import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { formatMoney } from '@velnorix/core';
import { Badge, Button, Card, CardContent, Separator } from '@velnorix/ui';
import { getOrderById, withTenant } from '@velnorix/db';
import { LAST_ORDER_COOKIE } from '@/lib/session.js';
import { resolveStorefront } from '@/lib/store-context.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'تأكيد الطلب' };

/**
 * Order confirmation.
 *
 * The order is found through a short-lived cookie, not through the number in
 * the URL: order numbers are sequential, so `?order=1002` would otherwise be a
 * readable list of other people's names and addresses.
 */
export default async function OrderConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const resolved = await resolveStorefront();
  if (!resolved) notFound();
  const { store, locale } = resolved;

  const { order: orderNumberParam } = await searchParams;
  const orderId = (await cookies()).get(LAST_ORDER_COOKIE)?.value;
  if (!orderId) redirect('/');

  const result = await withTenant(store.id, (db) => getOrderById(db, orderId));
  if (!result) redirect('/');

  const { order, items, total } = result;
  // The number in the URL is decoration; the cookie is the authority.
  if (orderNumberParam && String(order.orderNumber) !== orderNumberParam) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="text-center">
        <p className="text-3xl">✅</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">تم استلام طلبك</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          رقم الطلب{' '}
          <span className="numeric font-medium text-foreground">#{order.orderNumber}</span> — سنرسل
          التأكيد على <span className="numeric">{order.email}</span>
        </p>
      </div>

      <Card className="mt-6">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">حالة الطلب</p>
              <p className="text-xs text-muted-foreground">
                الدفع عند الاستلام — يُجهَّز الطلب ثم يُشحن.
              </p>
            </div>
            <Badge tone="warning">قيد المراجعة</Badge>
          </div>

          <Separator />

          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">
                    {locale === 'ar' ? item.titleAr : item.titleEn}
                  </span>
                  {item.variantTitleAr ? (
                    <span className="block text-xs text-muted-foreground">
                      {locale === 'ar' ? item.variantTitleAr : item.variantTitleEn}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground numeric">× {item.quantity}</span>
                </span>
                <span className="numeric shrink-0">
                  {formatMoney(
                    { amount: item.lineTotalMinor, currency: item.currency ?? order.currency },
                    locale,
                  )}
                </span>
              </li>
            ))}
          </ul>

          <Separator />

          {/*
           * The breakdown is stored on the order, not recomputed: what the
           * customer is shown here is exactly what the pricing engine decided
           * at checkout, even if the tax rate changes tomorrow.
           */}
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">المجموع الفرعي</dt>
              <dd className="numeric">
                {formatMoney({ amount: order.subtotalMinor, currency: order.currency }, locale)}
              </dd>
            </div>
            {order.discountMinor > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">الخصم</dt>
                <dd className="numeric text-success">
                  −{formatMoney({ amount: order.discountMinor, currency: order.currency }, locale)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">الشحن</dt>
              <dd className="numeric">
                {formatMoney({ amount: order.shippingMinor, currency: order.currency }, locale)}
              </dd>
            </div>
            {order.taxMinor > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">الضريبة</dt>
                <dd className="numeric">
                  {formatMoney({ amount: order.taxMinor, currency: order.currency }, locale)}
                </dd>
              </div>
            ) : null}
          </dl>

          <Separator />

          <div className="flex items-center justify-between text-base font-semibold">
            <span>الإجمالي</span>
            <span className="numeric">{formatMoney(total, locale)}</span>
          </div>

          <Separator />

          <div className="text-sm">
            <p className="font-medium">{order.shippingName}</p>
            <p className="text-muted-foreground">
              {order.addressLine1}
              {order.addressLine2 ? `، ${order.addressLine2}` : ''}
            </p>
            <p className="text-muted-foreground">
              {order.city}
              {order.region ? `، ${order.region}` : ''}
            </p>
            {order.phone ? <p className="numeric text-muted-foreground">{order.phone}</p> : null}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/">متابعة التسوق</Link>
        </Button>
        {resolved.customer ? (
          <Button asChild variant="outline">
            <Link href="/account/orders">طلباتي</Link>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
