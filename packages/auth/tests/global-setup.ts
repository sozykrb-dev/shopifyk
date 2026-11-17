import { startTestDatabase, type TestDatabase } from '@velnorix/test-utils';
import { closeDatabase, runMigrations, syncAppRolePassword } from '@velnorix/db';

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
