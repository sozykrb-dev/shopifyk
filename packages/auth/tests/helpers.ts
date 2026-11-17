import { eq } from 'drizzle-orm';
import {
  assignPlatformRole,
  assignStoreMembership,
  createStore,
  createUser,
  findRoleByKey,
  markEmailVerified,
  plans,
  updateUser,
  withPlatform,
  type Store,
  type User,
} from '@velnorix/db';
import { truncateAllData } from '@velnorix/test-utils';
import { hashPassword } from '../src/password.js';

/** Password used by every demo/test account. Strong enough to pass the policy. */
export const TEST_PASSWORD = 'Sahara!Dune#2026';

export async function resetData(): Promise<void> {
  await truncateAllData();
}

export async function planId(key = 'starter'): Promise<string> {
  return withPlatform(async (db) => {
    const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, key));
    if (!plan) throw new Error(`missing plan ${key}`);
    return plan.id;
  });
}

export async function makeStore(slug: string, name = slug): Promise<Store> {
  const plan = await planId();
  return withPlatform((db) => createStore(db, { slug, name, planId: plan }));
}

export type MakeUserInput = {
  email: string;
  context: User['context'];
  storeId?: string | null;
  fullName?: string;
  password?: string;
  verified?: boolean;
  status?: User['status'];
};

export async function makeUser(input: MakeUserInput): Promise<User> {
  return withPlatform(async (db) => {
    const created = await createUser(db, {
      email: input.email,
      fullName: input.fullName ?? input.email,
      context: input.context,
      storeId: input.storeId ?? null,
      passwordHash: await hashPassword(input.password ?? TEST_PASSWORD),
    });
    // `markEmailVerified` activates the account, so an explicit status (for
    // example `disabled`) has to be applied afterwards.
    const verified = input.verified === false ? created : await markEmailVerified(db, created.id);
    return input.status ? updateUser(db, verified.id, { status: input.status }) : verified;
  });
}

/** Grants a store role (e.g. `store_owner`, `support`) to a merchant user. */
export async function grantStoreRole(
  storeId: string,
  userId: string,
  roleKey = 'store_owner',
): Promise<void> {
  await withPlatform(async (db) => {
    const role = await findRoleByKey(db, roleKey);
    if (!role) throw new Error(`missing role ${roleKey}`);
    await assignStoreMembership(db, { storeId, userId, roleId: role.id });
  });
}

export async function grantPlatformRole(userId: string, roleKey = 'platform_owner'): Promise<void> {
  await withPlatform(async (db) => {
    const role = await findRoleByKey(db, roleKey);
    if (!role) throw new Error(`missing role ${roleKey}`);
    await assignPlatformRole(db, { userId, roleId: role.id });
  });
}

/** A fresh limiter per test, so one test's lockout cannot leak into another. */
export { InMemoryRateLimiter } from '@velnorix/core';
