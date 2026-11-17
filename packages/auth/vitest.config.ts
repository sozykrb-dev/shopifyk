import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    // Sessions, MFA and lockout all depend on shared database state.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // 32-byte key, base64. Test-only value; production reads it from KMS/env.
      TOTP_ENCRYPTION_KEY: 'dmVsbm9yaXgtdGVzdC10b3RwLWtleS0zMi1ieXRlcyE=',
    },
  },
});
