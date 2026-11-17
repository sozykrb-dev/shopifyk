import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatMoney, money } from '@velnorix/core';
import { Button, Card, CardContent, Separator } from '@velnorix/ui';
import { paymentRegistry } from '@velnorix/payments';
import { priceCart, type PriceableLine } from '@velnorix/pricing';
import { pricingInputs, withTenant } from '@velnorix/db';
import { currentCart } from '@/lib/cart.js';
import { resolveStorefront } from '@/lib/store-context.js';
import { CheckoutForm } from '@/components/checkout-form.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'إتمام الشراء' };

/**
 * Checkout.
 *
 * The summary shows an **estimate**, priced from the store's own rules for the
 * country, because the address that decides the shipping zone has not been
 * typed yet. The number the customer is actually charged is computed again on
 * submit, from the address they gave -- this one is a preview, and says so.
 */
export default async function CheckoutPage() {
  const resolved = await resolveStorefront();
  if (!resolved) notFound();
  const { store, currency, locale, customerUserId } = resolved;

  const cart = await currentCart({
    storeId: store.id,
    currency,
    customerUserId,
  });

  // Nothing to buy: send the shopper back rather than show a dead form.
  if (cart.lines.length === 0) redirect('/cart');

  const estimate = await withTenant(store.id, async (db) => {
    const inputs = await pricingInputs(db, { storeId: store.id });
    return priceCart({
      lines: cart.lines.map<PriceableLine>((line) => ({
        id: line.id,
        unitAmount: money(line.unitPriceMinor, cart.subtotal.currency),
        quantity: line.quantity,
      })),
      currency: cart.subtotal.currency,
      destination: { countryCode: 'EG' },
      taxRules: inputs.taxRules,
      shippingRates: inputs.shippingRates,
    });
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">إتمام الشراء</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        اختر طريقة الدفع المناسبة لك. البطاقات والمحافظ تعمل في وضع الاختبار حتى يتم تفعيل بيانات
        البوابة.
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_20rem]">
        <CheckoutForm
          defaultEmail={resolved.customer?.email ?? ''}
          total={formatMoney(estimate.total, locale)}
          locale={locale}
          methods={paymentRegistry()
            .list()
            .map((gateway) => ({
              provider: gateway.provider,
              labelAr: gateway.labelAr,
              labelEn: gateway.labelEn,
            }))}
        />

        <Card className="h-fit">
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium">ملخص الطلب</p>
            <Separator />
            <ul className="space-y-2">
              {cart.lines.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">
                      {locale === 'ar' ? line.titleAr : line.titleEn}
                    </span>
                    {line.variantTitleAr ? (
                      <span className="block text-xs text-muted-foreground">
                        {locale === 'ar' ? line.variantTitleAr : line.variantTitleEn}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground numeric">× {line.quantity}</span>
                  </span>
                  <span className="numeric shrink-0">{formatMoney(line.lineTotal, locale)}</span>
                </li>
              ))}
            </ul>
            <Separator />
            {estimate.discount.amount > 0 ? (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">الخصم</span>
                <span className="numeric text-success">
                  −{formatMoney(estimate.discount, locale)}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                الشحن{estimate.shipping?.freeShippingApplied ? ' (مجاني)' : ''}
              </span>
              <span className="numeric">{formatMoney(estimate.shippingAmount, locale)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                الضريبة
                {estimate.appliedTaxRule?.priceInclusive ? ' (ضمن السعر)' : ''}
              </span>
              <span className="numeric">{formatMoney(estimate.tax, locale)}</span>
            </div>
            <div className="flex items-center justify-between text-base font-semibold">
              <span>الإجمالي</span>
              <span className="numeric">{formatMoney(estimate.total, locale)}</span>
            </div>
            {estimate.shipping ? (
              <p className="text-xs text-muted-foreground">
                التوصيل خلال {estimate.shipping.minDays ?? '?'}–{estimate.shipping.maxDays ?? '؟'}{' '}
                أيام تقريبًا.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              الأسعار بالـ{currency}. هذه الأرقام تقديرية وتُحتسب نهائيًا بعد إدخال عنوان الشحن.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/cart">العودة إلى السلة</Link>
        </Button>
      </div>
    </main>
  );
}
