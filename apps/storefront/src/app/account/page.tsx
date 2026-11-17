import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { withPlatform } from '@velnorix/db';
import { CUSTOMER_SESSION_COOKIE } from '@/lib/session.js';
import { resolveStorefront } from '@/lib/store-context.js';
import { resolveSession, sessionAllowedOnHost } from '@velnorix/auth';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'حسابي' };

export default async function AccountPage() {
  const resolved = await resolveStorefront();
  if (!resolved) redirect('/');

  const token = (await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!token) redirect('/account/login');

  const session = await withPlatform((db) => resolveSession(db, token));
  const allowed =
    session !== null &&
    sessionAllowedOnHost('store', session.context, {
      matchesStore: session.storeId === resolved.store.id,
    });
  if (!allowed || !session) redirect('/account/login');

  const user = await withPlatform((db) =>
    db.query.users.findFirst({ where: (fields, { eq }) => eq(fields.id, session.userId) }),
  );
  if (!user) redirect('/account/login');

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">حسابي</h1>
      <p className="mt-1 text-sm text-muted-foreground">{resolved.store.name}</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{user.fullName}</CardTitle>
          <CardDescription className="numeric">{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            حالة البريد:{' '}
            {user.emailVerifiedAt ? (
              <span className="text-success">مؤكَّد</span>
            ) : (
              <span className="text-warning">
                غير مؤكَّد —{' '}
                <Link href="/account/verify" className="underline">
                  أكّد الآن
                </Link>
              </span>
            )}
          </p>
          <p className="text-muted-foreground">
            الطلبات وإدارة العنوان تُضاف في مرحلة إتمام الشراء.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
