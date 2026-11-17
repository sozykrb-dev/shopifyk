import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMoney, money } from '@velnorix/core';
import { PERMISSION } from '@velnorix/auth';
import {
  invoices,
  listStores,
  plans,
  storeRevenue,
  withPlatform,
  withPlatformTenant,
} from '@velnorix/db';
import { asc } from 'drizzle-orm';
import {
  Badge,
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

export const metadata: Metadata = { title: 'الفوترة' };
export const dynamic = 'force-dynamic';

const SUBSCRIPTION_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  trialing: { label: 'فترة تجريبية', tone: 'warning' },
  active: { label: 'نشط', tone: 'success' },
  past_due: { label: 'متأخر عن السداد', tone: 'danger' },
  paused: { label: 'موقوف', tone: 'warning' },
  cancelled: { label: 'ملغي', tone: 'neutral' },
};

const INVOICE_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  draft: { label: 'مسودة', tone: 'neutral' },
  open: { label: 'مستحق', tone: 'warning' },
  paid: { label: 'مدفوع', tone: 'success' },
  void: { label: 'ملغي', tone: 'neutral' },
  uncollectible: { label: 'غير قابل للتحصيل', tone: 'danger' },
};

/**
 * Platform billing.
 *
 * Every figure is read per store inside `withPlatformTenant(store.id)` and
 * summed here: billing rows are tenant data, so there is deliberately no
 * "read every invoice in one query" path that could leak across tenants.
 */
export default async function BillingPage() {
  const { principal } = await requirePrincipal(['super_admin', 'platform_staff']);
  if (!principal.permissions.has(PERMISSION.PLATFORM_BILLING_READ)) {
    return <EmptyState title="غير مسموح" description="حسابك لا يملك صلاحية عرض الفوترة." />;
  }

  const [stores, planRows] = await withPlatform(async (db) =>
    Promise.all([
      listStores(db, { limit: 200 }),
      db.select().from(plans).orderBy(asc(plans.priceMinor)),
    ]),
  );

  const perStore = await Promise.all(
    stores.items.map(async (store) => {
      const revenue = await withPlatformTenant(store.id, (db) => storeRevenue(db, store.id));
      const storeInvoices = await withPlatformTenant(store.id, (db) =>
        db.select().from(invoices).orderBy(asc(invoices.issuedAt)).limit(5),
      );
      return { store, revenue, invoices: storeInvoices };
    }),
  );

  const mrrMinor = perStore.reduce((total, row) => total + row.revenue.mrrMinor, 0);
  const trialing = perStore.filter((row) => row.revenue.trialing).length;
  const allInvoices = perStore.flatMap((row) =>
    row.invoices.map((invoice) => ({ invoice, store: row.store })),
  );
  const outstandingMinor = allInvoices
    .filter((row) => row.invoice.status === 'open')
    .reduce((total, row) => total + row.invoice.totalMinor, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">الفوترة والاشتراكات</h1>
        <p className="text-sm text-muted-foreground">
          أرقام حقيقية من قاعدة البيانات. أسعار الخطط المزروعة هي قيم مؤقتة بانتظار قرار تجاري (ADR
          0007).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="الإيراد الشهري المتكرر"
          value={formatMoney(money(mrrMinor, 'EGP'), 'ar')}
          icon={<span className="numeric">ج.م</span>}
        />
        <StatCard
          label="اشتراكات مدفوعة"
          value={perStore.filter((row) => row.revenue.mrrMinor > 0).length}
          icon={<span>✓</span>}
          tone="success"
        />
        <StatCard
          label="في الفترة التجريبية"
          value={trialing}
          icon={<span>◷</span>}
          tone={trialing > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="فواتير مستحقة"
          value={formatMoney(money(outstandingMinor, 'EGP'), 'ar')}
          icon={<span>!</span>}
          tone={outstandingMinor > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الخطط</CardTitle>
          <CardDescription>الأسعار كما هي مزروعة في قاعدة البيانات.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>الخطة</TH>
                <TH>السعر الشهري</TH>
                <TH>الفترة التجريبية</TH>
                <TH>عمولة المعاملات</TH>
              </TR>
            </THead>
            <TBody>
              {planRows.map((plan) => (
                <TR key={plan.id}>
                  <TD>
                    <p className="font-medium">{plan.nameAr}</p>
                    <p className="numeric text-xs text-muted-foreground">{plan.key}</p>
                  </TD>
                  <TD className="numeric font-medium">
                    {formatMoney(money(plan.priceMinor, plan.currency), 'ar')}
                  </TD>
                  <TD className="numeric text-muted-foreground">{plan.trialDays} يوم</TD>
                  <TD className="numeric text-muted-foreground">
                    {(plan.transactionFeeBps / 100).toFixed(2)}٪
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>اشتراكات المتاجر</CardTitle>
          <CardDescription>اشتراك واحد لكل متجر.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {perStore.length === 0 ? (
            <div className="p-6">
              <EmptyState title="لا توجد متاجر" description="أنشئ متجرًا ليظهر هنا." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المتجر</TH>
                  <TH>الخطة</TH>
                  <TH>الحالة</TH>
                  <TH>الإيراد الشهري</TH>
                </TR>
              </THead>
              <TBody>
                {perStore.map((row) => {
                  const status = row.revenue.status
                    ? (SUBSCRIPTION_STATUS[row.revenue.status] ?? {
                        label: row.revenue.status,
                        tone: 'neutral' as const,
                      })
                    : { label: 'بدون اشتراك', tone: 'neutral' as const };
                  return (
                    <TR key={row.store.id}>
                      <TD>
                        <Link
                          href={`/stores/${row.store.id}`}
                          className="font-medium hover:underline"
                        >
                          {row.store.name}
                        </Link>
                        <p className="numeric text-xs text-muted-foreground">{row.store.slug}</p>
                      </TD>
                      <TD className="numeric text-muted-foreground">
                        {row.revenue.planKey ?? '—'}
                      </TD>
                      <TD>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </TD>
                      <TD className="numeric font-medium">
                        {formatMoney(money(row.revenue.mrrMinor, row.revenue.currency), 'ar')}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {allInvoices.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>أحدث الفواتير</CardTitle>
            <CardDescription>أحدث 5 فواتير لكل متجر.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>الفاتورة</TH>
                  <TH>المتجر</TH>
                  <TH>الحالة</TH>
                  <TH>تاريخ الاستحقاق</TH>
                  <TH>الإجمالي</TH>
                </TR>
              </THead>
              <TBody>
                {allInvoices.map((row) => {
                  const status = INVOICE_STATUS[row.invoice.status] ?? {
                    label: row.invoice.status,
                    tone: 'neutral' as const,
                  };
                  return (
                    <TR key={row.invoice.id}>
                      <TD className="numeric font-medium">#{row.invoice.invoiceNumber}</TD>
                      <TD className="text-muted-foreground">{row.store.slug}</TD>
                      <TD>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </TD>
                      <TD className="numeric text-muted-foreground">
                        {row.invoice.dueAt?.toLocaleDateString('ar-EG') ?? '—'}
                      </TD>
                      <TD className="numeric font-medium">
                        {formatMoney(
                          money(row.invoice.totalMinor, row.invoice.currency ?? 'EGP'),
                          'ar',
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
