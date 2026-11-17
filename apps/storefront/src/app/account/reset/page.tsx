import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { ResetPasswordForm } from '@/components/account-forms.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'كلمة مرور جديدة' };

/**
 * Forgotten password, step two.
 *
 * The token arrives in the query string when the customer follows the emailed
 * link, and is pre-filled so nobody has to copy 43 characters by hand. The
 * link works once.
 */
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>كلمة مرور جديدة</CardTitle>
          <CardDescription>اختر كلمة مرور قوية لم تستخدمها من قبل.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPassword tokenParam={searchParams} />
        </CardContent>
      </Card>
    </main>
  );
}

async function ResetPassword({ tokenParam }: { tokenParam: Promise<{ token?: string }> }) {
  const { token } = await tokenParam;
  return <ResetPasswordForm initialToken={token} />;
}
