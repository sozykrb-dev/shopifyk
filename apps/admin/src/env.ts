import { envFlag, loadEnv } from '@velnorix/core/env';
import { z } from 'zod';

const ENV_KEY = Symbol('@velnorix/admin');

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATION_URL: z.string().min(1).optional(),
  APP_BASE_DOMAIN: z.string().min(3).default('velnorix.test'),
  /** Host of the platform console, e.g. admin.velnorix.com. */
  ADMIN_BASE_DOMAIN: z.string().min(3).default('admin.velnorix.test'),
  TOTP_ENCRYPTION_KEY: z.string().min(1),
  /**
   * Allows `?__tenant=slug` to pin a store when no wildcard domain is
   * available (local dev, preview deployments). Never enabled in production.
   */
  ALLOW_DEV_TENANT_OVERRIDE: envFlag,
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AdminEnv = z.infer<typeof schema>;

export function adminEnv(): AdminEnv {
  return loadEnv(ENV_KEY, schema);
}

/** True when the deployment may expose the tenant override. */
export function devTenantOverrideEnabled(): boolean {
  return adminEnv().NODE_ENV !== 'production' && adminEnv().ALLOW_DEV_TENANT_OVERRIDE;
}
