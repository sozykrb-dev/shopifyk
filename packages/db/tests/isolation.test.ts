import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { TenantIsolationError } from '@velnorix/core';
import { truncateAllData } from '@velnorix/test-utils';
import {
  closeDatabase,
  countAuditLogs,
  countProducts,
  createProduct,
  createStore,
  createUser,
  findStoreByHost,
  getProductById,
  getStoreSettings,
  listProducts,
  listStores,
  plans,
  recordAudit,
  upsertStoreSettings,
  withPlatform,
  withTenant,
  type PlatformDb,
  type Store,
} from '../src/index.js';
import { eq } from 'drizzle-orm';

/**
 * The most important tests in this repository.
 *
 * If any of them fails, one merchant can read or write another merchant's data,
 * which is an existential bug for the platform. They exercise the two isolation
 * layers independently:
 *
 *   1. the tenant-scoped data-access layer (`withTenant` + explicit filters);
 *   2. Postgres Row-Level Security, which must hold even when layer 1 is
 *      bypassed with hand-written SQL.
 */
describe('tenant isolation', () => {
  let storeA: Store;
  let storeB: Store;

  beforeEach(async () => {
    await truncateAllData();
    const planId = await withPlatform(defaultPlanId);
    storeA = await withPlatform((db) =>
      createStore(db, { slug: 'store-a', name: 'Store A', planId }),
    );
    storeB = await withPlatform((db) =>
      createStore(db, { slug: 'store-b', name: 'Store B', planId }),
    );
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("keeps each tenant's products to itself", async () => {
    await withTenant(storeA.id, (db) =>
      createProduct(db, {
        storeId: storeA.id,
        titleEn: 'A product',
        titleAr: 'منتج أ',
        handle: 'a-product',
        priceMinor: 10_000,
        status: 'active',
      }),
    );
    await withTenant(storeB.id, (db) =>
      createProduct(db, {
        storeId: storeB.id,
        titleEn: 'B product',
        titleAr: 'منتج ب',
        handle: 'b-product',
        priceMinor: 20_000,
        status: 'active',
      }),
    );

    const productsA = await withTenant(storeA.id, (db) => listProducts(db, { limit: 50 }));
    const productsB = await withTenant(storeB.id, (db) => listProducts(db, { limit: 50 }));

    expect(productsA.items.map((product) => product.handle)).toEqual(['a-product']);
    expect(productsB.items.map((product) => product.handle)).toEqual(['b-product']);
    expect(await withTenant(storeA.id, (db) => countProducts(db))).toBe(1);
    expect(await withTenant(storeB.id, (db) => countProducts(db))).toBe(1);
  });

  it("cannot read another tenant's row by guessing its id", async () => {
    const secret = await withTenant(storeB.id, (db) =>
      createProduct(db, {
        storeId: storeB.id,
        titleEn: 'Secret',
        titleAr: 'سري',
        handle: 'secret',
        priceMinor: 1,
      }),
    );

    const leaked = await withTenant(storeA.id, (db) => getProductById(db, secret.id));
    expect(leaked).toBeNull();
  });

  it("cannot update or delete another tenant's row with raw SQL", async () => {
    const victim = await withTenant(storeB.id, (db) =>
      createProduct(db, {
        storeId: storeB.id,
        titleEn: 'Victim',
        titleAr: 'ضحية',
        handle: 'victim',
        priceMinor: 5_000,
      }),
    );

    // Layer 1 would already refuse this; here we bypass it on purpose with raw
    // SQL to prove RLS (layer 2) holds on its own.
    const updated = await withTenant(storeA.id, (db) =>
      db.execute(sql`UPDATE products SET price_minor = 0 WHERE id = ${victim.id}`),
    );
    expect(affectedRows(updated)).toBe(0);

    const deleted = await withTenant(storeA.id, (db) =>
      db.execute(sql`DELETE FROM products WHERE id = ${victim.id}`),
    );
    expect(affectedRows(deleted)).toBe(0);

    const survivor = await withTenant(storeB.id, (db) => getProductById(db, victim.id));
    expect(survivor?.priceMinor).toBe(5_000);
  });

  it('cannot read another tenant with a raw SELECT that forgets its WHERE clause', async () => {
    await withTenant(storeB.id, (db) =>
      createProduct(db, {
        storeId: storeB.id,
        titleEn: 'Leak me',
        titleAr: 'سربني',
        handle: 'leak-me',
        priceMinor: 1,
      }),
    );

    const rows = await withTenant(storeA.id, (db) =>
      db.execute(sql`SELECT id, store_id FROM products`),
    );
    expect(rowsOf<{ store_id: string }>(rows)).toHaveLength(0);
  });

  it('cannot insert a row that belongs to another tenant (WITH CHECK)', async () => {
    // The whole transaction is expected to fail, so the rejection is captured
    // from the outside: catching it inside would leave the driver's own
    // rejection unhandled.
    const error = await captureError(
      withTenant(storeA.id, (db) =>
        db.execute(sql`
          INSERT INTO products (store_id, title_en, title_ar, handle, price_minor)
          VALUES (${storeB.id}, 'Injected', 'مُدخل', 'injected', 1)
        `),
      ),
    );

    // Drizzle wraps driver errors, so the RLS violation is on `cause`.
    expect(error).toBeInstanceOf(Error);
    expect(errorMessageChain(error)).toMatch(/row-level security/i);
    expect(await withTenant(storeB.id, (db) => countProducts(db))).toBe(0);
  });

  it('returns no tenant rows when no tenant context is set', async () => {
    await withTenant(storeA.id, (db) =>
      createProduct(db, {
        storeId: storeA.id,
        titleEn: 'A product',
        titleAr: 'منتج أ',
        handle: 'a-product',
        priceMinor: 1,
      }),
    );

    const rows = await withPlatform((db) => db.execute(sql`SELECT id FROM products`));
    expect(rowsOf(rows)).toHaveLength(0);
  });

  it('isolates store settings', async () => {
    await withTenant(storeA.id, (db) => upsertStoreSettings(db, storeA.id, { themeKey: 'dawn' }));
    await withTenant(storeB.id, (db) => upsertStoreSettings(db, storeB.id, { themeKey: 'nebula' }));

    expect((await withTenant(storeA.id, (db) => getStoreSettings(db, storeA.id)))?.themeKey).toBe(
      'dawn',
    );
    expect((await withTenant(storeB.id, (db) => getStoreSettings(db, storeB.id)))?.themeKey).toBe(
      'nebula',
    );

    // A cross-tenant read is refused outright by the data-access layer.
    await expect(
      withTenant(storeA.id, (db) => getStoreSettings(db, storeB.id)),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it('refuses to create a product for a tenant other than the active one', async () => {
    await expect(
      withTenant(storeA.id, (db) =>
        createProduct(db, {
          storeId: storeB.id,
          titleEn: 'Smuggled',
          titleAr: 'مُهرب',
          handle: 'smuggled',
          priceMinor: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it('refuses to open a tenant scope with a malformed store id', async () => {
    await expect(withTenant('not-a-uuid', async () => 'nope')).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
  });

  it('scopes the audit log per tenant, while platform staff see everything', async () => {
    await withTenant(storeA.id, (db) =>
      recordAudit(db, { actorType: 'user', storeId: storeA.id, action: 'product.created' }),
    );
    await withTenant(storeB.id, (db) =>
      recordAudit(db, { actorType: 'user', storeId: storeB.id, action: 'product.created' }),
    );
    await withPlatform((db) =>
      recordAudit(db, { actorType: 'system', action: 'platform.health_check' }),
    );

    expect(await withTenant(storeA.id, (db) => countAuditLogs(db))).toBe(1);
    expect(await withPlatform((db) => countAuditLogs(db))).toBe(3);
  });

  it('resolves a tenant from its host, case- and port-insensitively', async () => {
    expect((await withPlatform((db) => findStoreByHost(db, 'store-a.velnorix.test')))?.id).toBe(
      storeA.id,
    );
    expect((await withPlatform((db) => findStoreByHost(db, 'STORE-B.velnorix.test:443')))?.id).toBe(
      storeB.id,
    );
    expect(await withPlatform((db) => findStoreByHost(db, 'nope.velnorix.test'))).toBeNull();
  });

  it('lists stores in platform scope only', async () => {
    const page = await withPlatform((db) => listStores(db, { limit: 10 }));
    expect(page.items.map((store) => store.slug).sort()).toEqual(['store-a', 'store-b']);
    expect(page.hasMore).toBe(false);
  });

  it('keeps customer accounts separate per store', async () => {
    const { inA, inB } = await withPlatform(async (db) => ({
      inA: await createUser(db, {
        email: 'ahmed@example.com',
        fullName: 'Ahmed (A)',
        context: 'customer',
        storeId: storeA.id,
      }),
      inB: await createUser(db, {
        email: 'ahmed@example.com',
        fullName: 'Ahmed (B)',
        context: 'customer',
        storeId: storeB.id,
      }),
    }));

    expect(inA.id).not.toBe(inB.id);
    expect(inA.storeId).toBe(storeA.id);
    expect(inB.storeId).toBe(storeB.id);
  });
});

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function defaultPlanId(db: PlatformDb): Promise<string> {
  const [row] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
  if (!row) throw new Error('Plan "starter" is missing: did migration 0002 run?');
  return row.id;
}

/** Awaits a promise and returns the error it threw, or null when it resolved. */
async function captureError(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** Walks `error.cause` chain: drizzle wraps the driver error. */
function errorMessageChain(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && messages.length < 5) {
    messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return messages.join(' | ');
}

/** postgres.js returns rows as an array; UPDATE/DELETE also expose `.count`. */
function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : [];
}

function affectedRows(result: unknown): number {
  if (result && typeof result === 'object' && 'count' in result) {
    return Number((result as { count: unknown }).count ?? 0);
  }
  return rowsOf(result).length;
}
