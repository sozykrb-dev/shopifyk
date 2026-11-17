import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InsufficientStockError } from '@velnorix/core';
import { truncateAllData } from '@velnorix/test-utils';
import {
  closeDatabase,
  createProduct,
  createStore,
  getOrCreateGuestCart,
  addCartItem,
  countOutOfStock,
  placeOrder,
  plans,
  productStock,
  releaseStock,
  reserveStock,
  variantStock,
  withPlatform,
  withTenant,
  type Store,
} from '../src/index.js';
import { eq } from 'drizzle-orm';
import { carts, productVariants } from '../src/schema.js';

/**
 * Inventory.
 *
 * The property that matters is not "the number goes down" -- it is that two
 * customers cannot buy the last item. Everything here exists to pin that one
 * guarantee, because overselling is the failure a merchant discovers on the
 * phone to an angry customer, not in a log.
 */
describe('inventory', () => {
  let store: Store;

  /**
   * A product with one variant holding `stock` units.
   *
   * Variants are where stock lives -- a product row's own `inventory_quantity`
   * is the seed's legacy field and is not what checkout reserves against, so
   * the test builds the shape the engine actually reads.
   */
  async function productWithStock(
    handle: string,
    stock: number,
  ): Promise<{ productId: string; variantId: string }> {
    return withTenant(store.id, async (db) => {
      const product = await createProduct(db, {
        storeId: store.id,
        titleAr: 'منتج',
        titleEn: 'Product',
        handle,
        priceMinor: 10_000,
        currency: 'EGP',
        status: 'active',
      });

      const [variant] = await db
        .insert(productVariants)
        .values({
          storeId: store.id,
          productId: product.id,
          titleAr: 'افتراضي',
          titleEn: 'Default',
          sku: `${handle}-sku`,
          priceMinor: 10_000,
          currency: 'EGP',
          inventoryQuantity: stock,
        })
        .returning({ id: productVariants.id });
      if (!variant) throw new Error('expected the variant insert to return a row');

      return { productId: product.id, variantId: variant.id };
    });
  }

  async function setStock(variantId: string, quantity: number): Promise<void> {
    await withTenant(store.id, async (db) => {
      await db
        .update(productVariants)
        .set({ inventoryQuantity: quantity, updatedAt: new Date() })
        .where(eq(productVariants.id, variantId));
    });
  }

  async function stockOf(variantId: string): Promise<number | undefined> {
    return withTenant(store.id, async (db) => (await variantStock(db, [variantId])).get(variantId));
  }

  beforeEach(async () => {
    await truncateAllData();
    const [starter] = await withPlatform((db) =>
      db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter')),
    );
    store = await withPlatform((db) =>
      createStore(db, { slug: 'stock-shop', name: 'Stock Shop', planId: starter!.id }),
    );
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('reserving stock', () => {
    it('takes stock out when it is there', async () => {
      const { variantId } = await productWithStock('in-stock', 5);
      await setStock(variantId, 5);
      const unavailable = await withTenant(store.id, (db) =>
        reserveStock(db, [{ variantId, quantity: 2 }]),
      );
      expect(unavailable).toEqual([]);
      expect(await stockOf(variantId)).toBe(3);
    });

    it('refuses to go below zero and reports the variant', async () => {
      const { variantId } = await productWithStock('low-stock', 1);
      await setStock(variantId, 1);
      const unavailable = await withTenant(store.id, (db) =>
        reserveStock(db, [{ variantId, quantity: 2 }]),
      );
      expect(unavailable).toEqual([variantId]);
      // Nothing was taken: a half-successful reservation is worse than none.
      expect(await stockOf(variantId)).toBe(1);
    });

    it('takes two lines of the same variant in one go', async () => {
      const { variantId } = await productWithStock('two-lines', 3);
      await setStock(variantId, 3);
      const unavailable = await withTenant(store.id, (db) =>
        reserveStock(db, [
          { variantId, quantity: 2 },
          { variantId, quantity: 1 },
        ]),
      );
      expect(unavailable).toEqual([]);
      expect(await stockOf(variantId)).toBe(0);
    });

    it('refuses when the lines of one variant together exceed stock', async () => {
      const { variantId } = await productWithStock('two-lines-over', 2);
      await setStock(variantId, 2);
      const unavailable = await withTenant(store.id, (db) =>
        reserveStock(db, [
          { variantId, quantity: 1 },
          { variantId, quantity: 2 },
        ]),
      );
      expect(unavailable).toEqual([variantId]);
      expect(await stockOf(variantId)).toBe(2);
    });

    it('ignores lines without a variant', async () => {
      const unavailable = await withTenant(store.id, (db) =>
        reserveStock(db, [{ variantId: null, quantity: 999 }]),
      );
      expect(unavailable).toEqual([]);
    });

    it('puts stock back when an order is cancelled', async () => {
      const { variantId } = await productWithStock('refundable', 4);
      await setStock(variantId, 4);
      await withTenant(store.id, (db) => reserveStock(db, [{ variantId, quantity: 4 }]));
      expect(await stockOf(variantId)).toBe(0);
      await withTenant(store.id, (db) => releaseStock(db, [{ variantId, quantity: 4 }]));
      expect(await stockOf(variantId)).toBe(4);
    });
  });

  describe('placing an order', () => {
    it('takes the stock when the order succeeds', async () => {
      const { productId, variantId } = await productWithStock('ordered', 3);
      await setStock(variantId, 3);

      await withTenant(store.id, async (db) => {
        const cart = await getOrCreateGuestCart(db, 'guest-ordered');
        await addCartItem(db, {
          cartId: cart.id,
          productId,
          variantId,
          quantity: 2,
          unitPriceMinor: 10_000,
          currency: 'EGP',
        });
        await placeOrder(
          db,
          {
            cartId: cart.id,
            customerUserId: null,
            currency: 'EGP',
            email: 'buyer@example.com',
            shippingName: 'مشتري',
            addressLine1: 'شارع',
            city: 'القاهرة',
          },
          [
            {
              productId,
              variantId,
              titleAr: 'منتج',
              titleEn: 'Product',
              variantTitleAr: null,
              variantTitleEn: null,
              sku: null,
              quantity: 2,
              unitPriceMinor: 10_000,
            },
          ],
        );
      });

      expect(await stockOf(variantId)).toBe(1);
    });

    it('refuses the whole order rather than overselling', async () => {
      const { productId, variantId } = await productWithStock('oversell', 1);
      await setStock(variantId, 1);

      await withTenant(store.id, async (db) => {
        const cart = await getOrCreateGuestCart(db, 'guest-oversell');
        await addCartItem(db, {
          cartId: cart.id,
          productId,
          variantId,
          quantity: 1,
          unitPriceMinor: 10_000,
          currency: 'EGP',
        });
        // The cart was filled when stock existed; it ran out since. The order
        // must fail rather than sell what is not there.
        await setStock(variantId, 0);
        await expect(
          placeOrder(
            db,
            {
              cartId: cart.id,
              customerUserId: null,
              currency: 'EGP',
              email: 'buyer@example.com',
              shippingName: 'مشتري',
              addressLine1: 'شارع',
              city: 'القاهرة',
            },
            [
              {
                productId,
                variantId,
                titleAr: 'منتج',
                titleEn: 'Product',
                variantTitleAr: null,
                variantTitleEn: null,
                sku: null,
                quantity: 1,
                unitPriceMinor: 10_000,
              },
            ],
          ),
        ).rejects.toBeInstanceOf(InsufficientStockError);
      });

      // The transaction rolled back: the cart is still spendable and the
      // stock record was not invented out of nothing.
      expect(await stockOf(variantId)).toBe(0);
    });

    it('does not spend the cart when the order is refused', async () => {
      const { productId, variantId } = await productWithStock('no-stock', 0);
      await setStock(variantId, 0);

      const stillActive = await withTenant(store.id, async (db) => {
        const cart = await getOrCreateGuestCart(db, 'guest-no-stock');
        try {
          await placeOrder(
            db,
            {
              cartId: cart.id,
              customerUserId: null,
              currency: 'EGP',
              email: 'buyer@example.com',
              shippingName: 'مشتري',
              addressLine1: 'شارع',
              city: 'القاهرة',
            },
            [
              {
                productId,
                variantId,
                titleAr: 'منتج',
                titleEn: 'Product',
                variantTitleAr: null,
                variantTitleEn: null,
                sku: null,
                quantity: 1,
                unitPriceMinor: 10_000,
              },
            ],
          );
        } catch {
          /* expected */
        }
        const rows = await db
          .select({ status: carts.status })
          .from(carts)
          .where(eq(carts.id, cart.id));
        return rows[0]?.status;
      });

      expect(stillActive).toBe('active');
    });
  });

  describe('the cart respects stock', () => {
    it('clamps a line to what is actually available', async () => {
      const { productId, variantId } = await productWithStock('clamped', 2);
      await setStock(variantId, 2);

      const line = await withTenant(store.id, async (db) => {
        const cart = await getOrCreateGuestCart(db, 'guest-clamped');
        return addCartItem(db, {
          cartId: cart.id,
          productId,
          variantId,
          quantity: 9,
          unitPriceMinor: 10_000,
          currency: 'EGP',
        });
      });
      expect(line.quantity).toBe(2);
    });

    it('never accumulates past the stock when added twice', async () => {
      const { productId, variantId } = await productWithStock('twice', 3);
      await setStock(variantId, 3);

      const line = await withTenant(store.id, async (db) => {
        const cart = await getOrCreateGuestCart(db, 'guest-twice');
        await addCartItem(db, {
          cartId: cart.id,
          productId,
          variantId,
          quantity: 2,
          unitPriceMinor: 10_000,
          currency: 'EGP',
        });
        return addCartItem(db, {
          cartId: cart.id,
          productId,
          variantId,
          quantity: 2,
          unitPriceMinor: 10_000,
          currency: 'EGP',
        });
      });
      expect(line.quantity).toBe(3);
    });

    it('refuses to add an item that has sold out', async () => {
      const { productId, variantId } = await productWithStock('sold-out', 0);
      await setStock(variantId, 0);

      await withTenant(store.id, async (db) => {
        const cart = await getOrCreateGuestCart(db, 'guest-sold-out');
        await expect(
          addCartItem(db, {
            cartId: cart.id,
            productId,
            variantId,
            quantity: 1,
            unitPriceMinor: 10_000,
            currency: 'EGP',
          }),
        ).rejects.toBeInstanceOf(InsufficientStockError);
      });
    });
  });

  describe('products that carry their own stock', () => {
    /*
     * Most stores sell whole products with no sizes or colours, and those keep
     * their stock on the product row. A reservation that only understood
     * variants would be a silent no-op for them -- which is to say it would
     * let them oversell while the tests passed.
     */
    async function simpleProduct(handle: string, stock: number): Promise<string> {
      return withTenant(store.id, async (db) => {
        const product = await createProduct(db, {
          storeId: store.id,
          titleAr: 'منتج',
          titleEn: 'Product',
          handle,
          priceMinor: 5_000,
          currency: 'EGP',
          status: 'active',
          inventoryQuantity: stock,
        });
        return product.id;
      });
    }

    it('takes stock from the product when there is no variant', async () => {
      const productId = await simpleProduct('plain', 4);
      const unavailable = await withTenant(store.id, (db) =>
        reserveStock(db, [{ productId, variantId: null, quantity: 3 }]),
      );
      expect(unavailable).toEqual([]);
      const left = await withTenant(store.id, (db) => productStock(db, [productId]));
      expect(left.get(productId)).toBe(1);
    });

    it('refuses to oversell a product that has no variants', async () => {
      const productId = await simpleProduct('plain-low', 1);
      const unavailable = await withTenant(store.id, (db) =>
        reserveStock(db, [{ productId, variantId: null, quantity: 2 }]),
      );
      expect(unavailable).toEqual([productId]);
      const left = await withTenant(store.id, (db) => productStock(db, [productId]));
      expect(left.get(productId)).toBe(1);
    });

    it('refuses an order for a product with no stock left', async () => {
      const productId = await simpleProduct('plain-empty', 0);
      await withTenant(store.id, async (db) => {
        const cart = await getOrCreateGuestCart(db, 'guest-plain-empty');
        await expect(
          placeOrder(
            db,
            {
              cartId: cart.id,
              customerUserId: null,
              currency: 'EGP',
              email: 'buyer@example.com',
              shippingName: 'مشتري',
              addressLine1: 'شارع',
              city: 'القاهرة',
            },
            [
              {
                productId,
                variantId: null,
                titleAr: 'منتج',
                titleEn: 'Product',
                variantTitleAr: null,
                variantTitleEn: null,
                sku: null,
                quantity: 1,
                unitPriceMinor: 5_000,
              },
            ],
          ),
        ).rejects.toBeInstanceOf(InsufficientStockError);
      });
    });

    it('counts a product at zero only when it has no variants', async () => {
      await simpleProduct('plain-out', 0);
      const { variantId } = await productWithStock('variant-out', 0);
      await setStock(variantId, 0);
      // One product at zero, one variant at zero, and the variant's product is
      // not counted again.
      expect(await withTenant(store.id, (db) => countOutOfStock(db))).toBe(2);
    });
  });

  describe('reporting', () => {
    it('counts variants that have run out', async () => {
      const a = await productWithStock('out-a', 0);
      const b = await productWithStock('out-b', 5);
      await setStock(a.variantId, 0);
      await setStock(b.variantId, 5);
      expect(await withTenant(store.id, (db) => countOutOfStock(db))).toBe(1);
    });
  });
});
