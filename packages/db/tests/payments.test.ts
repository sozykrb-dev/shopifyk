import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { money } from '@velnorix/core';
import { truncateAllData } from '@velnorix/test-utils';
import {
  addCartItem,
  closeDatabase,
  createPaymentIntent,
  createProduct,
  createStore,
  getCart,
  getOrCreateGuestCart,
  getPaymentIntent,
  getPaymentIntentByReference,
  listPaymentEvents,
  listPaymentIntentsForOrder,
  placeOrder,
  plans,
  recordRefund,
  recordWebhookEvent,
  setPaymentIntentStatus,
  withPlatform,
  withTenant,
  type Store,
} from '../src/index.js';

/**
 * The two rules that keep a payment system honest, as code rather than as
 * intention: a replayed webhook must not pay twice, and a webhook that
 * disagrees with our own amount must be rejected rather than believed.
 */
describe('payment intents and webhook events', () => {
  let store: Store;
  let orderId: string;

  beforeEach(async () => {
    await truncateAllData();
    store = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
      return createStore(db, { slug: 'pay-shop', name: 'Pay Shop', planId: plan!.id });
    });

    const product = await withTenant(store.id, (db) =>
      createProduct(db, {
        storeId: store.id,
        titleEn: 'Sneaker',
        titleAr: 'حذاء',
        handle: 'sneaker',
        priceMinor: 100_00,
        currency: 'EGP',
        inventoryQuantity: 5,
      }),
    );

    const cart = await withTenant(store.id, (db) => getOrCreateGuestCart(db, 'pay-guest', 'EGP'));
    await withTenant(store.id, (db) =>
      addCartItem(db, {
        cartId: cart.id,
        productId: product.id,
        variantId: null,
        quantity: 1,
        unitPriceMinor: 100_00,
        currency: 'EGP',
      }),
    );
    const { lines } = await withTenant(store.id, (db) => getCart(db, cart));

    const order = await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: cart.id,
          customerUserId: null,
          currency: 'EGP',
          email: 'pay@example.com',
          shippingName: 'دافع',
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
          sku: line.sku,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );
    orderId = order.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  async function intent(amount = 100_00) {
    return withTenant(store.id, (db) =>
      createPaymentIntent(db, {
        orderId,
        provider: 'paymob',
        amount: money(amount, 'EGP'),
      }),
    );
  }

  it('creates a pending intent for the order total', async () => {
    const created = await intent();
    expect(created.status).toBe('pending');
    expect(created.amountMinor).toBe(100_00);
    expect(created.currency).toBe('EGP');

    const found = await withTenant(store.id, (db) => getPaymentIntent(db, created.id));
    expect(found?.id).toBe(created.id);
    expect(
      await withTenant(store.id, (db) => listPaymentIntentsForOrder(db, orderId)),
    ).toHaveLength(1);
  });

  it('applies a webhook once, and reports a replay as a duplicate', async () => {
    const created = await intent();
    const delivery = {
      provider: 'paymob',
      providerEventId: 'evt-1',
      intentId: created.id,
      type: 'transaction',
      status: 'captured',
      reportedAmount: money(100_00, 'EGP'),
      payload: { id: 'evt-1' },
    };

    const first = await withTenant(store.id, (db) => recordWebhookEvent(db, delivery));
    expect(first.applied).toBe(true);

    const second = await withTenant(store.id, (db) => recordWebhookEvent(db, delivery));
    expect(second.applied).toBe(false);
    if (second.applied) return;
    expect(second.reason).toBe('duplicate');

    // The money moved once, not twice.
    const after = await withTenant(store.id, (db) => getPaymentIntent(db, created.id));
    expect(after?.status).toBe('captured');
    expect(await withTenant(store.id, (db) => listPaymentEvents(db, created.id))).toHaveLength(1);
  });

  it('refuses a webhook whose amount disagrees with ours', async () => {
    const created = await intent(100_00);
    const result = await withTenant(store.id, (db) =>
      recordWebhookEvent(db, {
        provider: 'paymob',
        providerEventId: 'evt-underpay',
        intentId: created.id,
        type: 'transaction',
        status: 'captured',
        // Somebody tampering, or a genuine bug: either way, not our amount.
        reportedAmount: money(1_00, 'EGP'),
        payload: { id: 'evt-underpay' },
      }),
    );

    expect(result.applied).toBe(false);
    if (result.applied) return;
    expect(result.reason).toBe('amount_mismatch');

    const after = await withTenant(store.id, (db) => getPaymentIntent(db, created.id));
    // Not paid, and the disagreement is written down rather than swallowed.
    expect(after?.status).toBe('pending');
    expect(after?.lastError).toContain('Amount mismatch');
  });

  it('accepts a webhook that does not state an amount, and compares nothing', async () => {
    const created = await intent();
    const result = await withTenant(store.id, (db) =>
      recordWebhookEvent(db, {
        provider: 'paymob',
        providerEventId: 'evt-noamount',
        intentId: created.id,
        type: 'transaction',
        status: 'captured',
        reportedAmount: null,
        payload: {},
      }),
    );
    expect(result.applied).toBe(true);
  });

  it('allows the same event id from a different provider', async () => {
    const created = await intent();
    await withTenant(store.id, (db) =>
      recordWebhookEvent(db, {
        provider: 'paymob',
        providerEventId: 'shared-id',
        intentId: created.id,
        type: 'transaction',
        status: 'authorized',
        reportedAmount: null,
        payload: {},
      }),
    );
    const fawry = await withTenant(store.id, (db) =>
      recordWebhookEvent(db, {
        provider: 'fawry',
        providerEventId: 'shared-id',
        intentId: created.id,
        type: 'payment_status',
        status: 'captured',
        reportedAmount: null,
        payload: {},
      }),
    );
    // The uniqueness is per (store, provider, event id) -- one provider's id
    // space has nothing to do with another's.
    expect(fawry.applied).toBe(true);
  });

  it('finds an intent by the provider reference', async () => {
    const created = await intent();
    await withTenant(store.id, (db) =>
      setPaymentIntentStatus(db, created.id, 'pending', { providerReference: 'pm-998877' }),
    );
    const found = await withTenant(store.id, (db) =>
      getPaymentIntentByReference(db, 'paymob', 'pm-998877'),
    );
    expect(found?.id).toBe(created.id);
    // The same reference under another provider is not the same payment.
    expect(
      await withTenant(store.id, (db) => getPaymentIntentByReference(db, 'fawry', 'pm-998877')),
    ).toBeNull();
  });

  it('separates a partial refund from a full one', async () => {
    const created = await intent(100_00);
    await withTenant(store.id, (db) => setPaymentIntentStatus(db, created.id, 'captured'));

    const partial = await withTenant(store.id, (db) =>
      recordRefund(db, created.id, money(30_00, 'EGP'), 'rf-1'),
    );
    expect(partial?.refundedMinor).toBe(30_00);
    expect(partial?.status).toBe('partially_refunded');

    const rest = await withTenant(store.id, (db) =>
      recordRefund(db, created.id, money(70_00, 'EGP'), 'rf-2'),
    );
    expect(rest?.refundedMinor).toBe(100_00);
    expect(rest?.status).toBe('refunded');
  });
});
