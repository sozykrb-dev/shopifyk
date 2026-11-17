import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `e2e/**` is the Playwright suite; it is not run by vitest.
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
