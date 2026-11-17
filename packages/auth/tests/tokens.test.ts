import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  closeDatabase,
  emailVerificationTokens,
  passwordResetTokens,
  withPlatform,
} from '@velnorix/db';
import {
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  createPasswordResetToken,
} from '../src/tokens.js';
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
