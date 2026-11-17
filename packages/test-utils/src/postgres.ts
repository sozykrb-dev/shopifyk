import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * A real PostgreSQL for tests.
 *
 * Tenant isolation is enforced by Row-Level Security, so it has to be tested
 * against a real server, with a real non-superuser login role and real
 * `SET LOCAL ROLE` switches. No mocks, no in-memory shims.
 */

export type TestDatabase = {
  port: number;
  database: string;
  /** Connection string for the application role (`velnorix`, cannot bypass RLS). */
  appUrl: string;
  /** Connection string for the schema owner (used to migrate and truncate). */
  ownerUrl: string;
  stop: () => Promise<void>;
};

export type StartOptions = {
  database?: string;
  appRole?: string;
  appPassword?: string;
};

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function startTestDatabase(options: StartOptions = {}): Promise<TestDatabase> {
  const database = options.database ?? 'velnorix_test';
  const appRole = options.appRole ?? 'velnorix';
  const appPassword = options.appPassword ?? 'velnorix';
  const port = await findFreePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'velnorix-pg-'));

  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  await server.initialise();
  await server.start();

  const ownerClient = postgres(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, {
    max: 1,
    onnotice: () => {},
  });
  await ownerClient.unsafe(`CREATE DATABASE ${database}`);
  await ownerClient.end();

  const appUrl = `postgres://${appRole}:${appPassword}@127.0.0.1:${port}/${database}`;
  const ownerUrl = `postgres://postgres:postgres@127.0.0.1:${port}/${database}`;

  return {
    port,
    database,
    appUrl,
    ownerUrl,
    stop: async () => {
      await server.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Empties every table that holds mutable data, keeping the reference data
 * (permissions, system roles, plans and their permission map) installed by
 * migration 0002.
 *
 * It uses DELETE -- not TRUNCATE ... CASCADE -- on purpose: cascading a
 * TRUNCATE of `stores` would also wipe the `roles` and `role_permissions`
 * reference rows, because roles have an ON DELETE CASCADE foreign key to
 * stores. With DELETE, only store-scoped (custom) roles disappear.
 *
 * Runs as the schema owner, because the application roles have no
 * unrestricted DELETE.
 */
export async function truncateAllData(
  ownerUrl = process.env.DATABASE_MIGRATION_URL,
): Promise<void> {
  if (!ownerUrl)
    throw new Error('DATABASE_MIGRATION_URL is not set; is the test database running?');

  const client = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`
      DELETE FROM "audit_logs";
      DELETE FROM "sessions";
      DELETE FROM "recovery_codes";
      DELETE FROM "totp_credentials";
      DELETE FROM "password_reset_tokens";
      DELETE FROM "email_verification_tokens";
      DELETE FROM "products";
      DELETE FROM "store_settings";
      DELETE FROM "store_memberships";
      DELETE FROM "store_domains";
      DELETE FROM "user_platform_roles";
      DELETE FROM "users";
      DELETE FROM "stores";
    `);
  } finally {
    await client.end();
  }
}
