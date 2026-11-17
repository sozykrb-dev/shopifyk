import { closeDatabase, runMigrations, syncAppRolePassword } from '@velnorix/db';
import { loadCliEnv } from './load-env.js';

loadCliEnv();

/**
 * Applies every pending migration and syncs the application role's password.
 *
 * Migrations run as the schema owner (DATABASE_MIGRATION_URL), never as the
 * application role: the app role owns nothing and cannot create tables.
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and try again.');
  }

  await runMigrations();
  await syncAppRolePassword();
  await closeDatabase();

  console.log('[db] migrations applied');
}

main().catch((error: unknown) => {
  console.error('[db] migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
