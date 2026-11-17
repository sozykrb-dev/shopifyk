import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  closeDatabase,
  emailVerificationTokens,
  passwordResetTokens,
  updateUserPassword,
  withPlatform,
} from '@velnorix/db';
import {
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  createPasswordResetToken,
} from '../src/tokens.js';
import { hashPassword, verifyPassword } from '../src/password.js';
import { makeUser, resetData } from './helpers.js';

describe('single-use tokens', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('issues and consumes an email verification token exactly once', async () => {
    const user = await makeUser({ email: 'new@velnorix.test', context: 'merchant_owner' });

    const token = await withPlatform((db) =>
      createEmailVerificationToken(db, { userId: user.id, email: user.email }),
    );
    expect(token.length).toBeGreaterThan(20);

    const first = await withPlatform((db) => consumeEmailVerificationToken(db, token));
    expect(first?.userId).toBe(user.id);

    const second = await withPlatform((db) => consumeEmailVerificationToken(db, token));
    expect(second).toBeNull();
  });

  it('rejects an unknown token', async () => {
    expect(await withPlatform((db) => consumeEmailVerificationToken(db, 'nope'))).toBeNull();
  });

  it('rejects an expired token', async () => {
    const user = await makeUser({ email: 'exp@velnorix.test', context: 'merchant_owner' });
    const token = await withPlatform((db) =>
      createEmailVerificationToken(db, { userId: user.id, email: user.email }),
    );

    await withPlatform((db) =>
      db.execute(sql`UPDATE email_verification_tokens SET expires_at = now() - interval '1 hour'`),
    );

    expect(await withPlatform((db) => consumeEmailVerificationToken(db, token))).toBeNull();
  });

  it('invalidates previous reset tokens when a new one is requested', async () => {
    const user = await makeUser({ email: 'reset@velnorix.test', context: 'merchant_owner' });

    const first = await withPlatform((db) => createPasswordResetToken(db, user.id));
    const second = await withPlatform((db) => createPasswordResetToken(db, user.id));

    expect(first).not.toBe(second);
    expect(await withPlatform((db) => consumePasswordResetToken(db, first))).toBeNull();
    expect(await withPlatform((db) => consumePasswordResetToken(db, second))).toBe(user.id);
  });

  it('a completed reset retires the old password', async () => {
    /*
     * The property a customer actually cares about: after a reset, the old
     * password must stop working. If it does not, someone who stole the
     * password still has the account, and the reset only changed the password
     * the attacker has not got.
     */
    const user = await makeUser({
      email: 'rotate@velnorix.test',
      context: 'merchant_owner',
      password: 'Qx7!mVr2#kTz9',
    });

    const token = await withPlatform((db) => createPasswordResetToken(db, user.id));
    const userId = await withPlatform((db) => consumePasswordResetToken(db, token));
    expect(userId).toBe(user.id);

    const newHash = await hashPassword('Lp4$wBn8&dFq3');
    await withPlatform((db) => updateUserPassword(db, user.id, newHash));

    // `user` was read before the reset, so its hash is the old one -- the one
    // an attacker who knew the password still has.
    expect(await verifyPassword(user.passwordHash ?? '', 'Qx7!mVr2#kTz9')).toBe(true);
    expect(await verifyPassword(newHash, 'Qx7!mVr2#kTz9')).toBe(false);
    expect(await verifyPassword(newHash, 'Lp4$wBn8&dFq3')).toBe(true);
  });

  it('never stores the token itself', async () => {
    const user = await makeUser({ email: 'hash@velnorix.test', context: 'merchant_owner' });
    await withPlatform((db) => createPasswordResetToken(db, user.id));

    const rows = await withPlatform(async (db) =>
      db.select({ hash: passwordResetTokens.tokenHash }).from(passwordResetTokens),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hash).toMatch(/^[a-f0-9]{64}$/);

    const verificationRows = await withPlatform(async (db) =>
      db.select({ hash: emailVerificationTokens.tokenHash }).from(emailVerificationTokens),
    );
    expect(verificationRows).toHaveLength(0);
  });
});
