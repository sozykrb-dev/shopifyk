import { closeDatabase, resetDatabase } from '@velnorix/db';
import { loadCliEnv } from './load-env.js';

loadCliEnv();

/**
 * Destroys and rebuilds the public schema, then re-applies every migration.
 * Database roles survive (they are cluster-wide), reference data is restored.
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  if (process.env.NODE_ENV === 'production' && !force) {
    throw new Error('Refusing to reset a production database without --force.');
  }

  await resetDatabase();
  await closeDatabase();
  console.log('[db] schema reset and migrations re-applied');
}

main().catch((error: unknown) => {
  console.error('[db] reset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
