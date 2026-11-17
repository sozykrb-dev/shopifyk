import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  permissions,
  rolePermissions,
  roles,
  storeMemberships,
  userPlatformRoles,
  users,
  type Permission,
  type Role,
} from '../schema.js';

/**
 * RBAC repository.
 *
 * Permissions live in the database (`permissions` table), roles are rows, and a
 * user's effective permissions are the union of the permissions of their roles.
 * The authorisation check itself lives in packages/auth -- this module only
 * answers "which permission keys does this actor have?".
 */

export type ActorRef = {
  userId: string;
  context: 'super_admin' | 'platform_staff' | 'merchant_owner' | 'merchant_staff' | 'customer';
  storeId?: string | null;
};

/**
 * Union of:
 *  - platform role permissions (super admin / platform staff), and
 *  - store membership role permissions for `storeId` (merchant owner / staff).
 *
 * Customers have no permissions at all: they are not administrators, and the
 * storefront authorises them by ownership of their own records.
 */
export async function getEffectivePermissions(
  db: Database,
  actor: ActorRef,
): Promise<ReadonlySet<string>> {
  const granted = new Set<string>();

  if (actor.context === 'super_admin' || actor.context === 'platform_staff') {
    const rows = await db
      .select({ key: rolePermissions.permissionKey })
      .from(userPlatformRoles)
      .innerJoin(roles, eq(roles.id, userPlatformRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(userPlatformRoles.userId, actor.userId), eq(roles.scope, 'platform')));
    for (const row of rows) granted.add(row.key);
  }

  if ((actor.context === 'merchant_owner' || actor.context === 'merchant_staff') && actor.storeId) {
    const rows = await db
      .select({ key: rolePermissions.permissionKey })
      .from(storeMemberships)
      .innerJoin(roles, eq(roles.id, storeMemberships.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(
        and(
          eq(storeMemberships.userId, actor.userId),
          eq(storeMemberships.storeId, actor.storeId),
          eq(storeMemberships.status, 'active'),
        ),
      );
    for (const row of rows) granted.add(row.key);
  }

  return granted;
}

export async function listPermissions(db: Database): Promise<Permission[]> {
  return db.select().from(permissions).orderBy(permissions.group, permissions.key);
}

export async function listRoles(
  db: Database,
  scope: Role['scope'],
  storeId?: string | null,
): Promise<Role[]> {
  const rows = await db
    .select()
    .from(roles)
    .where(
      scope === 'platform'
        ? and(eq(roles.scope, 'platform'), isNull(roles.storeId))
        : storeId
          ? and(eq(roles.scope, 'store'), eq(roles.storeId, storeId))
          : eq(roles.scope, 'store'),
    )
    .orderBy(roles.isSystem, roles.key);
  return rows;
}

export async function findRoleByKey(
  db: Database,
  key: string,
  storeId?: string | null,
): Promise<Role | null> {
  const [role] = await db
    .select()
    .from(roles)
    .where(storeId ? and(eq(roles.key, key), eq(roles.storeId, storeId)) : eq(roles.key, key))
    .limit(1);
  return role ?? null;
}

export async function assignPlatformRole(
  db: Database,
  input: { userId: string; roleId: string },
): Promise<void> {
  await db
    .insert(userPlatformRoles)
    .values({ userId: input.userId, roleId: input.roleId })
    .onConflictDoNothing();
}

export async function assignStoreMembership(
  db: Database,
  input: { storeId: string; userId: string; roleId: string; invitedByUserId?: string | null },
): Promise<MembershipWithRole> {
  const [created] = await db
    .insert(storeMemberships)
    .values({
      storeId: input.storeId,
      userId: input.userId,
      roleId: input.roleId,
      invitedByUserId: input.invitedByUserId ?? null,
    })
    .onConflictDoUpdate({
      target: [storeMemberships.storeId, storeMemberships.userId],
      set: { roleId: input.roleId, status: 'active', updatedAt: new Date() },
    })
    .returning();

  if (!created) throw new Error('Failed to assign store membership.');
  const role = await db.select().from(roles).where(eq(roles.id, input.roleId)).limit(1);

  return {
    membershipId: created.id,
    storeId: created.storeId,
    userId: created.userId,
    roleKey: role[0]?.key ?? 'unknown',
    roleNameEn: role[0]?.nameEn ?? 'Unknown',
    roleNameAr: role[0]?.nameAr ?? 'غير معروف',
    status: created.status,
  };
}

export type MembershipWithRole = {
  membershipId: string;
  storeId: string;
  userId: string;
  roleKey: string;
  roleNameEn: string;
  roleNameAr: string;
  status: string;
};

export async function listMembershipsForUser(
  db: Database,
  userId: string,
): Promise<MembershipWithRole[]> {
  return db
    .select({
      membershipId: storeMemberships.id,
      storeId: storeMemberships.storeId,
      userId: storeMemberships.userId,
      roleKey: roles.key,
      roleNameEn: roles.nameEn,
      roleNameAr: roles.nameAr,
      status: storeMemberships.status,
    })
    .from(storeMemberships)
    .innerJoin(roles, eq(roles.id, storeMemberships.roleId))
    .where(eq(storeMemberships.userId, userId));
}

export type StoreMember = {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  roleKey: string;
  roleNameAr: string;
  status: string;
  createdAt: Date;
};

/**
 * Everyone with a role in one store.
 *
 * Deliberately tenant-scoped by argument rather than by RLS: this is the list
 * an admin console renders, and it must never leak a member of another store.
 */
export async function listStoreMembers(db: Database, storeId: string): Promise<StoreMember[]> {
  return db
    .select({
      membershipId: storeMemberships.id,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      roleKey: roles.key,
      roleNameAr: roles.nameAr,
      status: storeMemberships.status,
      createdAt: storeMemberships.createdAt,
    })
    .from(storeMemberships)
    .innerJoin(roles, eq(roles.id, storeMemberships.roleId))
    .innerJoin(users, eq(users.id, storeMemberships.userId))
    .where(eq(storeMemberships.storeId, storeId))
    .orderBy(asc(users.fullName));
}

/**
 * Applies a different role to an existing member (upserting if they are new).
 */
export async function setStoreMemberRole(
  db: Database,
  input: { storeId: string; userId: string; roleId: string; invitedByUserId?: string | null },
): Promise<MembershipWithRole> {
  return assignStoreMembership(db, input);
}

/**
 * Suspends a member without deleting the row.
 *
 * A revoked staff account keeps its history. Deleting the membership instead
 * would leave orders and audit entries pointing at a user who appears never to
 * have worked here, which is worse than a disabled account.
 */
export async function setStoreMemberStatus(
  db: Database,
  input: { storeId: string; userId: string; status: 'active' | 'disabled' },
): Promise<boolean> {
  const updated = await db
    .update(storeMemberships)
    .set({ status: input.status, updatedAt: new Date() })
    .where(
      and(eq(storeMemberships.storeId, input.storeId), eq(storeMemberships.userId, input.userId)),
    )
    .returning({ id: storeMemberships.id });
  return updated.length > 0;
}

/**
 * Counts how many active members hold a given role.
 *
 * Used to stop a store from removing the last owner. A store with no owner has
 * nobody who can add one back, and the only remedy is a platform operator with
 * SQL access -- which is not a remedy, it is an incident.
 */
export async function countActiveMembersWithRole(
  db: Database,
  storeId: string,
  roleKey: string,
): Promise<number> {
  const rows = await db
    .select({ id: storeMemberships.id })
    .from(storeMemberships)
    .innerJoin(roles, eq(roles.id, storeMemberships.roleId))
    .where(
      and(
        eq(storeMemberships.storeId, storeId),
        eq(storeMemberships.status, 'active'),
        eq(roles.key, roleKey),
      ),
    );
  return rows.length;
}

export async function findMembership(
  db: Database,
  storeId: string,
  userId: string,
): Promise<MembershipWithRole | null> {
  const [row] = await db
    .select({
      membershipId: storeMemberships.id,
      storeId: storeMemberships.storeId,
      userId: storeMemberships.userId,
      roleKey: roles.key,
      roleNameEn: roles.nameEn,
      roleNameAr: roles.nameAr,
      status: storeMemberships.status,
    })
    .from(storeMemberships)
    .innerJoin(roles, eq(roles.id, storeMemberships.roleId))
    .where(and(eq(storeMemberships.storeId, storeId), eq(storeMemberships.userId, userId)))
    .limit(1);
  return row ?? null;
}
