import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncateAllData } from '@velnorix/test-utils';
import {
  addCartItem,
  closeDatabase,
  countOrders,
  createProduct,
  createStore,
  getCart,
  getOrCreateGuestCart,
  getOrderById,
  getOrderByNumber,
  listCustomerOrders,
  listOrders,
  markOrderPaid,
  orders,
  products,
  plans,
  placeOrder,
  updateOrderStatus,
  withPlatform,
  withTenant,
  type Store,
} from '../src/index.js';

/**
 * Orders are where a bug stops being cosmetic: a double-submitted checkout is
 * two charges, and an order that follows a live product instead of a snapshot
 * rewrites what somebody already agreed to pay.
 */
describe('orders repository', () => {
  let store: Store;
  let productId: string;

  beforeEach(async () => {
    await truncateAllData();
    store = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
      return createStore(db, { slug: 'order-shop', name: 'Order Shop', planId: plan!.id });
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
  });

  afterAll(async () => {
    await closeDatabase();
  });

  async function cartWithTwoLines(guestToken: string) {
    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, guestToken, 'EGP'));
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
    const { lines } = await withTenant(store.id, (db) => getCart(db, cart));
    return { cart, lines };
  }

  it('snapshots the lines and the total at checkout', async () => {
    const { cart, lines } = await cartWithTwoLines('snap');
    const order = await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: cart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'ziad@example.com',
          shippingName: 'زياد',
          addressLine1: 'شارع الهرم ١',
          city: 'الجيزة',
          shippingMinor: 1500,
        },
        lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: line.variantTitleAr,
          variantTitleEn: line.variantTitleEn,
          sku: line.sku,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );

    expect(order.orderNumber).toBe(1001);
    expect(order.subtotalMinor).toBe(200_00);
    expect(order.shippingMinor).toBe(1500);
    expect(order.totalMinor).toBe(215_00);
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.status).toBe('pending');

    const withLines = await withTenant(store.id, (db) => getOrderById(db, order.id));
    expect(withLines?.items).toHaveLength(1);
    // The title is copied onto the line, not joined at read time.
    expect(withLines?.items[0]?.titleAr).toBe('حذاء');
    expect(withLines?.items[0]?.lineTotalMinor).toBe(200_00);
    expect(withLines?.total.amount).toBe(215_00);
  });

  it('does not change when the product is edited afterwards', async () => {
    const { cart, lines } = await cartWithTwoLines('frozen');
    await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: cart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'ziad@example.com',
          shippingName: 'زياد',
          addressLine1: 'شارع الهرم ١',
          city: 'الجيزة',
        },
        lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: line.variantTitleAr,
          variantTitleEn: line.variantTitleEn,
          sku: line.sku,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );

    // Rename the product and drop its price: the order must not follow.
    await withTenant(store.id, (db) =>
      db
        .update(products)
        .set({ titleAr: 'حذاء آخر', priceMinor: 1 })
        .where(eq(products.id, productId)),
    );

    const [placed] = await withTenant(store.id, (db) =>
      db.select().from(orders).where(eq(orders.storeId, store.id)),
    );
    const withLines = await withTenant(store.id, (db) => getOrderById(db, placed!.id));
    expect(withLines?.items[0]?.titleAr).toBe('حذاء');
    expect(withLines?.items[0]?.unitPriceMinor).toBe(100_00);
  });

  it('gives each store its own order-number sequence starting at 1001', async () => {
    const first = await cartWithTwoLines('seq-a');
    const a = await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: first.cart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'a@example.com',
          shippingName: 'أ',
          addressLine1: 'عنوان',
          city: 'القاهرة',
        },
        first.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: null,
          variantTitleEn: null,
          sku: null,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );
    expect(a.orderNumber).toBe(1001);

    const second = await cartWithTwoLines('seq-b');
    const b = await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: second.cart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'b@example.com',
          shippingName: 'ب',
          addressLine1: 'عنوان',
          city: 'القاهرة',
        },
        second.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: null,
          variantTitleEn: null,
          sku: null,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );
    expect(b.orderNumber).toBe(1002);

    // A brand-new store starts from 1001 again: the number is per store.
    const other = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
      return createStore(db, { slug: 'order-shop-2', name: 'Second', planId: plan!.id });
    });
    const otherProduct = await withTenant(other.id, (db) =>
      createProduct(db, {
        storeId: other.id,
        titleEn: 'Cap',
        titleAr: 'قبعة',
        handle: 'cap',
        priceMinor: 50_00,
        currency: 'EGP',
        // Stock is enforced now: an order can only be placed for units that
        // exist, so this product has to have some.
        inventoryQuantity: 10,
      }),
    );
    const otherCart = await withTenant(other.id, (db) =>
      getOrCreateGuestCart(db, 'other-guest', 'EGP'),
    );
    await withTenant(other.id, (db) =>
      addCartItem(db, {
        cartId: otherCart.id,
        productId: otherProduct.id,
        variantId: null,
        quantity: 1,
        unitPriceMinor: 50_00,
        currency: 'EGP',
      }),
    );
    const { lines: otherLines } = await withTenant(other.id, (db) => getCart(db, otherCart));
    const c = await withTenant(other.id, (db) =>
      placeOrder(
        db,
        {
          cartId: otherCart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'c@example.com',
          shippingName: 'ج',
          addressLine1: 'عنوان',
          city: 'الإسكندرية',
        },
        otherLines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: null,
          variantTitleEn: null,
          sku: null,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );
    expect(c.orderNumber).toBe(1001);
    expect(await withTenant(other.id, (db) => getOrderByNumber(db, 1001))).not.toBeNull();
  });

  it('marks the cart converted, so the same cart cannot be checked out twice', async () => {
    const { cart, lines } = await cartWithTwoLines('once');
    await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: cart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'once@example.com',
          shippingName: 'مرة واحدة',
          addressLine1: 'عنوان',
          city: 'القاهرة',
        },
        lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: null,
          variantTitleEn: null,
          sku: null,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );

    const after = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'once', 'EGP'));
    // A converted cart is not reused: the shopper gets a fresh one.
    expect(after.id).not.toBe(cart.id);
    expect(await withTenant(store.id, (db) => countOrders(db))).toBe(1);
  });

  it('refuses to place an empty order', async () => {
    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'empty', 'EGP'));
    await expect(
      withTenant(store.id, (db) =>
        placeOrder(
          db,
          {
            cartId: cart.id,
            customerUserId: null,
            currency: 'EGP',
            email: 'x@example.com',
            shippingName: 'x',
            addressLine1: 'x',
            city: 'x',
          },
          [],
        ),
      ),
    ).rejects.toThrow(/no lines/i);
  });

  it('lists a customer only their own orders', async () => {
    const { createUser } = await import('../src/index.js');
    const customer = await withPlatform((db) =>
      createUser(db, {
        email: 'cust@x.test',
        fullName: 'عميل',
        context: 'customer',
        storeId: store.id,
        passwordHash: 'x',
      }),
    );

    // One order belonging to the customer, one belonging to nobody.
    const mine = await cartWithTwoLines('mine');
    await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: mine.cart.id,
          customerUserId: customer.id,
          currency: 'EGP',
          email: 'cust@x.test',
          shippingName: 'عميل',
          addressLine1: 'عنوان',
          city: 'القاهرة',
        },
        mine.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: null,
          variantTitleEn: null,
          sku: null,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );

    const guest = await cartWithTwoLines('guest-order');
    await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: guest.cart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'guest@x.test',
          shippingName: 'زائر',
          addressLine1: 'عنوان',
          city: 'القاهرة',
        },
        guest.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: null,
          variantTitleEn: null,
          sku: null,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );

    const mine_orders = await withTenant(store.id, (db) => listCustomerOrders(db, customer.id));
    expect(mine_orders).toHaveLength(1);
    expect(mine_orders[0]?.email).toBe('cust@x.test');
    expect(await withTenant(store.id, (db) => countOrders(db))).toBe(2);
  });

  it('moves an order through status and payment', async () => {
    const { cart, lines } = await cartWithTwoLines('status');
    const order = await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: cart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 's@example.com',
          shippingName: 'س',
          addressLine1: 'عنوان',
          city: 'القاهرة',
        },
        lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: null,
          variantTitleEn: null,
          sku: null,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );

    const confirmed = await withTenant(store.id, (db) =>
      updateOrderStatus(db, order.id, 'confirmed'),
    );
    expect(confirmed?.status).toBe('confirmed');

    const paid = await withTenant(store.id, (db) => markOrderPaid(db, order.id, 'PAY-1'));
    expect(paid?.paymentStatus).toBe('paid');
    expect(paid?.paymentReference).toBe('PAY-1');

    const page = await withTenant(store.id, (db) =>
      listOrders(db, { limit: 10, status: 'confirmed' }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(order.id);

    const none = await withTenant(store.id, (db) =>
      listOrders(db, { limit: 10, status: 'cancelled' }),
    );
    expect(none.items).toHaveLength(0);
  });
});
