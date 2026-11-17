import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PERMISSION } from '@velnorix/auth';
import { formatMoney } from '@velnorix/core';
import { getProductMedia, getProductById, withTenant } from '@velnorix/db';
import { Badge, Button, Card, CardContent, EmptyState, Separator } from '@velnorix/ui';
import { ProductForm } from '@/components/product-form.js';
import { requirePrincipal } from '@/lib/session.js';
import { deleteProductAction } from '@/app/actions/products.js';

export const metadata: Metadata = { title: 'تعديل منتج' };
export const dynamic = 'force-dynamic';

/**
 * Edit product.
 *
 * Variants and images are loaded with the product and replaced as whole lists
 * on save, so what the merchant sees is exactly what gets written.
 */
export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);

  if (!storeId) redirect('/products');
  if (!principal.permissions.has(PERMISSION.STORE_PRODUCTS_READ)) {
    return <EmptyState title="غير مسموح" description="حسابك لا يملك صلاحية عرض المنتجات." />;
  }

  const product = await withTenant(storeId, (db) => getProductById(db, id));
  // Not found, not forbidden: the id belongs to another store as far as this
  // tenant is concerned, and saying which is a leak.
  if (!product) notFound();

  const { images, variants } = await withTenant(storeId, (db) => getProductMedia(db, id));
  const canWrite = principal.permissions.has(PERMISSION.STORE_PRODUCTS_WRITE);
  const canDelete = principal.permissions.has(PERMISSION.STORE_PRODUCTS_DELETE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{product.titleAr}</h1>
          <p className="text-sm text-muted-foreground numeric">
            {product.handle} · {formatMoney({ amount: product.priceMinor, currency: product.currency }, 'ar')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            tone={
              product.status === 'active' ? 'success' : product.status === 'draft' ? 'warning' : 'neutral'
            }
          >
            {product.status === 'active' ? 'منشور' : product.status === 'draft' ? 'مسودة' : 'مؤرشف'}
          </Badge>
          {created ? <Badge tone="success">تم الإنشاء</Badge> : null}
        </div>
      </div>

      {canWrite ? (
        <ProductForm
          mode="edit"
          initial={{
            id: product.id,
            titleAr: product.titleAr,
            titleEn: product.titleEn,
            handle: product.handle,
            descriptionAr: product.descriptionAr ?? '',
            descriptionEn: product.descriptionEn ?? '',
            price: (product.priceMinor / 100).toFixed(2),
            currency: product.currency,
            sku: product.sku ?? '',
            inventory: product.inventoryQuantity,
            status: product.status,
            variants: variants.map((variant) => ({
              id: variant.id,
              titleAr: variant.titleAr,
              titleEn: variant.titleEn,
              sku: variant.sku ?? '',
              price: (variant.priceMinor / 100).toFixed(2),
              inventoryQuantity: variant.inventoryQuantity,
            })),
            images: images.map((image) => ({
              url: image.url,
              altAr: image.altAr ?? '',
              altEn: image.altEn ?? '',
            })),
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              حسابك يملك صلاحية العرض فقط، دون التعديل.
            </p>
          </CardContent>
        </Card>
      )}

      {canDelete ? (
        <>
          <Separator />
          <Card className="border-destructive/30">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium">حذف المنتج</p>
                <p className="text-xs text-muted-foreground">
                  لا يمكن التراجع عن الحذف. تُحذف صوره وخياراته معه.
                </p>
              </div>
              <form action={deleteProductAction}>
                <input type="hidden" name="productId" value={product.id} />
                <Button type="submit" variant="destructive" size="sm">
                  حذف نهائي
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
