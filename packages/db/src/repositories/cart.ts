import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { TenantIsolationError, money, sha256Hex, sum, type Money } from '@velnorix/core';
import type { Database } from '../client.js';
import { requireTenantId } from '../tenant-context.js';
import {
  cartItems,
  carts,
  productImages,
  productVariants,
  products,
  type Cart,
  type CartItem,
} from '../schema.js';

/**
 * Shopping carts (tenant table).
 *
 * A cart is either a guest cart (identified by the SHA-256 of a cookie token)
 * or a customer cart (identified by `customer_user_id`). Only the hash is
 * stored, so a database leak cannot be replayed to take over a cart.
 *
 * Prices are captured onto the line item when it is added: raising a price must
 * never silently change what is already in someone's cart.
 */

export type CartLine = CartItem & {
  titleAr: string;
  titleEn: string;
  handle: string;
  imageUrl: string | null;
  variantTitleAr: string | null;
  variantTitleEn: string | null;
  /** Price of one unit, as stored on the line. */
  unitPrice: Money;
  /** unitPrice * quantity. */
  lineTotal: Money;
};

export type CartWithLines = {
  cart: Cart;
  lines: CartLine[];
  /** Sum of the line totals, in the cart's currency. */
  subtotal: Money;
  itemCount: number;
};

/** The only value ever persisted from a guest cookie. */
export function hashCartToken(token: string): string {
  return sha256Hex(token);
}

async function findActiveCart(db: Database, where: ReturnType<typeof and>): Promise<Cart | null> {
  const [row] = await db
    .select()
    .from(carts)
    .where(and(eq(carts.storeId, requireTenantId()), eq(carts.status, 'active'), where))
    .limit(1);
  return row ?? null;
}

function newCartId(): string {
  // crypto.randomUUID is available in Node 22; kept as a helper so the intent
  // ("a fresh cart id") is explicit and testable.
  return crypto.randomUUID();
}

export async function getOrCreateGuestCart(
  db: Database,
  guestToken: string,
  currency = 'EGP',
): Promise<Cart> {
  const storeId = requireTenantId();
  const guestTokenHash = hashCartToken(guestToken);

  const existing = await findActiveCart(db, eq(carts.guestTokenHash, guestTokenHash));
  if (existing) return existing;

  const [created] = await db
    .insert(carts)
    .values({ id: newCartId(), storeId, guestTokenHash, currency })
    .onConflictDoNothing()
    .returning();
  // A concurrent request may have created the cart first: read it back rather
  // than returning a row we did not insert.
  return created ?? (await findActiveCart(db, eq(carts.guestTokenHash, guestTokenHash)))!;
}

export async function getOrCreateCustomerCart(
  db: Database,
  customerUserId: string,
  currency = 'EGP',
): Promise<Cart> {
  const storeId = requireTenantId();
  const existing = await findActiveCart(db, eq(carts.customerUserId, customerUserId));
  if (existing) return existing;

  const [created] = await db
    .insert(carts)
    .values({ id: newCartId(), storeId, customerUserId, currency })
    .onConflictDoNothing()
    .returning();
  return created ?? (await findActiveCart(db, eq(carts.customerUserId, customerUserId)))!;
}

/**
 * Moves a guest cart to a customer: the cart the shopper filled before signing
 * in survives the login. We claim rather than merge, so there is never a
 * half-merged cart to explain.
 */
export async function claimGuestCart(
  db: Database,
  guestToken: string,
  customerUserId: string,
): Promise<Cart | null> {
  const [claimed] = await db
    .update(carts)
    .set({ customerUserId, guestTokenHash: null, updatedAt: new Date() })
    .where(
      and(
        eq(carts.storeId, requireTenantId()),
        eq(carts.guestTokenHash, hashCartToken(guestToken)),
        eq(carts.status, 'active'),
        isNull(carts.customerUserId),
      ),
    )
    .returning();
  return claimed ?? null;
}

async function loadLines(db: Database, cartId: string): Promise<CartLine[]> {
  const rows = await db
    .select({
      item: cartItems,
      titleAr: products.titleAr,
      titleEn: products.titleEn,
      handle: products.handle,
      imageUrl: productImages.url,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    // Left join: a product with no image still renders.
    .leftJoin(
      productImages,
      and(eq(productImages.productId, cartItems.productId), eq(productImages.position, 0)),
    )
    .where(and(eq(cartItems.storeId, requireTenantId()), eq(cartItems.cartId, cartId)))
    .orderBy(asc(cartItems.createdAt));

  return rows.map((row) => {
    const unitPrice = money(row.item.unitPriceMinor, row.item.currency);
    return {
      ...row.item,
      titleAr: row.titleAr,
      titleEn: row.titleEn,
      handle: row.handle,
      imageUrl: row.imageUrl,
      variantTitleAr: null,
      variantTitleEn: null,
      unitPrice,
      lineTotal: money(row.item.unitPriceMinor * row.item.quantity, row.item.currency),
    };
  });
}

export async function getCart(db: Database, cart: Cart): Promise<CartWithLines> {
  const lines = await loadLines(db, cart.id);
  const subtotal =
    lines.length === 0
      ? money(0, cart.currency)
      : sum(
          lines.map((line) => line.lineTotal),
          cart.currency,
        );
  return {
    cart,
    lines,
    subtotal,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
  };
}

export type AddToCartInput = {
  cartId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPriceMinor: number;
  currency: string;
};

/**
 * Adds (or bumps) a line.
 *
 * The quantity is clamped to [1, 99] here as well as in the UI: a cart is not
 * the place to discover that someone typed 100000.
 */
export async function addCartItem(db: Database, input: AddToCartInput): Promise<CartItem> {
  const storeId = requireTenantId();
  const quantity = Math.min(Math.max(Math.trunc(input.quantity), 1), 99);
  const variantId = input.variantId ?? null;

  /*
   * A cart item references a product, and a product belongs to one store. The
   * foreign key alone does not enforce that: it would happily accept another
   * store's product id, and checkout would then bill for it. So the product is
   * re-read inside the tenant scope -- if it is not visible here, it is not
   * this store's product and it does not go in the cart.
   */
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.id, input.productId)))
    .limit(1);
  if (!product) {
    throw new TenantIsolationError('Product does not belong to this store.');
  }

  if (variantId) {
    const [variant] = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.storeId, storeId),
          eq(productVariants.id, variantId),
          eq(productVariants.productId, input.productId),
        ),
      )
      .limit(1);
    if (!variant) {
      throw new TenantIsolationError('Variant does not belong to this product.');
    }
  }

  const [line] = await db
    .insert(cartItems)
    .values({
      storeId,
      cartId: input.cartId,
      productId: input.productId,
      variantId,
      quantity,
      unitPriceMinor: input.unitPriceMinor,
      currency: input.currency,
    })
    // The two partial unique indexes mean the conflict target depends on
    // whether the line has a variant.
    .onConflictDoUpdate({
      target:
        variantId === null
          ? [cartItems.cartId, cartItems.productId]
          : [cartItems.cartId, cartItems.productId, cartItems.variantId],
      targetWhere:
        variantId === null
          ? sql`${cartItems.variantId} IS NULL`
          : sql`${cartItems.variantId} IS NOT NULL`,
      set: {
        quantity: sql`LEAST(99, ${cartItems.quantity} + ${quantity})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return line!;
}

export async function setCartItemQuantity(
  db: Database,
  itemId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) {
    await removeCartItem(db, itemId);
    return;
  }
  await db
    .update(cartItems)
    .set({ quantity: Math.min(Math.trunc(quantity), 99), updatedAt: new Date() })
    .where(and(eq(cartItems.storeId, requireTenantId()), eq(cartItems.id, itemId)));
}

export async function removeCartItem(db: Database, itemId: string): Promise<void> {
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.storeId, requireTenantId()), eq(cartItems.id, itemId)));
}

export async function clearCart(db: Database, cartId: string): Promise<void> {
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.storeId, requireTenantId()), eq(cartItems.cartId, cartId)));
}

/** Marks a cart converted. Called by checkout, once an order exists. */
export async function markCartConverted(db: Database, cartId: string): Promise<void> {
  await db
    .update(carts)
    .set({ status: 'converted', updatedAt: new Date() })
    .where(and(eq(carts.storeId, requireTenantId()), eq(carts.id, cartId)));
}
