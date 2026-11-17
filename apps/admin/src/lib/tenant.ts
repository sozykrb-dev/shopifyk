import { headers } from 'next/headers';
import { findStoreByHost, findStoreBySlug, withPlatform, type Store } from '@velnorix/db';
import { TENANT_HEADERS } from './tenant-headers.js';

/**
 * Request context, injected by `middleware.ts`.
 *
 * The middleware runs on the edge runtime and cannot touch the database, so it
 * classifies the Host header and forwards the result as request headers. Every
 * server component then resolves the real store row through the data layer.
 */

export type RequestContext = {
  host: string;
  kind: 'platform' | 'store' | 'unknown';
  /** Store slug for `{slug}.<base domain>`; the full host for custom domains. */
  storeSlug: string | null;
  /** Set only when the dev/preview tenant override is in use. */
  devTenant: string | null;
};

export { TENANT_HEADERS };

export async function getRequestContext(): Promise<RequestContext> {
  const headerList = await headers();
  return {
    host: headerList.get(TENANT_HEADERS.host) ?? '',
    kind: (headerList.get(TENANT_HEADERS.kind) as RequestContext['kind']) ?? 'unknown',
    storeSlug: headerList.get(TENANT_HEADERS.storeSlug),
    devTenant: headerList.get(TENANT_HEADERS.devTenant),
  };
}

/**
 * Resolves the store the request belongs to.
 *
 * Custom domains are matched against `store_domains`; the dev override matches
 * on the slug. Returns null for the platform console and for unknown hosts.
 */
export async function resolveStore(context: RequestContext): Promise<Store | null> {
  if (context.kind !== 'store') return null;

  return withPlatform(async (db) => {
    if (context.devTenant) return findStoreBySlug(db, context.devTenant);
    return findStoreByHost(db, context.host || context.storeSlug || '');
  });
}

/** Tenant id to pin data access to, or null on the platform console. */
export async function resolveStoreId(context: RequestContext): Promise<string | null> {
  const store = await resolveStore(context);
  return store?.id ?? null;
}
