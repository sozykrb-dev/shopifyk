import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { LoginForm } from '@/components/account-forms.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'تسجيل الدخول' };

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; reset?: string }>;
}) {
  const { verified, reset } = await searchParams;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>تسجيل الدخول</CardTitle>
          <CardDescription>ادخل بحسابك في هذا المتجر.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm verified={verified === '1'} reset={reset === '1'} />
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        ليس لديك حساب؟{' '}
        <Link href="/account/register" className="font-medium hover:underline">
          إنشاء حساب
        </Link>
      </p>
      <p className="text-center text-sm">
        <Link href="/account/forgot" className="text-muted-foreground hover:underline">
          نسيت كلمة المرور؟
        </Link>
      </p>
    </main>
  );
}
