import type { Metadata, Viewport } from 'next';
import { ToastProvider, ToastViewport } from '@velnorix/ui';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Velnorix',
    template: '%s · Velnorix',
  },
  description: 'لوحة تحكم Velnorix — إدارة المتجر والمنصة',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout.
 *
 * Arabic-first: the document defaults to `dir="rtl"` and `lang="ar"`, and the
 * interface flips direction through logical CSS properties only. The font is
 * loaded from the CDN by the browser (not at build time), so a build never
 * depends on network access.
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
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <ToastProvider swipeDirection="left" duration={5000}>
          {children}
          <ToastViewport />
        </ToastProvider>
      </body>
    </html>
  );
}
