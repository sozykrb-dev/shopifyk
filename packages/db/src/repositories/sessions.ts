import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { randomToken, sha256Hex } from '@velnorix/core';
import type { Database } from '../client.js';
import { sessions, type NewSession, type Session } from '../schema.js';

export type SessionContext = Session['context'];

export type CreateSessionInput = {
  userId: string;
  context: SessionContext;
  /** Merchant and customer sessions are pinned to a single store. */
  storeId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  idleTtlSeconds: number;
  absoluteTtlSeconds: number;
  mfaCompleted?: boolean;
};

export type CreatedSession = {
  session: Session;
  /** Returned once, never stored. */ token: string;
};

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

export async function createSession(
  db: Database,
  input: CreateSessionInput,
): Promise<CreatedSession> {
  const token = randomToken(32);
  const now = new Date();
  const values: NewSession = {
    tokenHash: hashSessionToken(token),
    userId: input.userId,
    context: input.context,
    storeId: input.storeId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    expiresAt: new Date(now.getTime() + input.idleTtlSeconds * 1000),
    absoluteExpiresAt: new Date(now.getTime() + input.absoluteTtlSeconds * 1000),
    mfaCompletedAt: input.mfaCompleted ? now : null,
    lastSeenAt: now,
  };

  const [session] = await db.insert(sessions).values(values).returning();
  if (!session) throw new Error('Failed to create session.');
  return { session, token };
}

/**
 * Loads a session by token, enforcing every revocation/expiry rule in SQL so
 * the check cannot be forgotten by a caller.
 */
export async function findValidSession(db: Database, token: string): Promise<Session | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        isNull(sessions.revokedAt),
        sql`${sessions.expiresAt} > now()`,
        sql`${sessions.absoluteExpiresAt} > now()`,
      ),
    )
    .limit(1);
  return session ?? null;
}

/**
 * Slides the idle expiry forward, never past the absolute expiry, and only
 * writes when more than a minute of the window has elapsed (otherwise every
 * request would be a write).
 */
export async function touchSession(
  db: Database,
  session: Session,
  idleTtlSeconds: number,
): Promise<void> {
  const now = Date.now();
  if (session.lastSeenAt && now - session.lastSeenAt.getTime() < 60_000) return;

  const idleExpiry = new Date(now + idleTtlSeconds * 1000);
  const effectiveExpiry =
    idleExpiry.getTime() < session.absoluteExpiresAt.getTime()
      ? idleExpiry
      : session.absoluteExpiresAt;

  await db
    .update(sessions)
    .set({ lastSeenAt: new Date(now), expiresAt: effectiveExpiry })
    .where(eq(sessions.id, session.id));
}

export async function markMfaCompleted(db: Database, sessionId: string): Promise<void> {
  await db.update(sessions).set({ mfaCompletedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(
  db: Database,
  sessionId: string,
  reason: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(eq(sessions.id, sessionId));
}

export async function revokeAllSessionsForUser(
  db: Database,
  userId: string,
  reason: string,
): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return revoked.length;
}

/** Housekeeping: removes sessions that are expired or revoked beyond retention. */
export async function deleteExpiredSessions(
  db: Database,
  retentionMs = 30 * 24 * 60 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionMs);
  const deleted = await db
    .delete(sessions)
    .where(
      or(
        sql`${sessions.absoluteExpiresAt} < ${cutoff}`,
        and(sql`${sessions.revokedAt} IS NOT NULL`, sql`${sessions.revokedAt} < ${cutoff}`),
      ),
    )
    .returning({ id: sessions.id });
  return deleted.length;
}
