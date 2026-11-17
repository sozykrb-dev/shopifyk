import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDatabase, users, withPlatform } from '@velnorix/db';
import { registerCustomer, verifyCustomerEmail } from '../src/index.js';
import { TEST_PASSWORD, makeStore, resetData } from './helpers.js';

/**
 * Customer registration is the front door of every store, and it leaks in a
 * specific way when done carelessly: "this email is already registered" is a
 * membership oracle. These tests pin the rule that both outcomes -- brand-new
 * address and existing address -- are indistinguishable to the caller.
 */
describe('customer registration', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('creates a pending-verification customer scoped to the store', async () => {
    const store = await makeStore('reg-shop');

    const result = await withPlatform((db) =>
      registerCustomer(db, {
        storeId: store.id,
        email: 'newbie@example.com',
        password: TEST_PASSWORD,
        fullName: 'عميل جديد',
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verificationToken).toBeTruthy();

    const row = await withPlatform((db) =>
      db.query.users.findFirst({
        where: (fields, { eq }) => eq(fields.email, 'newbie@example.com'),
      }),
    );
    expect(row?.context).toBe('customer');
    expect(row?.storeId).toBe(store.id);
    expect(row?.status).toBe('pending_verification');
    expect(row?.emailVerifiedAt).toBeNull();
  });

  it('never reveals whether the address is already registered', async () => {
    const store = await makeStore('reg-shop');

    const first = await withPlatform((db) =>
      registerCustomer(db, {
        storeId: store.id,
        email: 'taken@example.com',
        password: TEST_PASSWORD,
        fullName: 'First',
      }),
    );
    expect(first.ok).toBe(true);

    const second = await withPlatform((db) =>
      registerCustomer(db, {
        storeId: store.id,
        email: 'TAKEN@example.com', // case-insensitive, like the index
        password: TEST_PASSWORD,
        fullName: 'Second Attempt',
      }),
    );

    // Same shape of answer, and no token: nothing was created or emailed.
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.verificationToken).toBeNull();

    const rows = await withPlatform((db) =>
      db.select().from(users).where(eq(users.email, 'taken@example.com')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fullName).toBe('First');
  });

  it('is a separate account from the same address on another store', async () => {
    const storeA = await makeStore('shop-a');
    const storeB = await makeStore('shop-b');

    await withPlatform((db) =>
      registerCustomer(db, {
        storeId: storeA.id,
        email: 'shared@example.com',
        password: TEST_PASSWORD,
        fullName: 'At A',
      }),
    );
    const result = await withPlatform((db) =>
      registerCustomer(db, {
        storeId: storeB.id,
        email: 'shared@example.com',
        password: TEST_PASSWORD,
        fullName: 'At B',
      }),
    );

    // A customer belongs to one store: the same person must register again
    // there, and gets a fresh verification token.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verificationToken).toBeTruthy();

    // Per store: the row for shop B is a different account, not the same one.
    const [b] = await withPlatform((db) =>
      db
        .select()
        .from(users)
        .where(and(eq(users.email, 'shared@example.com'), eq(users.storeId, storeB.id))),
    );
    expect(b?.fullName).toBe('At B');
  });

  it('activates the account once, and refuses to replay the token', async () => {
    const store = await makeStore('reg-shop');
    const result = await withPlatform((db) =>
      registerCustomer(db, {
        storeId: store.id,
        email: 'verify@example.com',
        password: TEST_PASSWORD,
        fullName: 'Verify Me',
      }),
    );
    if (!result.ok || !result.value.verificationToken) throw new Error('no token');
    const token = result.value.verificationToken;

    const first = await withPlatform((db) => verifyCustomerEmail(db, token));
    expect(first.ok).toBe(true);

    const row = await withPlatform((db) =>
      db.query.users.findFirst({
        where: (fields, { eq }) => eq(fields.email, 'verify@example.com'),
      }),
    );
    expect(row?.status).toBe('active');
    expect(row?.emailVerifiedAt).toBeInstanceOf(Date);

    // A verification link must be single-use: forwarding it must not work.
    const replay = await withPlatform((db) => verifyCustomerEmail(db, token));
    expect(replay.ok).toBe(false);
  });

  it('rejects a weak password before touching the database', async () => {
    const store = await makeStore('reg-shop');

    const result = await withPlatform((db) =>
      registerCustomer(db, {
        storeId: store.id,
        email: 'weak@example.com',
        password: '123',
        fullName: 'Weak',
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('weak_password');

    const rows = await withPlatform((db) =>
      db.select().from(users).where(eq(users.email, 'weak@example.com')),
    );
    expect(rows).toHaveLength(0);
  });
});
