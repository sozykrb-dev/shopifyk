import type { Money } from '@velnorix/core';

/**
 * The vocabulary of pricing.
 *
 * Everything here is plain data, with no database and no I/O. That is the
 * point: the rules that decide what a customer pays are the rules most worth
 * testing, and a pure function over plain data can be tested exhaustively —
 * including the rounding edges that only show up once in a thousand orders.
 *
 * The persisted shapes (rows from `packages/db`) are deliberately *not*
 * imported. The engine takes only the fields it needs, so a migration that
 * adds a column to a table cannot break pricing.
 */

/** Where the order is going. Shipping zones and tax rates are matched on it. */
export type Destination = Readonly<{
  countryCode: string;
  /** Governorate / state. Optional: Egyptian addresses often omit it. */
  region?: string | null;
  city?: string | null;
  /** Postal code, where the country uses one. */
  postalCode?: string | null;
}>;

/** One line entering pricing: what is in the cart, before any adjustment. */
export type PriceableLine = Readonly<{
  /** Stable within one pricing run; used to key the returned breakdown. */
  id: string;
  /** Unit price at the time of pricing. */
  unitAmount: Money;
  quantity: number;
  /** Whether tax applies to this line. Shipping is decided separately. */
  taxable?: boolean;
  /**
   * Whether the line counts towards a coupon's minimum-subtotal threshold and
   * can itself be discounted. Gift cards and the like opt out.
   */
  discountable?: boolean;
}>;

/**
 * A tax rule as data.
 *
 * `rateBps` is integer basis points (100 = 1%, 1400 = 14%). Basis points and
 * not a percentage, because a percentage invites a float and a float invites
 * the one-piastre discrepancy that shows up in a reconciliation months later.
 */
export type TaxRule = Readonly<{
  id: string;
  name: string;
  rateBps: number;
  /** ISO country code the rule applies to; `'*'` matches any country. */
  countryCode: string;
  /** Optional governorate / state filter. `null` means "any region". */
  region: string | null;
  /**
   * Tax-inclusive pricing: the displayed price already contains the tax, so
   * the tax is *extracted* from the gross amount rather than added to it.
   * Egypt displays prices inclusive of VAT, so this is the common case.
   */
  priceInclusive: boolean;
  /** Whether tax is charged on shipping as well as on goods. */
  taxesShipping: boolean;
  /** Higher priority wins when several rules match the same destination. */
  priority: number;
}>;

/** A shipping rate as data. Several can exist per store; the best one wins. */
export type ShippingRate = Readonly<{
  id: string;
  name: string;
  /** Cost in minor units of the store currency. */
  amount: Money;
  countryCode: string;
  region: string | null;
  city: string | null;
  /**
   * Orders at or above this subtotal (after discounts) ship free. `null`
   * means the threshold does not apply.
   */
  freeAboveMinor: number | null;
  /** Delivery estimate in days, for display only — never for money. */
  minDays: number | null;
  maxDays: number | null;
  priority: number;
}>;

export type CouponType = 'percent' | 'fixed';

/**
 * A coupon as data.
 *
 * Validity is evaluated, never trusted: the engine re-checks the window, the
 * minimum spend and the usage cap on every call, because a coupon that was
 * valid when the page rendered may have expired by the time the customer
 * presses "pay".
 */
export type Coupon = Readonly<{
  id: string;
  code: string;
  type: CouponType;
  /** Percent coupons: basis points off (1000 = 10%). Fixed: minor units off. */
  value: number;
  /** Minimum subtotal required, in minor units. Zero means no minimum. */
  minSubtotalMinor: number;
  /** Fixed coupons in a foreign currency make no sense; this guards the call. */
  currency: string;
  /** Inclusive start, exclusive end. */
  startsAt: Date | null;
  endsAt: Date | null;
  /** Total times the coupon may be redeemed. `null` is unlimited. */
  usageLimit: number | null;
  /** How many times it has been redeemed so far. */
  redeemedCount: number;
  /** Per-customer cap. `null` is unlimited. */
  perCustomerLimit: number | null;
  /** How many times *this* customer has already used it. */
  customerRedeemedCount: number;
  /** Whether shipping is discounted too. Usually false. */
  appliesToShipping: boolean;
  active: boolean;
}>;

/** Why a coupon was refused. Shown to the customer verbatim, in Arabic. */
export type CouponRejection =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'below_minimum'
  | 'usage_limit_reached'
  | 'customer_limit_reached'
  | 'currency_mismatch'
  | 'nothing_discountable';

/** A coupon the customer typed in, and what the engine made of it. */
export type CouponOutcome = Readonly<{
  coupon: Coupon;
  accepted: boolean;
  rejection: CouponRejection | null;
  discount: Money;
}>;

/** One line, after discount and tax have been applied to it. */
export type PricedLine = Readonly<{
  id: string;
  quantity: number;
  unitAmount: Money;
  /** Line total before any adjustment. */
  lineSubtotal: Money;
  /** This line's share of the order-level discount. */
  lineDiscount: Money;
  /** Tax on this line, after its discount. */
  lineTax: Money;
  /** What the customer pays for this line, tax included where applicable. */
  lineTotal: Money;
  taxable: boolean;
}>;

export type ShippingSelection = Readonly<{
  rate: ShippingRate;
  amount: Money;
  /** True when the cost was waived by the rate's free-shipping threshold. */
  freeShippingApplied: boolean;
  minDays: number | null;
  maxDays: number | null;
}>;

/**
 * The complete answer to "what does this order cost?".
 *
 * Every field is a `Money`, never a number, so a caller cannot add a shipping
 * cost to a subtotal without going through `core/money` — and therefore cannot
 * add EGP to SAR by accident.
 */
export type Quote = Readonly<{
  currency: string;
  lines: readonly PricedLine[];
  /** Sum of line subtotals, before discounts. */
  subtotal: Money;
  /** Order-level discount from the coupon. */
  discount: Money;
  /** Subtotal after discount; the base used for tax. */
  taxableBase: Money;
  /** Tax on goods. */
  tax: Money;
  /** Tax on shipping, when the rule says shipping is taxed. */
  shippingTax: Money;
  /** The rate that was applied, for the receipt. `null` when none matched. */
  appliedTaxRule: TaxRule | null;
  shipping: ShippingSelection | null;
  shippingAmount: Money;
  /** Goods + shipping + all tax - discount. What the customer pays. */
  total: Money;
  coupon: CouponOutcome | null;
  /**
   * Human-readable notes: "free shipping applied", "coupon expired". The UI
   * renders these; the totals above are authoritative regardless.
   */
  notes: readonly string[];
}>;
