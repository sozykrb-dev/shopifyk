import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { buildPage, decodeCursor, TenantIsolationError, type Page } from '@velnorix/core';
import type { Database } from '../client.js';
import { requireTenantId } from '../tenant-context.js';
import {
  productVariants,
  products,
  type NewProduct,
  type Product,
  type ProductVariant,
} from '../schema.js';

/**
 * Tenant-scoped product repository.
 *
 * Every function here must run inside `withTenant()` and adds its own
 * `WHERE store_id = <current tenant>` filter (layer 1). Postgres RLS is the
 * second, independent layer: even a query that forgets the filter cannot reach
 * another tenant's rows.
 */

export type CreateProductInput = {
  /** Must match the active tenant context; anything else is a bug, not a filter. */
  storeId: string;
  titleEn: string;
  titleAr: string;
  handle: string;
  descriptionEn?: string | null;
  descriptionAr?: string | null;
  priceMinor: number;
  currency?: string;
  sku?: string | null;
  inventoryQuantity?: number;
  status?: Product['status'];
};

export type ListProductsFilter = {
  limit: number;
  cursor?: string | undefined;
  status?: Product['status'] | undefined;
  search?: string | undefined;
};

export async function listProducts(
  db: Database,
  filter: ListProductsFilter,
): Promise<Page<Product>> {
  const conditions = [eq(products.storeId, requireTenantId())];
  if (filter.status) conditions.push(eq(products.status, filter.status));
  if (filter.search) {
    const term = `%${filter.search}%`;
    conditions.push(
      sql`(${products.titleEn} ILIKE ${term} OR ${products.titleAr} ILIKE ${term} OR ${products.handle} ILIKE ${term})`,
    );
  }
  if (filter.cursor) {
    const cursor = decodeCursor(filter.cursor);
    const cursorDate = new Date(cursor.k);
    // Keyset pagination: (created_at, id) < (cursor.k, cursor.i)
    // Timestamps are truncated to milliseconds on both sides: a JS Date cannot
    // represent Postgres microsecond precision, and an untruncated comparison
    // would silently skip rows written inside the same millisecond.
    const keyset = sql`(date_trunc('milliseconds', ${products.createdAt}) < ${cursorDate.toISOString()}::timestamptz
      OR (date_trunc('milliseconds', ${products.createdAt}) = ${cursorDate.toISOString()}::timestamptz
          AND ${products.id} < ${cursor.i}))`;
    conditions.push(keyset);
  }

  const rows = await db
    .select()
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(filter.limit + 1);

  return buildPage(rows, filter.limit, (row) => ({
    k: row.createdAt.toISOString(),
    i: row.id,
  }));
}

/**
 * Stock that is actually available.
 *
 * Two places hold stock, and both are real:
 *
 *   - a **variant** (`product_variants.inventory_quantity`) when the product
 *     comes in sizes or colours;
 *   - the **product** itself (`products.inventory_quantity`) when it does not.
 *
 * A line therefore names which of the two it draws from, and a reservation
 * that only understood variants would be a silent no-op for every store that
 * sells whole products -- which is most of them.
 */
export type StockLine = {
  productId?: string | null;
  variantId?: string | null;
  quantity: number;
};

export async function variantStock(
  db: Database,
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db
    .select({ id: productVariants.id, quantity: productVariants.inventoryQuantity })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.storeId, requireTenantId()),
        inArray(productVariants.id, [...variantIds]),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.quantity]));
}

export async function productStock(
  db: Database,
  productIds: readonly string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ id: products.id, quantity: products.inventoryQuantity })
    .from(products)
    .where(and(eq(products.storeId, requireTenantId()), inArray(products.id, [...productIds])));
  return new Map(rows.map((row) => [row.id, row.quantity]));
}

/** How many of this line may be sold at all: variant stock, else product stock. */
export async function stockLimitFor(
  db: Database,
  line: { productId?: string | null; variantId?: string | null },
): Promise<number> {
  if (line.variantId) {
    const stock = await variantStock(db, [line.variantId]);
    return stock.get(line.variantId) ?? 0;
  }
  if (line.productId) {
    const stock = await productStock(db, [line.productId]);
    return stock.get(line.productId) ?? 0;
  }
  return 0;
}

/**
 * Takes stock out, atomically, and refuses to go below zero.
 *
 * The guard is the `WHERE inventory_quantity >= qty` clause, not a read
 * followed by a write: two customers buying the last item at the same instant
 * must not both succeed, and only a conditional update inside the caller's
 * transaction can promise that. If any line would oversell, nothing is taken
 * and the caller's transaction is expected to roll back -- an order is placed
 * whole or not at all.
 *
 * Returns the ids that could not be satisfied, empty on success.
 */
export async function reserveStock(db: Database, lines: readonly StockLine[]): Promise<string[]> {
  const storeId = requireTenantId();
  const unavailable: string[] = [];

  /*
   * Grouped by what the stock is drawn from, because two lines of the same
   * variant or product must be taken in one go: taking them one at a time
   * would let the second fail after the first succeeded, leaving stock gone
   * with no order to show for it.
   */
  const variants = new Map<string, number>();
  const simple = new Map<string, number>();
  for (const line of lines) {
    const quantity = Math.max(0, Math.trunc(line.quantity));
    if (quantity === 0) continue;
    if (line.variantId) {
      variants.set(line.variantId, (variants.get(line.variantId) ?? 0) + quantity);
    } else if (line.productId) {
      simple.set(line.productId, (simple.get(line.productId) ?? 0) + quantity);
    }
  }

  for (const [variantId, quantity] of variants) {
    const updated = await db
      .update(productVariants)
      .set({
        inventoryQuantity: sql`${productVariants.inventoryQuantity} - ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productVariants.id, variantId),
          eq(productVariants.storeId, storeId),
          sql`${productVariants.inventoryQuantity} >= ${quantity}`,
        ),
      )
      .returning({ id: productVariants.id });
    if (updated.length === 0) unavailable.push(variantId);
  }

  for (const [productId, quantity] of simple) {
    const updated = await db
      .update(products)
      .set({
        inventoryQuantity: sql`${products.inventoryQuantity} - ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(products.id, productId),
          eq(products.storeId, storeId),
          sql`${products.inventoryQuantity} >= ${quantity}`,
        ),
      )
      .returning({ id: products.id });
    if (updated.length === 0) unavailable.push(productId);
  }

  return unavailable;
}

/** Puts stock back -- a cancelled or refunded order must not destroy inventory. */
export async function releaseStock(db: Database, lines: readonly StockLine[]): Promise<void> {
  const storeId = requireTenantId();

  const variants = new Map<string, number>();
  const simple = new Map<string, number>();
  for (const line of lines) {
    const quantity = Math.max(0, Math.trunc(line.quantity));
    if (quantity === 0) continue;
    if (line.variantId) {
      variants.set(line.variantId, (variants.get(line.variantId) ?? 0) + quantity);
    } else if (line.productId) {
      simple.set(line.productId, (simple.get(line.productId) ?? 0) + quantity);
    }
  }

  for (const [variantId, quantity] of variants) {
    await db
      .update(productVariants)
      .set({
        inventoryQuantity: sql`${productVariants.inventoryQuantity} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, storeId)));
  }

  for (const [productId, quantity] of simple) {
    await db
      .update(products)
      .set({
        inventoryQuantity: sql`${products.inventoryQuantity} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, productId), eq(products.storeId, storeId)));
  }
}

/** The variants of a product, in the order the merchant arranged them. */
export async function listVariants(db: Database, productId: string): Promise<ProductVariant[]> {
  return db
    .select()
    .from(productVariants)
    .where(
      and(eq(productVariants.storeId, requireTenantId()), eq(productVariants.productId, productId)),
    )
    .orderBy(asc(productVariants.position), asc(productVariants.createdAt));
}

/**
 * How many things have run out: variants at zero, plus products that carry
 * their own stock and are at zero. A product with variants is not counted
 * twice -- its availability is its variants' business.
 */
export async function countOutOfStock(db: Database): Promise<number> {
  const storeId = requireTenantId();
  const [variantRows] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(productVariants)
    .where(
      and(eq(productVariants.storeId, storeId), sql`${productVariants.inventoryQuantity} <= 0`),
    );

  const [withVariants] = await db
    .select({ total: sql<number>`count(distinct ${productVariants.productId})::int` })
    .from(productVariants)
    .where(eq(productVariants.storeId, storeId));

  const [productRows] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .where(
      and(
        eq(products.storeId, storeId),
        sql`${products.inventoryQuantity} <= 0`,
        sql`not exists (select 1 from ${productVariants} where ${productVariants.productId} = ${products.id})`,
      ),
    );

  // `withVariants` is subtracted from nothing here and kept for readability:
  // the two counts are disjoint by construction -- a product that has variants
  // is excluded from the second query.
  void withVariants;
  return (variantRows?.total ?? 0) + (productRows?.total ?? 0);
}

export async function getProductByHandle(db: Database, handle: string): Promise<Product | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.storeId, requireTenantId()), eq(products.handle, handle)))
    .limit(1);
  return product ?? null;
}

export async function getProductById(db: Database, id: string): Promise<Product | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.storeId, requireTenantId()), eq(products.id, id)))
    .limit(1);
  return product ?? null;
}

export async function createProduct(db: Database, input: CreateProductInput): Promise<Product> {
  const tenantId = requireTenantId();
  if (input.storeId !== tenantId) {
    throw new TenantIsolationError('Cannot create a product for a different tenant.');
  }

  const values: NewProduct = {
    storeId: input.storeId,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    handle: input.handle,
    descriptionEn: input.descriptionEn ?? null,
    descriptionAr: input.descriptionAr ?? null,
    priceMinor: input.priceMinor,
    currency: input.currency ?? 'EGP',
    sku: input.sku ?? null,
    inventoryQuantity: input.inventoryQuantity ?? 0,
    status: input.status ?? 'draft',
    publishedAt: input.status === 'active' ? new Date() : null,
  };

  const [created] = await db.insert(products).values(values).returning();
  if (!created) throw new Error('Failed to create product.');
  return created;
}

export async function updateProduct(
  db: Database,
  id: string,
  patch: Partial<Omit<NewProduct, 'id' | 'storeId' | 'createdAt' | 'updatedAt'>>,
): Promise<Product> {
  const [updated] = await db
    .update(products)
    .set({
      ...patch,
      // Publishing a product stamps published_at once, not on every save.
      ...(patch.status === 'active'
        ? { publishedAt: sql`COALESCE(${products.publishedAt}, now())` }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(products.storeId, requireTenantId()), eq(products.id, id)))
    .returning();
  if (!updated) throw new Error(`Product ${id} not found.`);
  return updated;
}

export async function deleteProduct(db: Database, id: string): Promise<boolean> {
  const deleted = await db
    .delete(products)
    .where(and(eq(products.storeId, requireTenantId()), eq(products.id, id)))
    .returning({ id: products.id });
  return deleted.length > 0;
}

export async function countProducts(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.storeId, requireTenantId()));
  return Number(row?.value ?? 0);
}
