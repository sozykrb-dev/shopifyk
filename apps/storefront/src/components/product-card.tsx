import Link from 'next/link';
import { Badge, Card, CardContent } from '@velnorix/ui';
import { formatMoney, money } from '@velnorix/core';
import type { Product } from '@velnorix/db';

/**
 * One product in a grid.
 *
 * Shared by the home page and the catalogue so the two cannot drift: the same
 * card, the same price formatting, the same stock message everywhere a
 * customer meets a product.
 */
export function ProductCard({
  product,
  imageUrl,
  locale,
}: {
  product: Product;
  imageUrl: string | null;
  locale: string;
}) {
  const arabic = locale === 'ar';
  const outOfStock = product.inventoryQuantity <= 0;

  return (
    <Link href={`/products/${product.handle}`} className="block h-full">
      <Card className="h-full overflow-hidden transition-colors hover:border-primary/40">
        <div className="relative flex h-40 items-center justify-center bg-muted/60 text-3xl">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={product.titleAr} className="size-full object-cover" />
          ) : (
            '📦'
          )}
          {outOfStock ? (
            <span className="absolute inset-x-2 top-2">
              <Badge tone="danger">نفد المخزون</Badge>
            </span>
          ) : null}
        </div>
        <CardContent className="space-y-1 p-4">
          <p className="truncate text-sm font-medium">
            {arabic ? product.titleAr : product.titleEn}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {arabic ? product.titleEn : product.titleAr}
          </p>
          <p className="numeric pt-1 text-sm font-semibold">
            {formatMoney(
              money(product.priceMinor, product.currency),
              arabic ? 'ar-EG-u-nu-latn' : 'en-US',
            )}
          </p>
          <p className="numeric text-xs text-muted-foreground">
            {outOfStock ? 'غير متاح حاليًا' : `المخزون: ${product.inventoryQuantity}`}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
