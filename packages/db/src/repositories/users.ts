import { and, eq, isNull, sql } from 'drizzle-orm';
import { sha256Hex } from '@velnorix/core';
import type { Database } from '../client.js';
import { users, type NewUser, type User } from '../schema.js';

export type AuthContext = User['context'];

export type CreateUserInput = {
  email: string;
  fullName: string;
  context: AuthContext;
  /** Required for `customer` accounts, must be null for every other context. */
  storeId?: string | null;
  passwordHash?: string | null;
  status?: User['status'];
  preferredLocale?: string;
  metadata?: Record<string, unknown>;
};

/** Emails are matched case-insensitively via the generated `email_normalized` column. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Replaces a user's password hash.
 *
 * Called after a reset token has been consumed, and deliberately dumb: it does
 * not check the old password, because by this point possession of a
 * single-use token is the proof. Everywhere else, changing a password must ask
 * for the current one.
 *
 * Any session that should die when the password changes is the caller's
 * business -- a reset must invalidate sessions, and that belongs with the
 * session code, not buried here.
 */
export async function updateUserPassword(
  db: Database,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function findUserByEmail(
  db: Database,
  email: string,
  context?: AuthContext,
  storeId?: string | null,
): Promise<User | null> {
  const conditions = [eq(users.emailNormalized, normalizeEmail(email))];
  if (context) conditions.push(eq(users.context, context));
  if (context === 'customer') {
    conditions.push(storeId ? eq(users.storeId, storeId) : isNull(users.storeId));
  }
  if (context && context !== 'customer') conditions.push(isNull(users.storeId));

  const [user] = await db
    .select()
    .from(users)
    .where(and(...conditions))
    .limit(1);
  return user ?? null;
}

export async function findUserById(db: Database, id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function createUser(db: Database, input: CreateUserInput): Promise<User> {
  if (input.context === 'customer' && !input.storeId) {
    throw new Error('Customer accounts must be scoped to a store.');
  }
  if (input.context !== 'customer' && input.storeId) {
    throw new Error('Only customer accounts may be scoped to a store.');
  }

  const values: NewUser = {
    email: input.email.trim(),
    context: input.context,
    fullName: input.fullName,
    passwordHash: input.passwordHash ?? null,
    storeId: input.storeId ?? null,
    status: input.status ?? 'pending_verification',
    preferredLocale: input.preferredLocale ?? 'ar',
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  const [created] = await db.insert(users).values(values).returning();
  if (!created) throw new Error('Failed to create user.');
  return created;
}

export async function updateUser(
  db: Database,
  id: string,
  patch: Partial<
    Pick<NewUser, 'fullName' | 'status' | 'preferredLocale' | 'passwordHash' | 'metadata'>
  >,
): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  if (!updated) throw new Error(`User ${id} not found.`);
  return updated;
}

export async function markEmailVerified(db: Database, id: string): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), status: 'active', updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  if (!updated) throw new Error(`User ${id} not found.`);
  return updated;
}

export async function recordSuccessfulLogin(db: Database, id: string): Promise<void> {
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
}

/** Number of users, optionally filtered by auth context. */
export async function countUsers(
  db: Database,
  filter: { context?: AuthContext; since?: Date } = {},
): Promise<number> {
  const conditions = [];
  if (filter.context) conditions.push(eq(users.context, filter.context));
  if (filter.since)
    conditions.push(sql`${users.createdAt} >= ${filter.since.toISOString()}::timestamptz`);

  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(users)
    .where(conditions.length ? and(...conditions) : undefined);
  return Number(row?.value ?? 0);
}

export type FailedLoginOutcome = { attempts: number; lockedUntil: Date | null };

/**
 * Increments the failure counter and locks the account once `maxAttempts` is
 * reached. Locking is time-boxed: a forgotten password must never permanently
 * lock someone out of their own store.
 */
export async function recordFailedLogin(
  db: Database,
  id: string,
  maxAttempts: number,
  lockDurationMs: number,
): Promise<FailedLoginOutcome> {
  const lockUntil = new Date(Date.now() + lockDurationMs);
  const [updated] = await db
    .update(users)
    .set({
      failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
      lockedUntil: sql`CASE WHEN ${users.failedLoginAttempts} + 1 >= ${maxAttempts}
        THEN ${lockUntil.toISOString()}::timestamptz
        ELSE ${users.lockedUntil} END`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning({ attempts: users.failedLoginAttempts, lockedUntil: users.lockedUntil });

  return { attempts: updated?.attempts ?? maxAttempts, lockedUntil: updated?.lockedUntil ?? null };
}

export async function isAccountLocked(user: User): Promise<boolean> {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
}

/** Only the hash of a token is ever stored or compared. */
export function hashLookupToken(token: string): string {
  return sha256Hex(token);
}
