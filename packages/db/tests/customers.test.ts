import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncateAllData } from '@velnorix/test-utils';
import {
  addCartItem,
  closeDatabase,
  createProduct,
  createStore,
  createUser,
  customerStats,
  getCart,
  getOrCreateGuestCart,
  listCustomerOrdersByEmail,
  listStoreCustomers,
  markEmailVerified,
  placeOrder,
  plans,
  withPlatform,
  withPlatformTenant,
  withTenant,
  type Store,
} from '../src/index.js';

/**
 * Customers, as a merchant sees them.
 *
 * The rule these tests exist to protect: a customer is somebody who bought,
 * not somebody who registered. Get that backwards and the page silently
 * under-reports the store's customer base, which is the kind of bug nobody
 * files — the merchant just assumes business is bad.
 */
describe('customers repository', () => {
  let store: Store;
  let productId: string;

  beforeEach(async () => {
    await truncateAllData();
    store = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
      return createStore(db, { slug: 'customer-shop', name: 'Customer Shop', planId: plan!.id });
    });

    const product = await withTenant(store.id, (db) =>
      createProduct(db, {
        storeId: store.id,
        titleEn: 'Sneaker',
        titleAr: 'حذاء',
        handle: 'sneaker',
        priceMinor: 100_00,
        currency: 'EGP',
        inventoryQuantity: 100,
      }),
    );
    productId = product.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  async function order(email: string, customerUserId: string | null, quantity = 1) {
    const token = `cart-${email}-${quantity}-${Math.random()}`;
    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, token, 'EGP'));
    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId,
        variantId: null,
        quantity,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );
    const { lines } = await withTenant(store.id, (db) => getCart(db, cart));

    return withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: cart.id,
          customerUserId,
          currency: 'EGP',
          email,
          shippingName: 'عميل',
          addressLine1: 'شارع ١',
          city: 'القاهرة',
          shippingMinor: 0,
          discountMinor: 0,
          taxMinor: 0,
        },
        lines,
      ),
    );
  }

  it('counts a guest who never registered as a customer', async () => {
    await order('guest@example.com', null, 2);

    const customers = await withPlatformTenant(store.id, (db) => listStoreCustomers(db, store.id));

    expect(customers).toHaveLength(1);
    expect(customers[0]?.email).toBe('guest@example.com');
    expect(customers[0]?.registered).toBe(false);
    expect(customers[0]?.userId).toBeNull();
    expect(customers[0]?.orderCount).toBe(1);
    expect(customers[0]?.totalSpentMinor).toBe(200_00);
    /*
     * Must be a real Date. The obvious implementation returns a string here,
     * which typechecks and then blows up on the page at
     * `toLocaleDateString`. Asserting the type is the point of this line.
     */
    expect(customers[0]?.lastOrderAt).toBeInstanceOf(Date);
  });

  it('folds a guest order and a signed-in order for the same person into one customer', async () => {
    const account = await withPlatform((db) =>
      createUser(db, {
        email: 'SAME@example.com',
        fullName: 'نور',
        context: 'customer',
        storeId: store.id,
      }),
    );
    await withPlatform((db) => markEmailVerified(db, account.id));

    // One order before registering, one after. Same address, different case.
    await order('same@example.com', null, 1);
    await order('SAME@Example.com', account.id, 1);

    const customers = await withPlatformTenant(store.id, (db) => listStoreCustomers(db, store.id));

    expect(customers).toHaveLength(1);
    expect(customers[0]?.email).toBe('same@example.com');
    expect(customers[0]?.fullName).toBe('نور');
    expect(customers[0]?.registered).toBe(true);
    expect(customers[0]?.orderCount).toBe(2);
  });

  it('lists someone who registered but never ordered', async () => {
    await withPlatform(async (db) => {
      const user = await createUser(db, {
        email: 'silent@example.com',
        fullName: 'حساب بلا طلب',
        context: 'customer',
        storeId: store.id,
      });
      await markEmailVerified(db, user.id);
    });

    const customers = await withPlatformTenant(store.id, (db) => listStoreCustomers(db, store.id));

    expect(customers).toHaveLength(1);
    expect(customers[0]?.registered).toBe(true);
    expect(customers[0]?.orderCount).toBe(0);
    expect(customers[0]?.totalSpentMinor).toBe(0);
  });

  it('sorts by lifetime spend, and counts only repeat buyers as repeat', async () => {
    await order('big@example.com', null, 5);
    await order('small@example.com', null, 1);
    await order('small@example.com', null, 1);

    const customers = await withPlatformTenant(store.id, (db) => listStoreCustomers(db, store.id));
    expect(customers.map((row) => row.email)).toEqual(['big@example.com', 'small@example.com']);

    const stats = await withPlatformTenant(store.id, (db) => customerStats(db, store.id));
    expect(stats.total).toBe(2);
    expect(stats.repeat).toBe(1);
    expect(stats.guests).toBe(2);
    expect(stats.registered).toBe(0);
  });

  it("does not count another store's buyers", async () => {
    /*
     * Cross-tenant isolation for the customer list. A leaked customer list is
     * the most valuable thing in this database -- it is a marketing list for
     * someone else's shop, handed over by yours.
     */
    const other = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
      return createStore(db, { slug: 'other-shop', name: 'Other', planId: plan!.id });
    });

    await order('mine@example.com', null, 1);

    // An order on the other store, written through its own tenant scope and
    // never nested inside another scope's connection.
    const otherProduct = await withTenant(other.id, (db) =>
      createProduct(db, {
        storeId: other.id,
        titleEn: 'Other',
        titleAr: 'آخر',
        handle: 'other',
        priceMinor: 50_00,
        currency: 'EGP',
        inventoryQuantity: 10,
      }),
    );
    const otherCart = await withTenant(other.id, (db) =>
      getOrCreateGuestCart(db, 'other-cart', 'EGP'),
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
    const otherCartState = await withTenant(other.id, (db) => getCart(db, otherCart));
    await withTenant(other.id, (db) =>
      placeOrder(
        db,
        {
          cartId: otherCart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'theirs@example.com',
          shippingName: 'غيرنا',
          addressLine1: 'شارع ٢',
          city: 'القاهرة',
          shippingMinor: 0,
          discountMinor: 0,
          taxMinor: 0,
        },
        otherCartState.lines,
      ),
    );

    const mine = await withPlatformTenant(store.id, (db) => listStoreCustomers(db, store.id));
    expect(mine.map((row) => row.email)).toEqual(['mine@example.com']);

    const theirs = await withPlatformTenant(other.id, (db) => listStoreCustomers(db, other.id));
    expect(theirs.map((row) => row.email)).toEqual(['theirs@example.com']);
  });

  it("reads one customer's order history regardless of address case", async () => {
    await order('history@example.com', null, 1);
    await order('History@Example.com', null, 2);

    const history = await withPlatformTenant(store.id, (db) =>
      listCustomerOrdersByEmail(db, store.id, 'history@example.com'),
    );
    expect(history).toHaveLength(2);
    expect(history[0]?.totalMinor).toBe(200_00);
  });

  it('searches by name and by email', async () => {
    await withPlatform(async (db) => {
      const user = await createUser(db, {
        email: 'nour@example.com',
        fullName: 'نور الهدى',
        context: 'customer',
        storeId: store.id,
      });
      await markEmailVerified(db, user.id);
    });
    await order('ziad@example.com', null, 1);

    const byName = await withPlatformTenant(store.id, (db) =>
      listStoreCustomers(db, store.id, { search: 'نور' }),
    );
    expect(byName.map((row) => row.email)).toEqual(['nour@example.com']);

    const byEmail = await withPlatformTenant(store.id, (db) =>
      listStoreCustomers(db, store.id, { search: 'ziad' }),
    );
    expect(byEmail.map((row) => row.email)).toEqual(['ziad@example.com']);
  });
});
