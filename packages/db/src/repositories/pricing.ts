import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type {
  Coupon as EngineCoupon,
  ShippingRate as EngineShippingRate,
  TaxRule as EngineTaxRule,
} from '@velnorix/pricing';
import type { Database } from '../client.js';
import {
  couponRedemptions,
  coupons,
  shippingRates,
  taxRules,
  type CouponRow,
  type ShippingRateRow,
  type TaxRuleRow,
} from '../schema.js';

/*
 * Pricing rules as data.
 *
 * This repository exists to do two things, and nothing else:
 *
 *   1. Persist what the merchant configured, in the store's tenant scope.
 *   2. Hand the pricing engine plain data it can price an order from.
 *
 * There is deliberately no pricing arithmetic in this file. The rules that
 * decide what a customer pays live in `packages/pricing`, are pure, and are
 * tested there -- where a rounding bug is caught by a test rather than by a
 * customer.
 */

type Db = Database;
type Money = { amount: number; currency: string };

/* ------------------------------------------------------------------ mappings */

/** A database row -> the engine's shape. Currency comes from the store. */
export function toTaxRule(row: TaxRuleRow): EngineTaxRule {
  return {
    id: row.id,
    name: row.nameAr,
    rateBps: row.rateBps,
    countryCode: row.countryCode,
    region: row.region,
    priceInclusive: row.priceInclusive,
    taxesShipping: row.taxesShipping,
    priority: row.priority,
  };
}

export function toShippingRate(row: ShippingRateRow): EngineShippingRate {
  return {
    id: row.id,
    name: row.nameAr,
    amount: { amount: row.amountMinor, currency: row.currency },
    countryCode: row.countryCode,
    region: row.region,
    city: row.city,
    freeAboveMinor: row.freeAboveMinor,
    minDays: row.minDays,
    maxDays: row.maxDays,
    priority: row.priority,
  };
}

/**
 * A coupon row -> the engine's shape, with its **current** usage counts.
 *
 * The counts are read from `coupon_redemptions`, not stored on the coupon: a
 * counter that can drift from the rows it counts is a limit that can be
 * exceeded. Pass `email` to get an accurate per-customer count.
 */
export function toCoupon(
  row: CouponRow,
  counts: { total: number; forEmail: number },
): EngineCoupon {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    minSubtotalMinor: row.minSubtotalMinor,
    currency: row.currency,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    redeemedCount: counts.total,
    perCustomerLimit: row.perCustomerLimit,
    customerRedeemedCount: counts.forEmail,
    appliesToShipping: row.appliesToShipping,
    active: row.active,
  };
}

/** How many times a coupon has been redeemed, overall and by one email. */
export async function couponUsage(
  db: Db,
  couponId: string,
  email?: string | null,
): Promise<{ total: number; forEmail: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      forEmail: sql<number>`count(*) filter (where ${couponRedemptions.emailNormalized} = ${normaliseEmail(email)})::int`,
    })
    .from(couponRedemptions)
    .where(eq(couponRedemptions.couponId, couponId));

  return { total: row?.total ?? 0, forEmail: email ? (row?.forEmail ?? 0) : 0 };
}

function normaliseEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/* ------------------------------------------------------------------- tax rules */

export async function listTaxRules(db: Db): Promise<TaxRuleRow[]> {
  return db.select().from(taxRules).orderBy(asc(taxRules.priority), asc(taxRules.nameAr));
}

export async function createTaxRule(
  db: Db,
  input: {
    storeId: string;
    nameAr: string;
    nameEn: string;
    rateBps: number;
    countryCode?: string;
    region?: string | null;
    priceInclusive?: boolean;
    taxesShipping?: boolean;
    priority?: number;
    active?: boolean;
  },
): Promise<TaxRuleRow> {
  const [row] = await db
    .insert(taxRules)
    .values({
      storeId: input.storeId,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      rateBps: input.rateBps,
      countryCode: input.countryCode ?? '*',
      region: input.region ?? null,
      priceInclusive: input.priceInclusive ?? true,
      taxesShipping: input.taxesShipping ?? false,
      priority: input.priority ?? 0,
      active: input.active ?? true,
    })
    .returning();
  if (!row) throw new Error('createTaxRule: insert returned no row');
  return row;
}

export async function updateTaxRule(
  db: Db,
  id: string,
  patch: Partial<{
    nameAr: string;
    nameEn: string;
    rateBps: number;
    countryCode: string;
    region: string | null;
    priceInclusive: boolean;
    taxesShipping: boolean;
    priority: number;
    active: boolean;
  }>,
): Promise<TaxRuleRow | null> {
  const [row] = await db
    .update(taxRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(taxRules.id, id))
    .returning();
  return row ?? null;
}

/**
 * Deactivating is preferred to deleting: an old order's receipt refers to the
 * rule that produced it, and a deleted rate makes that receipt unexplainable.
 */
export async function deactivateTaxRule(db: Db, id: string): Promise<void> {
  await db
    .update(taxRules)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(taxRules.id, id));
}

/* --------------------------------------------------------------- shipping rates */

export async function listShippingRates(db: Db): Promise<ShippingRateRow[]> {
  return db
    .select()
    .from(shippingRates)
    .orderBy(desc(shippingRates.priority), asc(shippingRates.amountMinor));
}

export async function createShippingRate(
  db: Db,
  input: {
    storeId: string;
    nameAr: string;
    nameEn: string;
    amountMinor: number;
    currency: string;
    countryCode?: string;
    region?: string | null;
    city?: string | null;
    freeAboveMinor?: number | null;
    minDays?: number | null;
    maxDays?: number | null;
    priority?: number;
    active?: boolean;
  },
): Promise<ShippingRateRow> {
  const [row] = await db
    .insert(shippingRates)
    .values({
      storeId: input.storeId,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      amountMinor: input.amountMinor,
      currency: input.currency,
      countryCode: input.countryCode ?? '*',
      region: input.region ?? null,
      city: input.city ?? null,
      freeAboveMinor: input.freeAboveMinor ?? null,
      minDays: input.minDays ?? null,
      maxDays: input.maxDays ?? null,
      priority: input.priority ?? 0,
      active: input.active ?? true,
    })
    .returning();
  if (!row) throw new Error('createShippingRate: insert returned no row');
  return row;
}

export async function updateShippingRate(
  db: Db,
  id: string,
  patch: Partial<{
    nameAr: string;
    nameEn: string;
    amountMinor: number;
    countryCode: string;
    region: string | null;
    city: string | null;
    freeAboveMinor: number | null;
    minDays: number | null;
    maxDays: number | null;
    priority: number;
    active: boolean;
  }>,
): Promise<ShippingRateRow | null> {
  const [row] = await db
    .update(shippingRates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(shippingRates.id, id))
    .returning();
  return row ?? null;
}

export async function deactivateShippingRate(db: Db, id: string): Promise<void> {
  await db
    .update(shippingRates)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(shippingRates.id, id));
}

/* ---------------------------------------------------------------------- coupons */

export async function listCoupons(db: Db): Promise<CouponRow[]> {
  return db.select().from(coupons).orderBy(desc(coupons.createdAt));
}

/**
 * Finds a coupon by code, typed the way a human types it.
 *
 * The lookup is case- and space-insensitive, because "welcome10" and
 * "WELCOME 10" are the same coupon to a customer -- but the stored code stays
 * normalised, so the unique index still means what it says.
 */
export async function findCouponByCode(
  db: Db,
  storeId: string,
  code: string,
): Promise<CouponRow | null> {
  const [row] = await db
    .select()
    .from(coupons)
    .where(and(eq(coupons.storeId, storeId), eq(coupons.code, normaliseCode(code))));
  return row ?? null;
}

export async function createCoupon(
  db: Db,
  input: {
    storeId: string;
    code: string;
    type: 'percent' | 'fixed';
    value: number;
    currency: string;
    minSubtotalMinor?: number;
    startsAt?: Date | null;
    endsAt?: Date | null;
    usageLimit?: number | null;
    perCustomerLimit?: number | null;
    appliesToShipping?: boolean;
    active?: boolean;
  },
): Promise<CouponRow> {
  const [row] = await db
    .insert(coupons)
    .values({
      storeId: input.storeId,
      code: normaliseCode(input.code),
      type: input.type,
      value: input.value,
      currency: input.currency,
      minSubtotalMinor: input.minSubtotalMinor ?? 0,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      usageLimit: input.usageLimit ?? null,
      perCustomerLimit: input.perCustomerLimit ?? null,
      appliesToShipping: input.appliesToShipping ?? false,
      active: input.active ?? true,
    })
    .returning();
  if (!row) throw new Error('createCoupon: insert returned no row');
  return row;
}

export async function updateCoupon(
  db: Db,
  id: string,
  patch: Partial<{
    code: string;
    type: 'percent' | 'fixed';
    value: number;
    minSubtotalMinor: number;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    perCustomerLimit: number | null;
    appliesToShipping: boolean;
    active: boolean;
  }>,
): Promise<CouponRow | null> {
  const [row] = await db
    .update(coupons)
    .set({
      ...patch,
      ...(patch.code ? { code: normaliseCode(patch.code) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(coupons.id, id))
    .returning();
  return row ?? null;
}

export async function deactivateCoupon(db: Db, id: string): Promise<void> {
  await db.update(coupons).set({ active: false, updatedAt: new Date() }).where(eq(coupons.id, id));
}

/* ------------------------------------------------------------------ redemptions */

/**
 * Records that a coupon was used.
 *
 * Idempotent by order: the unique index on (coupon_id, order_id) is the claim,
 * so replaying a checkout cannot inflate the usage count and push a coupon
 * past its cap. A suppressed insert returns null rather than throwing.
 */
export async function redeemCoupon(
  db: Db,
  input: {
    storeId: string;
    couponId: string;
    orderId: string;
    email?: string | null;
    amount: Money;
  },
): Promise<{ id: string; duplicate: boolean } | null> {
  const [row] = await db
    .insert(couponRedemptions)
    .values({
      storeId: input.storeId,
      couponId: input.couponId,
      orderId: input.orderId,
      emailNormalized: input.email ? normaliseEmail(input.email) : null,
      amountMinor: input.amount.amount,
      currency: input.amount.currency,
    })
    .onConflictDoNothing()
    .returning({ id: couponRedemptions.id });

  if (row) return { id: row.id, duplicate: false };

  // Either a replay of this order, or the redemption already exists. Either
  // way the cap is correctly counted exactly once.
  const [existing] = await db
    .select({ id: couponRedemptions.id })
    .from(couponRedemptions)
    .where(
      and(
        eq(couponRedemptions.couponId, input.couponId),
        eq(couponRedemptions.orderId, input.orderId),
      ),
    );
  return existing ? { id: existing.id, duplicate: true } : null;
}

export async function listRedemptions(
  db: Db,
  couponId: string,
): Promise<{ emailNormalized: string | null; amountMinor: number; redeemedAt: Date }[]> {
  return db
    .select({
      emailNormalized: couponRedemptions.emailNormalized,
      amountMinor: couponRedemptions.amountMinor,
      redeemedAt: couponRedemptions.redeemedAt,
    })
    .from(couponRedemptions)
    .where(eq(couponRedemptions.couponId, couponId))
    .orderBy(desc(couponRedemptions.redeemedAt));
}

/* ----------------------------------------------------------------- for the engine */

/**
 * Everything the pricing engine needs for one order, in the store's scope.
 *
 * Called from checkout inside `withTenant`, so the rules returned here are
 * necessarily that store's rules -- there is no way to ask for another store's
 * pricing, because RLS would return nothing.
 */
export async function pricingInputs(
  db: Db,
  input: {
    storeId: string;
    email?: string | null;
    code?: string | null;
  },
): Promise<{
  taxRules: EngineTaxRule[];
  shippingRates: EngineShippingRate[];
  coupon: EngineCoupon | null;
  couponRow: CouponRow | null;
}> {
  const [ruleRows, rateRows, couponResult] = await Promise.all([
    db.select().from(taxRules).where(eq(taxRules.active, true)),
    db.select().from(shippingRates).where(eq(shippingRates.active, true)),
    input.code
      ? loadCouponForPricing(db, input.storeId, input.code, input.email ?? null)
      : Promise.resolve(null),
  ]);

  return {
    taxRules: ruleRows.map(toTaxRule),
    shippingRates: rateRows.map(toShippingRate),
    coupon: couponResult?.coupon ?? null,
    couponRow: couponResult?.row ?? null,
  };
}

/**
 * Loads a coupon for the engine, with its usage counts attached.
 *
 * A coupon the engine is handed without its counts is a coupon that can be
 * used forever: the limits live in the redemptions, not in the row.
 */
export async function loadCouponForPricing(
  db: Db,
  storeId: string,
  code: string,
  email?: string | null,
): Promise<{ row: CouponRow; coupon: EngineCoupon } | null> {
  const row = await findCouponByCode(db, storeId, code);
  if (!row) return null;
  const counts = await couponUsage(db, row.id, email);
  return { row, coupon: toCoupon(row, counts) };
}
