import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationError } from '@velnorix/core';
import { closeDatabase, withPlatform } from '@velnorix/db';
import {
  PERMISSION,
  assertCan,
  assertContext,
  assertStoreAccess,
  can,
  canAll,
  canAny,
  loadPrincipal,
} from '../src/index.js';
import { grantPlatformRole, grantStoreRole, makeStore, makeUser, resetData } from './helpers.js';

describe('RBAC engine', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  async function principalFor(
    userId: string,
    context: 'super_admin' | 'merchant_owner' | 'merchant_staff' | 'customer',
    storeId: string | null = null,
  ) {
    return withPlatform((db) =>
      loadPrincipal(db, { userId, context, storeId, sessionId: 'session-id', mfaCompleted: true }),
    );
  }

  it('grants a store owner every store permission', async () => {
    const store = await makeStore('shop-a');
    const user = await makeUser({ email: 'owner@shop-a.test', context: 'merchant_owner' });
    await grantStoreRole(store.id, user.id, 'store_owner');

    const principal = await principalFor(user.id, 'merchant_owner', store.id);
    expect(principal).not.toBeNull();
    if (!principal) return;

    expect(can(principal, PERMISSION.STORE_PRODUCTS_WRITE)).toBe(true);
    expect(can(principal, PERMISSION.STORE_PRODUCTS_DELETE)).toBe(true);
    expect(can(principal, PERMISSION.PLATFORM_TENANTS_SUSPEND)).toBe(false);
  });

  it('limits a support role to what it was granted', async () => {
    const store = await makeStore('shop-a');
    const user = await makeUser({ email: 'support@shop-a.test', context: 'merchant_staff' });
    await grantStoreRole(store.id, user.id, 'support');

    const principal = await principalFor(user.id, 'merchant_staff', store.id);
    if (!principal) throw new Error('principal missing');

    expect(can(principal, PERMISSION.STORE_DASHBOARD_READ)).toBe(true);
    expect(can(principal, PERMISSION.STORE_PRODUCTS_READ)).toBe(true);
    expect(can(principal, PERMISSION.STORE_PRODUCTS_WRITE)).toBe(false);
    expect(can(principal, PERMISSION.STORE_STAFF_WRITE)).toBe(false);

    expect(() => assertCan(principal, PERMISSION.STORE_PRODUCTS_WRITE)).toThrow(AuthorizationError);
    expect(() => assertCan(principal, PERMISSION.STORE_DASHBOARD_READ)).not.toThrow();
  });

  it('supports any/all combinations', async () => {
    const store = await makeStore('shop-a');
    const user = await makeUser({ email: 'support@shop-a.test', context: 'merchant_staff' });
    await grantStoreRole(store.id, user.id, 'support');
    const principal = await principalFor(user.id, 'merchant_staff', store.id);
    if (!principal) throw new Error('principal missing');

    expect(
      canAny(principal, [PERMISSION.STORE_PRODUCTS_WRITE, PERMISSION.STORE_PRODUCTS_READ]),
    ).toBe(true);
    expect(
      canAll(principal, [PERMISSION.STORE_PRODUCTS_WRITE, PERMISSION.STORE_PRODUCTS_READ]),
    ).toBe(false);
  });

  it('refuses cross-store access for merchant principals', async () => {
    const storeA = await makeStore('shop-a');
    const storeB = await makeStore('shop-b');
    const user = await makeUser({ email: 'owner@shop-a.test', context: 'merchant_owner' });
    await grantStoreRole(storeA.id, user.id, 'store_owner');

    const principal = await principalFor(user.id, 'merchant_owner', storeA.id);
    if (!principal) throw new Error('principal missing');

    expect(() => assertStoreAccess(principal, storeA.id)).not.toThrow();
    expect(() => assertStoreAccess(principal, storeB.id)).toThrow(AuthorizationError);
  });

  it('lets platform principals act on any store but only in platform routes', async () => {
    const store = await makeStore('shop-a');
    const user = await makeUser({ email: 'admin@velnorix.test', context: 'super_admin' });
    await grantPlatformRole(user.id, 'platform_owner');

    const principal = await principalFor(user.id, 'super_admin', null);
    if (!principal) throw new Error('principal missing');

    expect(() => assertStoreAccess(principal, store.id)).not.toThrow();
    expect(() => assertContext(principal, ['super_admin', 'platform_staff'])).not.toThrow();
    expect(() => assertContext(principal, ['merchant_owner'])).toThrow(AuthorizationError);
    expect(can(principal, PERMISSION.PLATFORM_AUDIT_READ)).toBe(true);
  });

  it('gives customers no administrative permissions', async () => {
    const store = await makeStore('shop-a');
    const customer = await makeUser({
      email: 'customer@shop-a.test',
      context: 'customer',
      storeId: store.id,
    });

    const principal = await principalFor(customer.id, 'customer', store.id);
    if (!principal) throw new Error('principal missing');

    expect(principal.permissions.size).toBe(0);
    expect(can(principal, PERMISSION.STORE_PRODUCTS_READ)).toBe(false);
  });

  it('returns null for a user that no longer exists', async () => {
    expect(await principalFor('00000000-0000-4000-8000-000000000000', 'super_admin')).toBeNull();
  });
});
