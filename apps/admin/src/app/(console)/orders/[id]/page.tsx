import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PERMISSION } from '@velnorix/auth';
import { formatMoney } from '@velnorix/core';
import { getOrderById, withTenant } from '@velnorix/db';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Separator,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@velnorix/ui';
import { requirePrincipal } from '@/lib/session.js';
import { markOrderPaidAction, updateOrderStatusAction } from '@/app/actions/orders.js';

export const metadata: Metadata = { title: 'تفاصيل الطلب' };
export const dynamic = 'force-dynamic';

const STATUS: Record<
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

const NEXT_STATUSES = [
  { value: 'pending', label: 'إعادة إلى قيد المراجعة' },
  { value: 'confirmed', label: 'تأكيد الطلب' },
  { value: 'shipped', label: 'تم الشحن' },
  { value: 'delivered', label: 'تم التسليم' },
  { value: 'cancelled', label: 'إلغاء الطلب' },
] as const;

/**
 * Order detail.
 *
 * Everything on this page is the snapshot taken at checkout: the prices are the
 * ones the customer agreed to, even if the catalogue has moved since.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);

  if (!storeId) redirect('/orders');
  if (!principal.permissions.has(PERMISSION.STORE_ORDERS_READ)) {
    return <EmptyState title="غير مسموح" description="حسابك لا يملك صلاحية عرض الطلبات." />;
  }

  const result = await withTenant(storeId, (db) => getOrderById(db, id));
  // Not found, not "forbidden": the id may belong to another store, and saying
  // which would leak that the order exists at all.
  if (!result) notFound();

  const { order, items, total } = result;
  const status = STATUS[order.status] ?? { label: order.status, tone: 'neutral' as const };
  const canWrite = principal.permissions.has(PERMISSION.STORE_ORDERS_WRITE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight numeric">طلب #{order.orderNumber}</h1>
          <p className="numeric text-sm text-muted-foreground">
            {order.placedAt.toLocaleString('ar-EG')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone={order.paymentStatus === 'paid' ? 'success' : 'neutral'}>
            {order.paymentStatus === 'paid' ? 'مدفوع' : 'غير مدفوع'}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>المنتجات</CardTitle>
            <CardDescription>
              الأسعار كما كانت وقت الطلب، وليس كما هي في الكتالوج الآن.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>المنتج</TH>
                  <TH>الكمية</TH>
                  <TH>سعر الوحدة</TH>
                  <TH>الإجمالي</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <p className="font-medium">{item.titleAr}</p>
                      {item.variantTitleAr ? (
                        <p className="text-xs text-muted-foreground">{item.variantTitleAr}</p>
                      ) : null}
                      {item.sku ? (
                        <p className="numeric text-xs text-muted-foreground">{item.sku}</p>
                      ) : null}
                    </TD>
                    <TD className="numeric">{item.quantity}</TD>
                    <TD className="numeric text-muted-foreground">
                      {formatMoney(
                        { amount: item.unitPriceMinor, currency: item.currency ?? order.currency },
                        'ar',
                      )}
                    </TD>
                    <TD className="numeric font-medium">
                      {formatMoney(
                        { amount: item.lineTotalMinor, currency: item.currency ?? order.currency },
                        'ar',
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>العميل والشحن</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{order.shippingName}</p>
              <p className="numeric text-muted-foreground">{order.email}</p>
              {order.phone ? <p className="numeric text-muted-foreground">{order.phone}</p> : null}
              <Separator className="my-2" />
              <p className="text-muted-foreground">{order.addressLine1}</p>
              {order.addressLine2 ? (
                <p className="text-muted-foreground">{order.addressLine2}</p>
              ) : null}
              <p className="text-muted-foreground">
                {order.city}
                {order.region ? `، ${order.region}` : ''}
              </p>
              <p className="text-muted-foreground">{order.countryCode}</p>
              {order.notes ? (
                <>
                  <Separator className="my-2" />
                  <p className="text-xs text-muted-foreground">ملاحظات: {order.notes}</p>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>الملخص</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">المجموع الفرعي</span>
                <span className="numeric">
                  {formatMoney({ amount: order.subtotalMinor, currency: order.currency }, 'ar')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">الشحن</span>
                <span className="numeric">
                  {formatMoney({ amount: order.shippingMinor, currency: order.currency }, 'ar')}
                </span>
              </div>
              {order.discountMinor > 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الخصم</span>
                  <span className="numeric">
                    −{formatMoney({ amount: order.discountMinor, currency: order.currency }, 'ar')}
                  </span>
                </div>
              ) : null}
              <Separator />
              <div className="flex justify-between text-base font-semibold">
                <span>الإجمالي</span>
                <span className="numeric">{formatMoney(total, 'ar')}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                طريقة الدفع:{' '}
                {order.paymentMethod === 'cash_on_delivery'
                  ? 'الدفع عند الاستلام'
                  : order.paymentMethod}
                {order.paymentReference ? ` · ${order.paymentReference}` : ''}
              </p>
            </CardContent>
          </Card>

          {canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle>تحديث الحالة</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {NEXT_STATUSES.map((next) => (
                  <form action={updateOrderStatusAction} key={next.value}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="status" value={next.value} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={next.value === order.status ? 'default' : 'outline'}
                      disabled={next.value === order.status}
                    >
                      {next.label}
                    </Button>
                  </form>
                ))}
                {order.paymentStatus !== 'paid' ? (
                  <form action={markOrderPaidAction}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      تسجيل التحصيل
                    </Button>
                  </form>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/orders">العودة إلى الطلبات</Link>
        </Button>
      </div>
    </div>
  );
}
