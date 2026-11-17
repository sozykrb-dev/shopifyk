import Link from 'next/link';
import { Badge, Button, Card, CardContent, EmptyState } from '@velnorix/ui';
import { themeStyle } from '@/lib/theme.js';
import { listProductImages, listProducts, withTenant, type Product } from '@velnorix/db';
import { ProductCard } from '@/components/product-card.js';
import { getStorefrontContext, resolveStoreWithSettings } from '@/lib/tenant.js';

export const dynamic = 'force-dynamic';

/**
 * Storefront home.
 *
 * Everything on this page is read inside `withTenant(store.id)`: the store
 * cannot see another store's products even if a query forgets its filter,
 * because Row-Level Security is enforced by Postgres itself.
 */
export default async function StoreHomePage() {
  const context = await getStorefrontContext();
  const resolved = await resolveStoreWithSettings(context);

  if (!resolved) {
    return <StoreUnavailable host={context.host} />;
  }

  const { store, settings } = resolved;

  if (store.status !== 'active') {
    return <StoreUnavailable host={context.host} storeName={store.name} suspended />;
  }

  const page = await withTenant(store.id, (db) =>
    listProducts(db, { limit: 12, status: 'active' }),
  );

  // One extra query for the whole grid instead of one per card.
  const imagesFor = await withTenant(store.id, async (db) => {
    const entries = await Promise.all(
      page.items.map(async (product) => {
        const [first] = await listProductImages(db, product.id);
        return [product.id, first?.url ?? null] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<string, string | null>;
  });
  const locale = settings?.locale ?? store.defaultLocale;

  return (
    <main
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      lang={locale}
      style={themeStyle(settings?.primaryColor) as React.CSSProperties | undefined}
    >
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5">
          <div>
            <p className="text-lg font-semibold tracking-tight">{store.name}</p>
            <p className="text-xs text-muted-foreground numeric">{context.host}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/products">كل المنتجات</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/cart">السلة</Link>
            </Button>
            <Badge tone="primary">{settings?.themeKey ?? 'dawn'}</Badge>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">أحدث المنتجات</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          العملة: {store.defaultCurrency} · اللغة: {locale}
        </p>

        {page.items.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="لا توجد منتجات منشورة بعد"
              description="سيظهر كتالوج المتجر هنا فور نشر المنتجات."
            />
          </div>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {page.items.map((product) => (
              <li key={product.id}>
                <ProductCard
                  product={product as Product}
                  imageUrl={imagesFor[product.id] ?? null}
                  locale={locale}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        مدعوم بـ Velnorix
      </footer>
    </main>
  );
}

/** Only rendered outside production, and only when the override is enabled. */
function devTenantHint(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (process.env.ALLOW_DEV_TENANT_OVERRIDE !== 'true') return null;
  return 'cairo-sneakers';
}

function StoreUnavailable({
  host,
  storeName,
  suspended,
}: {
  host: string;
  storeName?: string;
  suspended?: boolean;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-2 p-6 text-center">
          <p className="text-lg font-semibold">
            {suspended ? `متجر ${storeName ?? ''} موقوف مؤقتًا` : 'لا يوجد متجر على هذا النطاق'}
          </p>
          <p className="text-sm text-muted-foreground numeric">{host}</p>
          <p className="pt-2 text-sm text-muted-foreground">
            {suspended
              ? 'يرجى التواصل مع صاحب المتجر أو مع دعم المنصة.'
              : 'تحقّق من عنوان المتجر، أو أنشئ متجرك على Velnorix.'}
          </p>
          {!suspended && devTenantHint() ? (
            <p className="text-sm text-muted-foreground">
              في بيئة التطوير يمكنك تحديد المتجر بـ{' '}
              <code className="numeric">?__tenant={devTenantHint()}</code> في الرابط.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * Converts `#0f766e` to the `174 72% 26%` triplet the design tokens expect, so
 * a per-store colour can be injected as a CSS variable without a rebuild.
 */
