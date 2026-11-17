import Link from 'next/link';
import { Badge, Button, EmptyState, Input } from '@velnorix/ui';
import { listProductImages, listProducts, withTenant, type Product } from '@velnorix/db';
import { getStorefrontContext, resolveStoreWithSettings } from '@/lib/tenant.js';
import { themeStyle } from '@/lib/theme.js';
import { ProductCard } from '@/components/product-card.js';

export const dynamic = 'force-dynamic';

/**
 * The catalogue.
 *
 * Search and paging are both in the URL, so a filtered view is a link a
 * customer can share or bookmark -- and so the page is rendered on the server
 * from a real query rather than filtered in the browser from a full list it
 * should never have been sent.
 *
 * Paging is cursor-based (not OFFSET): with 40,000 products, page 900 of an
 * OFFSET query makes Postgres walk 36,000 rows to throw them away.
 */
const PAGE_SIZE = 12;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const context = await getStorefrontContext();
  const resolved = await resolveStoreWithSettings(context);
  if (!resolved) {
    return <Unavailable host={context.host} />;
  }
  const { store, settings } = resolved;
  if (store.status !== 'active') {
    return <Unavailable host={context.host} storeName={store.name} suspended />;
  }

  const { q, cursor } = await searchParams;
  const search = q?.trim() ? q.trim().slice(0, 100) : undefined;
  const locale = settings?.locale ?? store.defaultLocale;

  const page = await withTenant(store.id, (db) =>
    listProducts(db, { limit: PAGE_SIZE, status: 'active', search, cursor }),
  );

  // One query for the whole grid's images rather than one per card.
  const imagesFor = await withTenant(store.id, async (db) => {
    const entries = await Promise.all(
      page.items.map(async (product) => {
        const [first] = await listProductImages(db, product.id);
        return [product.id, first?.url ?? null] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<string, string | null>;
  });

  const buildHref = (nextCursor?: string | null) => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (nextCursor) params.set('cursor', nextCursor);
    const query = params.toString();
    return query ? `/products?${query}` : '/products';
  };

  return (
    <main
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      lang={locale}
      style={themeStyle(settings?.primaryColor) as React.CSSProperties | undefined}
    >
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
          <div>
            <Link href="/" className="text-lg font-semibold tracking-tight">
              {store.name}
            </Link>
            <p className="numeric text-xs text-muted-foreground">{context.host}</p>
          </div>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">الرئيسية</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/cart">السلة</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">كل المنتجات</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {search ? `نتائج البحث عن «${search}»` : 'تصفح كل ما ينشره المتجر.'}
              {search ? ` · ${page.items.length} في هذه الصفحة` : ''}
            </p>
          </div>

          {/*
           * A plain GET form: the search term is a URL parameter, so the
           * back button works and the result is a page the server rendered.
           */}
          <form action="/products" method="get" className="flex items-center gap-2">
            <Input
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder="ابحث عن منتج…"
              aria-label="بحث"
              className="w-56"
            />
            <Button type="submit" size="sm">
              بحث
            </Button>
            {search ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/products">مسح</Link>
              </Button>
            ) : null}
          </form>
        </div>

        {page.items.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title={search ? 'لا توجد نتائج' : 'لا توجد منتجات منشورة بعد'}
              description={
                search
                  ? 'جرّب كلمة مختلفة، أو تصفّح كل المنتجات.'
                  : 'سيظهر كتالوج المتجر هنا فور نشر المنتجات.'
              }
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

        {page.nextCursor || page.items.length === PAGE_SIZE ? (
          <div className="mt-8 flex items-center justify-center gap-3">
            {page.nextCursor ? (
              <Button asChild variant="outline">
                <Link href={buildHref(page.nextCursor)}>التالي</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        مدعوم بـ Velnorix
      </footer>
    </main>
  );
}

function Unavailable({
  host,
  storeName,
  suspended,
}: {
  host: string;
  storeName?: string;
  suspended?: boolean;
}) {
  return (
    <main dir="rtl" lang="ar" className="mx-auto max-w-2xl px-4 py-20 text-center">
      <Badge tone={suspended ? 'danger' : 'neutral'}>{host}</Badge>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {suspended ? `متجر ${storeName} موقوف` : 'لا يوجد متجر على هذا النطاق'}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {suspended
          ? 'تواصل مع صاحب المتجر لمتابعة الطلبات.'
          : 'تحقق من النطاق، أو أنشئ متجرًا على Velnorix.'}
      </p>
    </main>
  );
}
