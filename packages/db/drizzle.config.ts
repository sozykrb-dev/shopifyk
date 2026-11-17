import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit is used for ONE thing: generating DDL from `src/schema.ts` so the
 * TypeScript schema and the SQL migrations can never drift apart.
 *
 * Migrations are applied by our own runner (src/migrator.ts) so that the same
 * code path works against the embedded Postgres used in tests and the managed
 * Postgres used in production.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
});
