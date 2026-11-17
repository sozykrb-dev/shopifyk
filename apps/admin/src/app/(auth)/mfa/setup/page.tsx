import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { TotpSetup } from '@/components/totp-setup.js';
import { currentPrincipal } from '@/lib/session.js';

export const metadata: Metadata = { title: 'إعداد المصادقة الثنائية' };

export default async function MfaSetupPage() {
  const current = await currentPrincipal();
  if (!current) redirect('/login');
  if (current.principal.mfaCompleted) redirect('/');

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>إعداد المصادقة الثنائية</CardTitle>
        <CardDescription>
          حسابات إدارة المنصة ملزمة باستخدام المصادقة الثنائية. الإعداد يستغرق دقيقة واحدة.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TotpSetup />
      </CardContent>
    </Card>
  );
}
