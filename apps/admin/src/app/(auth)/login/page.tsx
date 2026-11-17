import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { LoginForm } from '@/components/login-form.js';
import { currentPrincipal } from '@/lib/session.js';
import { getRequestContext, resolveStore } from '@/lib/tenant.js';

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
          <p className="text-sm text-destructive">
            لا يوجد متجر على هذا النطاق. تحقّق من العنوان أو استخدم نطاق متجرك.
          </p>
        ) : (
          <LoginForm storeName={store?.slug ?? null} />
        )}
      </CardContent>
    </Card>
  );
}
