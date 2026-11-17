import { loadEnv } from '@velnorix/core/env';
import { z } from 'zod';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const ENV_KEY = Symbol('@velnorix/db');

const envSchema = z.object({
  /**
   * Connection used by the application: MUST be a role that owns nothing and
   * cannot bypass RLS (`velnorix`).
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /**
   * Connection used by migrations: the schema owner. Falls back to
   * DATABASE_URL for local development where the superuser is used directly.
   */
  DATABASE_MIGRATION_URL: z.string().min(1).optional(),
  /** Root domain used to build `{slug}.<APP_BASE_DOMAIN>` storefront hosts. */
  APP_BASE_DOMAIN: z.string().min(3).default('velnorix.test'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(600).default(20),
  DATABASE_SSL: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === 'require'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type DatabaseEnv = z.infer<typeof envSchema>;

export function dbEnv(): DatabaseEnv {
  return loadEnv(ENV_KEY, envSchema);
}

export type Database = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | null = null;
let database: Database | null = null;

/**
 * The raw postgres.js client.
 *
 * This is internal on purpose: application code must go through `withTenant` /
 * `withPlatform` (see tenant-context.ts), which is the only place that decides
 * which database role a query runs as.
 */
export function getSqlClient(): postgres.Sql {
  if (client) return client;
  const env = dbEnv();

  client = postgres(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    idle_timeout: env.DATABASE_IDLE_TIMEOUT_SECONDS,
    connect_timeout: 10,
    ssl: env.DATABASE_SSL ? 'require' : false,
    // Notices are noise; errors are logged by the caller with context.
    onnotice: () => {},
  });

  return client;
}

/** Drizzle handle bound to the shared pool. Prefer the scoped helpers. */
export function getDatabase(): Database {
  if (database) return database;
  database = drizzle(getSqlClient(), { schema });
  return database;
}

/**
 * Separate pool for migrations, connected as the schema owner.
 * Only `scripts/migrate.ts` and `scripts/reset.ts` touch this.
 */
let migrationClient: postgres.Sql | null = null;

export function getMigrationSqlClient(): postgres.Sql {
  if (migrationClient) return migrationClient;
  const env = dbEnv();
  const url = env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL;
  migrationClient = postgres(url, {
    max: 1,
    connect_timeout: 10,
    ssl: env.DATABASE_SSL ? 'require' : false,
    onnotice: () => {},
  });
  return migrationClient;
}

/** Closes every pool. Used by scripts and tests. */
export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    database = null;
  }
  if (migrationClient) {
    await migrationClient.end({ timeout: 5 });
    migrationClient = null;
  }
}
