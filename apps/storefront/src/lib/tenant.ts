import { headers } from 'next/headers';
import {
  findStoreByHost,
  findStoreBySlug,
  getStoreSettings,
  withPlatform,
  withTenant,
  type Store,
  type StoreSettings,
} from '@velnorix/db';
import { TENANT_HEADERS } from './tenant-headers.js';

/**
 * Tenant resolution for the storefront.
 *
 * A store is reached through `{slug}.<base domain>` or through a verified custom
 * domain. The edge middleware classifies the host; this module loads the real
 * store row and (inside a tenant scope) its settings.
 */

export type StorefrontContext = {
  host: string;
  kind: 'platform' | 'store' | 'unknown';
  storeSlug: string | null;
  devTenant: string | null;
};

export async function getStorefrontContext(): Promise<StorefrontContext> {
  const headerList = await headers();
  return {
    host: headerList.get(TENANT_HEADERS.host) ?? '',
    kind: (headerList.get(TENANT_HEADERS.kind) as StorefrontContext['kind']) ?? 'unknown',
    storeSlug: headerList.get(TENANT_HEADERS.storeSlug),
    devTenant: headerList.get(TENANT_HEADERS.devTenant),
  };
}

export async function resolveStore(context: StorefrontContext): Promise<Store | null> {
  if (context.kind !== 'store') return null;

  return withPlatform(async (db) => {
    if (context.devTenant) return findStoreBySlug(db, context.devTenant);
    return findStoreByHost(db, context.host || context.storeSlug || '');
  });
}

export type ResolvedStore = {
  store: Store;
  settings: StoreSettings | null;
};

/** Loads the store and, in a tenant scope, its theme settings. */
export async function resolveStoreWithSettings(
  context: StorefrontContext,
): Promise<ResolvedStore | null> {
  const store = await resolveStore(context);
  if (!store) return null;

  const settings = await withTenant(store.id, (db) => getStoreSettings(db, store.id));
  return { store, settings };
}
