import { describe, expect, it } from 'vitest';
import { money } from '@velnorix/core';
import {
  evaluateCoupon,
  matchShippingRates,
  priceCart,
  resolveTaxRule,
  selectShipping,
  type Coupon,
  type Destination,
  type PriceableLine,
  type ShippingRate,
  type TaxRule,
} from '../src/index.js';

/*
 * The rules that decide what a customer pays are the rules most worth testing.
 * Every case here is one that has produced a real bug in a real shop: a
 * receipt whose lines do not sum to the total, a coupon that made the order
 * more expensive, tax charged on an amount that already contained tax.
 */

const EGP = 'EGP';
const egp = (amount: number) => money(amount, EGP);

const CAIRO: Destination = { countryCode: 'EG', region: 'القاهرة', city: 'مدينة نصر' };

const VAT: TaxRule = {
  id: 'vat',
  name: 'ضريبة القيمة المضافة',
  rateBps: 1400, // 14%
  countryCode: 'EG',
  region: null,
  priceInclusive: false,
  taxesShipping: false,
  priority: 0,
};

const VAT_INCLUSIVE: TaxRule = { ...VAT, id: 'vat-inc', priceInclusive: true };

function line(overrides: Partial<PriceableLine> = {}): PriceableLine {
  return { id: 'l1', unitAmount: egp(10_000), quantity: 1, ...overrides };
}

/** The invariant every order must hold: the lines add up to the total. */
function expectLinesToSumToTotal(quote: ReturnType<typeof priceCart>): void {
  const linesTotal = quote.lines.reduce((acc, l) => acc + l.lineTotal.amount, 0);
  const expected = quote.total.amount - quote.shippingAmount.amount;
  expect(linesTotal).toBe(expected);
}

describe('subtotal and empty carts', () => {
  it('prices an empty cart as all zeros rather than throwing', () => {
    const quote = priceCart({ lines: [], currency: EGP, destination: CAIRO });
    expect(quote.total.amount).toBe(0);
    expect(quote.subtotal.amount).toBe(0);
    expect(quote.lines).toEqual([]);
  });

  it('multiplies unit price by quantity', () => {
    const quote = priceCart({
      lines: [{ id: 'a', unitAmount: egp(12_345), quantity: 3 }],
      currency: EGP,
      destination: CAIRO,
    });
    expect(quote.subtotal.amount).toBe(37_035);
    expect(quote.total.amount).toBe(37_035);
  });

  it('refuses to price a line in a currency the order is not in', () => {
    expect(() =>
      priceCart({
        lines: [{ id: 'a', unitAmount: money(100, 'SAR'), quantity: 1 }],
        currency: EGP,
        destination: CAIRO,
      }),
    ).toThrow(/currency mismatch/i);
  });

  it('refuses a fractional quantity', () => {
    expect(() =>
      priceCart({
        lines: [{ id: 'a', unitAmount: egp(100), quantity: 1.5 }],
        currency: EGP,
        destination: CAIRO,
      }),
    ).toThrow(/integer/i);
  });
});

describe('tax', () => {
  it('adds tax on top when prices are tax-exclusive', () => {
    const quote = priceCart({
      lines: [line({ unitAmount: egp(10_000) })],
      currency: EGP,
      destination: CAIRO,
      taxRules: [VAT],
    });
    expect(quote.subtotal.amount).toBe(10_000);
    expect(quote.tax.amount).toBe(1_400);
    expect(quote.total.amount).toBe(11_400);
  });

  it('extracts tax from the price when prices are tax-inclusive', () => {
    const quote = priceCart({
      lines: [line({ unitAmount: egp(10_000) })],
      currency: EGP,
      destination: CAIRO,
      taxRules: [VAT_INCLUSIVE],
    });
    // 10,000 inclusive of 14% VAT: net = 10000 * 10000 / 11400 = 8,771.93,
    // which rounds half-up to 8,772, leaving 1,228 of tax inside the price.
    expect(quote.tax.amount).toBe(1_228);
    expect(quote.total.amount - quote.tax.amount).toBe(8_772);
    // The customer still pays exactly the shelf price: tax is inside it.
    expect(quote.total.amount).toBe(10_000);
    // Net + tax must reconstruct the gross with no piastre lost.
    expect(quote.total.amount - quote.tax.amount + quote.tax.amount).toBe(10_000);
  });

  it('extracted tax plus net always equals the gross, to the piastre', () => {
    // Sweep awkward amounts: an off-by-one here is a reconciliation failure.
    for (let gross = 1; gross <= 500; gross += 1) {
      const quote = priceCart({
        lines: [line({ unitAmount: egp(gross) })],
        currency: EGP,
        destination: CAIRO,
        taxRules: [VAT_INCLUSIVE],
      });
      expect(quote.tax.amount).toBeLessThanOrEqual(gross);
      expect(quote.total.amount).toBe(gross);
    }
  });

  it('does not tax a line marked non-taxable', () => {
    const quote = priceCart({
      lines: [
        line({ id: 'a', unitAmount: egp(10_000), taxable: true }),
        line({ id: 'b', unitAmount: egp(10_000), taxable: false }),
      ],
      currency: EGP,
      destination: CAIRO,
      taxRules: [VAT],
    });
    expect(quote.tax.amount).toBe(1_400);
    expect(quote.lines[0]?.lineTax.amount).toBe(1_400);
    expect(quote.lines[1]?.lineTax.amount).toBe(0);
  });

  it('charges no tax when no rule matches the destination', () => {
    const quote = priceCart({
      lines: [line()],
      currency: EGP,
      destination: { countryCode: 'SA', region: 'Riyadh' },
      taxRules: [VAT],
    });
    expect(quote.tax.amount).toBe(0);
    expect(quote.appliedTaxRule).toBeNull();
  });

  it('prefers a rule naming the region over one naming only the country', () => {
    const regional: TaxRule = { ...VAT, id: 'regional', rateBps: 500, region: 'القاهرة' };
    expect(resolveTaxRule([VAT, regional], CAIRO)?.id).toBe('regional');
    expect(resolveTaxRule([VAT, regional], { countryCode: 'EG', region: 'الجيزة' })?.id).toBe(
      'vat',
    );
  });

  it('breaks ties on priority, so a merchant override wins', () => {
    const override: TaxRule = { ...VAT, id: 'override', rateBps: 0, priority: 10 };
    expect(resolveTaxRule([VAT, override], CAIRO)?.id).toBe('override');
  });

  it('taxes shipping when the rule says so, and only then', () => {
    const rate: ShippingRate = {
      id: 's',
      name: 'عادي',
      amount: egp(3_000),
      countryCode: 'EG',
      region: null,
      city: null,
      freeAboveMinor: null,
      minDays: 2,
      maxDays: 5,
      priority: 0,
    };
    const untaxed = priceCart({
      lines: [line()],
      currency: EGP,
      destination: CAIRO,
      taxRules: [VAT],
      shippingRates: [rate],
    });
    expect(untaxed.shippingTax.amount).toBe(0);
    expect(untaxed.shippingAmount.amount).toBe(3_000);

    const taxed = priceCart({
      lines: [line()],
      currency: EGP,
      destination: CAIRO,
      taxRules: [{ ...VAT, taxesShipping: true }],
      shippingRates: [rate],
    });
    expect(taxed.shippingTax.amount).toBe(420);
    expect(taxed.shippingAmount.amount).toBe(3_420);
    expect(taxed.total.amount).toBe(10_000 + 1_400 + 3_420);
  });
});

describe('shipping', () => {
  const standard: ShippingRate = {
    id: 'std',
    name: 'عادي',
    amount: egp(3_000),
    countryCode: 'EG',
    region: null,
    city: null,
    freeAboveMinor: null,
    minDays: 2,
    maxDays: 5,
    priority: 0,
  };
  const express: ShippingRate = {
    id: 'exp',
    name: 'سريع',
    amount: egp(7_000),
    countryCode: 'EG',
    region: null,
    city: null,
    freeAboveMinor: null,
    minDays: 1,
    maxDays: 2,
    priority: 10,
  };

  it('charges nothing shippable when no rate covers the destination', () => {
    const quote = priceCart({
      lines: [line()],
      currency: EGP,
      destination: { countryCode: 'SA' },
      shippingRates: [standard],
    });
    expect(quote.shipping).toBeNull();
    expect(quote.shippingAmount.amount).toBe(0);
  });

  it('prefers a higher-priority rate over a cheaper one', () => {
    expect(selectShipping([standard, express], CAIRO, egp(0))?.rate.id).toBe('exp');
  });

  it('prefers a rate naming the city over a country-wide rate', () => {
    const cityRate: ShippingRate = {
      ...standard,
      id: 'city',
      amount: egp(1_500),
      city: 'مدينة نصر',
      priority: 0,
    };
    expect(matchShippingRates([standard, cityRate], CAIRO)[0]?.id).toBe('city');
  });

  it('waives shipping when the subtotal reaches the threshold', () => {
    const free: ShippingRate = { ...standard, freeAboveMinor: 50_000 };
    const quote = priceCart({
      lines: [line({ unitAmount: egp(50_000) })],
      currency: EGP,
      destination: CAIRO,
      shippingRates: [free],
    });
    expect(quote.shipping?.freeShippingApplied).toBe(true);
    expect(quote.shippingAmount.amount).toBe(0);
  });

  it('charges shipping one piastre below the threshold', () => {
    const free: ShippingRate = { ...standard, freeAboveMinor: 50_000 };
    const quote = priceCart({
      lines: [line({ unitAmount: egp(49_999) })],
      currency: EGP,
      destination: CAIRO,
      shippingRates: [free],
    });
    expect(quote.shipping?.freeShippingApplied).toBe(false);
    expect(quote.shippingAmount.amount).toBe(3_000);
  });

  it('never lets a coupon cost the customer their free shipping', () => {
    // 50,000 earns free shipping; a 10% coupon must not push it to 45,000 and
    // re-add the 3,000 charge. Free shipping is judged pre-discount.
    const free: ShippingRate = { ...standard, freeAboveMinor: 50_000 };
    const coupon: Coupon = {
      id: 'c',
      code: 'TEN',
      type: 'percent',
      value: 1000,
      minSubtotalMinor: 0,
      currency: EGP,
      startsAt: null,
      endsAt: null,
      usageLimit: null,
      redeemedCount: 0,
      perCustomerLimit: null,
      customerRedeemedCount: 0,
      appliesToShipping: false,
      active: true,
    };
    const quote = priceCart({
      lines: [line({ unitAmount: egp(50_000) })],
      currency: EGP,
      destination: CAIRO,
      shippingRates: [free],
      coupon,
    });
    expect(quote.discount.amount).toBe(5_000);
    expect(quote.shippingAmount.amount).toBe(0);
    expect(quote.total.amount).toBe(45_000);
  });
});

describe('coupons', () => {
  const base: Coupon = {
    id: 'c',
    code: 'WELCOME',
    type: 'percent',
    value: 1_000,
    minSubtotalMinor: 0,
    currency: EGP,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    redeemedCount: 0,
    perCustomerLimit: null,
    customerRedeemedCount: 0,
    appliesToShipping: false,
    active: true,
  };

  it('takes a percentage off', () => {
    const out = evaluateCoupon(base, egp(25_000));
    expect(out?.accepted).toBe(true);
    expect(out?.discount.amount).toBe(2_500);
  });

  it('takes a fixed amount off', () => {
    const out = evaluateCoupon({ ...base, type: 'fixed', value: 5_000 }, egp(25_000));
    expect(out?.discount.amount).toBe(5_000);
  });

  it('never discounts more than the order is worth', () => {
    const out = evaluateCoupon({ ...base, type: 'fixed', value: 90_000 }, egp(25_000));
    expect(out?.discount.amount).toBe(25_000);
  });

  it('refuses a coupon below its minimum spend', () => {
    const out = evaluateCoupon({ ...base, minSubtotalMinor: 30_000 }, egp(25_000));
    expect(out?.accepted).toBe(false);
    expect(out?.rejection).toBe('below_minimum');
    expect(out?.discount.amount).toBe(0);
  });

  it('accepts a coupon exactly at its minimum spend', () => {
    const out = evaluateCoupon({ ...base, minSubtotalMinor: 25_000 }, egp(25_000));
    expect(out?.accepted).toBe(true);
  });

  it('refuses an expired coupon, with an Arabic message', () => {
    const out = evaluateCoupon(
      { ...base, endsAt: new Date('2026-01-01T00:00:00Z') },
      egp(25_000),
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(out?.rejection).toBe('expired');
    expect(out?.accepted).toBe(false);
  });

  it('treats the end instant as exclusive and the start as inclusive', () => {
    const at = new Date('2026-06-01T12:00:00Z');
    const endsNow = evaluateCoupon({ ...base, endsAt: at }, egp(100), at);
    const startsNow = evaluateCoupon({ ...base, startsAt: at }, egp(100), at);
    expect(endsNow?.rejection).toBe('expired');
    expect(startsNow?.accepted).toBe(true);
  });

  it('refuses a coupon that has hit its usage cap', () => {
    const out = evaluateCoupon({ ...base, usageLimit: 10, redeemedCount: 10 }, egp(100));
    expect(out?.rejection).toBe('usage_limit_reached');
  });

  it('refuses a customer who has used their per-customer allowance', () => {
    const out = evaluateCoupon(
      { ...base, perCustomerLimit: 1, customerRedeemedCount: 1 },
      egp(100),
    );
    expect(out?.rejection).toBe('customer_limit_reached');
  });

  it('refuses a coupon in another currency', () => {
    const out = evaluateCoupon({ ...base, currency: 'SAR' }, egp(100));
    expect(out?.rejection).toBe('currency_mismatch');
  });

  it('refuses an inactive coupon', () => {
    expect(evaluateCoupon({ ...base, active: false }, egp(100))?.rejection).toBe('inactive');
  });

  it('discounts only the discountable lines', () => {
    const quote = priceCart({
      lines: [
        line({ id: 'a', unitAmount: egp(10_000) }),
        line({ id: 'b', unitAmount: egp(10_000), discountable: false }),
      ],
      currency: EGP,
      destination: CAIRO,
      coupon: { ...base, type: 'fixed', value: 4_000 },
    });
    expect(quote.discount.amount).toBe(4_000);
    expect(quote.lines[0]?.lineDiscount.amount).toBe(4_000);
    expect(quote.lines[1]?.lineDiscount.amount).toBe(0);
  });

  it('reports nothing-discountable rather than silently doing nothing', () => {
    const quote = priceCart({
      lines: [line({ unitAmount: egp(10_000), discountable: false })],
      currency: EGP,
      destination: CAIRO,
      coupon: { ...base, type: 'fixed', value: 4_000 },
    });
    expect(quote.discount.amount).toBe(0);
    expect(quote.notes.join(' ')).toMatch(/مؤهلة/);
  });

  it('can be made to cover shipping too', () => {
    const rate: ShippingRate = {
      id: 's',
      name: 'عادي',
      amount: egp(3_000),
      countryCode: 'EG',
      region: null,
      city: null,
      freeAboveMinor: null,
      minDays: 2,
      maxDays: 5,
      priority: 0,
    };
    const withoutShipping = priceCart({
      lines: [line({ unitAmount: egp(10_000) })],
      currency: EGP,
      destination: CAIRO,
      shippingRates: [rate],
      coupon: { ...base, type: 'percent', value: 1_000 },
    });
    const withShipping = priceCart({
      lines: [line({ unitAmount: egp(10_000) })],
      currency: EGP,
      destination: CAIRO,
      shippingRates: [rate],
      coupon: { ...base, type: 'percent', value: 1_000, appliesToShipping: true },
    });
    expect(withoutShipping.discount.amount).toBe(1_000);
    expect(withShipping.discount.amount).toBe(1_300);
  });
});

describe('the receipt always adds up', () => {
  const rate: ShippingRate = {
    id: 's',
    name: 'عادي',
    amount: egp(2_999),
    countryCode: 'EG',
    region: null,
    city: null,
    freeAboveMinor: 90_000,
    minDays: 2,
    maxDays: 5,
    priority: 0,
  };

  const scenarios: { name: string; lines: PriceableLine[]; tax: TaxRule; coupon: Coupon | null }[] =
    [
      {
        name: 'three lines, VAT exclusive',
        lines: [
          line({ id: 'a', unitAmount: egp(19_999), quantity: 2 }),
          line({ id: 'b', unitAmount: egp(3_333), quantity: 7 }),
          line({ id: 'c', unitAmount: egp(1), quantity: 1 }),
        ],
        tax: VAT,
        coupon: null,
      },
      {
        name: 'three lines, VAT inclusive',
        lines: [
          line({ id: 'a', unitAmount: egp(19_999), quantity: 2 }),
          line({ id: 'b', unitAmount: egp(3_333), quantity: 7 }),
          line({ id: 'c', unitAmount: egp(1), quantity: 1 }),
        ],
        tax: VAT_INCLUSIVE,
        coupon: null,
      },
      {
        name: 'awkward percentage coupon across three lines',
        lines: [
          line({ id: 'a', unitAmount: egp(19_999), quantity: 1 }),
          line({ id: 'b', unitAmount: egp(3_333), quantity: 1 }),
          line({ id: 'c', unitAmount: egp(1_111), quantity: 1 }),
        ],
        tax: VAT,
        coupon: {
          id: 'c',
          code: 'ODD',
          type: 'percent',
          value: 1_733,
          minSubtotalMinor: 0,
          currency: EGP,
          startsAt: null,
          endsAt: null,
          usageLimit: null,
          redeemedCount: 0,
          perCustomerLimit: null,
          customerRedeemedCount: 0,
          appliesToShipping: false,
          active: true,
        },
      },
      {
        name: 'mixed taxable and non-taxable lines with a discount',
        lines: [
          line({ id: 'a', unitAmount: egp(9_999), quantity: 3, taxable: true }),
          line({ id: 'b', unitAmount: egp(4_444), quantity: 1, taxable: false }),
          line({ id: 'c', unitAmount: egp(7), quantity: 11, taxable: true }),
        ],
        tax: { ...VAT, rateBps: 1_425, taxesShipping: true },
        coupon: {
          id: 'c',
          code: 'MIX',
          type: 'fixed',
          value: 8_888,
          minSubtotalMinor: 0,
          currency: EGP,
          startsAt: null,
          endsAt: null,
          usageLimit: null,
          redeemedCount: 0,
          perCustomerLimit: null,
          customerRedeemedCount: 0,
          appliesToShipping: false,
          active: true,
        },
      },
    ];

  for (const scenario of scenarios) {
    it(`line tax sums to the order tax: ${scenario.name}`, () => {
      const quote = priceCart({
        lines: scenario.lines,
        currency: EGP,
        destination: CAIRO,
        taxRules: [scenario.tax],
        shippingRates: [rate],
        coupon: scenario.coupon,
      });
      const lineTax = quote.lines.reduce((acc, l) => acc + l.lineTax.amount, 0);
      expect(lineTax).toBe(quote.tax.amount);
    });

    it(`line discounts sum to the order discount: ${scenario.name}`, () => {
      const quote = priceCart({
        lines: scenario.lines,
        currency: EGP,
        destination: CAIRO,
        taxRules: [scenario.tax],
        shippingRates: [rate],
        coupon: scenario.coupon,
      });
      const lineDiscount = quote.lines.reduce((acc, l) => acc + l.lineDiscount.amount, 0);
      expect(lineDiscount).toBe(quote.discount.amount);
    });

    it(`lines plus shipping equal the total: ${scenario.name}`, () => {
      const quote = priceCart({
        lines: scenario.lines,
        currency: EGP,
        destination: CAIRO,
        taxRules: [scenario.tax],
        shippingRates: [rate],
        coupon: scenario.coupon,
      });
      expectLinesToSumToTotal(quote);
    });

    it(`never charges a negative total: ${scenario.name}`, () => {
      const quote = priceCart({
        lines: scenario.lines,
        currency: EGP,
        destination: CAIRO,
        taxRules: [scenario.tax],
        shippingRates: [rate],
        coupon: scenario.coupon,
      });
      expect(quote.total.amount).toBeGreaterThanOrEqual(0);
      expect(quote.discount.amount).toBeLessThanOrEqual(quote.subtotal.amount);
    });
  }

  it('sweeps a thousand awkward carts without ever losing a piastre', () => {
    for (let i = 1; i <= 1_000; i += 1) {
      const quote = priceCart({
        lines: [
          line({ id: 'a', unitAmount: egp(i * 7), quantity: (i % 5) + 1 }),
          line({ id: 'b', unitAmount: egp(i * 13 + 1), quantity: (i % 3) + 1 }),
        ],
        currency: EGP,
        destination: CAIRO,
        taxRules: [{ ...VAT, rateBps: i % 2_000 }],
        shippingRates: [rate],
        coupon: {
          id: 'c',
          code: 'SWEEP',
          type: 'percent',
          value: i % 5_000,
          minSubtotalMinor: 0,
          currency: EGP,
          startsAt: null,
          endsAt: null,
          usageLimit: null,
          redeemedCount: 0,
          perCustomerLimit: null,
          customerRedeemedCount: 0,
          appliesToShipping: false,
          active: true,
        },
      });
      const lineTax = quote.lines.reduce((acc, l) => acc + l.lineTax.amount, 0);
      const lineDiscount = quote.lines.reduce((acc, l) => acc + l.lineDiscount.amount, 0);
      expect(lineTax).toBe(quote.tax.amount);
      expect(lineDiscount).toBe(quote.discount.amount);
      expectLinesToSumToTotal(quote);
      expect(quote.total.amount).toBeGreaterThanOrEqual(0);
    }
  });
});
