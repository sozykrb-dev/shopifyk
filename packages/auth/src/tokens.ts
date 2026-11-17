import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomToken, sha256Hex } from '@velnorix/core';
import type { Database } from '@velnorix/db';
import { emailVerificationTokens, passwordResetTokens } from '@velnorix/db';
import { authEnv } from './env.js';

/**
 * Single-use, time-limited tokens for email verification and password reset.
 *
 * Only the SHA-256 of a token is stored, and a token is consumed by the same
 * UPDATE that reads it (`WHERE consumed_at IS NULL ... RETURNING`), so two
 * parallel requests can never both succeed.
 */

function hashCode(token: string): string {
  return sha256Hex(token);
}

export async function createEmailVerificationToken(
  db: Database,
  input: { userId: string; email: string },
): Promise<string> {
  const token = randomToken(32);
  await db.insert(emailVerificationTokens).values({
    userId: input.userId,
    email: input.email,
    tokenHash: hashCode(token),
    expiresAt: new Date(Date.now() + authEnv().EMAIL_VERIFICATION_TTL_SECONDS * 1000),
  });
  return token;
}

export async function consumeEmailVerificationToken(
  db: Database,
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const [row] = await db
    .update(emailVerificationTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, hashCode(token)),
        isNull(emailVerificationTokens.consumedAt),
        sql`${emailVerificationTokens.expiresAt} > now()`,
      ),
    )
    .returning({ userId: emailVerificationTokens.userId, email: emailVerificationTokens.email });

  return row ? { userId: row.userId, email: row.email } : null;
}

export async function createPasswordResetToken(db: Database, userId: string): Promise<string> {
  // A reset request invalidates every previous one: leaving old tokens alive
  // would let an attacker who stole an old link reset the password later.
  await db
    .update(passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.consumedAt)));

  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: hashCode(token),
    expiresAt: new Date(Date.now() + authEnv().PASSWORD_RESET_TTL_SECONDS * 1000),
  });
  return token;
}

export async function consumePasswordResetToken(
  db: Database,
  token: string,
): Promise<string | null> {
  const [row] = await db
    .update(passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashCode(token)),
        isNull(passwordResetTokens.consumedAt),
        sql`${passwordResetTokens.expiresAt} > now()`,
      ),
    )
    .returning({ userId: passwordResetTokens.userId });

  return row?.userId ?? null;
}
