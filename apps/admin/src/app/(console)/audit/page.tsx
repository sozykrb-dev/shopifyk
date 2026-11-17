import type { Metadata } from 'next';
import { PERMISSION, can } from '@velnorix/auth';
import { listAuditLogs, withPlatform } from '@velnorix/db';
import { Card, CardContent, EmptyState, Table, TBody, TD, TH, THead, TR } from '@velnorix/ui';
import { PaginationLinks } from '@/components/pagination-links.js';
import { requirePrincipal } from '@/lib/session.js';

export const metadata: Metadata = { title: 'سجل التدقيق' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ cursor?: string; action?: string }>;

/**
 * Audit log viewer (platform scope).
 *
 * The audit table has its own RLS policy: merchants only ever see their own
 * store's entries, platform staff see everything -- including the entries this
 * page cannot help but create.
 */
export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await requirePrincipal(['super_admin', 'platform_staff']);
  const params = await searchParams;

  if (!can(principal, PERMISSION.PLATFORM_AUDIT_READ)) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState title="غير مسموح" description="حسابك لا يملك صلاحية قراءة سجل التدقيق." />
        </CardContent>
      </Card>
    );
  }

  const limit = 30;
  const page = await withPlatform((db) =>
    listAuditLogs(db, { limit, cursor: params.cursor, action: params.action }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">سجل التدقيق</h1>
        <p className="text-sm text-muted-foreground">
          كل إجراء إداري حسّاس، مرتّبًا من الأحدث. السجل للإضافة فقط.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {page.items.length === 0 ? (
            <EmptyState title="لا توجد أحداث بعد" description="ستظهر الأحداث هنا بعد أول إجراء." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التوقيت</TH>
                  <TH>الحدث</TH>
                  <TH>الفاعل</TH>
                  <TH>الهدف</TH>
                  <TH>التفاصيل</TH>
                </TR>
              </THead>
              <TBody>
                {page.items.map((entry) => (
                  <TR key={entry.id}>
                    <TD className="numeric whitespace-nowrap text-muted-foreground">
                      {entry.occurredAt.toISOString().replace('T', ' ').slice(0, 19)}
                    </TD>
                    <TD className="font-medium">{entry.action}</TD>
                    <TD className="text-muted-foreground">
                      {entry.actorContext ?? entry.actorType}
                    </TD>
                    <TD className="text-muted-foreground">
                      {entry.targetType ? `${entry.targetType}` : '—'}
                    </TD>
                    <TD
                      className="max-w-xs truncate text-muted-foreground"
                      title={JSON.stringify(entry.metadata)}
                    >
                      {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <PaginationLinks
            basePath="/audit"
            hasMore={page.hasMore}
            nextCursor={page.nextCursor}
            prevCursor={page.prevCursor}
            query={{ action: params.action }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
