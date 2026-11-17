import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatMoney } from '@velnorix/core';
import { Button, Card, CardContent, Separator } from '@velnorix/ui';
import { currentCart } from '@/lib/cart.js';
import { resolveStorefront } from '@/lib/store-context.js';
import { CheckoutForm } from '@/components/checkout-form.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'إتمام الشراء' };

/**
 * Checkout.
 *
 * Shipping and taxes are still zero: pricing rules belong to a later phase and
 * inventing them here would put invented numbers on a real order.
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

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">إتمام الشراء</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        الدفع عند الاستلام. بوابات الدفع الإلكتروني تُضاف لاحقًا.
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_20rem]">
        <CheckoutForm
          defaultEmail={resolved.customer?.email ?? ''}
          total={formatMoney(cart.subtotal, locale)}
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
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">الشحن</span>
              <span className="numeric">{formatMoney({ amount: 0, currency }, locale)}</span>
            </div>
            <div className="flex items-center justify-between text-base font-semibold">
              <span>الإجمالي</span>
              <span className="numeric">{formatMoney(cart.subtotal, locale)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              الأسعار بالـ{currency}. الضرائب وقواعد الشحن تأتي في مرحلة التسعير.
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
