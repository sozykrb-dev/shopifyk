import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // A real Postgres is required: RLS cannot be tested against a mock.
    globalSetup: ['./tests/global-setup.ts'],
    // One real database, one schema: test files must not race each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  },
});
