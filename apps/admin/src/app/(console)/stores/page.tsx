import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import { PERMISSION, can } from '@velnorix/auth';
import { listStores, withPlatform } from '@velnorix/db';
import {
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
import { StoreActions, StoreStatusBadge } from '@/components/store-table.js';
import { requirePrincipal } from '@/lib/session.js';

export const metadata: Metadata = { title: 'المتاجر' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ cursor?: string; search?: string; status?: string }>;

/** Tenant list with search, filtering and cursor pagination. */
export default async function StoresPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await requirePrincipal(['super_admin', 'platform_staff']);
  const params = await searchParams;

  const limit = 25;
  const page = await withPlatform((db) =>
    listStores(db, {
      limit,
      cursor: params.cursor,
      search: params.search,
      status: (params.status as 'active' | 'suspended' | 'closed' | undefined) ?? undefined,
    }),
  );

  const canSuspend = can(principal, PERMISSION.PLATFORM_TENANTS_SUSPEND);
  const items = page.items.map((store) => ({
    id: store.id,
    name: store.name,
    slug: store.slug,
    status: store.status,
    planKey: store.planKey,
    createdAt: store.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">المتاجر</h1>
          <p className="text-sm text-muted-foreground">كل المتاجر على المنصة.</p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <form className="flex flex-wrap items-center gap-2" method="get">
            <div className="relative flex-1 min-w-52">
              <Search
                className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                name="search"
                defaultValue={params.search ?? ''}
                placeholder="ابحث بالاسم أو النطاق الفرعي…"
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
              <option value="active">نشط</option>
              <option value="suspended">موقوف</option>
              <option value="closed">مغلق</option>
            </select>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              تصفية
            </button>
          </form>

          {items.length === 0 ? (
            <EmptyState title="لا توجد متاجر مطابقة" description="جرّب تعديل البحث أو التصفية." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المتجر</TH>
                  <TH>النطاق الفرعي</TH>
                  <TH>الباقة</TH>
                  <TH>الحالة</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((store) => (
                  <TR key={store.id}>
                    <TD className="font-medium">{store.name}</TD>
                    <TD className="numeric text-muted-foreground">{store.slug}</TD>
                    <TD className="text-muted-foreground">{store.planKey}</TD>
                    <TD>
                      <StoreStatusBadge status={store.status} />
                    </TD>
                    <TD className="text-end">
                      <StoreActions store={store} canSuspend={canSuspend} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <PaginationLinks
            basePath="/stores"
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
