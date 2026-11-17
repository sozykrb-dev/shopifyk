'use server';

import { revalidatePath } from 'next/cache';
import { PERMISSION } from '@velnorix/auth';
import { SUPPORTED_CURRENCIES } from '@velnorix/core';
import { getStoreSettings, updateStore, upsertStoreSettings, withTenant } from '@velnorix/db';
import { requirePrincipal } from '@/lib/session.js';

/**
 * Store settings Server Actions.
 *
 * Gated on `store:settings.write` and scoped by `withTenant()`, where RLS is
 * the final word: a store can only ever write its own settings row, whatever
 * the form claims to contain.
 *
 * Colour and locale are validated here rather than trusted from the form. A
 * colour is injected into a CSS custom property and rendered on every store
 * page, so an unvalidated value is stored XSS dressed up as branding.
 */

export type SettingsFormState = { error?: string; ok?: string };

const LOCALES = ['ar', 'en'] as const;
const THEMES = ['dawn', 'dusk', 'sand', 'ink'] as const;

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
 * A six-digit hex colour, and nothing else.
 *
 * The value is written into a `style` attribute on the storefront, so the
 * check is not cosmetic: `red; background: url(javascript:…)` would otherwise
 * be a stored XSS with a very friendly name.
 */
function parseHexColour(value: string): string | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return null;
  return value.toLowerCase();
}

/** Only same-origin or https image URLs: a logo is rendered as an <img src>. */
function parseLogoUrl(value: string): string | null {
  if (value === '') return '';
  if (/^https:\/\/\S+$/.test(value)) return value;
  if (/^\/[\w./-]+$/.test(value)) return value;
  return null;
}

function parseTimezone(value: string): string | null {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z_-]+){0,2}$/.test(value)) return null;
  try {
    // The zone database is the authority on whether a timezone exists.
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

export async function updateStoreSettingsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };
  const storeId = auth.storeId;

  const name = text(formData, 'name');
  if (!name) return { error: 'أدخل اسم المتجر.' };
  if (name.length > 120) return { error: 'اسم المتجر طويل جدًا.' };

  const currency = text(formData, 'currency').toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    return { error: `العملة غير مدعومة. المدعوم: ${SUPPORTED_CURRENCIES.join('، ')}` };
  }

  const locale = text(formData, 'locale');
  if (!LOCALES.includes(locale as (typeof LOCALES)[number])) {
    return { error: 'اللغة يجب أن تكون ar أو en.' };
  }

  const timezone = parseTimezone(text(formData, 'timezone'));
  if (timezone === null) return { error: 'المنطقة الزمنية غير صحيحة.' };

  const themeKey = text(formData, 'themeKey');
  if (!THEMES.includes(themeKey as (typeof THEMES)[number])) {
    return { error: 'القالب غير معروف.' };
  }

  const primaryColor = parseHexColour(text(formData, 'primaryColor'));
  if (primaryColor === null) return { error: 'أدخل اللون بصيغة ستة أرقام، مثال: #0f766e.' };

  const logoUrl = parseLogoUrl(text(formData, 'logoUrl'));
  if (logoUrl === null) {
    return { error: 'رابط الشعار يجب أن يبدأ بـ https:// أو /. ' };
  }

  await withTenant(storeId, async (db) => {
    /*
     * Two tables, one transaction: the name and defaults belong to the store,
     * the appearance to its settings row. A half-applied save would leave a
     * store whose name changed but whose language did not, which is the kind
     * of inconsistency a merchant reports as "the site is broken".
     */
    await db.transaction(async (tx) => {
      await updateStore(tx, storeId, {
        name,
        defaultCurrency: currency,
        defaultLocale: locale,
        timezone,
      });
      await upsertStoreSettings(tx, storeId, {
        themeKey,
        primaryColor,
        logoUrl: logoUrl === '' ? null : logoUrl,
        locale,
        currency,
      });
    });
  });

  revalidatePath('/settings');
  // The storefront reads these on every page, and the layout is cached.
  revalidatePath('/', 'layout');
  return { ok: 'تم حفظ الإعدادات.' };
}

/** Loads the current settings, for rendering the form. */
export async function currentSettings() {
  const { storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  if (!storeId) return null;
  return withTenant(storeId, async (db) => ({
    settings: await getStoreSettings(db, storeId),
  }));
}
