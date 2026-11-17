import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_ADMIN_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * End-to-end configuration.
 *
 * Playwright starts the admin app itself (`webServer`), so the suite works on a
 * clean checkout without any manual setup. The database must be migrated and
 * seeded first (`pnpm db:migrate && pnpm db:seed`).
 *
 * Browsers are downloaded with `pnpm exec playwright install --with-deps chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'ar-EG',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // RTL layout is exercised by the default (Arabic) locale of the app.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
