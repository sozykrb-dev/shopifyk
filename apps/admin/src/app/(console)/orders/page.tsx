import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { PERMISSION } from '@velnorix/auth';
import { formatMoney } from '@velnorix/core';
import { listOrders, withTenant } from '@velnorix/db';
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

export const metadata: Metadata = { title: 'الطلبات' };
export const dynamic = 'force-dynamic';

const STATUS: Record<
  string,
  { label: string; tone: 'warning' | 'primary' | 'success' | 'neutral' | 'danger' }
> = {
  pending: { label: 'قيد المراجعة', tone: 'warning' },
  confirmed: { label: 'مؤكَّد', tone: 'primary' },
  shipped: { label: 'تم الشحن', tone: 'primary' },
  delivered: { label: 'تم التسليم', tone: 'success' },
  cancelled: { label: 'ملغي', tone: 'danger' },
  refunded: { label: 'مُسترجع', tone: 'neutral' },
};

const PAYMENT: Record<string, string> = {
  unpaid: 'غير مدفوع',
  authorized: 'مصرَّح',
  paid: 'مدفوع',
  refunded: 'مُسترجع',
  failed: 'فشل',
};

type SearchParams = Promise<{ cursor?: string; search?: string; status?: string }>;

/**
 * Store orders (tenant scope).
 *
 * Read inside `withTenant(storeId)`: another store's orders are not merely
 * hidden here, they are unreachable -- RLS would refuse the query even without
 * the filter.
 */
export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  const params = await searchParams;

  if (!storeId) {
    return <EmptyState title="لا يوجد متجر" description="هذا النطاق غير مرتبط بأي متجر." />;
  }
  if (!principal.permissions.has(PERMISSION.STORE_ORDERS_READ)) {
    return <EmptyState title="غير مسموح" description="حسابك لا يملك صلاحية عرض الطلبات." />;
  }

  const page = await withTenant(storeId, (db) =>
    listOrders(db, {
      limit: 25,
      cursor: params.cursor,
      search: params.search,
      status: (params.status as 'pending' | undefined) ?? undefined,
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">الطلبات</h1>
        <p className="text-sm text-muted-foreground">طلبات متجرك فقط، الأحدث أولًا.</p>
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
                placeholder="ابحث بالرقم أو الاسم أو المدينة…"
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
              <option value="pending">قيد المراجعة</option>
              <option value="confirmed">مؤكَّد</option>
              <option value="shipped">تم الشحن</option>
              <option value="delivered">تم التسليم</option>
              <option value="cancelled">ملغي</option>
            </select>
            <Button type="submit" size="sm">
              تصفية
            </Button>
          </form>

          {page.items.length === 0 ? (
            <EmptyState
              title="لا توجد طلبات"
              description="أول طلب يظهر هنا فور إتمامه من واجهة المتجر."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الطلب</TH>
                  <TH>العميل</TH>
                  <TH>المدينة</TH>
                  <TH>الحالة</TH>
                  <TH>الدفع</TH>
                  <TH>الإجمالي</TH>
                </TR>
              </THead>
              <TBody>
                {page.items.map((order) => {
                  const status = STATUS[order.status] ?? {
                    label: order.status,
                    tone: 'neutral' as const,
                  };
                  return (
                    <TR key={order.id}>
                      <TD>
                        <Link
                          href={`/orders/${order.id}`}
                          className="numeric font-medium hover:underline"
                        >
                          #{order.orderNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground numeric">
                          {order.placedAt.toLocaleDateString('ar-EG')}
                        </p>
                      </TD>
                      <TD>
                        <p className="text-sm">{order.shippingName}</p>
                        <p className="numeric text-xs text-muted-foreground">{order.email}</p>
                      </TD>
                      <TD className="text-muted-foreground">{order.city}</TD>
                      <TD>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </TD>
                      <TD className="text-muted-foreground">
                        {PAYMENT[order.paymentStatus] ?? order.paymentStatus}
                      </TD>
                      <TD className="numeric font-medium">
                        {formatMoney({ amount: order.totalMinor, currency: order.currency }, 'ar')}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}

          <PaginationLinks
            basePath="/orders"
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
