import Link from 'next/link';
import {
  Activity,
  LayoutDashboard,
  LogOut,
  Package,
  ScrollText,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { Avatar, AvatarFallback, Badge, Button, Separator } from '@velnorix/ui';
import { signOutAction } from '@/app/actions/auth.js';
import { DirectionToggle, ThemeToggle } from '@/components/theme-controls.js';
import type { Principal } from '@velnorix/auth';

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PLATFORM_NAV: NavItem[] = [
  { href: '/', label: 'نظرة عامة', icon: LayoutDashboard },
  { href: '/stores', label: 'المتاجر', icon: Store },
  { href: '/audit', label: 'سجل التدقيق', icon: ScrollText },
  { href: '/system', label: 'صحة النظام', icon: Activity },
];

const STORE_NAV: NavItem[] = [
  { href: '/', label: 'نظرة عامة', icon: LayoutDashboard },
  { href: '/products', label: 'المنتجات', icon: Package },
];

const ROLE_LABELS: Record<Principal['context'], string> = {
  super_admin: 'مالك المنصة',
  platform_staff: 'موظف منصة',
  merchant_owner: 'مالك المتجر',
  merchant_staff: 'موظف متجر',
  customer: 'عميل',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * Admin shell: dense but calm.
 *
 * Navigation is derived from the request context (platform console vs store
 * admin), so a merchant never sees a link to a platform page and vice versa --
 * and every page behind those links re-checks permissions on the server.
 */
export function AppShell({
  principal,
  storeName,
  activePath,
  children,
}: {
  principal: Principal;
  storeName?: string | null;
  activePath: string;
  children: React.ReactNode;
}) {
  const nav =
    principal.context === 'merchant_owner' || principal.context === 'merchant_staff'
      ? STORE_NAV
      : PLATFORM_NAV;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-e bg-card lg:flex lg:flex-col">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Velnorix</span>
        </div>

        <nav aria-label="القائمة الرئيسية" className="flex-1 space-y-1 p-3">
          {nav.map((item) => {
            const active = activePath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Separator />
        <div className="p-3">
          <div className="flex items-center gap-3 rounded-md border p-3">
            <Avatar>
              <AvatarFallback>{initials(principal.fullName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{principal.fullName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {ROLE_LABELS[principal.context]}
              </p>
            </div>
          </div>
          <form action={signOutAction} className="mt-3">
            <Button type="submit" variant="outline" size="sm" className="w-full">
              <LogOut aria-hidden="true" />
              تسجيل الخروج
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b bg-card/60 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{storeName ?? 'لوحة المنصة'}</span>
            {principal.mfaCompleted ? null : <Badge tone="warning">بانتظار المصادقة</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <DirectionToggle />
            <ThemeToggle />
            <form action={signOutAction} className="lg:hidden">
              <Button type="submit" variant="ghost" size="icon" aria-label="تسجيل الخروج">
                <LogOut aria-hidden="true" />
              </Button>
            </form>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
