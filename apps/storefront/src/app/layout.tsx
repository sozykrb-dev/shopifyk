import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@velnorix/ui';
import './globals.css';
import { StoreHeader } from '@/components/store-header.js';
import { getStorefrontContext, resolveStoreWithSettings } from '@/lib/tenant.js';

export const metadata: Metadata = {
  title: { default: 'متجر على Velnorix', template: '%s · Velnorix' },
  description: 'متجر سريع، متعدد اللغات، يعمل بالجنيه المصري.',
};

/**
 * Storefront root layout.
 *
 * Arabic-first and RTL by default; a store can flip direction through its own
 * settings. The theme accent colour is injected as one CSS variable, so the
 * whole design system follows it without a rebuild.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const context = await getStorefrontContext();
  const resolved = await resolveStoreWithSettings(context);
  const locale = resolved?.settings?.locale ?? resolved?.store.defaultLocale ?? 'ar';

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        {/*
          Fonts are loaded from the CDN at runtime rather than through
          `next/font`, so a build (or CI) never needs network access.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {resolved ? (
          <StoreHeader storeName={resolved.store.name} storeSlug={resolved.store.slug}>
            {children}
          </StoreHeader>
        ) : (
          <>
            <header className="border-b bg-card">
              <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
                <Link href="/" className="text-sm font-semibold tracking-tight">
                  Velnorix
                </Link>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/">ابدأ متجرك</Link>
                </Button>
              </div>
            </header>
            {children}
          </>
        )}
      </body>
    </html>
  );
}
