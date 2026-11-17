import { AuthorizationError } from '@velnorix/core';
import { findUserById, getEffectivePermissions, type Database, type User } from '@velnorix/db';

/**
 * RBAC engine.
 *
 * Permissions are rows in the `permissions` table and are granted to roles in
 * `role_permissions`; a user's effective permissions are the union over their
 * platform roles and their store membership role. Checks always run on the
 * server, on data loaded from the database in the same request -- a client can
 * never tell us what it is allowed to do.
 */

/** Permission keys, exported so callers cannot typo them. */
export const PERMISSION = {
  STORE_DASHBOARD_READ: 'store:dashboard.read',
  STORE_PRODUCTS_READ: 'store:products.read',
  STORE_PRODUCTS_WRITE: 'store:products.write',
  STORE_PRODUCTS_DELETE: 'store:products.delete',
  STORE_ORDERS_READ: 'store:orders.read',
  STORE_ORDERS_WRITE: 'store:orders.write',
  STORE_ORDERS_FULFILL: 'store:orders.fulfill',
  STORE_ORDERS_REFUND: 'store:orders.refund',
  STORE_REPORTS_READ: 'store:reports.read',
  STORE_SETTINGS_WRITE: 'store:settings.write',
  STORE_STAFF_WRITE: 'store:staff.write',
  STORE_BILLING_READ: 'store:billing.read',
  STORE_BILLING_WRITE: 'store:billing.write',
  STORE_CUSTOMERS_READ: 'store:customers.read',
  PLATFORM_TENANTS_READ: 'platform:tenants.read',
  PLATFORM_TENANTS_SUSPEND: 'platform:tenants.suspend',
  PLATFORM_TENANTS_IMPERSONATE: 'platform:tenants.impersonate',
  PLATFORM_AUDIT_READ: 'platform:audit.read',
  PLATFORM_BILLING_READ: 'platform:billing.read',
  PLATFORM_SETTINGS_WRITE: 'platform:settings.write',
  PLATFORM_SYSTEM_READ: 'platform:system.read',
} as const;

export type PermissionKey = (typeof PERMISSION)[keyof typeof PERMISSION] | (string & {});

export type Principal = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  context: User['context'];
  /** Merchant and customer principals are bound to exactly one store. */
  storeId: string | null;
  permissions: ReadonlySet<string>;
  mfaCompleted: boolean;
  locale: string;
};

/**
 * Loads the actor and their permissions.
 *
 * Permissions are re-read from the database on every request (they are cheap:
 * two indexed joins). A cached principal would keep working after an admin
 * revoked a permission, which is exactly what an audit would flag.
 */
export async function loadPrincipal(
  db: Database,
  actor: {
    userId: string;
    context: User['context'];
    storeId: string | null;
    sessionId: string;
    mfaCompleted: boolean;
  },
): Promise<Principal | null> {
  const user = await findUserById(db, actor.userId);
  if (!user) return null;

  const permissions = await getEffectivePermissions(db, {
    userId: user.id,
    context: user.context,
    storeId: actor.storeId,
  });

  return {
    sessionId: actor.sessionId,
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    context: user.context,
    storeId: actor.storeId,
    permissions,
    mfaCompleted: actor.mfaCompleted,
    locale: user.preferredLocale,
  };
}

export function can(principal: Principal, permission: PermissionKey): boolean {
  return principal.permissions.has(permission);
}

/** Throws `AuthorizationError` (403) when the permission is missing. */
export function assertCan(principal: Principal, permission: PermissionKey): void {
  if (!can(principal, permission)) {
    throw new AuthorizationError('You do not have permission to perform this action.', {
      permission,
    });
  }
}

export function canAny(principal: Principal, permissions: readonly PermissionKey[]): boolean {
  return permissions.some((permission) => can(principal, permission));
}

export function canAll(principal: Principal, permissions: readonly PermissionKey[]): boolean {
  return permissions.every((permission) => can(principal, permission));
}

/**
 * Guards that a principal may act on a given store.
 *
 * Platform principals pass (they act across tenants through audited flows);
 * merchant and customer principals must belong to that exact store.
 */
export function assertStoreAccess(principal: Principal, storeId: string): void {
  if (principal.context === 'super_admin' || principal.context === 'platform_staff') return;
  if (principal.storeId !== storeId) {
    throw new AuthorizationError('You do not have access to this store.');
  }
}

/** Super admin routes must never be reachable with a merchant session, and vice versa. */
export function assertContext(principal: Principal, allowed: readonly User['context'][]): void {
  if (!allowed.includes(principal.context)) {
    throw new AuthorizationError('This area is not available for your account type.');
  }
}
