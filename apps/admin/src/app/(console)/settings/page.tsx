import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { PERMISSION } from '@velnorix/auth';
import { SUPPORTED_CURRENCIES } from '@velnorix/core';
import { findStoreById, getStoreSettings, withPlatformTenant, withTenant } from '@velnorix/db';
import { requirePrincipal } from '@/lib/session.js';
import { StoreSettingsForm } from '@/components/store-settings-form.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'إعدادات المتجر' };

/**
 * Store settings.
 *
 * The storefront already renders from `store_settings` — theme, colour, locale
 * and currency are read on every page. What was missing was the other half:
 * somewhere for the merchant to set them.
 *
 * Reading happens inside `withTenant`; writing is gated on
 * `store:settings.write` in the action. A staff member without that permission
 * sees the page read-only, which is why the check is here as well as there:
 * hiding a button is a courtesy, the permission is the control.
 */
export default async function SettingsPage() {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  if (!storeId) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">إعدادات المتجر</h1>
        <Alert tone="warning" title="هذا النطاق غير مرتبط بأي متجر." />
      </div>
    );
  }

  const canWrite = principal.permissions.has(PERMISSION.STORE_SETTINGS_WRITE);

  /*
   * The store row is platform data and the settings row is tenant data, so the
   * two are read from their own scopes rather than hoping one connection can
   * see both.
   */
  const store = await withPlatformTenant(storeId, (db) => findStoreById(db, storeId));
  const settings = await withTenant(storeId, (db) => getStoreSettings(db, storeId));
  if (!store) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">إعدادات المتجر</h1>
        <Alert tone="danger" title="لم يتم العثور على المتجر." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">إعدادات المتجر</h1>
        <p className="text-sm text-muted-foreground">
          الاسم والمظهر واللغة. تنعكس هذه الإعدادات على واجهة المتجر مباشرة.
        </p>
      </div>

      {canWrite ? (
        <StoreSettingsForm
          currencies={SUPPORTED_CURRENCIES}
          initial={{
            name: store.name,
            currency: settings?.currency ?? store.defaultCurrency,
            locale: settings?.locale ?? store.defaultLocale,
            timezone: store.timezone,
            themeKey: settings?.themeKey ?? 'dawn',
            primaryColor: settings?.primaryColor ?? '#0f766e',
            logoUrl: settings?.logoUrl ?? '',
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>الإعدادات الحالية</CardTitle>
            <CardDescription>ليس لديك صلاحية التعديل. هذه قراءة فقط.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <ReadOnly label="اسم المتجر" value={store.name} />
            <ReadOnly label="العملة" value={settings?.currency ?? store.defaultCurrency} />
            <ReadOnly label="اللغة" value={settings?.locale ?? store.defaultLocale} />
            <ReadOnly label="المنطقة الزمنية" value={store.timezone} />
            <ReadOnly label="القالب" value={settings?.themeKey ?? 'dawn'} />
            <ReadOnly label="اللون الأساسي" value={settings?.primaryColor ?? '#0f766e'} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
