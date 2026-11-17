'use server';

import { revalidatePath } from 'next/cache';
import { PERMISSION } from '@velnorix/auth';
import {
  createCoupon,
  createShippingRate,
  createTaxRule,
  deactivateCoupon,
  deactivateShippingRate,
  deactivateTaxRule,
  withTenant,
} from '@velnorix/db';
import { requirePrincipal } from '@/lib/session.js';

/**
 * Pricing Server Actions.
 *
 * These change what a store charges, so they are gated on
 * `store:settings.write` -- the same permission that guards the rest of the
 * store's commercial settings -- and they run inside `withTenant()`, where RLS
 * would refuse another store's rows even if the permission check were bypassed.
 *
 * Nothing is ever deleted. A rate that produced a real receipt is deactivated
 * instead, so an old order can still explain what it charged and why.
 */

export type PricingFormState = { error?: string; ok?: string };

/** Requires the settings permission and returns the tenant scope. */
async function authorize(): Promise<{ storeId: string } | { error: string }> {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  if (!storeId) return { error: 'هذا النطاق غير مرتبط بأي متجر.' };
  if (!principal.permissions.has(PERMISSION.STORE_SETTINGS_WRITE)) {
    return { error: 'ليس لديك صلاحية تعديل إعدادات المتجر.' };
  }
  return { storeId };
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

/**
 * Percentages are entered the way a merchant says them ("14") and stored as
 * basis points, because a rate kept as a float is a rounding bug waiting for a
 * large order.
 */
function parsePercentToBps(value: string): number | null {
  const trimmed = value.trim().replace(/[%\s,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const bps = Math.round(Number(trimmed) * 100);
  if (bps > 10_000) return null;
  return bps;
}

/** Money in major units (ج.م) -> minor units (قروش), once, at the edge. */
function parseMoneyToMinor(value: string): number | null {
  const trimmed = value.trim().replace(/[,\s]/g, '');
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

function parseOptionalMoneyToMinor(value: string): number | null | undefined {
  if (value.trim() === '') return null;
  return parseMoneyToMinor(value);
}

/**
 * An optional whole number: `null` when the field was left empty, `'invalid'`
 * when it was filled in with something that is not one. An empty field and a
 * nonsense field are different answers and must not collapse into each other.
 */
function parseOptionalInt(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  return Number.parseInt(trimmed, 10);
}

function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

/* ------------------------------------------------------------------- tax rules */

export async function createTaxRuleAction(
  _prev: PricingFormState,
  formData: FormData,
): Promise<PricingFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };

  const nameAr = text(formData, 'nameAr');
  const rateBps = parsePercentToBps(text(formData, 'rate'));

  if (!nameAr) return { error: 'أدخل اسم القاعدة.' };
  if (rateBps === null) return { error: 'أدخل النسبة كرقم بين 0 و100.' };

  const priority = parseOptionalInt(text(formData, 'priority'));
  if (priority === 'invalid') return { error: 'أدخل الأولوية كرقم.' };

  await withTenant(auth.storeId, (db) =>
    createTaxRule(db, {
      storeId: auth.storeId,
      nameAr,
      nameEn: text(formData, 'nameEn') || nameAr,
      rateBps,
      countryCode: text(formData, 'countryCode') || '*',
      region: emptyToNull(text(formData, 'region')),
      priceInclusive: formData.get('priceInclusive') === 'on',
      taxesShipping: formData.get('taxesShipping') === 'on',
      priority: priority ?? 0,
    }),
  );

  revalidatePath('/pricing');
  return { ok: 'تمت إضافة قاعدة الضريبة.' };
}

export async function deactivateTaxRuleAction(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ('error' in auth) return;
  const id = text(formData, 'id');
  if (!id) return;
  await withTenant(auth.storeId, (db) => deactivateTaxRule(db, id));
  revalidatePath('/pricing');
}

/* --------------------------------------------------------------- shipping rates */

export async function createShippingRateAction(
  _prev: PricingFormState,
  formData: FormData,
): Promise<PricingFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };

  const nameAr = text(formData, 'nameAr');
  const amountMinor = parseMoneyToMinor(text(formData, 'amount'));
  const freeAboveMinor = parseOptionalMoneyToMinor(text(formData, 'freeAbove'));

  if (!nameAr) return { error: 'أدخل اسم طريقة الشحن.' };
  if (amountMinor === null) return { error: 'أدخل تكلفة الشحن كرقم.' };
  if (freeAboveMinor === undefined) return { error: 'أدخل حد الشحن المجاني كرقم أو اتركه فارغًا.' };

  const minDays = parseOptionalInt(text(formData, 'minDays'));
  const maxDays = parseOptionalInt(text(formData, 'maxDays'));
  if (minDays === 'invalid' || maxDays === 'invalid') {
    return { error: 'أدخل مدة التوصيل بالأيام.' };
  }
  if (minDays !== null && maxDays !== null && maxDays < minDays) {
    return { error: 'أقصى مدة يجب أن يكون أكبر من أقل مدة أو يساويها.' };
  }

  const priority = parseOptionalInt(text(formData, 'priority'));
  if (priority === 'invalid') return { error: 'أدخل الأولوية كرقم.' };

  await withTenant(auth.storeId, (db) =>
    createShippingRate(db, {
      storeId: auth.storeId,
      nameAr,
      nameEn: text(formData, 'nameEn') || nameAr,
      amountMinor,
      currency: text(formData, 'currency') || 'EGP',
      countryCode: text(formData, 'countryCode') || '*',
      region: emptyToNull(text(formData, 'region')),
      city: emptyToNull(text(formData, 'city')),
      freeAboveMinor,
      minDays,
      maxDays,
      priority: priority ?? 0,
    }),
  );

  revalidatePath('/pricing');
  return { ok: 'تمت إضافة طريقة الشحن.' };
}

export async function deactivateShippingRateAction(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ('error' in auth) return;
  const id = text(formData, 'id');
  if (!id) return;
  await withTenant(auth.storeId, (db) => deactivateShippingRate(db, id));
  revalidatePath('/pricing');
}

/* ---------------------------------------------------------------------- coupons */

export async function createCouponAction(
  _prev: PricingFormState,
  formData: FormData,
): Promise<PricingFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };

  const code = text(formData, 'code');
  const type = text(formData, 'type') === 'fixed' ? 'fixed' : 'percent';
  const currency = text(formData, 'currency') || 'EGP';

  if (!code) return { error: 'أدخل رمز الكوبون.' };

  /*
   * The value means two different things, and mixing them up is the classic
   * coupon bug: a percentage is basis points, a fixed amount is money.
   */
  const value =
    type === 'percent'
      ? parsePercentToBps(text(formData, 'value'))
      : parseMoneyToMinor(text(formData, 'value'));
  if (value === null) {
    return {
      error: type === 'percent' ? 'أدخل النسبة كرقم بين 0 و100.' : 'أدخل قيمة الخصم كرقم.',
    };
  }
  if (type === 'percent' && value > 10_000) return { error: 'لا يمكن أن يتجاوز الخصم 100%.' };

  const minSubtotalMinor = parseMoneyToMinor(text(formData, 'minSubtotal'));
  if (minSubtotalMinor === null) return { error: 'أدخل الحد الأدنى كرقم.' };

  const usageLimit = parseOptionalInt(text(formData, 'usageLimit'));
  const perCustomerLimit = parseOptionalInt(text(formData, 'perCustomerLimit'));
  if (usageLimit === 'invalid' || perCustomerLimit === 'invalid') {
    return { error: 'أدخل حدود الاستخدام كأرقام أو اتركها فارغة.' };
  }

  const startsAt = text(formData, 'startsAt');
  const endsAt = text(formData, 'endsAt');
  const parsedStartsAt = startsAt ? new Date(startsAt) : null;
  const parsedEndsAt = endsAt ? new Date(endsAt) : null;
  if (startsAt && Number.isNaN(parsedStartsAt?.getTime())) {
    return { error: 'تاريخ البدء غير صحيح.' };
  }
  if (endsAt && Number.isNaN(parsedEndsAt?.getTime())) {
    return { error: 'تاريخ الانتهاء غير صحيح.' };
  }
  if (parsedStartsAt && parsedEndsAt && parsedEndsAt <= parsedStartsAt) {
    return { error: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء.' };
  }

  try {
    await withTenant(auth.storeId, (db) =>
      createCoupon(db, {
        storeId: auth.storeId,
        code,
        type,
        value,
        currency,
        minSubtotalMinor,
        startsAt: parsedStartsAt,
        endsAt: parsedEndsAt,
        usageLimit,
        perCustomerLimit,
        appliesToShipping: formData.get('appliesToShipping') === 'on',
      }),
    );
  } catch {
    // The unique index on (store_id, code) is the authority: a check-then-insert
    // would race, so we let the index decide and translate its answer.
    return { error: 'يوجد كوبون بنفس هذا الرمز بالفعل.' };
  }

  revalidatePath('/pricing');
  return { ok: 'تم إنشاء الكوبون.' };
}

export async function deactivateCouponAction(formData: FormData): Promise<void> {
  const auth = await authorize();
  if ('error' in auth) return;
  const id = text(formData, 'id');
  if (!id) return;
  await withTenant(auth.storeId, (db) => deactivateCoupon(db, id));
  revalidatePath('/pricing');
}
