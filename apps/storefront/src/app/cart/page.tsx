import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '@velnorix/core';
import { Button, Card, CardContent, EmptyState } from '@velnorix/ui';
import { currentCart } from '@/lib/cart.js';
import { resolveStorefront } from '@/lib/store-context.js';
import { removeCartItemAction, updateCartItemAction } from '@/app/actions/cart.js';

export const dynamic = 'force-dynamic';

/**
 * Cart page.
 *
 * Line prices are the ones captured at add-to-cart time, so a price change does
 * not silently edit what is already in the basket.
 */
export default async function CartPage() {
  const resolved = await resolveStorefront();
  if (!resolved) notFound();
  const { store, currency, locale } = resolved;

  const cart = await currentCart({
    storeId: store.id,
    currency,
    customerUserId: resolved.customerUserId,
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">السلة</h1>

      {cart.lines.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="السلة فارغة"
            description="أضف منتجات من المتجر وستظهر هنا."
            action={
              <Button asChild size="sm">
                <Link href="/">تصفّح المنتجات</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_20rem]">
          <ul className="space-y-3">
            {cart.lines.map((line) => (
              <li key={line.id}>
                <Card>
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted/60 text-2xl">
                      {line.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={line.imageUrl}
                          alt={line.titleAr}
                          className="size-full rounded-md object-cover"
                        />
                      ) : (
                        '📦'
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${line.handle}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {locale === 'ar' ? line.titleAr : line.titleEn}
                      </Link>
                      <p className="text-xs text-muted-foreground numeric">
                        {formatMoney(line.unitPrice, locale)}
                      </p>

                      <form action={updateCartItemAction} className="mt-2 flex items-center gap-2">
                        <input type="hidden" name="itemId" value={line.id} />
                        <input
                          type="number"
                          name="quantity"
                          min={0}
                          max={99}
                          defaultValue={line.quantity}
                          className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm numeric"
                        />
                        <Button type="submit" variant="ghost" size="sm">
                          تحديث
                        </Button>
                      </form>
                    </div>

                    <div className="text-end">
                      <p className="text-sm font-semibold numeric">
                        {formatMoney(line.lineTotal, locale)}
                      </p>
                      <form action={removeCartItemAction}>
                        <input type="hidden" name="itemId" value={line.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                        >
                          إزالة
                        </Button>
                      </form>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <Card className="h-fit">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">عدد القطع</span>
                <span className="numeric">{cart.itemCount}</span>
              </div>
              <div className="flex items-center justify-between text-base font-semibold">
                <span>الإجمالي</span>
                <span className="numeric">{formatMoney(cart.subtotal, locale)}</span>
              </div>
              <Button asChild className="w-full">
                <Link href="/checkout">إتمام الشراء</Link>
              </Button>
              <p className="text-xs text-muted-foreground">
                الدفع عند الاستلام الآن. بوابات الدفع الإلكتروني (Paymob · Fawry) تُضاف لاحقًا.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
