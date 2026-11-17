import { cookies } from 'next/headers';
import { resolveSession, sessionAllowedOnHost } from '@velnorix/auth';
import { withPlatform, type Store } from '@velnorix/db';
import { CUSTOMER_SESSION_COOKIE } from './session.js';
import { getStorefrontContext, resolveStoreWithSettings } from './tenant.js';
import type { StorefrontContext } from './tenant.js';

/**
 * Everything a storefront request needs, resolved once.
 *
 * Server Actions cannot trust a store id from the client, so every action
 * re-resolves the store from the Host header and re-reads the session row.
 */

export type CustomerIdentity = {
  userId: string;
  email: string;
  fullName: string;
};

export type ResolvedStorefront = {
  context: StorefrontContext;
  store: Store;
  currency: string;
  locale: string;
  /** Null for a guest. */
  customer: CustomerIdentity | null;
  /** Convenience: `customer?.userId ?? null`, because that is what most callers need. */
  customerUserId: string | null;
};

export async function resolveStorefront(): Promise<ResolvedStorefront | null> {
  const context = await getStorefrontContext();
  const resolved = await resolveStoreWithSettings(context);
  if (!resolved) return null;

  const { store, settings } = resolved;
  const token = (await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value;
  let customer: CustomerIdentity | null = null;

  if (token) {
    const session = await withPlatform((db) => resolveSession(db, token));
    const allowed =
      session !== null &&
      sessionAllowedOnHost(context.kind === 'store' ? 'store' : context.kind, session.context, {
        matchesStore: session.storeId === store.id,
      });

    if (allowed && session.context === 'customer') {
      const user = await withPlatform((db) =>
        db.query.users.findFirst({ where: (fields, { eq }) => eq(fields.id, session.userId) }),
      );
      if (user && user.status === 'active') {
        customer = { userId: user.id, email: user.email, fullName: user.fullName };
      }
    }
  }

  return {
    context,
    store,
    currency: settings?.currency ?? store.defaultCurrency,
    locale: settings?.locale ?? store.defaultLocale,
    customer,
    customerUserId: customer?.userId ?? null,
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
