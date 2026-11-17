import {
  createSession,
  findValidSession,
  markMfaCompleted,
  revokeAllSessionsForUser,
  revokeSession,
  touchSession,
  type CreatedSession,
  type Database,
  type Session,
  type SessionContext,
} from '@velnorix/db';
import { authEnv } from '../env.js';

/**
 * Session policy.
 *
 * Sessions are server-side rows, never JWTs: revocation (suspend a user, log
 * out everywhere) has to be immediate, and a stateless token cannot be revoked.
 * The cookie holds an opaque 256-bit random token whose SHA-256 is all we store.
 */

/**
 * One cookie per authentication context, so a browser holding a merchant
 * session can never present it to a super-admin route by accident.
 */
export const SESSION_COOKIES: Record<SessionContext, string> = {
  super_admin: 'vx_platform_session',
  platform_staff: 'vx_platform_session',
  merchant_owner: 'vx_store_session',
  merchant_staff: 'vx_store_session',
  customer: 'vx_customer_session',
};

export function cookieNameFor(context: SessionContext): string {
  return SESSION_COOKIES[context];
}

export type SessionPolicy = { idleSeconds: number; absoluteSeconds: number };

export function sessionPolicy(): SessionPolicy {
  const env = authEnv();
  return {
    idleSeconds: env.SESSION_IDLE_TTL_SECONDS,
    absoluteSeconds: env.SESSION_ABSOLUTE_TTL_SECONDS,
  };
}

export type StartSessionInput = {
  userId: string;
  context: SessionContext;
  storeId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  mfaCompleted?: boolean;
};

export async function startSession(
  db: Database,
  input: StartSessionInput,
): Promise<CreatedSession> {
  const policy = sessionPolicy();
  return createSession(db, {
    userId: input.userId,
    context: input.context,
    storeId: input.storeId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    idleTtlSeconds: policy.idleSeconds,
    absoluteTtlSeconds: policy.absoluteSeconds,
    mfaCompleted: input.mfaCompleted ?? false,
  });
}

/**
 * Resolves a token to a live session. Returns null for unknown, expired and
 * revoked tokens alike -- callers must not distinguish them.
 */
export async function resolveSession(db: Database, token: string): Promise<Session | null> {
  if (!token) return null;
  const session = await findValidSession(db, token);
  if (!session) return null;
  await touchSession(db, session, sessionPolicy().idleSeconds);
  return session;
}

export async function completeSessionMfa(db: Database, sessionId: string): Promise<void> {
  await markMfaCompleted(db, sessionId);
}

export async function endSession(db: Database, sessionId: string, reason: string): Promise<void> {
  await revokeSession(db, sessionId, reason);
}

export async function endAllSessions(
  db: Database,
  userId: string,
  reason: string,
): Promise<number> {
  return revokeAllSessionsForUser(db, userId, reason);
}

/**
 * A session may only be used for the context it was minted in. This is the
 * check that keeps the five authentication contexts separate.
 */
export function sessionMatchesContext(session: Session, context: SessionContext): boolean {
  return session.context === context;
}

/**
 * A session that has not completed MFA is "pending": it exists, so the user
 * does not have to retype their password, but it grants no access.
 */
export function sessionRequiresMfa(session: Session): boolean {
  return session.mfaCompletedAt === null;
}
