import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { LoginForm } from '@/components/login-form.js';
import { currentPrincipal } from '@/lib/session.js';
import { getRequestContext, resolveStore } from '@/lib/tenant.js';

/**
 * Hosts are the only tenant signal, so on a host that maps to no store there is
 * nothing to sign in to. In development a store can be pinned with
 * `?__tenant=<slug>`, so say so instead of leaving the visitor stuck.
 */
function devTenantHint(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (process.env.ALLOW_DEV_TENANT_OVERRIDE !== 'true') return null;
  return 'cairo-sneakers';
}

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage() {
  // Already signed in (and through MFA): go straight to the dashboard.
  const current = await currentPrincipal();
  if (current?.principal.mfaCompleted) redirect('/');

  const context = await getRequestContext();
  const store = await resolveStore(context);
  const isPlatform = context.kind === 'platform';

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{isPlatform ? 'لوحة تحكم المنصة' : 'لوحة تحكم المتجر'}</CardTitle>
        <CardDescription>
          {isPlatform
            ? 'سجّل الدخول بحساب إدارة المنصة.'
            : store
              ? `سجّل الدخول إلى ${store.name}.`
              : 'هذا النطاق غير مرتبط بأي متجر.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isPlatform && !store ? (
          <div className="space-y-2 text-sm text-destructive">
            <p>لا يوجد متجر على هذا النطاق. تحقّق من العنوان أو استخدم نطاق متجرك.</p>
            {devTenantHint() ? (
              <p className="text-muted-foreground">
                في بيئة التطوير يمكنك تحديد المتجر بـ{' '}
                <code className="numeric">?__tenant={devTenantHint()}</code> في الرابط.
              </p>
            ) : null}
          </div>
        ) : (
          <LoginForm storeName={store?.slug ?? null} />
        )}
      </CardContent>
    </Card>
  );
}
