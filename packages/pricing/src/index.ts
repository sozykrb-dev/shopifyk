import {
  add,
  allocate,
  applyRate,
  extractTax,
  money,
  type Money,
  multiply,
  subtract,
  sum,
  zero,
} from '@velnorix/core';
import type {
  Coupon,
  CouponOutcome,
  CouponRejection,
  Destination,
  PriceableLine,
  PricedLine,
  Quote,
  ShippingRate,
  ShippingSelection,
  TaxRule,
} from './types.js';

export * from './types.js';

/*
 * The pricing engine.
 *
 * Four decisions are baked in here, and each one is a decision rather than an
 * accident:
 *
 * 1. **The server prices the order; the browser never does.** This module is
 *    pure so that it can run in exactly one place — checkout — with the same
 *    result every time. A total computed in the browser is a total a customer
 *    can edit.
 *
 * 2. **Free shipping is decided on the subtotal before the coupon.** If a
 *    discount could push an order below the threshold, a coupon would make the
 *    customer pay *more* overall, and the support ticket would be right.
 *
 * 3. **A discount is allocated, not applied to the total.** `allocate()` splits
 *    it across lines by value with the largest-remainder method, so the sum of
 *    the lines equals the order total down to the last piastre. Rounding each
 *    line independently is how a receipt stops adding up.
 *
 * 4. **Tax-inclusive is the default, because Egypt displays it that way.** When
 *    a price already contains VAT, the tax is *extracted* from it, not added on
 *    top — see `extractTax` in core.
 */

/** Sum of `quantity * unitAmount` across lines, before any adjustment. */
export function lineSubtotal(line: PriceableLine): Money {
  return multiply(line.unitAmount, line.quantity);
}

/** Whether a line may be discounted. Defaults to true. */
function isDiscountable(line: PriceableLine): boolean {
  return line.discountable !== false;
}

/** Whether a line is taxable. Defaults to true. */
function isTaxable(line: PriceableLine): boolean {
  return line.taxable !== false;
}

function normaliseCountry(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

function normalisePlace(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Every tax rule that matches the destination, most specific first.
 *
 * Specificity is explicit rather than clever: a rule naming a region beats a
 * rule naming only a country, and `priority` breaks ties so a merchant can
 * override the built-in rate without deleting it.
 */
export function matchTaxRules(
  rules: readonly TaxRule[],
  destination: Destination,
): readonly TaxRule[] {
  const country = normaliseCountry(destination.countryCode);
  const region = normalisePlace(destination.region);

  return rules
    .filter((rule) => {
      const ruleCountry = normaliseCountry(rule.countryCode);
      if (ruleCountry !== '*' && ruleCountry !== country) return false;
      const ruleRegion = normalisePlace(rule.region);
      // A rule with no region matches any region. A rule with a region only
      // matches that region — or a destination that named none, which we read
      // as "unspecified" and therefore not a contradiction, so the general
      // rate still applies.
      if (ruleRegion && region && ruleRegion !== region) return false;
      return true;
    })
    .sort((a, b) => {
      const specificity = Number(Boolean(b.region)) - Number(Boolean(a.region));
      if (specificity !== 0) return specificity;
      return b.priority - a.priority;
    });
}

/** The single tax rule that governs this destination, or null. */
export function resolveTaxRule(
  rules: readonly TaxRule[],
  destination: Destination,
): TaxRule | null {
  return matchTaxRules(rules, destination)[0] ?? null;
}

/** Every shipping rate that can deliver to this destination, best first. */
export function matchShippingRates(
  rates: readonly ShippingRate[],
  destination: Destination,
): readonly ShippingRate[] {
  const country = normaliseCountry(destination.countryCode);
  const region = normalisePlace(destination.region);
  const city = normalisePlace(destination.city);

  return rates
    .filter((rate) => {
      const rateCountry = normaliseCountry(rate.countryCode);
      if (rateCountry !== '*' && rateCountry !== country) return false;
      const rateRegion = normalisePlace(rate.region);
      if (rateRegion && region && rateRegion !== region) return false;
      const rateCity = normalisePlace(rate.city);
      if (rateCity && city && rateCity !== city) return false;
      return true;
    })
    .sort((a, b) => {
      const specificity =
        Number(Boolean(b.city)) - Number(Boolean(a.city)) ||
        Number(Boolean(b.region)) - Number(Boolean(a.region));
      if (specificity !== 0) return specificity;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.amount.amount - b.amount.amount;
    });
}

const REJECTION_MESSAGES: Record<CouponRejection, string> = {
  not_found: 'لم نجد هذا الكوبون.',
  inactive: 'هذا الكوبون غير مفعل حاليًا.',
  not_started: 'لم يبدأ العمل بهذا الكوبون بعد.',
  expired: 'انتهت صلاحية هذا الكوبون.',
  below_minimum: 'هذا الكوبون يتطلب حدًا أدنى للطلب أعلى من الحالي.',
  usage_limit_reached: 'تم استنفاد عدد مرات استخدام هذا الكوبون.',
  customer_limit_reached: 'لقد استخدمت هذا الكوبون من قبل بالحد الأقصى المسموح.',
  currency_mismatch: 'هذا الكوبون غير متاح بعملة المتجر.',
  nothing_discountable: 'لا توجد منتجات في السلة مؤهلة للخصم.',
};

/** The Arabic message for a rejection, safe to render verbatim. */
export function rejectionMessage(rejection: CouponRejection): string {
  return REJECTION_MESSAGES[rejection];
}

/**
 * Decides whether a coupon may be used, and how much it is worth.
 *
 * Every condition is re-checked here, on every call. A coupon that was valid
 * when the page was rendered may have expired or hit its cap before the
 * customer pressed pay, and a coupon validated only in the UI is a coupon a
 * customer can replay.
 *
 * `discountBase` is the amount the coupon is calculated from — usually the
 * goods subtotal, or goods plus shipping for coupons that cover shipping.
 */
export function evaluateCoupon(
  coupon: Coupon | null,
  discountBase: Money,
  asOf: Date = new Date(),
): CouponOutcome | null {
  if (!coupon) return null;

  const reject = (rejection: CouponRejection): CouponOutcome => ({
    coupon,
    accepted: false,
    rejection,
    discount: zero(discountBase.currency),
  });

  if (!coupon.active) return reject('inactive');
  if (coupon.currency !== discountBase.currency) return reject('currency_mismatch');
  if (coupon.startsAt && asOf < coupon.startsAt) return reject('not_started');
  if (coupon.endsAt && asOf >= coupon.endsAt) return reject('expired');
  if (discountBase.amount < coupon.minSubtotalMinor) return reject('below_minimum');
  if (coupon.usageLimit !== null && coupon.redeemedCount >= coupon.usageLimit) {
    return reject('usage_limit_reached');
  }
  if (coupon.perCustomerLimit !== null && coupon.customerRedeemedCount >= coupon.perCustomerLimit) {
    return reject('customer_limit_reached');
  }

  let discount: Money;
  if (coupon.type === 'percent') {
    discount = applyRate(discountBase, coupon.value);
  } else {
    const fixed = money(coupon.value, coupon.currency);
    // A fixed discount must never exceed what is there to discount, or the
    // order total goes negative and the merchant owes the customer money.
    discount = fixed.amount > discountBase.amount ? discountBase : fixed;
  }

  return { coupon, accepted: true, rejection: null, discount };
}

/**
 * Splits a discount across lines in proportion to their value.
 *
 * The returned amounts sum to at most `discount` — capped at each line's own
 * value, because a line can never be discounted below zero. The caller uses
 * the sum as the *effective* discount, so a coupon that outruns the goods
 * simply discounts the goods and no more.
 */
export function allocateDiscount(
  discount: Money,
  lines: readonly PriceableLine[],
): readonly Money[] {
  const weights = lines.map((line) => (isDiscountable(line) ? lineSubtotal(line).amount : 0));
  // Nothing to discount against: a cart of non-discountable lines cannot
  // allocate, and must not throw.
  if (weights.every((weight) => weight === 0)) return lines.map(() => zero(discount.currency));

  const shares = allocate(discount, weights).map((share, index) => {
    const line = lines[index];
    if (!line) throw new Error('allocateDiscount: line index out of range');
    // allocate() gives each non-discountable line a zero weight, so this only
    // guards the case where a single line's share exceeds its own value.
    const cap = lineSubtotal(line);
    return share.amount > cap.amount ? cap : share;
  });
  return shares;
}

/**
 * Picks the shipping the customer will be charged.
 *
 * The free-shipping threshold is compared against `thresholdBase`, which
 * callers pass as the **pre-discount** subtotal: a coupon must never cost the
 * customer their free shipping.
 */
export function selectShipping(
  rates: readonly ShippingRate[],
  destination: Destination,
  thresholdBase: Money,
): ShippingSelection | null {
  const match = matchShippingRates(rates, destination)[0];
  if (!match) return null;

  const freeShippingApplied =
    match.freeAboveMinor !== null && thresholdBase.amount >= match.freeAboveMinor;

  const amount = freeShippingApplied ? zero(match.amount.currency) : match.amount;

  return {
    rate: match,
    amount,
    freeShippingApplied,
    minDays: match.minDays,
    maxDays: match.maxDays,
  };
}

/**
 * Prices an order.
 *
 * The one function a checkout should call. Everything it needs is passed in;
 * nothing is fetched, and nothing is remembered, so the same inputs always
 * produce the same totals — including in a test, six months from now.
 */
export function priceCart(request: {
  lines: readonly PriceableLine[];
  currency: string;
  destination: Destination;
  taxRules?: readonly TaxRule[];
  shippingRates?: readonly ShippingRate[];
  coupon?: Coupon | null;
  asOf?: Date;
}): Quote {
  const { lines, currency, destination, asOf = new Date() } = request;
  const taxRules = request.taxRules ?? [];
  const shippingRates = request.shippingRates ?? [];
  const notes: string[] = [];

  if (lines.length === 0) {
    return emptyQuote(currency);
  }

  for (const line of lines) {
    if (line.unitAmount.currency !== currency) {
      throw new Error(
        `Pricing currency mismatch: line priced in ${line.unitAmount.currency}, order in ${currency}.`,
      );
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new Error('Line quantity must be a non-negative integer.');
    }
  }

  const lineSubtotals = lines.map(lineSubtotal);
  const subtotal = sum(lineSubtotals, currency);

  // Free shipping is judged on the undiscounted subtotal — see the note at the
  // top of this file.
  const shipping = selectShipping(shippingRates, destination, subtotal);
  const shippingBase = shipping ? shipping.amount : zero(currency);
  if (shipping?.freeShippingApplied) notes.push('شحن مجاني مطبّق على هذا الطلب.');

  // The coupon is calculated against what it is allowed to touch.
  const discountBase =
    request.coupon?.appliesToShipping && shipping ? add(subtotal, shippingBase) : subtotal;
  const couponOutcome = evaluateCoupon(request.coupon ?? null, discountBase, asOf);
  if (couponOutcome?.rejection) notes.push(rejectionMessage(couponOutcome.rejection));

  const discountShares = couponOutcome?.accepted
    ? allocateDiscount(couponOutcome.discount, lines)
    : lines.map(() => zero(currency));
  const discount = sum(discountShares, currency);
  if (couponOutcome?.accepted && discount.amount === 0 && couponOutcome.discount.amount > 0) {
    notes.push(rejectionMessage('nothing_discountable'));
  } else if (couponOutcome?.accepted && discount.amount < couponOutcome.discount.amount) {
    notes.push('تم تقليص الخصم إلى قيمة المنتجات المؤهلة.');
  }

  const taxRule = resolveTaxRule(taxRules, destination);
  const netGoods = subtract(subtotal, discount);

  // Per-line net, so tax can be allocated rather than recomputed per line.
  const lineNets = lines.map((line, index) => {
    const gross = lineSubtotals[index] ?? zero(currency);
    const share = discountShares[index] ?? zero(currency);
    return { line, gross, net: subtract(gross, share) };
  });

  const taxableBase = sum(
    lineNets.filter(({ line }) => isTaxable(line)).map(({ net }) => net),
    currency,
  );

  let tax = zero(currency);
  if (taxRule && taxRule.rateBps !== 0) {
    tax = taxRule.priceInclusive
      ? extractTax(taxableBase, taxRule.rateBps)
      : applyRate(taxableBase, taxRule.rateBps);
  }

  // Tax is allocated across lines by their discounted value, so the lines on
  // the receipt add up to the order's tax — not to the tax plus a rounding
  // error per line.
  const taxShares = allocateTax(tax, lineNets, currency);

  let shippingAmount = shippingBase;
  let shippingTax = zero(currency);
  if (taxRule && taxRule.taxesShipping && shippingBase.amount > 0) {
    if (taxRule.priceInclusive) {
      shippingTax = extractTax(shippingBase, taxRule.rateBps);
    } else {
      shippingTax = applyRate(shippingBase, taxRule.rateBps);
      shippingAmount = add(shippingBase, shippingTax);
    }
  } else if (taxRule && taxRule.priceInclusive && shippingBase.amount > 0) {
    // Inclusive pricing: the shipping charge already contains its tax, so
    // report the tax that is inside it without changing what is charged.
    shippingTax = extractTax(shippingBase, taxRule.rateBps);
  }

  const pricedLines: PricedLine[] = lineNets.map(({ line, gross, net }, index) => {
    const lineDiscount = discountShares[index] ?? zero(currency);
    const lineTax = isTaxable(line) ? (taxShares[index] ?? zero(currency)) : zero(currency);
    const lineTotal = taxRule?.priceInclusive ? net : add(net, lineTax);
    return {
      id: line.id,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      lineSubtotal: gross,
      lineDiscount,
      lineTax,
      lineTotal,
      taxable: isTaxable(line),
    };
  });

  const total = taxRule?.priceInclusive
    ? add(netGoods, shippingAmount)
    : add(add(netGoods, shippingAmount), tax);

  return {
    currency,
    lines: pricedLines,
    subtotal,
    discount,
    taxableBase,
    tax,
    shippingTax,
    appliedTaxRule: taxRule,
    shipping,
    shippingAmount,
    total,
    coupon: couponOutcome,
    notes,
  };
}

/** A quote for an empty cart: every amount zero, nothing matched. */
function emptyQuote(currency: string): Quote {
  return {
    currency,
    lines: [],
    subtotal: zero(currency),
    discount: zero(currency),
    taxableBase: zero(currency),
    tax: zero(currency),
    shippingTax: zero(currency),
    appliedTaxRule: null,
    shipping: null,
    shippingAmount: zero(currency),
    total: zero(currency),
    coupon: null,
    notes: [],
  };
}

/**
 * Spreads an order-level tax across lines, largest-remainder, skipping lines
 * that are not taxable.
 */
function allocateTax(
  tax: Money,
  lineNets: readonly { line: PriceableLine; net: Money }[],
  currency: string,
): readonly Money[] {
  if (tax.amount === 0) return lineNets.map(() => zero(currency));
  const weights = lineNets.map(({ line, net }) => (isTaxable(line) ? net.amount : 0));
  if (weights.every((weight) => weight === 0)) return lineNets.map(() => zero(currency));
  return allocate(tax, weights);
}
