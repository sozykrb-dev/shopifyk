import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncateAllData } from '@velnorix/test-utils';
import {
  advanceSubscriptionPeriod,
  cancelSubscription,
  closeDatabase,
  createStore,
  getInvoiceByNumber,
  getSubscriptionForStore,
  issueInvoice,
  listInvoices,
  listOverdueInvoices,
  markInvoicePaid,
  nextPeriod,
  storeRevenue,
  plans,
  startSubscription,
  voidInvoice,
  withPlatform,
  withPlatformTenant,
  type Store,
} from '../src/index.js';

/**
 * Billing is the one part of the platform that must never quietly round in
 * somebody's favour. These tests pin the two rules that bite: an invoice is a
 * document that does not re-price, and a subscription period must not drift
 * when a month is shorter than the one before it.
 */
describe('billing: subscriptions and invoices', () => {
  let store: Store;
  let starterId: string;
  let growthId: string;

  beforeEach(async () => {
    await truncateAllData();
    const [starter] = await withPlatform((db) =>
      db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter')),
    );
    const [growth] = await withPlatform((db) =>
      db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'growth')),
    );
    starterId = starter!.id;
    growthId = growth!.id;

    store = await withPlatform((db) =>
      createStore(db, { slug: 'billing-shop', name: 'Billing Shop', planId: starterId }),
    );
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('billing periods', () => {
    it('advances one month without drifting into the month after', () => {
      // 31 January + one month must land in February, not 3 March.
      const period = nextPeriod(new Date('2026-01-31T12:00:00Z'));
      expect(period.end.getUTCMonth()).toBe(1);
      expect(period.end.getUTCFullYear()).toBe(2026);
    });

    it('keeps the same day of month for ordinary dates', () => {
      const period = nextPeriod(new Date('2026-03-15T00:00:00Z'));
      expect(period.end.getUTCMonth()).toBe(3);
      expect(period.end.getUTCDate()).toBe(15);
    });

    it('crosses the year boundary', () => {
      const period = nextPeriod(new Date('2026-12-10T00:00:00Z'));
      expect(period.end.getUTCFullYear()).toBe(2027);
      expect(period.end.getUTCMonth()).toBe(0);
    });
  });

  describe('subscriptions', () => {
    it('starts on the plan with a trial when the plan has one', async () => {
      const subscription = await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: starterId, trialDays: 14 }),
      );
      expect(subscription.status).toBe('trialing');
      expect(subscription.trialEndsAt).toBeInstanceOf(Date);

      const days = Math.round(
        ((subscription.trialEndsAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) as number,
      );
      expect(days).toBe(14);
    });

    it('starts active with no trial when the plan has none', async () => {
      const subscription = await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: starterId }),
      );
      expect(subscription.status).toBe('active');
      expect(subscription.trialEndsAt).toBeNull();
      expect(subscription.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    });

    it('moves a store onto another plan instead of creating a second row', async () => {
      await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: starterId, trialDays: 14 }),
      );
      const upgraded = await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: growthId }),
      );
      expect(upgraded.planId).toBe(growthId);
      // Upgrading out of a trial ends it: the merchant chose to pay now.
      expect(upgraded.status).toBe('active');

      const all = await withPlatformTenant(store.id, (db) => getSubscriptionForStore(db, store.id));
      expect(all?.planId).toBe(growthId);
    });

    it('advances the period and stays aligned to the old end date', async () => {
      const subscription = await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: starterId }),
      );
      const firstEnd = subscription.currentPeriodEnd;

      const advanced = await withPlatformTenant(store.id, (db) =>
        advanceSubscriptionPeriod(db, store.id),
      );
      expect(advanced?.currentPeriodStart.getTime()).toBe(firstEnd.getTime());
      expect(advanced?.currentPeriodEnd.getTime()).toBeGreaterThan(firstEnd.getTime());
    });

    it('cancels, and un-cancels if the store comes back', async () => {
      await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: starterId }),
      );
      const cancelled = await withPlatformTenant(store.id, (db) =>
        cancelSubscription(db, store.id, { immediately: true }),
      );
      expect(cancelled?.status).toBe('cancelled');
      expect(cancelled?.cancelledAt).toBeInstanceOf(Date);

      const restarted = await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: starterId }),
      );
      expect(restarted.status).toBe('active');
      expect(restarted.cancelledAt).toBeNull();
    });
  });

  describe('invoices', () => {
    async function anInvoice(storeId: string, totalMinor = 29_900) {
      return withPlatformTenant(storeId, (db) =>
        issueInvoice(db, {
          storeId,
          lines: [
            {
              descriptionAr: 'اشتراك شهري — الخطة الأساسية',
              descriptionEn: 'Monthly subscription — Starter',
              quantity: 1,
              unitAmountMinor: totalMinor,
              totalMinor,
            },
          ],
        }),
      );
    }

    it('numbers invoices per store, starting at 1', async () => {
      const first = await anInvoice(store.id);
      expect(first.invoiceNumber).toBe(1);

      const second = await withPlatform((db) =>
        createStore(db, { slug: 'billing-shop-2', name: 'Second', planId: starterId }),
      );
      const other = await withPlatformTenant(second.id, async (db) => {
        return issueInvoice(db, {
          storeId: second.id,
          lines: [
            {
              descriptionAr: 'اشتراك',
              descriptionEn: 'Subscription',
              quantity: 1,
              unitAmountMinor: 100,
              totalMinor: 100,
            },
          ],
        });
      });
      // Each store numbers its own invoices from 1: "فاتورة 1" is not global.
      expect(other.invoiceNumber).toBe(1);
    });

    it('stores the lines as a snapshot, and never re-prices them', async () => {
      const invoice = await anInvoice(store.id, 29_900);
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.lines[0]?.totalMinor).toBe(29_900);
      expect(invoice.subtotalMinor).toBe(29_900);
      expect(invoice.totalMinor).toBe(29_900);

      // Change the plan price: the invoice must not follow.
      await withPlatform((db) =>
        db.update(plans).set({ priceMinor: 999_900 }).where(eq(plans.id, starterId)),
      );
      const after = await withPlatformTenant(store.id, (db) => getInvoiceByNumber(db, store.id, 1));
      expect(after?.totalMinor).toBe(29_900);
      expect(after?.lines[0]?.totalMinor).toBe(29_900);
    });

    it('sums the lines and adds tax', async () => {
      const invoice = await withPlatformTenant(store.id, (db) =>
        issueInvoice(db, {
          storeId: store.id,
          lines: [
            {
              descriptionAr: 'اشتراك',
              descriptionEn: 'Subscription',
              quantity: 2,
              unitAmountMinor: 10_000,
              totalMinor: 20_000,
            },
            {
              descriptionAr: 'رسوم معاملات',
              descriptionEn: 'Transaction fees',
              quantity: 1,
              unitAmountMinor: 1_500,
              totalMinor: 1_500,
            },
          ],
          taxMinor: 3_225,
        }),
      );
      expect(invoice.subtotalMinor).toBe(21_500);
      expect(invoice.taxMinor).toBe(3_225);
      expect(invoice.totalMinor).toBe(24_725);
      expect(invoice.status).toBe('open');
      expect(invoice.issuedAt).toBeInstanceOf(Date);
      expect(invoice.dueAt!.getTime()).toBeGreaterThan(invoice.issuedAt!.getTime());
    });

    it('is unpaid until it is marked paid, and records how', async () => {
      const invoice = await anInvoice(store.id);
      expect(
        await withPlatformTenant(store.id, (db) => listInvoices(db, store.id, { status: 'open' })),
      ).toHaveLength(1);

      const paid = await withPlatformTenant(store.id, (db) =>
        markInvoicePaid(db, invoice.id, { method: 'manual_transfer', reference: 'TR-7788' }),
      );
      expect(paid?.status).toBe('paid');
      expect(paid?.paidAt).toBeInstanceOf(Date);
      expect(paid?.paymentMethod).toBe('manual_transfer');
      expect(paid?.paymentReference).toBe('TR-7788');

      expect(
        await withPlatformTenant(store.id, (db) => listInvoices(db, store.id, { status: 'open' })),
      ).toHaveLength(0);
    });

    it('can be voided while open, and not after it is paid', async () => {
      const invoice = await anInvoice(store.id);
      const voided = await withPlatformTenant(store.id, (db) => voidInvoice(db, invoice.id));
      expect(voided?.status).toBe('void');
      expect(voided?.voidedAt).toBeInstanceOf(Date);

      const second = await anInvoice(store.id, 1000);
      await withPlatformTenant(store.id, (db) => markInvoicePaid(db, second.id));
      // A paid invoice is a receipt: it cannot be quietly erased.
      expect(await withPlatformTenant(store.id, (db) => voidInvoice(db, second.id))).toBeNull();
    });

    it('finds overdue invoices for dunning', async () => {
      const overdue = await withPlatformTenant(store.id, (db) =>
        issueInvoice(db, {
          storeId: store.id,
          lines: [
            {
              descriptionAr: 'فاتورة متأخرة',
              descriptionEn: 'Overdue',
              quantity: 1,
              unitAmountMinor: 100,
              totalMinor: 100,
            },
          ],
          dueInDays: -5,
        }),
      );
      const found = await withPlatformTenant(store.id, (db) => listOverdueInvoices(db, store.id));
      expect(found.map((invoice) => invoice.id)).toContain(overdue.id);

      await withPlatformTenant(store.id, (db) => markInvoicePaid(db, overdue.id));
      // Paid invoices are nobody's dunning list.
      expect(
        (await withPlatformTenant(store.id, (db) => listOverdueInvoices(db, store.id))).map(
          (invoice) => invoice.id,
        ),
      ).not.toContain(overdue.id);
    });
  });

  describe('platform revenue', () => {
    it('counts MRR over active subscriptions only', async () => {
      await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: growthId }),
      );
      const secondStore = await withPlatform((db) =>
        createStore(db, { slug: 'trial-shop', name: 'Trial', planId: starterId }),
      );
      await withPlatformTenant(secondStore.id, (db) =>
        startSubscription(db, { storeId: secondStore.id, planId: starterId, trialDays: 14 }),
      );

      const paying = await withPlatformTenant(store.id, (db) => storeRevenue(db, store.id));
      const trialing = await withPlatformTenant(secondStore.id, (db) =>
        storeRevenue(db, secondStore.id),
      );
      // growth is 89900; a trialing store contributes nothing to MRR yet.
      expect(paying.mrrMinor).toBe(89_900);
      expect(paying.planKey).toBe('growth');
      expect(paying.status).toBe('active');
      expect(trialing.mrrMinor).toBe(0);
      expect(trialing.trialing).toBe(true);
    });

    it('drops a cancelled subscription out of MRR', async () => {
      await withPlatformTenant(store.id, (db) =>
        startSubscription(db, { storeId: store.id, planId: growthId }),
      );
      await withPlatformTenant(store.id, (db) =>
        cancelSubscription(db, store.id, { immediately: true }),
      );
      const revenue = await withPlatformTenant(store.id, (db) => storeRevenue(db, store.id));
      expect(revenue.mrrMinor).toBe(0);
      expect(revenue.status).toBe('cancelled');
    });
  });
});
