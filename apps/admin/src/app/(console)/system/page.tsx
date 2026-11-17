import type { Metadata } from 'next';
import { sql } from 'drizzle-orm';
import { Activity, Database, ShieldCheck } from 'lucide-react';
import { withPlatform } from '@velnorix/db';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@velnorix/ui';
import { StatCard } from '@/components/stat-card.js';
import { requirePrincipal } from '@/lib/session.js';

export const metadata: Metadata = { title: 'صحة النظام' };
export const dynamic = 'force-dynamic';

type RoleRow = { rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean };
type RlsRow = { tablename: string; rowsecurity: boolean; forcerowsecurity: boolean };

/**
 * System health.
 *
 * The most important part of this page is the security section: it reads the
 * isolation guarantees straight out of the database catalog, so a deployment
 * where the app role can bypass RLS (or a tenant table lost `FORCE`) is visible
 * at a glance instead of being discovered by a merchant.
 */
export default async function SystemPage() {
  await requirePrincipal(['super_admin', 'platform_staff']);

  const [roles, rls, health, sessions] = await withPlatform(async (db) => {
    const roleRows = await db.execute(sql`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
      FROM pg_roles
      WHERE rolname LIKE 'velnorix%'
      ORDER BY rolname
    `);
    const rlsRows = await db.execute(sql`
      SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND (c.relrowsecurity OR c.relforcerowsecurity)
      ORDER BY c.relname
    `);
    const healthRow = await db.execute(sql`SELECT now() AS server_time, version() AS version`);
    const sessionRows = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::int AS active,
        count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked,
        count(*)::int AS total
      FROM sessions
    `);
    return [
      rows<RoleRow>(roleRows),
      rows<RlsRow>(rlsRows),
      rows<{ server_time: string; version: string }>(healthRow),
      rows<{ active: number; revoked: number; total: number }>(sessionRows),
    ] as const;
  });

  const insecureRole = roles.find((role) => role.rolsuper || role.rolbypassrls);
  const unforcedTable = rls.find((table) => !table.forcerowsecurity);
  const sessionStats = sessions[0] ?? { active: 0, revoked: 0, total: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">صحة النظام</h1>
        <p className="text-sm text-muted-foreground">
          حالة قاعدة البيانات، العزل بين المتاجر، والجلسات.
        </p>
      </div>

      {insecureRole || unforcedTable ? (
        <Alert tone="danger" title="إعداد أمني غير صحيح">
          {insecureRole
            ? `الدور ${insecureRole.rolname} يستطيع تجاوز RLS. يجب أن يكون NOBYPASSRLS وغير superuser.`
            : ''}
          {unforcedTable
            ? ` الجدول ${unforcedTable.tablename} لا يستخدم FORCE ROW LEVEL SECURITY.`
            : ''}
        </Alert>
      ) : (
        <Alert tone="success" title="العزل بين المتاجر مفروض">
          كل جداول المستأجرين تستخدم RLS مع FORCE، وأدوار التطبيق لا تستطيع تجاوزه.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="جلسات نشطة" value={sessionStats.active} icon={<Activity />} />
        <StatCard label="جلسات مُلغاة" value={sessionStats.revoked} icon={<ShieldCheck />} />
        <StatCard label="إجمالي الجلسات" value={sessionStats.total} icon={<Database />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>أدوار قاعدة البيانات</CardTitle>
            <CardDescription>يجب أن تكون كلها NOBYPASSRLS وغير superuser</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>الدور</TH>
                  <TH>تسجيل دخول</TH>
                  <TH>superuser</TH>
                  <TH>تجاوز RLS</TH>
                </TR>
              </THead>
              <TBody>
                {roles.map((role) => (
                  <TR key={role.rolname}>
                    <TD className="numeric font-medium">{role.rolname}</TD>
                    <TD>{role.rolcanlogin ? 'نعم' : 'لا'}</TD>
                    <TD className={role.rolsuper ? 'text-destructive' : 'text-success'}>
                      {role.rolsuper ? 'نعم (خطأ)' : 'لا'}
                    </TD>
                    <TD className={role.rolbypassrls ? 'text-destructive' : 'text-success'}>
                      {role.rolbypassrls ? 'نعم (خطأ)' : 'لا'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>جداول محمية بـ RLS</CardTitle>
            <CardDescription>الجداول التي تخزّن بيانات المستأجرين</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>الجدول</TH>
                  <TH>RLS</TH>
                  <TH>FORCE</TH>
                </TR>
              </THead>
              <TBody>
                {rls.map((table) => (
                  <TR key={table.tablename}>
                    <TD className="numeric font-medium">{table.tablename}</TD>
                    <TD>{table.rowsecurity ? 'مفعل' : 'معطل'}</TD>
                    <TD className={table.forcerowsecurity ? 'text-success' : 'text-destructive'}>
                      {table.forcerowsecurity ? 'مفعل' : 'معطل'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="pt-4 text-xs text-muted-foreground">
              خادم قاعدة البيانات: {health[0]?.version?.split(' ').slice(0, 2).join(' ') ?? '—'}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** postgres.js returns rows as an array; this keeps the types honest. */
function rows<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : [];
}
