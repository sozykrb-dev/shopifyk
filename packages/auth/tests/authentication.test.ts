import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from '@velnorix/core';
import { closeDatabase, withPlatform } from '@velnorix/db';
import * as OTPAuth from 'otpauth';
import {
  TOTP_DIGITS,
  TOTP_PERIOD,
  authenticate,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  resolveSession,
  sessionRequiresMfa,
  verifySecondFactor,
} from '../src/index.js';
import {
  TEST_PASSWORD,
  grantPlatformRole,
  grantStoreRole,
  makeStore,
  makeUser,
  resetData,
} from './helpers.js';

function codeFor(secret: string): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
  }).generate();
}

describe('authentication', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('signs a merchant owner into their own store', async () => {
    const store = await makeStore('shop-a');
    const user = await makeUser({ email: 'owner@shop-a.test', context: 'merchant_owner' });
    await grantStoreRole(store.id, user.id, 'store_owner');

    const outcome = await withPlatform((db) =>
      authenticate(
        db,
        {
          email: 'owner@shop-a.test',
          password: TEST_PASSWORD,
          context: 'merchant_owner',
          storeId: store.id,
          ipAddress: '10.0.0.1',
        },
        new InMemoryRateLimiter(),
      ),
    );

    expect(outcome.status).toBe('authenticated');
    if (outcome.status !== 'authenticated') return;
    expect(outcome.session.context).toBe('merchant_owner');
    expect(outcome.session.storeId).toBe(store.id);
    expect(outcome.session.mfaCompletedAt).toBeInstanceOf(Date);

    const resolved = await withPlatform((db) => resolveSession(db, outcome.token));
    expect(resolved?.id).toBe(outcome.session.id);
  });

  it('answers identically for a wrong password and an unknown account', async () => {
    const store = await makeStore('shop-b');
    const user = await makeUser({ email: 'owner@shop-b.test', context: 'merchant_owner' });
    await grantStoreRole(store.id, user.id, 'store_owner');

    const wrongPassword = await withPlatform((db) =>
      authenticate(
        db,
        {
          email: 'owner@shop-b.test',
          password: 'WrongPassword#1',
          context: 'merchant_owner',
        },
        new InMemoryRateLimiter(),
      ),
    );
    const unknownAccount = await withPlatform((db) =>
      authenticate(
        db,
        {
          email: 'nobody@shop-b.test',
          password: TEST_PASSWORD,
          context: 'merchant_owner',
        },
        new InMemoryRateLimiter(),
      ),
    );

    expect(wrongPassword.status).toBe('failed');
    expect(unknownAccount.status).toBe('failed');
    if (wrongPassword.status !== 'failed' || unknownAccount.status !== 'failed') return;
    expect(wrongPassword.error).toEqual(unknownAccount.error);
  });

  it('locks the account after too many failed attempts', async () => {
    const user = await makeUser({ email: 'brute@velnorix.test', context: 'super_admin' });
    await grantPlatformRole(user.id, 'platform_owner');
    let outcome;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      outcome = await withPlatform((db) =>
        authenticate(
          db,
          {
            email: 'brute@velnorix.test',
            password: 'WrongPassword#1',
            context: 'super_admin',
          },
          new InMemoryRateLimiter(),
        ),
      );
    }

    expect(outcome?.status).toBe('failed');
    if (outcome?.status !== 'failed') return;
    expect(outcome.error.code).toBe('account_locked');
  });

  it('refuses a disabled account and an unverified email', async () => {
    const disabled = await makeUser({
      email: 'disabled@velnorix.test',
      context: 'super_admin',
      status: 'disabled',
    });
    void disabled;
    const pending = await makeUser({
      email: 'pending@velnorix.test',
      context: 'super_admin',
      verified: false,
    });
    void pending;

    const disabledOutcome = await withPlatform((db) =>
      authenticate(
        db,
        { email: 'disabled@velnorix.test', password: TEST_PASSWORD, context: 'super_admin' },
        new InMemoryRateLimiter(),
      ),
    );
    expect(disabledOutcome.status).toBe('failed');

    const pendingOutcome = await withPlatform((db) =>
      authenticate(
        db,
        { email: 'pending@velnorix.test', password: TEST_PASSWORD, context: 'super_admin' },
        new InMemoryRateLimiter(),
      ),
    );
    expect(pendingOutcome.status).toBe('failed');
    if (pendingOutcome.status !== 'failed') return;
    expect(pendingOutcome.error.code).toBe('email_not_verified');
  });

  it('never lets a merchant sign in to a store they do not belong to', async () => {
    const storeA = await makeStore('shop-a');
    const storeB = await makeStore('shop-b');
    const user = await makeUser({ email: 'owner@shop-a.test', context: 'merchant_owner' });
    await grantStoreRole(storeA.id, user.id, 'store_owner');

    const outcome = await withPlatform((db) =>
      authenticate(
        db,
        {
          email: 'owner@shop-a.test',
          password: TEST_PASSWORD,
          context: 'merchant_owner',
          storeId: storeB.id,
        },
        new InMemoryRateLimiter(),
      ),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.error.code).toBe('invalid_credentials');
  });

  it('keeps the five authentication contexts separate', async () => {
    const store = await makeStore('shop-a');
    const merchant = await makeUser({ email: 'owner@shop-a.test', context: 'merchant_owner' });
    await grantStoreRole(store.id, merchant.id, 'store_owner');

    // A merchant account cannot be used to sign in to the platform console...
    const asPlatform = await withPlatform((db) =>
      authenticate(
        db,
        { email: 'owner@shop-a.test', password: TEST_PASSWORD, context: 'super_admin' },
        new InMemoryRateLimiter(),
      ),
    );
    expect(asPlatform.status).toBe('failed');

    // ...and a merchant session is refused when a store is attached to a
    // platform login or missing from a customer login.
    const customer = await makeUser({
      email: 'customer@shop-a.test',
      context: 'customer',
      storeId: store.id,
    });
    void customer;

    const customerWithoutStore = await withPlatform((db) =>
      authenticate(
        db,
        { email: 'customer@shop-a.test', password: TEST_PASSWORD, context: 'customer' },
        new InMemoryRateLimiter(),
      ),
    );
    expect(customerWithoutStore.status).toBe('failed');

    const customerInStore = await withPlatform((db) =>
      authenticate(
        db,
        {
          email: 'customer@shop-a.test',
          password: TEST_PASSWORD,
          context: 'customer',
          storeId: store.id,
        },
        new InMemoryRateLimiter(),
      ),
    );
    expect(customerInStore.status).toBe('authenticated');
  });

  it('throttles repeated attempts', async () => {
    const user = await makeUser({ email: 'throttle@velnorix.test', context: 'super_admin' });
    await grantPlatformRole(user.id, 'platform_owner');
    const limiter = new InMemoryRateLimiter();
    let last;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await withPlatform((db) =>
        authenticate(
          db,
          { email: 'throttle@velnorix.test', password: 'WrongPassword#1', context: 'super_admin' },
          limiter,
        ),
      );
    }

    expect(last?.status).toBe('failed');
    if (last?.status !== 'failed') return;
    expect(last.error.code).toBe('rate_limited');
  });

  describe('two-factor authentication', () => {
    it('forces super admins through a second factor', async () => {
      const user = await makeUser({ email: 'owner@velnorix.test', context: 'super_admin' });
      await grantPlatformRole(user.id, 'platform_owner');

      const outcome = await withPlatform((db) =>
        authenticate(
          db,
          { email: 'owner@velnorix.test', password: TEST_PASSWORD, context: 'super_admin' },
          new InMemoryRateLimiter(),
        ),
      );

      expect(outcome.status).toBe('mfa_required');
      if (outcome.status !== 'authenticated' && outcome.status !== 'mfa_required') return;
      expect(outcome.session.mfaCompletedAt).toBeNull();
      expect(sessionRequiresMfa(outcome.session)).toBe(true);
    });

    it('enrols TOTP, then accepts a valid code and rejects a replay', async () => {
      const user = await makeUser({ email: 'mfa@velnorix.test', context: 'super_admin' });
      await grantPlatformRole(user.id, 'platform_owner');

      const setup = await withPlatform((db) =>
        beginTotpEnrollment(db, user.id, 'mfa@velnorix.test'),
      );
      const confirmation = await withPlatform((db) =>
        confirmTotpEnrollment(db, user.id, codeFor(setup.secret)),
      );
      expect(confirmation.ok).toBe(true);
      if (!confirmation.ok) return;
      expect(confirmation.value.recoveryCodes).toHaveLength(8);

      const login = await withPlatform((db) =>
        authenticate(
          db,
          { email: 'mfa@velnorix.test', password: TEST_PASSWORD, context: 'super_admin' },
          new InMemoryRateLimiter(),
        ),
      );
      expect(login.status).toBe('mfa_required');
      if (login.status !== 'mfa_required') return;

      const wrong = await withPlatform((db) =>
        verifySecondFactor(db, { sessionId: login.session.id, userId: user.id, code: '000000' }),
      );
      expect(wrong.ok).toBe(false);

      const code = codeFor(setup.secret);
      const accepted = await withPlatform((db) =>
        verifySecondFactor(
          db,
          { sessionId: login.session.id, userId: user.id, code },
          new InMemoryRateLimiter(),
        ),
      );
      expect(accepted.ok).toBe(true);

      // Same code, same window: rejected as a replay.
      const replay = await withPlatform((db) =>
        verifySecondFactor(
          db,
          { sessionId: login.session.id, userId: user.id, code },
          new InMemoryRateLimiter(),
        ),
      );
      expect(replay.ok).toBe(false);
    });

    it('accepts a recovery code exactly once', async () => {
      const user = await makeUser({ email: 'recovery@velnorix.test', context: 'super_admin' });
      await grantPlatformRole(user.id, 'platform_owner');
      const setup = await withPlatform((db) =>
        beginTotpEnrollment(db, user.id, 'recovery@velnorix.test'),
      );
      const confirmation = await withPlatform((db) =>
        confirmTotpEnrollment(db, user.id, codeFor(setup.secret)),
      );
      if (!confirmation.ok) throw new Error('enrolment failed');
      const [recoveryCode] = confirmation.value.recoveryCodes;
      if (!recoveryCode) throw new Error('no recovery code issued');

      const login = await withPlatform((db) =>
        authenticate(
          db,
          { email: 'recovery@velnorix.test', password: TEST_PASSWORD, context: 'super_admin' },
          new InMemoryRateLimiter(),
        ),
      );
      if (login.status !== 'mfa_required') throw new Error('expected mfa_required');

      const first = await withPlatform((db) =>
        verifySecondFactor(
          db,
          { sessionId: login.session.id, userId: user.id, code: recoveryCode },
          new InMemoryRateLimiter(),
        ),
      );
      expect(first.ok).toBe(true);

      const second = await withPlatform((db) =>
        verifySecondFactor(
          db,
          { sessionId: login.session.id, userId: user.id, code: recoveryCode },
          new InMemoryRateLimiter(),
        ),
      );
      expect(second.ok).toBe(false);
    });
  });
});
