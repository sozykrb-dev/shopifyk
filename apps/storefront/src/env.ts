import { envFlag, loadEnv } from '@velnorix/core/env';
import { z } from 'zod';

const ENV_KEY = Symbol('@velnorix/storefront');

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_BASE_DOMAIN: z.string().min(3).default('velnorix.test'),
  ALLOW_DEV_TENANT_OVERRIDE: envFlag,
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type StorefrontEnv = z.infer<typeof schema>;

export function storefrontEnv(): StorefrontEnv {
  return loadEnv(ENV_KEY, schema);
}

export function devTenantOverrideEnabled(): boolean {
  const env = storefrontEnv();
  return env.NODE_ENV !== 'production' && env.ALLOW_DEV_TENANT_OVERRIDE;
}
