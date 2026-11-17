import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { MfaForm } from '@/components/mfa-form.js';
import { currentPrincipal } from '@/lib/session.js';

export const metadata: Metadata = { title: 'المصادقة الثنائية' };

export default async function MfaPage() {
  const current = await currentPrincipal();
  if (!current) redirect('/login');
  if (current.principal.mfaCompleted) redirect('/');

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>التحقق بخطوتين</CardTitle>
        <CardDescription>
          أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة للتأكيد أن الدخول من جهازك.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MfaForm />
      </CardContent>
    </Card>
  );
}
