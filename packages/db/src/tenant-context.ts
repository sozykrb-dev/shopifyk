import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { TenantIsolationError, isUuid } from '@velnorix/core';
import { getDatabase, type Database } from './client.js';

/**
 * Tenant-scoped data access -- layer 1 of the isolation model.
 *
 * There is no supported way to get a database handle except through these
 * functions:
 *
 *   withTenant(storeId, fn)    runs `fn` as `velnorix_app` with
 *                              `app.current_store_id` pinned to `storeId`.
 *   withPlatform(fn)           runs `fn` as `velnorix_platform`, with no tenant
 *                              context (platform tables only).
 *   withPlatformTenant(id, fn) platform role inside a tenant context, for
 *                              audited platform actions such as impersonation.
 *
 * Layer 2 is Postgres RLS (see migrations/0001_roles_and_rls.sql): even if a
 * query forgets its `WHERE store_id = ...`, Postgres refuses to return another
 * tenant's rows.
 */

/** Handle for a tenant-scoped transaction. Only valid inside the callback. */
export type TenantDb = Database;
/** Handle for a platform-scoped transaction. Only valid inside the callback. */
export type PlatformDb = Database;

/**
 * Async-local tenant id.
 *
 * This is what makes the "tenant-scoped data-access layer" a real layer rather
 * than a convention: repositories call `requireTenantId()` and add their own
 * `WHERE store_id = ...`, so isolation still holds if RLS is ever misconfigured.
 */
const tenantStorage = new AsyncLocalStorage<string>();

/** Id of the tenant bound to the current async context, if any. */
export function currentTenantId(): string | undefined {
  return tenantStorage.getStore();
}

/** `currentTenantId()` that throws instead of returning undefined. */
export function requireTenantId(): string {
  const storeId = tenantStorage.getStore();
  if (!storeId) {
    throw new TenantIsolationError('No tenant context is active for this operation.');
  }
  return storeId;
}

function assertStoreId(storeId: string): void {
  if (!isUuid(storeId)) {
    throw new TenantIsolationError('Refusing to open a tenant scope with an invalid store id.');
  }
}

/**
 * Runs `fn` inside a transaction pinned to one tenant.
 *
 * Everything is `SET LOCAL`, so both the role and the tenant id disappear at
 * COMMIT/ROLLBACK: a pooled connection can never leak context to the next
 * request.
 */
export async function withTenant<T>(storeId: string, fn: (db: TenantDb) => Promise<T>): Promise<T> {
  assertStoreId(storeId);
  return tenantStorage.run(storeId, () =>
    getDatabase().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE velnorix_app`);
      // set_config(..., true) is a parameterised SET LOCAL: no string
      // interpolation, so a malicious store id cannot inject SQL.
      await tx.execute(sql`SELECT set_config('app.current_store_id', ${storeId}, true)`);
      // The transaction exposes the same query API as the pooled handle.
      return fn(tx as unknown as TenantDb);
    }),
  );
}

/**
 * Runs `fn` inside a transaction as the platform role.
 * Tenant tables are unreachable in this scope: RLS denies every row because no
 * tenant context is set.
 */
export async function withPlatform<T>(fn: (db: PlatformDb) => Promise<T>): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE velnorix_platform`);
    await tx.execute(sql`SELECT set_config('app.current_store_id', NULL, true)`);
    return fn(tx as unknown as PlatformDb);
  });
}

/**
 * Platform role *with* a tenant context -- used by audited platform actions
 * such as super-admin impersonation, which must be recorded against the tenant
 * they touch.
 */
export async function withPlatformTenant<T>(
  storeId: string,
  fn: (db: PlatformDb) => Promise<T>,
): Promise<T> {
  assertStoreId(storeId);
  return tenantStorage.run(storeId, () =>
    getDatabase().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE velnorix_platform`);
      await tx.execute(sql`SELECT set_config('app.current_store_id', ${storeId}, true)`);
      return fn(tx as unknown as PlatformDb);
    }),
  );
}
