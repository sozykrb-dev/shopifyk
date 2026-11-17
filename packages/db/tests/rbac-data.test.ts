import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncateAllData } from '@velnorix/test-utils';
import {
  assignPlatformRole,
  assignStoreMembership,
  closeDatabase,
  createStore,
  createUser,
  findRoleByKey,
  getEffectivePermissions,
  listPermissions,
  listRoles,
  permissions,
  plans,
  withPlatform,
  type Store,
} from '../src/index.js';

describe('RBAC data', () => {
  let storeA: Store;
  let storeB: Store;

  beforeEach(async () => {
    await truncateAllData();
    await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'growth'));
      if (!plan) throw new Error('missing growth plan');
      storeA = await createStore(db, { slug: 'store-a', name: 'A', planId: plan.id });
      storeB = await createStore(db, { slug: 'store-b', name: 'B', planId: plan.id });
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('ships a permission catalogue and system roles', async () => {
    const catalogue = await withPlatform(listPermissions);
    expect(catalogue.length).toBeGreaterThan(20);
    expect(catalogue.every((permission) => permission.key.includes(':'))).toBe(true);

    const platformRoles = await withPlatform((db) => listRoles(db, 'platform'));
    expect(platformRoles.map((role) => role.key)).toEqual(
      expect.arrayContaining(['platform_owner', 'platform_support', 'platform_finance']),
    );
  });

  it('gives the store owner every store-scoped permission', async () => {
    const owner = await withPlatform((db) =>
      createUser(db, { email: 'owner@a.test', fullName: 'Owner', context: 'merchant_owner' }),
    );
    const role = await withPlatform((db) => findRoleByKey(db, 'store_owner'));
    if (!role) throw new Error('missing store_owner role');
    await withPlatform((db) =>
      assignStoreMembership(db, { storeId: storeA.id, userId: owner.id, roleId: role.id }),
    );

    const granted = await withPlatform((db) =>
      getEffectivePermissions(db, {
        userId: owner.id,
        context: 'merchant_owner',
        storeId: storeA.id,
      }),
    );

    const allStorePermissions = await withPlatform(async (db) => {
      const rows = await db
        .select({ key: permissions.key })
        .from(permissions)
        .where(eq(permissions.group, 'products'));
      return rows.map((row) => row.key);
    });

    for (const key of allStorePermissions) expect(granted.has(key)).toBe(true);
    expect(granted.has('platform:tenants.suspend')).toBe(false);
  });

  it('does not leak permissions from one store to another', async () => {
    const manager = await withPlatform((db) =>
      createUser(db, { email: 'manager@a.test', fullName: 'Manager', context: 'merchant_staff' }),
    );
    const role = await withPlatform((db) => findRoleByKey(db, 'support'));
    if (!role) throw new Error('missing support role');
    await withPlatform((db) =>
      assignStoreMembership(db, { storeId: storeA.id, userId: manager.id, roleId: role.id }),
    );

    const inA = await withPlatform((db) =>
      getEffectivePermissions(db, {
        userId: manager.id,
        context: 'merchant_staff',
        storeId: storeA.id,
      }),
    );
    const inB = await withPlatform((db) =>
      getEffectivePermissions(db, {
        userId: manager.id,
        context: 'merchant_staff',
        storeId: storeB.id,
      }),
    );

    expect(inA.has('store:orders.read')).toBe(true);
    expect(inB.size).toBe(0);
  });

  it('gives customers no administrative permissions at all', async () => {
    const customer = await withPlatform((db) =>
      createUser(db, {
        email: 'customer@a.test',
        fullName: 'Customer',
        context: 'customer',
        storeId: storeA.id,
      }),
    );

    const granted = await withPlatform((db) =>
      getEffectivePermissions(db, {
        userId: customer.id,
        context: 'customer',
        storeId: storeA.id,
      }),
    );
    expect(granted.size).toBe(0);
  });

  it('maps platform roles to platform permissions only', async () => {
    const finance = await withPlatform((db) =>
      createUser(db, {
        email: 'finance@velnorix.test',
        fullName: 'Finance',
        context: 'platform_staff',
      }),
    );
    const role = await withPlatform((db) => findRoleByKey(db, 'platform_finance'));
    if (!role) throw new Error('missing platform_finance role');
    await withPlatform((db) => assignPlatformRole(db, { userId: finance.id, roleId: role.id }));

    const granted = await withPlatform((db) =>
      getEffectivePermissions(db, { userId: finance.id, context: 'platform_staff' }),
    );

    expect(granted.has('platform:billing.read')).toBe(true);
    expect(granted.has('platform:tenants.suspend')).toBe(false);
  });
});
