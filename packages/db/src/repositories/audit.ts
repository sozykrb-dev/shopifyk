import { and, desc, eq, sql } from 'drizzle-orm';
import { buildPage, decodeCursor, type Page } from '@velnorix/core';
import type { Database } from '../client.js';
import { currentTenantId } from '../tenant-context.js';
import { auditLogs, type AuditLog, type NewAuditLog } from '../schema.js';

/**
 * Audit log.
 *
 * Append-only: there is deliberately no update or delete in this module. Rows
 * are protected by RLS too -- a merchant reads only their own store's trail,
 * platform staff read everything (see migrations/0001_roles_and_rls.sql).
 */

export type AuditActorType = 'user' | 'system' | 'anonymous';

export type RecordAuditInput = {
  actorType: AuditActorType;
  actorUserId?: string | null;
  actorContext?: NewAuditLog['actorContext'] | null;
  storeId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function recordAudit(db: Database, input: RecordAuditInput): Promise<AuditLog> {
  const [created] = await db
    .insert(auditLogs)
    .values({
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      actorContext: input.actorContext ?? null,
      storeId: input.storeId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning();
  if (!created) throw new Error('Failed to write audit log entry.');
  return created;
}

export type AuditFilter = {
  limit: number;
  cursor?: string | undefined;
  storeId?: string | undefined;
  action?: string | undefined;
  actorUserId?: string | undefined;
};

export async function listAuditLogs(db: Database, filter: AuditFilter): Promise<Page<AuditLog>> {
  const conditions = [];
  // Inside a tenant scope the caller cannot ask for another tenant's trail:
  // the tenant id comes from the async context, never from the request.
  const tenantId = currentTenantId();
  if (tenantId) conditions.push(eq(auditLogs.storeId, tenantId));
  else if (filter.storeId) conditions.push(eq(auditLogs.storeId, filter.storeId));
  if (filter.storeId) conditions.push(eq(auditLogs.storeId, filter.storeId));
  if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.actorUserId) conditions.push(eq(auditLogs.actorUserId, filter.actorUserId));
  if (filter.cursor) {
    const cursor = decodeCursor(filter.cursor);
    const cursorDate = new Date(cursor.k);
    conditions.push(
      sql`(date_trunc('milliseconds', ${auditLogs.occurredAt}) < ${cursorDate.toISOString()}::timestamptz
        OR (date_trunc('milliseconds', ${auditLogs.occurredAt}) = ${cursorDate.toISOString()}::timestamptz
            AND ${auditLogs.id} < ${cursor.i}))`,
    );
  }

  const rows = await db
    .select()
    .from(auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(filter.limit + 1);

  return buildPage(rows, filter.limit, (row) => ({
    k: row.occurredAt.toISOString(),
    i: row.id,
  }));
}

/** Number of audit entries recorded since `since`. */
export async function countAuditSince(db: Database, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(sql`${auditLogs.occurredAt} >= ${since.toISOString()}::timestamptz`);
  return Number(row?.value ?? 0);
}

export async function countAuditLogs(db: Database, action?: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(action ? eq(auditLogs.action, action) : undefined);
  return Number(row?.value ?? 0);
}
