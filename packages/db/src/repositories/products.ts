import { and, desc, eq, sql } from 'drizzle-orm';
import { buildPage, decodeCursor, TenantIsolationError, type Page } from '@velnorix/core';
import type { Database } from '../client.js';
import { requireTenantId } from '../tenant-context.js';
import { products, type NewProduct, type Product } from '../schema.js';

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
