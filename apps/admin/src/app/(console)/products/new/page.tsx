import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PERMISSION } from '@velnorix/auth';
import { EmptyState } from '@velnorix/ui';
import { ProductForm } from '@/components/product-form.js';
import { requirePrincipal } from '@/lib/session.js';

export const metadata: Metadata = { title: 'منتج جديد' };
export const dynamic = 'force-dynamic';

/**
 * New product.
 *
 * The form posts to a Server Action that re-checks the permission and
 * re-resolves the store; this page only decides whether to show the form.
 */
export default async function NewProductPage() {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);

  if (!storeId || !principal.permissions.has(PERMISSION.STORE_PRODUCTS_WRITE)) {
    return <EmptyState title="غير مسموح" description="حسابك لا يملك صلاحية إنشاء المنتجات." />;
  }
  if (!storeId) redirect('/products');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">منتج جديد</h1>
        <p className="text-sm text-muted-foreground">
          سيُنشر في متجرك فقط. اختر «منشور» ليظهر في واجهة المتجر.
        </p>
      </div>

      <ProductForm
        mode="create"
        initial={{
          titleAr: '',
          titleEn: '',
          handle: '',
          descriptionAr: '',
          descriptionEn: '',
          price: '',
          currency: 'EGP',
          sku: '',
          inventory: 0,
          status: 'draft',
          variants: [],
          images: [],
        }}
      />
    </div>
  );
}
