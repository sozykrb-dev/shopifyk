import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncateAllData } from '@velnorix/test-utils';
import {
  closeDatabase,
  createStore,
  createUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  plans,
  recordFailedLogin,
  recordSuccessfulLogin,
  updateUser,
  withPlatform,
  type Store,
} from '../src/index.js';

describe('users repository', () => {
  let store: Store;

  beforeEach(async () => {
    await truncateAllData();
    store = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'trial'));
      if (!plan) throw new Error('missing trial plan');
      return createStore(db, { slug: 'cairo', name: 'Cairo Store', planId: plan.id });
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('normalises emails for lookup', async () => {
    const created = await withPlatform((db) =>
      createUser(db, {
        email: '  Ahmed@Example.com ',
        fullName: 'Ahmed',
        context: 'merchant_owner',
      }),
    );
    expect(created.email).toBe('Ahmed@Example.com');

    const found = await withPlatform((db) => findUserByEmail(db, 'ahmed@example.com'));
    expect(found?.id).toBe(created.id);
  });

  it('enforces global uniqueness for platform and merchant accounts', async () => {
    await withPlatform((db) =>
      createUser(db, { email: 'owner@velnorix.test', fullName: 'Owner', context: 'super_admin' }),
    );

    await expect(
      withPlatform((db) =>
        createUser(db, {
          email: 'owner@velnorix.test',
          fullName: 'Impostor',
          context: 'platform_staff',
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuses a customer account without a store and a merchant account with one', async () => {
    await expect(
      withPlatform((db) =>
        createUser(db, { email: 'x@y.test', fullName: 'X', context: 'customer' }),
      ),
    ).rejects.toThrow(/scoped to a store/);

    await expect(
      withPlatform((db) =>
        createUser(db, {
          email: 'y@z.test',
          fullName: 'Y',
          context: 'merchant_owner',
          storeId: store.id,
        }),
      ),
    ).rejects.toThrow(/Only customer accounts/);
  });

  it('looks up users only within the requested context', async () => {
    await withPlatform((db) =>
      createUser(db, {
        email: 'dual@velnorix.test',
        fullName: 'Dual',
        context: 'merchant_owner',
      }),
    );

    expect(
      await withPlatform((db) => findUserByEmail(db, 'dual@velnorix.test', 'merchant_owner')),
    ).not.toBeNull();
    expect(
      await withPlatform((db) => findUserByEmail(db, 'dual@velnorix.test', 'super_admin')),
    ).toBeNull();
  });

  it('locks an account after too many failed attempts and clears it on success', async () => {
    const user = await withPlatform((db) =>
      createUser(db, { email: 'brute@velnorix.test', fullName: 'Brute', context: 'super_admin' }),
    );

    const first = await withPlatform((db) => recordFailedLogin(db, user.id, 5, 60_000));
    expect(first.attempts).toBe(1);
    expect(first.lockedUntil).toBeNull();

    let outcome = first;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      outcome = await withPlatform((db) => recordFailedLogin(db, user.id, 5, 60_000));
    }
    expect(outcome.attempts).toBe(5);
    expect(outcome.lockedUntil).toBeInstanceOf(Date);
    expect(outcome.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    await withPlatform((db) => recordSuccessfulLogin(db, user.id));
    const reloaded = await withPlatform((db) => findUserById(db, user.id));
    expect(reloaded?.failedLoginAttempts).toBe(0);
    expect(reloaded?.lockedUntil).toBeNull();
    expect(reloaded?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('activates the account when the email is verified', async () => {
    const user = await withPlatform((db) =>
      createUser(db, { email: 'new@velnorix.test', fullName: 'New', context: 'merchant_owner' }),
    );
    expect(user.status).toBe('pending_verification');

    const verified = await withPlatform((db) => markEmailVerified(db, user.id));
    expect(verified.status).toBe('active');
    expect(verified.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('updates mutable profile fields', async () => {
    const user = await withPlatform((db) =>
      createUser(db, { email: 'edit@velnorix.test', fullName: 'Old', context: 'platform_staff' }),
    );
    const updated = await withPlatform((db) =>
      updateUser(db, user.id, { fullName: 'New', preferredLocale: 'en' }),
    );
    expect(updated.fullName).toBe('New');
    expect(updated.preferredLocale).toBe('en');
  });
});
