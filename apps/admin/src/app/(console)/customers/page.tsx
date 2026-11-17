import Link from 'next/link';
import { formatMoney, money } from '@velnorix/core';
import { PERMISSION } from '@velnorix/auth';
import { customerStats, listStoreCustomers, withPlatformTenant } from '@velnorix/db';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@velnorix/ui';
import { StatCard } from '@/components/stat-card.js';
import { requirePrincipal } from '@/lib/session.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'العملاء' };

/**
 * The store's customers.
 *
 * Built from orders first, with accounts joined on afterwards. The obvious way
 * round — list the registered users — quietly hides every guest checkout, and
 * guest checkout is how most first orders happen. A merchant looking at a
 * short list concludes the store is failing when it is actually converting
 * fine.
 *
 * Read inside `withPlatformTenant`, so RLS is what keeps one store's customer
 * list out of another's console rather than a `WHERE` clause someone has to
 * remember to write.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);

  if (!storeId) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">العملاء</h1>
        <EmptyState title="غير متاح" description="هذا النطاق غير مرتبط بأي متجر." />
      </div>
    );
  }

  if (!principal.permissions.has(PERMISSION.STORE_CUSTOMERS_READ)) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">العملاء</h1>
        <EmptyState title="غير مسموح" description="حسابك لا يملك صلاحية عرض العملاء." />
      </div>
    );
  }

  const { q } = await searchParams;

  const [customers, stats] = await withPlatformTenant(storeId, (db) =>
    Promise.all([
      listStoreCustomers(db, storeId, { search: q, limit: 100 }),
      customerStats(db, storeId),
    ]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">العملاء</h1>
        <p className="text-sm text-muted-foreground">
          من اشترى من متجرك — بحساب أو بدونه. الضيوف محسوبون، لأن معظم الطلبات الأولى تتم بدون
          تسجيل.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="إجمالي العملاء" value={stats.total} icon={<span>◍</span>} />
        <StatCard
          label="بحساب مسجل"
          value={stats.registered}
          icon={<span>◉</span>}
          tone="success"
        />
        <StatCard
          label="طلبوا كضيوف"
          value={stats.guests}
          icon={<span>○</span>}
          tone={stats.guests > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="عملاء عائدون"
          value={stats.repeat}
          icon={<span>⟳</span>}
          tone={stats.repeat > 0 ? 'success' : 'neutral'}
        />
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="ابحث بالاسم أو البريد الإلكتروني"
          className="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" variant="outline">
          بحث
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>قائمة العملاء</CardTitle>
          <CardDescription>
            {q ? `نتائج البحث عن «${q}»` : 'مرتبون بإجمالي الإنفاق، الأعلى أولًا.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {customers.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="لا يوجد عملاء بعد"
                description="سيظهر هنا كل من يكمل طلبًا في متجرك، سواء أنشأ حسابًا أم لا."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>العميل</TH>
                  <TH>الحالة</TH>
                  <TH>الطلبات</TH>
                  <TH>إجمالي الإنفاق</TH>
                  <TH>آخر طلب</TH>
                </TR>
              </THead>
              <TBody>
                {customers.map((customer) => (
                  <TR key={customer.email}>
                    <TD>
                      <p className="font-medium">{customer.fullName ?? '—'}</p>
                      <p className="numeric text-xs text-muted-foreground" dir="ltr">
                        {customer.email}
                      </p>
                    </TD>
                    <TD>
                      {customer.registered ? (
                        <Badge tone="success">مسجل</Badge>
                      ) : (
                        <Badge tone="neutral">ضيف</Badge>
                      )}
                    </TD>
                    <TD className="numeric">{customer.orderCount}</TD>
                    <TD className="numeric font-medium">
                      {customer.orderCount === 0
                        ? '—'
                        : formatMoney(
                            money(customer.totalSpentMinor, customer.currency ?? 'EGP'),
                            'ar',
                          )}
                    </TD>
                    <TD className="numeric text-muted-foreground">
                      {customer.lastOrderAt?.toLocaleDateString('ar-EG') ?? '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        تبحث عن طلب بعينه؟{' '}
        <Link href="/orders" className="font-medium hover:underline">
          كل الطلبات
        </Link>
      </p>
    </div>
  );
}
