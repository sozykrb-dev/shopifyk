import {
  Activity,
  LayoutDashboard,
  Package,
  Receipt,
  Users,
  Settings,
  Tags,
  ScrollText,
  ShoppingBag,
  Store,
  type LucideIcon,
} from 'lucide-react';
import type { Principal } from '@velnorix/auth';

/**
 * Admin navigation, as data.
 *
 * Which links exist is a function of the authentication context alone: a
 * merchant must never be handed a link to a platform page, and platform staff
 * have no business in a store's catalogue. Every page behind these links
 * re-checks permissions on the server -- hiding a link is a courtesy, not a
 * control (see ADR 0005).
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const OVERVIEW: NavItem = { href: '/', label: 'نظرة عامة', icon: LayoutDashboard };

const PLATFORM_NAV: readonly NavItem[] = [
  OVERVIEW,
  { href: '/stores', label: 'المتاجر', icon: Store },
  { href: '/audit', label: 'سجل التدقيق', icon: ScrollText },
  { href: '/billing', label: 'الفوترة', icon: Receipt },
  { href: '/system', label: 'صحة النظام', icon: Activity },
];

const STORE_NAV: readonly NavItem[] = [
  OVERVIEW,
  { href: '/orders', label: 'الطلبات', icon: ShoppingBag },
  { href: '/products', label: 'المنتجات', icon: Package },
  { href: '/pricing', label: 'التسعير', icon: Tags },
  { href: '/staff', label: 'فريق العمل', icon: Users },
  { href: '/settings', label: 'الإعدادات', icon: Settings },
];

export function isStoreContext(context: Principal['context']): boolean {
  return context === 'merchant_owner' || context === 'merchant_staff';
}

export function visibleNavItems(context: Principal['context']): readonly NavItem[] {
  // A customer has no admin surface at all: the storefront owns that context.
  if (context === 'customer') return [];
  return isStoreContext(context) ? STORE_NAV : PLATFORM_NAV;
}

const ROLE_LABELS: Record<Principal['context'], string> = {
  super_admin: 'مالك المنصة',
  platform_staff: 'موظف منصة',
  merchant_owner: 'مالك المتجر',
  merchant_staff: 'موظف متجر',
  customer: 'عميل',
};

export function roleLabel(context: Principal['context']): string {
  return ROLE_LABELS[context];
}

/** Two letters from the display name, for the avatar fallback. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}
