import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { RegisterForm } from '@/components/account-forms.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'إنشاء حساب' };

export default function CustomerRegisterPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>إنشاء حساب</CardTitle>
          <CardDescription>حسابك خاص بهذا المتجر.</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm />
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        لديك حساب بالفعل؟{' '}
        <Link href="/account/login" className="font-medium hover:underline">
          تسجيل الدخول
        </Link>
      </p>
    </main>
  );
}
