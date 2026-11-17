import { startTestDatabase, type TestDatabase } from '@velnorix/test-utils';
import { closeDatabase, runMigrations, syncAppRolePassword } from '../src/index.js';

/**
 * One real PostgreSQL per test run:
 *
 *   DATABASE_URL             -> the `velnorix` login role (NOBYPASSRLS), what
 *                               the application itself uses;
 *   DATABASE_MIGRATION_URL   -> the schema owner, used to migrate and truncate.
 *
 * Testing isolation with the superuser would prove nothing, so the app role is
 * the one every repository runs as.
 */
let database: TestDatabase | null = null;

export async function setup(): Promise<void> {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.appUrl;
  process.env.DATABASE_MIGRATION_URL = database.ownerUrl;

  await runMigrations();
  await syncAppRolePassword();
  await closeDatabase();
}

export async function teardown(): Promise<void> {
  await closeDatabase();
  await database?.stop();
  database = null;
}
