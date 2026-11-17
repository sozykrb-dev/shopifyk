import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncateAllData } from '@velnorix/test-utils';
import {
  assignPlatformRole,
  assignStoreMembership,
  closeDatabase,
  countActiveMembersWithRole,
  createStore,
  createUser,
  findRoleByKey,
  getEffectivePermissions,
  listPermissions,
  listRoles,
  listStoreMembers,
  permissions,
  plans,
  setStoreMemberRole,
  setStoreMemberStatus,
  withPlatform,
  withTenant,
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

  describe('store staff', () => {
    it('changing a role takes effect immediately', async () => {
      /*
       * The point of role-based access: moving someone from `support` to
       * `store_manager` changes what they can do on their very next request.
       * Permissions are re-read per request, so there is no cache to
       * invalidate -- if this test ever needs one, the design has regressed.
       */
      const staff = await withPlatform((db) =>
        createUser(db, { email: 'staff@a.test', fullName: 'Staff', context: 'merchant_staff' }),
      );
      const support = await withPlatform((db) => findRoleByKey(db, 'support'));
      const ownerRole = await withPlatform((db) => findRoleByKey(db, 'store_owner'));
      if (!support || !ownerRole) throw new Error('missing roles');

      await withPlatform((db) =>
        assignStoreMembership(db, { storeId: storeA.id, userId: staff.id, roleId: support.id }),
      );

      const before = await withPlatform((db) =>
        getEffectivePermissions(db, {
          userId: staff.id,
          context: 'merchant_staff',
          storeId: storeA.id,
        }),
      );
      expect(before.has('store:staff.write')).toBe(false);
      expect(before.has('store:settings.write')).toBe(false);

      await withPlatform((db) =>
        setStoreMemberRole(db, {
          storeId: storeA.id,
          userId: staff.id,
          roleId: ownerRole.id,
        }),
      );

      const after = await withPlatform((db) =>
        getEffectivePermissions(db, {
          userId: staff.id,
          context: 'merchant_staff',
          storeId: storeA.id,
        }),
      );
      expect(after.has('store:staff.write')).toBe(true);
      expect(after.has('store:settings.write')).toBe(true);
    });

    it('a disabled member loses every store permission', async () => {
      const staff = await withPlatform((db) =>
        createUser(db, { email: 'gone@a.test', fullName: 'Gone', context: 'merchant_staff' }),
      );
      const manager = await withPlatform((db) => findRoleByKey(db, 'store_manager'));
      if (!manager) throw new Error('missing store_manager role');
      await withPlatform((db) =>
        assignStoreMembership(db, { storeId: storeA.id, userId: staff.id, roleId: manager.id }),
      );

      const changed = await withTenant(storeA.id, (db) =>
        setStoreMemberStatus(db, { storeId: storeA.id, userId: staff.id, status: 'disabled' }),
      );
      expect(changed).toBe(true);

      const granted = await withPlatform((db) =>
        getEffectivePermissions(db, {
          userId: staff.id,
          context: 'merchant_staff',
          storeId: storeA.id,
        }),
      );
      expect(granted.size).toBe(0);
    });

    it('counts active owners so a store can refuse to lose its last one', async () => {
      const first = await withPlatform((db) =>
        createUser(db, { email: 'o1@a.test', fullName: 'Owner One', context: 'merchant_owner' }),
      );
      const second = await withPlatform((db) =>
        createUser(db, { email: 'o2@a.test', fullName: 'Owner Two', context: 'merchant_owner' }),
      );
      const ownerRole = await withPlatform((db) => findRoleByKey(db, 'store_owner'));
      if (!ownerRole) throw new Error('missing store_owner role');

      await withPlatform((db) =>
        assignStoreMembership(db, { storeId: storeA.id, userId: first.id, roleId: ownerRole.id }),
      );
      expect(
        await withTenant(storeA.id, (db) =>
          countActiveMembersWithRole(db, storeA.id, 'store_owner'),
        ),
      ).toBe(1);

      await withPlatform((db) =>
        assignStoreMembership(db, { storeId: storeA.id, userId: second.id, roleId: ownerRole.id }),
      );
      expect(
        await withTenant(storeA.id, (db) =>
          countActiveMembersWithRole(db, storeA.id, 'store_owner'),
        ),
      ).toBe(2);

      // Disabling one owner still leaves one, so the count drops but the store
      // is not orphaned. The action refuses only when the count would hit zero.
      await withTenant(storeA.id, (db) =>
        setStoreMemberStatus(db, { storeId: storeA.id, userId: second.id, status: 'disabled' }),
      );
      expect(
        await withTenant(storeA.id, (db) =>
          countActiveMembersWithRole(db, storeA.id, 'store_owner'),
        ),
      ).toBe(1);
    });

    it("lists one store's members and not the other's", async () => {
      /*
       * Cross-tenant isolation for the staff roster. A leaked roster is a
       * ready-made phishing list, and it is the kind of leak that never gets
       * noticed because nothing visibly breaks.
       */
      const inA = await withPlatform((db) =>
        createUser(db, { email: 'ina@a.test', fullName: 'In A', context: 'merchant_staff' }),
      );
      const inB = await withPlatform((db) =>
        createUser(db, { email: 'inb@b.test', fullName: 'In B', context: 'merchant_staff' }),
      );
      const support = await withPlatform((db) => findRoleByKey(db, 'support'));
      if (!support) throw new Error('missing support role');

      await withPlatform((db) =>
        assignStoreMembership(db, { storeId: storeA.id, userId: inA.id, roleId: support.id }),
      );
      await withPlatform((db) =>
        assignStoreMembership(db, { storeId: storeB.id, userId: inB.id, roleId: support.id }),
      );

      const rosterA = await withTenant(storeA.id, (db) => listStoreMembers(db, storeA.id));
      expect(rosterA.map((member) => member.email)).toEqual(['ina@a.test']);
      // The join brings the display data the console needs, not just an id.
      expect(rosterA[0]?.fullName).toBe('In A');
      expect(rosterA[0]?.roleKey).toBe('support');

      const rosterB = await withTenant(storeB.id, (db) => listStoreMembers(db, storeB.id));
      expect(rosterB.map((member) => member.email)).toEqual(['inb@b.test']);
    });
  });
});
