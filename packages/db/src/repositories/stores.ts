import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { buildPage, TenantIsolationError, type Page } from '@velnorix/core';
import { dbEnv, type Database } from '../client.js';
import { requireTenantId } from '../tenant-context.js';
import {
  plans,
  storeDomains,
  storeSettings,
  stores,
  type NewStore,
  type Store,
  type StoreSettings,
} from '../schema.js';

export type CreateStoreInput = {
  slug: string;
  name: string;
  planId: string;
  ownerUserId?: string | null;
  defaultCurrency?: string;
  defaultLocale?: string;
  timezone?: string;
  trialDays?: number;
};

export async function findStoreBySlug(db: Database, slug: string): Promise<Store | null> {
  const [store] = await db
    .select()
    .from(stores)
    .where(eq(stores.slug, slug.toLowerCase()))
    .limit(1);
  return store ?? null;
}

export async function findStoreById(db: Database, id: string): Promise<Store | null> {
  const [store] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
  return store ?? null;
}

/**
 * Host-based tenant resolution.
 *
 * `host` is the lowercased Host header (port stripped). A store is reachable
 * through its own subdomain and through any verified custom domain.
 */
export async function findStoreByHost(db: Database, host: string): Promise<Store | null> {
  const normalized = host.trim().toLowerCase().split(':')[0] ?? '';
  if (!normalized) return null;

  const [row] = await db
    .select({ store: stores })
    .from(storeDomains)
    .innerJoin(stores, eq(stores.id, storeDomains.storeId))
    .where(eq(storeDomains.host, normalized))
    .limit(1);
  if (row) return row.store;

  // Fall back to the canonical slug so a store is reachable the moment it is
  // created, before its domain row has been written.
  const slug = normalized.split('.')[0] ?? '';
  return slug ? findStoreBySlug(db, slug) : null;
}

export type StoreListItem = Store & { planKey: string };

/** Number of stores, optionally filtered by status. */
export async function countStores(
  db: Database,
  filter: { status?: Store['status'] } = {},
): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(stores)
    .where(filter.status ? eq(stores.status, filter.status) : undefined);
  return Number(row?.value ?? 0);
}

export type ListStoresFilter = {
  limit: number;
  cursor?: string | undefined;
  search?: string | undefined;
  status?: Store['status'] | undefined;
};

/** Cursor-paginated store list for the super admin (platform scope). */
export async function listStores(
  db: Database,
  filter: ListStoresFilter,
): Promise<Page<StoreListItem>> {
  const conditions = [];
  if (filter.status) conditions.push(eq(stores.status, filter.status));
  if (filter.search) {
    const term = `%${filter.search}%`;
    const search = or(ilike(stores.name, term), ilike(stores.slug, term));
    if (search) conditions.push(search);
  }

  const rows = await db
    .select({ store: stores, planKey: plans.key })
    .from(stores)
    .innerJoin(plans, eq(plans.id, stores.planId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(stores.createdAt), asc(stores.id))
    .limit(filter.limit + 1);

  return buildPage(
    rows.map((row) => ({ ...row.store, planKey: row.planKey })),
    filter.limit,
    (row) => ({ k: row.createdAt.toISOString(), i: row.id }),
  );
}

export async function createStore(db: Database, input: CreateStoreInput): Promise<Store> {
  const values: NewStore = {
    slug: input.slug.toLowerCase(),
    name: input.name,
    planId: input.planId,
    ownerUserId: input.ownerUserId ?? null,
    defaultCurrency: input.defaultCurrency ?? 'EGP',
    defaultLocale: input.defaultLocale ?? 'ar',
    timezone: input.timezone ?? 'Africa/Cairo',
    ...(input.trialDays
      ? { trialEndsAt: new Date(Date.now() + input.trialDays * 24 * 60 * 60 * 1000) }
      : {}),
  };

  const [created] = await db.insert(stores).values(values).returning();
  if (!created) throw new Error('Failed to create store.');

  await db.insert(storeDomains).values({
    storeId: created.id,
    host: `${created.slug}.${dbEnv().APP_BASE_DOMAIN}`,
    type: 'subdomain',
    isPrimary: true,
    verifiedAt: new Date(),
  });

  return created;
}

export async function suspendStore(db: Database, storeId: string, reason: string): Promise<Store> {
  const [updated] = await db
    .update(stores)
    .set({
      status: 'suspended',
      suspendedAt: new Date(),
      suspensionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, storeId))
    .returning();
  if (!updated) throw new Error(`Store ${storeId} not found.`);
  return updated;
}

export async function restoreStore(db: Database, storeId: string): Promise<Store> {
  const [updated] = await db
    .update(stores)
    .set({
      status: 'active',
      suspendedAt: null,
      suspensionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, storeId))
    .returning();
  if (!updated) throw new Error(`Store ${storeId} not found.`);
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Tenant scoped: store settings                                               */
/* -------------------------------------------------------------------------- */

export async function getStoreSettings(
  db: Database,
  storeId: string,
): Promise<StoreSettings | null> {
  const tenantId = requireTenantId();
  if (storeId !== tenantId) {
    throw new TenantIsolationError('Cannot read settings for a different tenant.');
  }
  const [settings] = await db
    .select()
    .from(storeSettings)
    .where(eq(storeSettings.storeId, tenantId))
    .limit(1);
  return settings ?? null;
}

export async function upsertStoreSettings(
  db: Database,
  storeId: string,
  patch: Partial<Omit<StoreSettings, 'storeId' | 'createdAt' | 'updatedAt'>>,
): Promise<StoreSettings> {
  const tenantId = requireTenantId();
  if (storeId !== tenantId) {
    throw new TenantIsolationError('Cannot write settings for a different tenant.');
  }
  const [updated] = await db
    .insert(storeSettings)
    .values({ storeId, ...patch })
    .onConflictDoUpdate({
      target: storeSettings.storeId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  if (!updated) throw new Error('Failed to save store settings.');
  return updated;
}

export async function listStoreDomains(db: Database, storeId: string) {
  return db
    .select()
    .from(storeDomains)
    .where(eq(storeDomains.storeId, storeId))
    .orderBy(desc(storeDomains.isPrimary), asc(storeDomains.host));
}
