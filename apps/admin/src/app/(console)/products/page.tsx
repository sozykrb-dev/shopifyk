import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { PERMISSION } from '@velnorix/auth';
import { listProducts, withTenant } from '@velnorix/db';
import { formatMoney, money } from '@velnorix/core';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@velnorix/ui';
import { PaginationLinks } from '@/components/pagination-links.js';
import { requirePrincipal } from '@/lib/session.js';

export const metadata: Metadata = { title: 'المنتجات' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ cursor?: string; search?: string; status?: string }>;

/**
 * Store products (tenant scope, read-only in Phase 0).
 *
 * The list is fetched inside `withTenant(storeId)`, so the query is pinned to
 * this store both by the data-access layer and by Postgres RLS. It also proves
 * the wiring end to end: seed data in, no other store's rows out.
 *
 * Creating and editing are separate permissions, so the "منتج جديد" button only
 * appears for someone who can actually use it -- and the action behind it
 * re-checks the same permission anyway.
 */
export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  const params = await searchParams;

  if (!storeId) {
    return <EmptyState title="لا يوجد متجر" description="هذا النطاق غير مرتبط بأي متجر." />;
  }

  const canRead = principal.permissions.has(PERMISSION.STORE_PRODUCTS_READ);
  if (!canRead) {
    return <EmptyState title="غير مسموح" description="حسابك لا يملك صلاحية عرض المنتجات." />;
  }
  const canWrite = principal.permissions.has(PERMISSION.STORE_PRODUCTS_WRITE);

  const limit = 25;
  const page = await withTenant(storeId, (db) =>
    listProducts(db, {
      limit,
      cursor: params.cursor,
      search: params.search,
      status: (params.status as 'draft' | 'active' | 'archived' | undefined) ?? undefined,
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">المنتجات</h1>
          <p className="text-sm text-muted-foreground">
            تعرض هذه الصفحة منتجات متجرك فقط، ولا يمكن أن تظهر منتجات متجر آخر.
          </p>
        </div>
        {canWrite ? (
          <Button asChild size="sm">
            <Link href="/products/new">
              <Plus className="size-4" /> منتج جديد
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <form className="flex flex-wrap items-center gap-2" method="get">
            <div className="relative min-w-52 flex-1">
              <Search
                className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                name="search"
                defaultValue={params.search ?? ''}
                placeholder="ابحث بالاسم (عربي أو إنجليزي)…"
                className="ps-9"
                aria-label="بحث"
              />
            </div>
            <select
              name="status"
              defaultValue={params.status ?? ''}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="الحالة"
            >
              <option value="">كل الحالات</option>
              <option value="active">منشور</option>
              <option value="draft">مسودة</option>
              <option value="archived">مؤرشف</option>
            </select>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              تصفية
            </button>
          </form>

          {page.items.length === 0 ? (
            <EmptyState
              title="لا توجد منتجات"
              description={
                canWrite
                  ? 'ابدأ بإنشاء أول منتج في متجرك.'
                  : 'لا توجد منتجات بعد، وحسابك لا يملك صلاحية الإنشاء.'
              }
              action={
                canWrite ? (
                  <Button asChild size="sm">
                    <Link href="/products/new">منتج جديد</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المنتج</TH>
                  <TH>الرمز</TH>
                  <TH>الحالة</TH>
                  <TH>المخزون</TH>
                  <TH>السعر</TH>
                </TR>
              </THead>
              <TBody>
                {page.items.map((product) => (
                  <TR key={product.id}>
                    <TD>
                      {canWrite ? (
                        <Link
                          href={`/products/${product.id}`}
                          className="font-medium hover:underline"
                        >
                          {product.titleAr}
                        </Link>
                      ) : (
                        <p className="font-medium">{product.titleAr}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{product.titleEn}</p>
                    </TD>
                    <TD className="numeric text-muted-foreground">{product.sku ?? '—'}</TD>
                    <TD>
                      <Badge
                        tone={
                          product.status === 'active'
                            ? 'success'
                            : product.status === 'draft'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {product.status === 'active'
                          ? 'منشور'
                          : product.status === 'draft'
                            ? 'مسودة'
                            : 'مؤرشف'}
                      </Badge>
                    </TD>
                    <TD className="numeric">{product.inventoryQuantity}</TD>
                    <TD className="numeric font-medium">
                      {formatMoney(money(product.priceMinor, product.currency))}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <PaginationLinks
            basePath="/products"
            hasMore={page.hasMore}
            nextCursor={page.nextCursor}
            prevCursor={page.prevCursor}
            query={{ search: params.search, status: params.status }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
