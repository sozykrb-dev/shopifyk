import { describe, expect, it } from 'vitest';
import {
  cookieNameForHost,
  sessionAllowedOnHost,
  signInContextForHost,
} from '../src/host-context.js';

describe('signInContextForHost', () => {
  it('signs super admins in on the platform console', () => {
    expect(signInContextForHost('platform')).toBe('super_admin');
  });

  it('signs merchants in on their store admin', () => {
    expect(signInContextForHost('store')).toBe('merchant_owner');
  });

  it('has no login form on an unknown host', () => {
    expect(signInContextForHost('unknown')).toBeNull();
  });
});

describe('cookieNameForHost', () => {
  it('uses separate cookies for the platform console and the store admin', () => {
    const platform = cookieNameForHost('platform');
    const store = cookieNameForHost('store');
    expect(platform).toBeTruthy();
    expect(store).toBeTruthy();
    expect(platform).not.toBe(store);
  });

  it('has no cookie for an unknown host', () => {
    expect(cookieNameForHost('unknown')).toBeNull();
  });
});

describe('sessionAllowedOnHost', () => {
  it('admits super admins and platform staff to the console', () => {
    expect(sessionAllowedOnHost('platform', 'super_admin', { matchesStore: false })).toBe(true);
    expect(sessionAllowedOnHost('platform', 'platform_staff', { matchesStore: false })).toBe(true);
  });

  it('rejects a merchant session presented to the platform console', () => {
    expect(sessionAllowedOnHost('platform', 'merchant_owner', { matchesStore: true })).toBe(false);
    expect(sessionAllowedOnHost('platform', 'merchant_staff', { matchesStore: true })).toBe(false);
  });

  it('rejects a customer session everywhere in the admin', () => {
    expect(sessionAllowedOnHost('platform', 'customer', { matchesStore: false })).toBe(false);
    expect(sessionAllowedOnHost('store', 'customer', { matchesStore: true })).toBe(false);
    expect(sessionAllowedOnHost('unknown', 'customer', { matchesStore: false })).toBe(false);
  });

  it('admits a merchant session only on the store it was minted for', () => {
    expect(sessionAllowedOnHost('store', 'merchant_owner', { matchesStore: true })).toBe(true);
    expect(sessionAllowedOnHost('store', 'merchant_owner', { matchesStore: false })).toBe(false);
    expect(sessionAllowedOnHost('store', 'merchant_staff', { matchesStore: true })).toBe(true);
    expect(sessionAllowedOnHost('store', 'merchant_staff', { matchesStore: false })).toBe(false);
  });

  it('rejects a super admin session presented to a store admin', () => {
    expect(sessionAllowedOnHost('store', 'super_admin', { matchesStore: true })).toBe(false);
    expect(sessionAllowedOnHost('store', 'platform_staff', { matchesStore: true })).toBe(false);
  });

  it('admits nothing on an unknown host', () => {
    for (const context of [
      'super_admin',
      'platform_staff',
      'merchant_owner',
      'merchant_staff',
      'customer',
    ] as const) {
      expect(sessionAllowedOnHost('unknown', context, { matchesStore: true })).toBe(false);
    }
  });
});
