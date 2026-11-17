import { desc, sql } from 'drizzle-orm';
import { CreditCard, Package, Store, Users } from 'lucide-react';
import {
  countAuditSince,
  countStores,
  countUsers,
  listStores,
  plans,
  products,
  withPlatform,
  withTenant,
} from '@velnorix/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@velnorix/ui';
import { StatCard } from '@/components/stat-card.js';
import { requirePrincipal } from '@/lib/session.js';
import { formatMoney, money } from '@velnorix/core';

export const dynamic = 'force-dynamic';

/**
 * Overview dashboard.
 *
 * Every number here comes from a real query -- no sample data, no placeholders.
 * The platform view and the store view share this route and branch on the
 * principal's context.
 */
export default async function DashboardPage() {
  const { principal, storeId } = await requirePrincipal();

  if (storeId) {
    return <StoreDashboard storeId={storeId} storeName={principal.fullName} />;
  }
  return <PlatformDashboard />;
}

async function PlatformDashboard() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalStores, activeStores, suspendedStores, merchants, auditLast24h, stores, planRows] =
    await withPlatform(async (db) =>
      Promise.all([
        countStores(db),
        countStores(db, { status: 'active' }),
        countStores(db, { status: 'suspended' }),
        countUsers(db, { context: 'merchant_owner' }),
        countAuditSince(db, since),
        listStores(db, { limit: 5 }),
        db.select().from(plans).orderBy(plans.priceMinor),
      ]),
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">نظرة عامة على المنصة</h1>
        <p className="text-sm text-muted-foreground">
          أرقام حقيقية من قاعدة البيانات، بدون بيانات تجريبية.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="إجمالي المتاجر" value={totalStores} icon={<Store />} />
        <StatCard label="متاجر نشطة" value={activeStores} icon={<Store />} tone="success" />
        <StatCard
          label="متاجر موقوفة"
          value={suspendedStores}
          icon={<Store />}
          tone={suspendedStores > 0 ? 'warning' : 'neutral'}
        />
        <StatCard label="أصحاب متاجر" value={merchants} icon={<Users />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>أحدث المتاجر</CardTitle>
            <CardDescription>آخر 5 متاجر تم إنشاؤها</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>المتجر</TH>
                  <TH>الباقة</TH>
                  <TH>الحالة</TH>
                </TR>
              </THead>
              <TBody>
                {stores.items.map((store) => (
                  <TR key={store.id}>
                    <TD className="font-medium">{store.name}</TD>
                    <TD className="text-muted-foreground">{store.planKey}</TD>
                    <TD className="text-muted-foreground">{store.status}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الباقات</CardTitle>
            <CardDescription>السعر ونسبة عمولة المنصة</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {planRows.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{plan.nameAr}</p>
                  <p className="text-xs text-muted-foreground">
                    عمولة {(plan.transactionFeeBps / 100).toFixed(2)}%
                  </p>
                </div>
                <span className="numeric text-sm font-medium">
                  {formatMoney(money(plan.priceMinor, plan.currency))}
                </span>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              {auditLast24h} حدثًا في سجل التدقيق خلال آخر 24 ساعة.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function StoreDashboard({ storeId, storeName }: { storeId: string; storeName: string }) {
  const summary = await withTenant(storeId, async (db) => {
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) FILTER (WHERE ${products.status} = 'active')::int`,
      })
      .from(products);

    const latest = await db.select().from(products).orderBy(desc(products.createdAt)).limit(5);

    return {
      total: Number(counts?.total ?? 0),
      active: Number(counts?.active ?? 0),
      latest,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">نظرة عامة على المتجر</h1>
        <p className="text-sm text-muted-foreground">
          مرحبًا {storeName}. هذه بيانات متجرك فقط — العزل بين المتاجر مفروض على مستوى قاعدة
          البيانات.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="المنتجات" value={summary.total} icon={<Package />} />
        <StatCard label="منشور" value={summary.active} icon={<Package />} tone="success" />
        <StatCard label="مسودات" value={summary.total - summary.active} icon={<CreditCard />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>أحدث المنتجات</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>المنتج</TH>
                <TH>الحالة</TH>
                <TH>السعر</TH>
              </TR>
            </THead>
            <TBody>
              {summary.latest.map((product) => (
                <TR key={product.id}>
                  <TD className="font-medium">{product.titleAr}</TD>
                  <TD className="text-muted-foreground">{product.status}</TD>
                  <TD className="numeric">
                    {formatMoney(money(product.priceMinor, product.currency))}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
