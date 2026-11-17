import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney, money } from '@velnorix/core';
import { Badge, Card, CardContent, Separator } from '@velnorix/ui';
import { getProductByHandle, getProductMedia, withTenant } from '@velnorix/db';
import { resolveStorefront } from '@/lib/store-context.js';
import { AddToCartForm } from '@/components/add-to-cart-form.js';

export const dynamic = 'force-dynamic';

/**
 * Product detail page.
 *
 * Read inside `withTenant(store.id)`, like every other storefront query: the
 * product must belong to the store being served, and RLS enforces that even if
 * this query forgot its filter.
 */
export default async function ProductPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const resolved = await resolveStorefront();
  if (!resolved) notFound();

  const { store, locale } = resolved;
  const product = await withTenant(store.id, (db) => getProductByHandle(db, handle));
  if (!product || product.status !== 'active') notFound();

  const { images, variants } = await withTenant(store.id, (db) => getProductMedia(db, product.id));

  const title = locale === 'ar' ? product.titleAr : product.titleEn;
  const description = locale === 'ar' ? product.descriptionAr : product.descriptionEn;
  const price = money(product.priceMinor, product.currency);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">
          الرئيسية
        </Link>
        <span className="mx-1">/</span>
        <span>{title}</span>
      </nav>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted/50 text-6xl">
            {images[0]?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={images[0].url}
                alt={locale === 'ar' ? (images[0].altAr ?? title) : (images[0].altEn ?? title)}
                className="size-full rounded-lg object-cover"
              />
            ) : (
              '📦'
            )}
          </div>
          {images.length > 1 ? (
            <div className="grid grid-cols-5 gap-2">
              {images.slice(1, 6).map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={image.id}
                  src={image.url}
                  alt={image.altAr ?? image.altEn ?? title}
                  className="aspect-square size-full rounded-md border object-cover"
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {product.sku ? (
              <p className="mt-1 text-xs text-muted-foreground numeric">SKU: {product.sku}</p>
            ) : null}
          </div>

          <p className="text-2xl font-semibold numeric">{formatMoney(price, locale)}</p>

          {variants.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">الخيارات</p>
              <div className="flex flex-wrap gap-2">
                {variants.map((variant) => (
                  <Badge
                    key={variant.id}
                    tone={variant.inventoryQuantity > 0 ? 'primary' : 'neutral'}
                  >
                    {locale === 'ar' ? variant.titleAr : variant.titleEn}
                    {variant.inventoryQuantity === 0 ? ' — غير متوفر' : ''}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <AddToCartForm
            productId={product.id}
            variants={variants.map((variant) => ({
              id: variant.id,
              title: locale === 'ar' ? variant.titleAr : variant.titleEn,
              inStock: variant.inventoryQuantity > 0,
            }))}
            inStock={
              variants.length > 0
                ? variants.some((v) => v.inventoryQuantity > 0)
                : product.inventoryQuantity > 0
            }
          />

          <Separator />

          {description ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}

          <Card>
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="font-medium">الشحن والدفع</p>
              <p className="text-muted-foreground">
                الدفع عند الاستلام متاح داخل مصر. بوابات الدفع الإلكتروني (Paymob، Fawry) تُفعَّل في
                مرحلة الدفع.
              </p>
              <p className="text-xs text-muted-foreground">
                العملة: {product.currency} · المتوفر: {product.inventoryQuantity}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
