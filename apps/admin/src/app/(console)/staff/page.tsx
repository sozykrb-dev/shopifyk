import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { PERMISSION } from '@velnorix/auth';
import { listRoles, listStoreMembers, withPlatform, withTenant } from '@velnorix/db';
import { requirePrincipal } from '@/lib/session.js';
import { AddMemberForm, StaffList } from '@/components/staff-manager.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'فريق العمل' };

/**
 * Staff management.
 *
 * The roles and their permissions were defined in migration 0002 and have been
 * enforced by the RBAC engine since Phase 1 — what was missing was any way for
 * a merchant to *use* them. Without this page a store owner has one option:
 * share their own password. That is how most small stores actually work, and
 * it is the reason an audit trail is useless at most of them.
 *
 * Only store-scoped roles are offered. `platform_owner` is not in the list,
 * and the action rejects it anyway: the page is a convenience, the check in
 * the action is the control.
 */
export default async function StaffPage() {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  if (!storeId) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">فريق العمل</h1>
        <Alert tone="warning" title="هذا النطاق غير مرتبط بأي متجر." />
      </div>
    );
  }

  const canWrite = principal.permissions.has(PERMISSION.STORE_STAFF_WRITE);

  const roles = await withPlatform((db) => listRoles(db, 'store'));
  const members = await withTenant(storeId, (db) => listStoreMembers(db, storeId));

  const roleOptions = roles.map((role) => ({ key: role.key, nameAr: role.nameAr }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">فريق العمل</h1>
        <p className="text-sm text-muted-foreground">
          أدوار الفريق وصلاحياته. كل تغيير يُسجَّل في سجل التدقيق.
        </p>
      </div>

      {canWrite ? <AddMemberForm roles={roleOptions} /> : null}

      <StaffList
        members={members.map((member) => ({
          userId: member.userId,
          email: member.email,
          fullName: member.fullName,
          roleKey: member.roleKey,
          roleNameAr: member.roleNameAr,
          status: member.status,
        }))}
        roles={roleOptions}
        currentUserId={principal.userId}
      />

      {!canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>صلاحيات محدودة</CardTitle>
            <CardDescription>يمكنك العرض فقط. التعديل يتطلب صلاحية إدارة الموظفين.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {roles.map((role) => (
              <div key={role.id} className="rounded-lg border border-border p-3">
                <p className="font-medium">{role.nameAr}</p>
                <p className="numeric text-sm text-muted-foreground" dir="ltr">
                  {role.key}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
