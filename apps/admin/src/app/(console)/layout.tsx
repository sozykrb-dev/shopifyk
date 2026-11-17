import { headers } from 'next/headers';
import { AppShell } from '@/components/app-shell.js';
import { requirePrincipal } from '@/lib/session.js';
import { TENANT_HEADERS } from '@/lib/tenant-headers.js';
import { resolveStore } from '@/lib/tenant.js';

/**
 * Console layout (platform console and store admin).
 *
 * `requirePrincipal()` is the authorisation gate for every page underneath it:
 * no session -> /login, pending MFA -> /mfa, wrong context -> /login.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { principal, context } = await requirePrincipal();
  const store = await resolveStore(context);
  const headerList = await headers();
  const pathname = headerList.get(TENANT_HEADERS.pathname) ?? '/';

  return (
    <AppShell principal={principal} storeName={store?.name} activePath={pathname}>
      {children}
    </AppShell>
  );
}
