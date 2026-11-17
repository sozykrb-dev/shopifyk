import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'متجر على Velnorix',
  description: 'متجر سريع، متعدد اللغات، يعمل بالجنيه المصري.',
};

/**
 * Storefront root layout.
 *
 * `dir` and `lang` are set per store (the store's default locale) through the
 * `StoreTheme` component in the page, because the store is only known after the
 * tenant has been resolved.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          Fonts are loaded from the CDN at runtime rather than through
          `next/font`, so a build (or CI) never needs network access.
        */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
