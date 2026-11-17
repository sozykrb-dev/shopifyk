import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  cookieNameFor,
  hasConfirmedTotp,
  loadPrincipal,
  resolveSession,
  sessionPolicy,
  sessionRequiresMfa,
  type Principal,
} from '@velnorix/auth';
import { withPlatform } from '@velnorix/db';
import { cookieNameForHost, sessionAllowedOnHost } from './auth-context.js';
import { getRequestContext, resolveStoreId, type RequestContext } from './tenant.js';
import { TENANT_HEADERS } from './tenant-headers.js';

/**
 * Session plumbing for the admin app.
 *
 * The cookie only ever holds an opaque token; every request re-reads the
 * session row from Postgres, so revoking a session (or suspending a user)
 * takes effect on the next request instead of at the end of a token's life.
 */

export function contextCookieName(context: RequestContext): string | null {
  return cookieNameForHost(context.kind);
}

/** Writes the session cookie. Only callable from a Server Action or Route Handler. */
export async function startSessionCookie(
  sessionContext: Parameters<typeof cookieNameFor>[0],
  token: string,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(cookieNameFor(sessionContext), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: sessionPolicy().absoluteSeconds,
  });
}

export async function clearSessionCookie(
  sessionContext: Parameters<typeof cookieNameFor>[0],
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(cookieNameFor(sessionContext));
}

export type PrincipalResult = {
  principal: Principal;
  context: RequestContext;
  storeId: string | null;
  sessionId: string;
};

/**
 * Loads the signed-in principal for this host, or null.
 *
 * The session's context must match the host's context: a merchant session
 * presented to the platform console (or vice versa) is treated as no session at
 * all, which is what keeps the five authentication contexts separate.
 */
export async function currentPrincipal(): Promise<PrincipalResult | null> {
  const context = await getRequestContext();
  if (context.kind === 'unknown') return null;

  const cookieName = contextCookieName(context);
  if (!cookieName) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (!token) return null;

  const storeId = await resolveStoreId(context);

  const session = await withPlatform((db) => resolveSession(db, token));
  if (!session) return null;

  if (
    !sessionAllowedOnHost(context.kind, session.context, {
      matchesStore: session.storeId === storeId,
    })
  ) {
    return null;
  }

  const principal = await withPlatform((db) =>
    loadPrincipal(db, {
      userId: session.userId,
      context: session.context,
      storeId: session.storeId,
      sessionId: session.id,
      mfaCompleted: !sessionRequiresMfa(session),
    }),
  );
  if (!principal) return null;

  return { principal, context, storeId, sessionId: session.id };
}

/**
 * Same as `currentPrincipal()` but redirects instead of returning null.
 *
 * A session that has not completed MFA is sent to /mfa (it grants no access),
 * and a super admin who has not enrolled a second factor is sent to /mfa/setup.
 */
export async function requirePrincipal(
  allowed?: readonly Principal['context'][],
): Promise<PrincipalResult> {
  const result = await currentPrincipal();
  if (!result) redirect('/login');

  const headerList = await headers();
  const pathname = headerList.get(TENANT_HEADERS.pathname) ?? '/';

  if (!result.principal.mfaCompleted && !pathname.startsWith('/mfa')) {
    const enrolled = await withPlatform((db) => hasConfirmedTotp(db, result.principal.userId));
    redirect(enrolled ? '/mfa' : '/mfa/setup');
  }

  if (allowed && !allowed.includes(result.principal.context)) redirect('/login');
  return result;
}
