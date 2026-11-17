import type { SessionContext } from '@velnorix/db';
import { cookieNameFor } from './session/index.js';

/**
 * Pure mapping between the kind of host a request arrived on and the
 * authentication context that may sign in there.
 *
 * The platform has five authentication contexts and they must never bleed into
 * each other: a merchant session presented to the platform console -- or a
 * store session replayed against another store -- is not a session at all.
 * Keeping the mapping in one pure module, shared by every app, is what makes
 * that rule testable instead of implied.
 */

export type HostKind = 'platform' | 'store' | 'unknown';

/** The context a visitor signs in with on each kind of host. */
export function signInContextForHost(kind: HostKind): SessionContext | null {
  if (kind === 'platform') return 'super_admin';
  if (kind === 'store') return 'merchant_owner';
  return null;
}

/**
 * Name of the cookie holding the session for this host, or null when the host
 * maps to no context (an unknown host has no login form at all).
 */
export function cookieNameForHost(kind: HostKind): string | null {
  const context = signInContextForHost(kind);
  return context === null ? null : cookieNameFor(context);
}

/**
 * Whether a session minted in `sessionContext` may be presented to `kind`.
 *
 * Platform staff (support, finance) share the platform console cookie with
 * super admins but keep their own context, so their permissions stay narrower.
 * A merchant session is additionally bound to one store: the same cookie sent
 * to another store's admin must not authenticate.
 */
export function sessionAllowedOnHost(
  kind: HostKind,
  sessionContext: SessionContext,
  options: { matchesStore: boolean },
): boolean {
  if (kind === 'platform') {
    return sessionContext === 'super_admin' || sessionContext === 'platform_staff';
  }
  if (kind === 'store') {
    if (sessionContext !== 'merchant_owner' && sessionContext !== 'merchant_staff') return false;
    return options.matchesStore;
  }
  return false;
}
