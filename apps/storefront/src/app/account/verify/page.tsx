import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { VerifyForm } from '@/components/account-forms.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'تأكيد البريد الإلكتروني' };

export default function VerifyEmailPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>تأكيد البريد الإلكتروني</CardTitle>
          <CardDescription>أدخل الرمز المرسل إلى بريدك لتفعيل الحساب.</CardDescription>
        </CardHeader>
        <CardContent>
          <VerifyForm />
        </CardContent>
      </Card>
    </main>
  );
}
