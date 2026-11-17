import {
  InMemoryRateLimiter,
  enforceRateLimit,
  sha256Hex,
  type Result,
  type RateLimiter,
} from '@velnorix/core';
import {
  findMembership,
  findUserByEmail,
  isAccountLocked,
  recordAudit,
  recordFailedLogin,
  recordSuccessfulLogin,
  recoveryCodes,
  totpCredentials,
  updateUser,
  type AuthContext,
  type Database,
  type Session,
  type User,
} from '@velnorix/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { authEnv } from './env.js';
import { dummyVerify, verifyPassword } from './password.js';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  isReplay,
  verifyTotpCode,
  type TotpSetup,
} from './totp.js';
import { completeSessionMfa, startSession } from './session/index.js';
import { createTotpSetup } from './totp.js';

/**
 * The authentication service: sign-in, MFA and TOTP enrolment.
 *
 * Every failure returns the SAME error, in the SAME time, whether the account
 * exists or not. Account enumeration is a real attack on a platform where the
 * email address tells you which merchant someone works for.
 */

const GENERIC_FAILURE = {
  code: 'invalid_credentials',
  message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
};

/** Default limiter for single-process deployments and tests. */
export const loginRateLimiter: RateLimiter = new InMemoryRateLimiter();

export type LoginInput = {
  email: string;
  password: string;
  /** Which of the five contexts this login form belongs to. */
  context: AuthContext;
  /** Required for customer logins: the store the account belongs to. */
  storeId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type LoginSuccess = {
  status: 'authenticated' | 'mfa_required';
  user: User;
  session: Session;
  token: string;
};

export type LoginFailure = { status: 'failed'; error: { code: string; message: string } };

export type LoginOutcome = LoginSuccess | LoginFailure;

/**
 * Verifies credentials and mints a session.
 *
 * A successful password check is not enough when MFA is enrolled: the session
 * is created with `mfaCompletedAt = null`, which grants no access until the
 * second factor is verified.
 */
export async function authenticate(
  db: Database,
  input: LoginInput,
  limiter: RateLimiter = loginRateLimiter,
): Promise<LoginOutcome> {
  const env = authEnv();
  const throttleKey = `${input.context}:${input.ipAddress ?? 'unknown'}:${sha256Hex(
    input.email.trim().toLowerCase(),
  )}`;

  try {
    await enforceRateLimit(limiter, throttleKey, env.LOGIN_MAX_ATTEMPTS, 60_000);
  } catch {
    return {
      status: 'failed',
      error: {
        code: 'rate_limited',
        message: 'محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل.',
      },
    };
  }

  const user = await findUserByEmail(db, input.email, input.context, input.storeId ?? null);

  if (!user) {
    // Spend the same CPU time as a real verification, then fail generically.
    await dummyVerify();
    await auditLogin(db, null, input, 'auth.login.failed', { reason: 'unknown_account' });
    return { status: 'failed', error: GENERIC_FAILURE };
  }

  if (await isAccountLocked(user)) {
    await auditLogin(db, user, input, 'auth.login.failed', { reason: 'locked' });
    return {
      status: 'failed',
      error: { code: 'account_locked', message: 'تم قفل الحساب مؤقتًا. حاول مرة أخرى لاحقًا.' },
    };
  }

  if (user.status === 'disabled') {
    await auditLogin(db, user, input, 'auth.login.failed', { reason: 'disabled' });
    return { status: 'failed', error: GENERIC_FAILURE };
  }

  const passwordOk = await verifyPassword(user.passwordHash ?? '', input.password);
  if (!passwordOk) {
    await recordFailedLogin(db, user.id, env.LOGIN_MAX_ATTEMPTS, env.LOGIN_LOCKOUT_SECONDS * 1000);
    await auditLogin(db, user, input, 'auth.login.failed', { reason: 'bad_password' });
    return { status: 'failed', error: GENERIC_FAILURE };
  }

  // Merchant sign-in always happens on a store's admin host, and the account
  // must actually belong to that store: otherwise any merchant could mint a
  // session for somebody else's store.
  if (input.context === 'merchant_owner' || input.context === 'merchant_staff') {
    if (!input.storeId) {
      await auditLogin(db, user, input, 'auth.login.failed', { reason: 'store_missing' });
      return { status: 'failed', error: GENERIC_FAILURE };
    }
    const membership = await findMembership(db, input.storeId, user.id);
    if (!membership || membership.status !== 'active') {
      await auditLogin(db, user, input, 'auth.login.failed', { reason: 'not_a_member' });
      return { status: 'failed', error: GENERIC_FAILURE };
    }
  }

  if ((input.context === 'super_admin' || input.context === 'platform_staff') && input.storeId) {
    await auditLogin(db, user, input, 'auth.login.failed', { reason: 'store_not_allowed' });
    return { status: 'failed', error: GENERIC_FAILURE };
  }

  if (input.context === 'customer' && !input.storeId) {
    await auditLogin(db, user, input, 'auth.login.failed', { reason: 'store_missing' });
    return { status: 'failed', error: GENERIC_FAILURE };
  }

  if (!user.emailVerifiedAt) {
    await auditLogin(db, user, input, 'auth.login.failed', { reason: 'email_unverified' });
    return {
      status: 'failed',
      error: {
        code: 'email_not_verified',
        message: 'يرجى تأكيد بريدك الإلكتروني أولًا.',
      },
    };
  }

  const hasTotp = await hasConfirmedTotp(db, user.id);
  const mfaRequired = hasTotp || input.context === 'super_admin';

  const { session, token } = await startSession(db, {
    userId: user.id,
    context: user.context,
    storeId: input.storeId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    mfaCompleted: !mfaRequired,
  });

  await recordSuccessfulLogin(db, user.id);
  await auditLogin(db, user, input, 'auth.login.succeeded', { mfaRequired });
  await limiter.reset(throttleKey);

  return {
    status: mfaRequired ? 'mfa_required' : 'authenticated',
    user,
    session,
    token,
  };
}

/**
 * Completes the second factor with a TOTP code or a recovery code.
 * Recovery codes are single use and are burned as they are consumed.
 */
export async function verifySecondFactor(
  db: Database,
  input: { sessionId: string; userId: string; code: string },
  limiter: RateLimiter = loginRateLimiter,
): Promise<Result<{ userId: string }, { code: string; message: string }>> {
  const throttleKey = `mfa:${input.userId}`;
  try {
    await enforceRateLimit(limiter, throttleKey, 10, 60_000);
  } catch {
    return { ok: false, error: { code: 'rate_limited', message: 'محاولات كثيرة جدًا.' } };
  }

  const [credential] = await db
    .select()
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, input.userId))
    .limit(1);

  const code = input.code.replace(/\s/g, '');

  if (credential?.confirmedAt) {
    const secret = decryptTotpSecret(credential.secretEncrypted);
    if (!isReplay(credential.lastUsedAt) && verifyTotpCode(secret, code)) {
      await db
        .update(totpCredentials)
        .set({ lastUsedAt: new Date() })
        .where(eq(totpCredentials.userId, input.userId));
      await completeSessionMfa(db, input.sessionId);
      await limiter.reset(throttleKey);
      return { ok: true, value: { userId: input.userId } };
    }
  }

  const recovered = await consumeRecoveryCode(db, input.userId, code);
  if (recovered) {
    await completeSessionMfa(db, input.sessionId);
    await limiter.reset(throttleKey);
    return { ok: true, value: { userId: input.userId } };
  }

  return {
    ok: false,
    error: { code: 'invalid_code', message: 'الرمز غير صحيح. حاول مرة أخرى.' },
  };
}

/**
 * TOTP enrolment. The seed is stored encrypted but UNCONFIRMED until the user
 * proves they can generate a code, so a typo cannot lock them out.
 */
export async function beginTotpEnrollment(
  db: Database,
  userId: string,
  accountLabel: string,
): Promise<TotpSetup> {
  const setup = createTotpSetup(accountLabel);
  await db
    .insert(totpCredentials)
    .values({ userId, secretEncrypted: encryptTotpSecret(setup.secret) })
    .onConflictDoUpdate({
      target: totpCredentials.userId,
      set: { secretEncrypted: encryptTotpSecret(setup.secret), confirmedAt: null },
    });
  return setup;
}

export async function confirmTotpEnrollment(
  db: Database,
  userId: string,
  code: string,
): Promise<Result<{ recoveryCodes: string[] }, { code: string; message: string }>> {
  const [credential] = await db
    .select()
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, userId))
    .limit(1);

  if (!credential) {
    return { ok: false, error: { code: 'no_enrollment', message: 'ابدأ إعداد المصادقة أولًا.' } };
  }

  const secret = decryptTotpSecret(credential.secretEncrypted);
  if (!verifyTotpCode(secret, code)) {
    return { ok: false, error: { code: 'invalid_code', message: 'الرمز غير صحيح.' } };
  }

  await db
    .update(totpCredentials)
    // `lastUsedAt` is deliberately NOT set here: burning the current window at
    // enrolment time would make the user's very next code look like a replay.
    .set({ confirmedAt: new Date() })
    .where(eq(totpCredentials.userId, userId));

  const codes = generateRecoveryCodes();
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db.insert(recoveryCodes).values(codes.hashes.map((hash) => ({ userId, codeHash: hash })));

  return { ok: true, value: { recoveryCodes: codes.plain } };
}

export async function disableTotp(db: Database, userId: string): Promise<void> {
  await db.delete(totpCredentials).where(eq(totpCredentials.userId, userId));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
}

export async function hasConfirmedTotp(db: Database, userId: string): Promise<boolean> {
  const [credential] = await db
    .select({ id: totpCredentials.userId })
    .from(totpCredentials)
    .where(and(eq(totpCredentials.userId, userId), sql`${totpCredentials.confirmedAt} IS NOT NULL`))
    .limit(1);
  return Boolean(credential);
}

/**
 * Sets a new password hash.
 *
 * The caller decides which sessions to revoke: the usual policy is "every
 * session except the current one", so resetting a password logs out everyone
 * else without logging the user out mid-flow.
 */
export async function changePassword(
  db: Database,
  input: { userId: string; newPasswordHash: string },
): Promise<User> {
  return updateUser(db, input.userId, { passwordHash: input.newPasswordHash });
}

/* -------------------------------------------------------------------------- */
/* internals                                                                   */
/* -------------------------------------------------------------------------- */

async function consumeRecoveryCode(db: Database, userId: string, code: string): Promise<boolean> {
  const [row] = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return Boolean(row);
}

async function auditLogin(
  db: Database,
  user: User | null,
  input: LoginInput,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await recordAudit(db, {
    actorType: user ? 'user' : 'anonymous',
    actorUserId: user?.id ?? null,
    actorContext: input.context,
    storeId: input.storeId ?? null,
    action,
    targetType: 'user',
    targetId: user?.id ?? null,
    metadata: { emailDomain: input.email.split('@')[1] ?? null, ...metadata },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}
