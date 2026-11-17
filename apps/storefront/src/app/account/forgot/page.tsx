import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { ForgotPasswordForm } from '@/components/account-forms.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'إعادة تعيين كلمة المرور' };

/**
 * Forgotten password, step one.
 *
 * Deliberately gives nothing away: the confirmation is the same whether or not
 * the address is known to this store.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>نسيت كلمة المرور؟</CardTitle>
          <CardDescription>
            أدخل بريدك الإلكتروني وسنرسل رابطًا لإعادة تعيين كلمة المرور.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
