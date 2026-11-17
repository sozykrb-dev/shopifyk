import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatMoney } from '@velnorix/core';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@velnorix/ui';
import { listCustomerOrders, withTenant } from '@velnorix/db';
import { resolveStorefront } from '@/lib/store-context.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'طلباتي' };

const STATUS_LABELS: Record<
  string,
  { label: string; tone: 'warning' | 'primary' | 'success' | 'neutral' | 'danger' }
> = {
  pending: { label: 'قيد المراجعة', tone: 'warning' },
  confirmed: { label: 'مؤكَّد', tone: 'primary' },
  shipped: { label: 'تم الشحن', tone: 'primary' },
  delivered: { label: 'تم التسليم', tone: 'success' },
  cancelled: { label: 'ملغي', tone: 'danger' },
  refunded: { label: 'مُسترجع', tone: 'neutral' },
};

/**
 * The signed-in customer's orders.
 *
 * Read inside `withTenant()` and filtered by the id from the session cookie, so
 * there is no way to ask for somebody else's order list.
 */
export default async function CustomerOrdersPage() {
  const resolved = await resolveStorefront();
  if (!resolved) redirect('/');
  if (!resolved.customer) redirect('/account/login');

  const { store, locale } = resolved;
  const orders = await withTenant(store.id, (db) =>
    listCustomerOrders(db, resolved.customer!.userId),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">طلباتي</h1>
      <p className="mt-1 text-sm text-muted-foreground">{store.name}</p>

      <div className="mt-6">
        {orders.length === 0 ? (
          <EmptyState
            title="لا توجد طلبات بعد"
            description="عند إتمام أول طلب سيظهر هنا مع حالته."
            action={
              <Button asChild size="sm">
                <Link href="/">تصفّح المنتجات</Link>
              </Button>
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>الطلب</TH>
                    <TH>التاريخ</TH>
                    <TH>الحالة</TH>
                    <TH>الإجمالي</TH>
                  </TR>
                </THead>
                <TBody>
                  {orders.map((order) => {
                    const status = STATUS_LABELS[order.status] ?? {
                      label: order.status,
                      tone: 'neutral' as const,
                    };
                    return (
                      <TR key={order.id}>
                        <TD className="numeric font-medium">#{order.orderNumber}</TD>
                        <TD className="numeric text-muted-foreground">
                          {order.placedAt.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB')}
                        </TD>
                        <TD>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </TD>
                        <TD className="numeric font-medium">
                          {formatMoney(
                            { amount: order.totalMinor, currency: order.currency },
                            locale,
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
