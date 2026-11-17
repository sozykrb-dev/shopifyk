import { cookies } from 'next/headers';
import { resolveSession, sessionAllowedOnHost } from '@velnorix/auth';
import { withPlatform, type Store } from '@velnorix/db';
import { getStorefrontContext, resolveStoreWithSettings } from './tenant.js';
import type { StorefrontContext } from './tenant.js';

/**
 * Everything a storefront request needs, resolved once.
 *
 * Server Actions cannot trust a store id from the client, so every action
 * re-resolves the store from the Host header and re-reads the session row.
 */

export type ResolvedStorefront = {
  context: StorefrontContext;
  store: Store;
  currency: string;
  locale: string;
  customerUserId: string | null;
};

export async function resolveStorefront(): Promise<ResolvedStorefront | null> {
  const context = await getStorefrontContext();
  const resolved = await resolveStoreWithSettings(context);
  if (!resolved) return null;

  const { store, settings } = resolved;
  const token = (await cookies()).get('vx_customer_session')?.value;
  let customerUserId: string | null = null;

  if (token) {
    const session = await withPlatform((db) => resolveSession(db, token));
    const allowed =
      session !== null &&
      sessionAllowedOnHost(context.kind === 'store' ? 'store' : context.kind, session.context, {
        matchesStore: session.storeId === store.id,
      });
    if (allowed && session.context === 'customer') customerUserId = session.userId;
  }

  return {
    context,
    store,
    currency: settings?.currency ?? store.defaultCurrency,
    locale: settings?.locale ?? store.defaultLocale,
    customerUserId,
  };
}

/** `resolveStorefront()` for callers that already know a store must exist. */
export async function requireStorefront(): Promise<ResolvedStorefront> {
  const resolved = await resolveStorefront();
  if (!resolved) {
    throw new Error('No store is mapped to this host.');
  }
  return resolved;
}
