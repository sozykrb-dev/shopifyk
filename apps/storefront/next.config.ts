import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * The monorepo keeps its environment in the root `.env`, but Next only reads
 * the one next to the app. Load it explicitly so `pnpm dev` works after a
 * single `pnpm bootstrap`; real environment variables (CI, production) win.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const file of ['.env', '.env.local']) {
  const path = join(root, file);
  if (existsSync(path)) loadDotenv({ path, override: false });
}

import type { NextConfig } from 'next';

const previewOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native/platform packages must stay outside the server bundle.
  serverExternalPackages: ['postgres', '@node-rs/argon2', 'pino', 'pino-pretty'],
  transpilePackages: [
    '@velnorix/ui',
    '@velnorix/core',
    '@velnorix/db',
    '@velnorix/auth',
    '@velnorix/payments',
    '@velnorix/pricing',
  ],
  poweredByHeader: false,
  allowedDevOrigins: [...previewOrigins, '*.e2b.app', '*.e2b.dev', 'localhost'],
  images: {
    // Store images are served from the S3-compatible bucket in front of the CDN.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
    formats: ['image/avif', 'image/webp'],
  },
  webpack: (config, { isServer }) => {
    // Native and platform packages must stay `require()`d at runtime instead of
    // being traced into the bundle (a `.node` binary cannot be webpacked).
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals]),
        '@node-rs/argon2',
        'postgres',
        'pino',
        'pino-pretty',
      ];
    }

    // The workspace packages are consumed as TypeScript source and import each
    // other with ESM `.js` specifiers (what `tsc` emits for `./button` in
    // `./button.tsx`). Teach webpack the same mapping, per-file.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
