import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { priceCart, type PriceableLine } from '@velnorix/pricing';
import { truncateAllData } from '@velnorix/test-utils';
import {
  closeDatabase,
  couponUsage,
  createCoupon,
  createShippingRate,
  createTaxRule,
  createStore,
  deactivateCoupon,
  deactivateTaxRule,
  deactivateShippingRate,
  findCouponByCode,
  getOrCreateGuestCart,
  listCoupons,
  listShippingRates,
  listTaxRules,
  loadCouponForPricing,
  placeOrder,
  plans,
  pricingInputs,
  redeemCoupon,
  toCoupon,
  toShippingRate,
  toTaxRule,
  updateCoupon,
  withPlatform,
  withPlatformTenant,
  withTenant,
  type Store,
} from '../src/index.js';
import { eq } from 'drizzle-orm';

/**
 * Pricing rules are a merchant's commercial settings, so the two things that
 * must hold are the ones tested here: another store cannot see or change them,
 * and a usage cap counted from redemptions cannot be spent twice.
 */
describe('pricing rules: tax, shipping and coupons', () => {
  let store: Store;
  let other: Store;

  beforeEach(async () => {
    await truncateAllData();
    const [starter] = await withPlatform((db) =>
      db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter')),
    );
    store = await withPlatform((db) =>
      createStore(db, { slug: 'pricing-shop', name: 'Pricing Shop', planId: starter!.id }),
    );
    other = await withPlatform((db) =>
      createStore(db, { slug: 'other-shop', name: 'Other Shop', planId: starter!.id }),
    );
  });

  afterAll(async () => {
    await closeDatabase();
  });

  /**
   * A real order, because a coupon redemption references one.
   *
   * A redemption that is not tied to a real order is a redemption nobody can
   * audit, so the foreign key is doing the arguing here, not the test.
   */
  async function anOrder(email = 'customer@example.com'): Promise<string> {
    return withTenant(store.id, async (db) => {
      const cart = await getOrCreateGuestCart(db, `guest-${email}-${Date.now()}`);
      return placeOrder(
        db,
        {
          cartId: cart.id,
          customerUserId: null,
          currency: 'EGP',
          email,
          shippingName: 'عميل',
          addressLine1: 'شارع الاختبار',
          city: 'القاهرة',
        },
        [
          {
            productId: null,
            variantId: null,
            titleAr: 'منتج',
            titleEn: 'Product',
            variantTitleAr: null,
            variantTitleEn: null,
            sku: null,
            quantity: 1,
            unitPriceMinor: 10_000,
          },
        ],
      ).then((order) => order.id);
    });
  }

  describe('rows map to engine input', () => {
    it('carries rate, scope and inclusivity into the engine', async () => {
      const row = await withPlatformTenant(store.id, (db) =>
        createTaxRule(db, {
          storeId: store.id,
          nameAr: 'ضريبة القيمة المضافة',
          nameEn: 'VAT',
          rateBps: 1400,
          countryCode: 'EG',
          region: null,
          priceInclusive: true,
          taxesShipping: false,
        }),
      );
      expect(toTaxRule(row)).toMatchObject({
        rateBps: 1400,
        countryCode: 'EG',
        priceInclusive: true,
      });
    });

    it('carries the free-shipping threshold', async () => {
      const row = await withPlatformTenant(store.id, (db) =>
        createShippingRate(db, {
          storeId: store.id,
          nameAr: 'شحن عادي',
          nameEn: 'Standard',
          amountMinor: 3000,
          currency: 'EGP',
          freeAboveMinor: 50_000,
        }),
      );
      expect(toShippingRate(row)).toMatchObject({
        amount: { amount: 3000, currency: 'EGP' },
        freeAboveMinor: 50_000,
      });
    });
  });

  describe('tenant isolation', () => {
    it("hides one store's tax rules from another", async () => {
      await withPlatformTenant(store.id, (db) =>
        createTaxRule(db, {
          storeId: store.id,
          nameAr: 'ضريبة',
          nameEn: 'Tax',
          rateBps: 1400,
        }),
      );
      await withPlatformTenant(other.id, async (db) => {
        // The other store is scoped to itself, so it sees nothing of ours.
        expect(await listTaxRules(db)).toHaveLength(0);
      });
      await withPlatformTenant(store.id, async (db) => {
        expect(await listTaxRules(db)).toHaveLength(1);
      });
    });

    it("hides one store's coupons from another", async () => {
      await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'secret',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
        }),
      );
      const found = await withPlatformTenant(other.id, (db) =>
        findCouponByCode(db, other.id, 'SECRET'),
      );
      expect(found).toBeNull();
    });

    it('cannot be read outside any tenant scope at all', async () => {
      await withPlatformTenant(store.id, (db) =>
        createShippingRate(db, {
          storeId: store.id,
          nameAr: 'شحن',
          nameEn: 'Ship',
          amountMinor: 1000,
          currency: 'EGP',
        }),
      );
      // withPlatform is the platform acting globally: under RLS the pricing
      // tables return nothing, because there is no tenant to read as.
      const rows = await withPlatform((db) => listShippingRates(db));
      expect(rows).toHaveLength(0);
    });
  });

  describe('coupon codes', () => {
    it('normalises the code on the way in and on the way out', async () => {
      await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: '  welcome-10  ',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
        }),
      );
      const found = await withPlatformTenant(store.id, (db) =>
        findCouponByCode(db, store.id, '  WELCOME-10 '),
      );
      expect(found?.code).toBe('WELCOME-10');
    });

    it('rejects a duplicate code in the same store', async () => {
      await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'ONCE',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
        }),
      );
      // The second insert goes in its own scope: a unique violation leaves the
      // surrounding transaction unusable, which is exactly why the index --
      // and not a check-then-insert -- is what enforces this.
      await expect(
        withPlatformTenant(store.id, (db) =>
          createCoupon(db, {
            storeId: store.id,
            code: 'once',
            type: 'percent',
            value: 1000,
            currency: 'EGP',
          }),
        ),
      ).rejects.toThrow();
    });

    it('allows the same code in two different stores', async () => {
      await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'SHARED',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
        }),
      );
      const created = await withPlatformTenant(other.id, (db) =>
        createCoupon(db, {
          storeId: other.id,
          code: 'SHARED',
          type: 'percent',
          value: 2000,
          currency: 'EGP',
        }),
      );
      expect(created.value).toBe(2000);
    });
  });

  describe('usage caps are counted, never remembered', () => {
    it('counts redemptions rather than trusting a stored counter', async () => {
      const coupon = await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'CAP5',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
          usageLimit: 2,
        }),
      );

      const orderId = await anOrder();
      await withPlatformTenant(store.id, async (db) => {
        expect(await couponUsage(db, coupon.id)).toMatchObject({ total: 0 });
        await redeemCoupon(db, {
          storeId: store.id,
          couponId: coupon.id,
          orderId,
          amount: { amount: 100, currency: 'EGP' },
        });
        expect(await couponUsage(db, coupon.id)).toMatchObject({ total: 1 });
      });

      const loaded = await withPlatformTenant(store.id, (db) =>
        loadCouponForPricing(db, store.id, 'CAP5'),
      );
      expect(loaded?.coupon.redeemedCount).toBe(1);
      expect(loaded?.coupon.usageLimit).toBe(2);
    });

    it('ignores a replayed redemption instead of double-counting it', async () => {
      const coupon = await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'ONETIME',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
          usageLimit: 1,
        }),
      );

      const orderId = await anOrder();
      await withPlatformTenant(store.id, async (db) => {
        const first = await redeemCoupon(db, {
          storeId: store.id,
          couponId: coupon.id,
          orderId,
          amount: { amount: 100, currency: 'EGP' },
        });
        const second = await redeemCoupon(db, {
          storeId: store.id,
          couponId: coupon.id,
          orderId,
          amount: { amount: 100, currency: 'EGP' },
        });
        expect(first?.duplicate).toBe(false);
        expect(second?.duplicate).toBe(true);
        expect(await couponUsage(db, coupon.id)).toMatchObject({ total: 1 });
      });
    });

    it('counts per customer by email, case-insensitively', async () => {
      const coupon = await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'ONEEACH',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
          perCustomerLimit: 1,
        }),
      );

      const orderId = await anOrder('ahmed@example.com');
      await withPlatformTenant(store.id, async (db) => {
        await redeemCoupon(db, {
          storeId: store.id,
          couponId: coupon.id,
          orderId,
          email: 'Ahmed@Example.com',
          amount: { amount: 100, currency: 'EGP' },
        });
        expect(await couponUsage(db, coupon.id, 'ahmed@example.com')).toMatchObject({
          forEmail: 1,
        });
        expect(await couponUsage(db, coupon.id, 'other@example.com')).toMatchObject({
          forEmail: 0,
        });
      });

      const forAhmed = await withPlatformTenant(store.id, (db) =>
        loadCouponForPricing(db, store.id, 'ONEEACH', 'AHMED@EXAMPLE.COM'),
      );
      expect(forAhmed?.coupon.customerRedeemedCount).toBe(1);
      expect(forAhmed?.coupon.perCustomerLimit).toBe(1);
    });
  });

  describe('deactivating instead of deleting', () => {
    it('keeps a tax rule in place but out of pricing', async () => {
      const rule = await withPlatformTenant(store.id, (db) =>
        createTaxRule(db, {
          storeId: store.id,
          nameAr: 'ضريبة',
          nameEn: 'Tax',
          rateBps: 1400,
        }),
      );
      await withPlatformTenant(store.id, (db) => deactivateTaxRule(db, rule.id));

      const inputs = await withPlatformTenant(store.id, (db) =>
        pricingInputs(db, { storeId: store.id }),
      );
      expect(inputs.taxRules).toHaveLength(0);
      // The row still exists: an old receipt can still explain itself.
      await withPlatformTenant(store.id, async (db) => {
        expect(await listTaxRules(db)).toHaveLength(1);
      });
    });

    it('keeps a shipping rate but stops offering it', async () => {
      const rate = await withPlatformTenant(store.id, (db) =>
        createShippingRate(db, {
          storeId: store.id,
          nameAr: 'شحن',
          nameEn: 'Ship',
          amountMinor: 3000,
          currency: 'EGP',
        }),
      );
      await withPlatformTenant(store.id, (db) => deactivateShippingRate(db, rate.id));

      const quote = priceCart({
        lines: [{ id: 'a', unitAmount: { amount: 10_000, currency: 'EGP' }, quantity: 1 }],
        currency: 'EGP',
        destination: { countryCode: 'EG' },
        shippingRates: (
          await withPlatformTenant(store.id, (db) => pricingInputs(db, { storeId: store.id }))
        ).shippingRates,
      });
      expect(quote.shipping).toBeNull();
      void rate;
    });

    it('keeps a coupon but refuses to honour it', async () => {
      const coupon = await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'GONE',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
        }),
      );
      await withPlatformTenant(store.id, (db) => deactivateCoupon(db, coupon.id));

      const loaded = await withPlatformTenant(store.id, (db) =>
        loadCouponForPricing(db, store.id, 'GONE'),
      );
      expect(
        priceCart({
          lines: [{ id: 'a', unitAmount: { amount: 10_000, currency: 'EGP' }, quantity: 1 }],
          currency: 'EGP',
          destination: { countryCode: 'EG' },
          coupon: loaded?.coupon ?? null,
        }).coupon?.rejection,
      ).toBe('inactive');

      await withPlatformTenant(store.id, async (db) => {
        expect(await listCoupons(db)).toHaveLength(1);
      });
    });

    it('updates a coupon in place without changing its code', async () => {
      const coupon = await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'EDIT',
          type: 'percent',
          value: 1000,
          currency: 'EGP',
        }),
      );
      const updated = await withPlatformTenant(store.id, (db) =>
        updateCoupon(db, coupon.id, { value: 2500, minSubtotalMinor: 5_000 }),
      );
      expect(updated?.value).toBe(2500);
      expect(updated?.minSubtotalMinor).toBe(5_000);
      expect(updated?.code).toBe('EDIT');
    });
  });

  describe('pricing an order from the database', () => {
    it('applies a store VAT rate and a shipping rate end to end', async () => {
      await withPlatformTenant(store.id, async (db) => {
        await createTaxRule(db, {
          storeId: store.id,
          nameAr: 'ضريبة القيمة المضافة',
          nameEn: 'VAT',
          rateBps: 1400,
          countryCode: 'EG',
          priceInclusive: false,
          taxesShipping: false,
        });
        await createShippingRate(db, {
          storeId: store.id,
          nameAr: 'شحن عادي',
          nameEn: 'Standard',
          amountMinor: 3_000,
          currency: 'EGP',
          countryCode: 'EG',
        });
      });

      const quote = await withTenant(store.id, async (db) => {
        const inputs = await pricingInputs(db, { storeId: store.id });
        const lines: PriceableLine[] = [
          { id: 'a', unitAmount: { amount: 10_000, currency: 'EGP' }, quantity: 2 },
        ];
        return priceCart({
          lines,
          currency: 'EGP',
          destination: { countryCode: 'EG', region: 'القاهرة' },
          taxRules: inputs.taxRules,
          shippingRates: inputs.shippingRates,
        });
      });

      expect(quote.subtotal.amount).toBe(20_000);
      expect(quote.tax.amount).toBe(2_800);
      expect(quote.shippingAmount.amount).toBe(3_000);
      expect(quote.total.amount).toBe(25_800);
    });

    it('charges no tax for a store that has configured none', async () => {
      // The default is a zero rate, not an invented one: ADR 0007 deferred tax
      // as a business decision, and the absence of a decision must not become
      // a 14% charge the merchant never agreed to.
      const quote = await withTenant(store.id, async (db) => {
        const inputs = await pricingInputs(db, { storeId: store.id });
        return priceCart({
          lines: [{ id: 'a', unitAmount: { amount: 10_000, currency: 'EGP' }, quantity: 1 }],
          currency: 'EGP',
          destination: { countryCode: 'EG' },
          taxRules: inputs.taxRules,
          shippingRates: inputs.shippingRates,
        });
      });
      expect(quote.tax.amount).toBe(0);
      expect(quote.shippingAmount.amount).toBe(0);
      expect(quote.total.amount).toBe(10_000);
    });

    it('prices with a coupon loaded straight from the database', async () => {
      await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'WELCOME',
          type: 'percent',
          value: 1_500,
          currency: 'EGP',
          minSubtotalMinor: 5_000,
        }),
      );

      const quote = await withTenant(store.id, async (db) => {
        const inputs = await pricingInputs(db, {
          storeId: store.id,
          code: 'welcome',
          email: 'Customer@Example.com',
        });
        return priceCart({
          lines: [{ id: 'a', unitAmount: { amount: 10_000, currency: 'EGP' }, quantity: 1 }],
          currency: 'EGP',
          destination: { countryCode: 'EG' },
          taxRules: inputs.taxRules,
          shippingRates: inputs.shippingRates,
          coupon: inputs.coupon,
        });
      });

      expect(quote.coupon?.accepted).toBe(true);
      expect(quote.discount.amount).toBe(1_500);
      expect(quote.total.amount).toBe(8_500);
    });

    it('refuses a coupon that another customer has already used up', async () => {
      const coupon = await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'FIRST',
          type: 'percent',
          value: 1_000,
          currency: 'EGP',
          perCustomerLimit: 1,
        }),
      );
      const orderId = await anOrder('taken@example.com');
      await withPlatformTenant(store.id, (db) =>
        redeemCoupon(db, {
          storeId: store.id,
          couponId: coupon.id,
          orderId,
          email: 'taken@example.com',
          amount: { amount: 1_000, currency: 'EGP' },
        }),
      );

      const quote = await withTenant(store.id, async (db) => {
        const inputs = await pricingInputs(db, {
          storeId: store.id,
          code: 'FIRST',
          email: 'taken@example.com',
        });
        return priceCart({
          lines: [{ id: 'a', unitAmount: { amount: 10_000, currency: 'EGP' }, quantity: 1 }],
          currency: 'EGP',
          destination: { countryCode: 'EG' },
          coupon: inputs.coupon,
        });
      });

      expect(quote.coupon?.accepted).toBe(false);
      expect(quote.coupon?.rejection).toBe('customer_limit_reached');
      expect(quote.discount.amount).toBe(0);
    });
  });

  describe('toCoupon', () => {
    it('passes the counts through to the engine', async () => {
      const row = await withPlatformTenant(store.id, (db) =>
        createCoupon(db, {
          storeId: store.id,
          code: 'COUNTED',
          type: 'fixed',
          value: 5_000,
          currency: 'EGP',
          usageLimit: 3,
          perCustomerLimit: 1,
        }),
      );
      const coupon = toCoupon(row, { total: 2, forEmail: 1 });
      expect(coupon).toMatchObject({
        type: 'fixed',
        value: 5_000,
        usageLimit: 3,
        redeemedCount: 2,
        perCustomerLimit: 1,
        customerRedeemedCount: 1,
      });
      void other;
    });
  });
});
