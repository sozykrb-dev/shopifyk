import { ShieldCheck } from 'lucide-react';
import { ThemeToggle, DirectionToggle } from '@/components/theme-controls.js';

/**
 * Authentication shell: no navigation, no sidebars, one focused card.
 * The store name (when signing in on a store host) is filled in by the page.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <div className="flex w-full max-w-md items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Velnorix</span>
        </div>
        <div className="flex items-center gap-1">
          <DirectionToggle />
          <ThemeToggle />
        </div>
      </div>
      {children}
      <p className="max-w-md text-center text-xs text-muted-foreground">
        جميع محاولات الدخول تُسجَّل في سجل التدقيق. الدخول إلى لوحة المنصة يتطلب مصادقة ثنائية.
      </p>
    </main>
  );
}
