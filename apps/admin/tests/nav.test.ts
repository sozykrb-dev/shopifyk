import { describe, expect, it } from 'vitest';
import { initials, isStoreContext, roleLabel, visibleNavItems } from '../src/lib/nav.js';

/**
 * The admin shell's navigation is derived from the authentication context, so
 * the rule that matters -- a merchant must never see a platform link, and a
 * customer has no admin surface at all -- is testable without rendering
 * anything. (Hiding a link is a courtesy; every page still checks permissions
 * on the server.)
 */
describe('admin navigation', () => {
  it('gives platform contexts the platform links only', () => {
    for (const context of ['super_admin', 'platform_staff'] as const) {
      const hrefs = visibleNavItems(context).map((item) => item.href);
      expect(hrefs).toContain('/stores');
      expect(hrefs).toContain('/audit');
      expect(hrefs).not.toContain('/products');
      expect(hrefs).not.toContain('/orders');
    }
  });

  it('gives merchant contexts the store links only', () => {
    for (const context of ['merchant_owner', 'merchant_staff'] as const) {
      const hrefs = visibleNavItems(context).map((item) => item.href);
      expect(hrefs).toContain('/products');
      expect(hrefs).toContain('/orders');
      expect(hrefs).not.toContain('/stores');
      expect(hrefs).not.toContain('/audit');
      expect(hrefs).not.toContain('/system');
    }
  });

  it('shows a customer no admin surface at all', () => {
    expect(visibleNavItems('customer')).toHaveLength(0);
  });

  it('starts every context on the overview page', () => {
    for (const context of [
      'super_admin',
      'platform_staff',
      'merchant_owner',
      'merchant_staff',
    ] as const) {
      expect(visibleNavItems(context)[0]?.href).toBe('/');
    }
  });

  it('classifies the contexts', () => {
    expect(isStoreContext('merchant_owner')).toBe(true);
    expect(isStoreContext('merchant_staff')).toBe(true);
    expect(isStoreContext('super_admin')).toBe(false);
    expect(isStoreContext('customer')).toBe(false);
  });

  it('labels every context in Arabic', () => {
    expect(roleLabel('super_admin')).toBe('مالك المنصة');
    expect(roleLabel('merchant_owner')).toBe('مالك المتجر');
    expect(roleLabel('customer')).toBe('عميل');
  });

  it('derives at most two initials, and survives odd input', () => {
    expect(initials('Ahmed Ziad')).toBe('AZ');
    expect(initials('  nour   ali   hassan ')).toBe('NA');
    expect(initials('')).toBe('');
    expect(initials('   ')).toBe('');
  });
});
