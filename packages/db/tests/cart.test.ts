import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { TenantIsolationError } from '@velnorix/core';
import { truncateAllData } from '@velnorix/test-utils';
import {
  addCartItem,
  clearCart,
  closeDatabase,
  createProduct,
  createStore,
  createUser,
  getCart,
  getOrCreateCustomerCart,
  getOrCreateGuestCart,
  hashCartToken,
  plans,
  productVariants,
  removeCartItem,
  setCartItemQuantity,
  withPlatform,
  withTenant,
  type Store,
} from '../src/index.js';

/**
 * Cart rules that are easy to get wrong and expensive to get wrong in
 * production: a cart must never mix stores, never store the raw guest token,
 * never let a browser decide the price, and never go below one item or above
 * the per-line cap.
 */
describe('cart repository', () => {
  let store: Store;
  let productId: string;
  let variantId: string;

  beforeEach(async () => {
    await truncateAllData();
    store = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
      if (!plan) throw new Error('missing starter plan');
      return createStore(db, { slug: 'cart-shop', name: 'Cart Shop', planId: plan!.id });
    });

    const product = await withTenant(store.id, (db) =>
      createProduct(db, {
        storeId: store.id,
        titleEn: 'Sneaker',
        titleAr: 'حذاء',
        handle: 'sneaker',
        priceMinor: 100_00,
        currency: 'EGP',
        inventoryQuantity: 10,
      }),
    );
    productId = product.id;

    variantId = await withTenant(store.id, async (db) => {
      const [variant] = await db
        .insert(productVariants)
        .values({
          storeId: store.id,
          productId,
          titleEn: '42',
          titleAr: '٤٢',
          sku: 'SNK-42',
          priceMinor: 120_00,
          inventoryQuantity: 3,
        })
        .returning({ id: productVariants.id });
      return variant!.id;
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('only stores the hash of the guest token', async () => {
    const token = 'a-very-secret-cart-token';
    await withTenant(store.id, async (db) => {
      const cart = await getOrCreateGuestCart(db, token, 'EGP');
      expect(cart.guestTokenHash).toBe(hashCartToken(token));
      expect(cart.guestTokenHash).not.toContain('secret');
    });
  });

  it('re-uses one cart per guest token and one per customer', async () => {
    const first = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'token-a', 'EGP'));
    const second = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'token-a', 'EGP'));
    expect(second.id).toBe(first.id);

    const user = await withPlatform((db) =>
      createUser(db, {
        email: 'guest@example.com',
        fullName: 'Guest',
        context: 'customer',
        storeId: store.id,
        passwordHash: 'x',
      }),
    );
    const a = await withTenant(store.id, (db) => getOrCreateCustomerCart(db, user.id, 'EGP'));
    const b = await withTenant(store.id, (db) => getOrCreateCustomerCart(db, user.id, 'EGP'));
    expect(b.id).toBe(a.id);
    expect(a.customerUserId).toBe(user.id);
  });

  it('prices a line from the product, and from the variant when one is chosen', async () => {
    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'pricing', 'EGP'));

    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId: null,
        quantity: 2,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );
    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId,
        quantity: 1,
        unitPriceMinor: 120_00,
        currency: 'EGP',
      }),
    );

    const withLines = await withTenant(store.id, (db) => getCart(db, cart));
    expect(withLines.lines).toHaveLength(2);
    expect(withLines.subtotal.amount).toBe(320_00);
    expect(withLines.itemCount).toBe(3);
  });

  it('bumps the quantity instead of duplicating a line', async () => {
    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'bump', 'EGP'));
    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId: null,
        quantity: 1,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );
    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId: null,
        quantity: 2,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );

    const withLines = await withTenant(store.id, (db) => getCart(db, cart));
    expect(withLines.lines).toHaveLength(1);
    expect(withLines.lines[0]!.quantity).toBe(3);
  });

  it('clamps the quantity to 1..99', async () => {
    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'clamp', 'EGP'));
    const line = await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId: null,
        quantity: 1,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );

    await withTenant(store.id, (db) => setCartItemQuantity(db, line.id, 0));
    let withLines = await withTenant(store.id, (db) => getCart(db, cart));
    expect(withLines.lines).toHaveLength(0);

    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId: null,
        quantity: 5,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );
    withLines = await withTenant(store.id, (db) => getCart(db, cart));
    await withTenant(store.id, (db) => setCartItemQuantity(db, withLines.lines[0]!.id, 500));
    withLines = await withTenant(store.id, (db) => getCart(db, cart));
    expect(withLines.lines[0]!.quantity).toBe(99);
  });

  it('removes a line and clears the cart', async () => {
    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'remove', 'EGP'));
    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId: null,
        quantity: 1,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );

    let withLines = await withTenant(store.id, (db) => getCart(db, cart));
    await withTenant(store.id, (db) => removeCartItem(db, withLines.lines[0]!.id));
    withLines = await withTenant(store.id, (db) => getCart(db, cart));
    expect(withLines.lines).toHaveLength(0);

    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId: null,
        quantity: 1,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );
    await withTenant(store.id, (db) => clearCart(db, cart.id));
    withLines = await withTenant(store.id, (db) => getCart(db, cart));
    expect(withLines.lines).toHaveLength(0);
    expect(withLines.subtotal.amount).toBe(0);
  });

  it('refuses to add another store product to a cart', async () => {
    const other = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
      return createStore(db, { slug: 'other-shop', name: 'Other', planId: plan!.id });
    });
    const foreign = await withTenant(other.id, (db) =>
      createProduct(db, {
        storeId: other.id,
        titleEn: 'Foreign',
        titleAr: 'أجنبي',
        handle: 'foreign',
        priceMinor: 50_00,
        currency: 'EGP',
      }),
    );

    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'cross', 'EGP'));
    await expect(
      withTenant(store.id, (db) =>
        addCartItem(db, {
          cartId: cart.id,
          productId: foreign.id,
          variantId: null,
          quantity: 1,
          unitPriceMinor: 50_00,
          currency: 'EGP',
        }),
      ),
    ).rejects.toThrow(TenantIsolationError);
  });
});
