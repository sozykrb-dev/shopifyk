import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getMigrationSqlClient } from './client.js';
import * as schema from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Migrations are plain SQL committed to the repo (generated from
 * `src/schema.ts` by drizzle-kit, plus hand-written migrations for roles/RLS).
 * This runner applies them in order inside a transaction per migration.
 */
export function migrationsFolder(): string {
  if (process.env.DATABASE_MIGRATIONS_DIR) return process.env.DATABASE_MIGRATIONS_DIR;
  // Works both from source (src/) and from a build output directory.
  const candidate = join(here, '..', 'src', 'migrations');
  return existsSync(candidate) ? candidate : join(here, '..', 'migrations');
}

export async function runMigrations(): Promise<void> {
  const client = getMigrationSqlClient();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
}

/**
 * Drops and recreates the public schema, then re-applies every migration.
 * Database roles survive: they are cluster-wide, not database-wide.
 */
export async function resetDatabase(): Promise<void> {
  const client = getMigrationSqlClient();
  await client.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
  `);
  await runMigrations();
}

/**
 * Sets the password of the application role from `DATABASE_URL`.
 *
 * Migrations must not hard-code credentials, so the password lives in the
 * environment only. In production you would rotate it through your secret
 * manager instead.
 */
export async function syncAppRolePassword(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to sync the application role password.');

  const parsed = new URL(url);
  const role = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (!role || !password) return;

  const client = getMigrationSqlClient();
  await client.unsafe(
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}) THEN
         EXECUTE format('ALTER ROLE %I PASSWORD %L', ${literal(role)}, ${literal(password)});
       END IF;
     END
     $$;`,
  );
}

/** Single-quoted SQL literal, safe for use inside a DO block. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
