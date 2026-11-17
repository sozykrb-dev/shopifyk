#!/usr/bin/env node
/**
 * Long-running local PostgreSQL for development and preview environments.
 *
 * Docker is not always available (CI sandboxes, this workspace), so the dev
 * database is an embedded PostgreSQL 18 server that stores its cluster in
 * `.pgdata`. Production and real deployments use `docker-compose.yml` or a
 * managed PostgreSQL -- the application code is identical either way.
 *
 * It is started through `scripts/pg.mjs start` and stopped with
 * `scripts/pg.mjs stop`.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.PGPORT ?? 5433);
const database = process.env.PGDATABASE ?? 'velnorix';
const dataDir = process.env.PGDATA_DIR ?? '.pgdata';
// The cluster lives in its own sub-directory: `dataDir` also holds server.pid
// and server.log, and initdb refuses to initialise a non-empty directory.
const clusterDir = join(dataDir, 'cluster');
const superuser = process.env.PG_SUPERUSER ?? 'postgres';
const superuserPassword = process.env.PG_SUPERUSER_PASSWORD ?? 'postgres';

mkdirSync(clusterDir, { recursive: true });

const server = new EmbeddedPostgres({
  databaseDir: clusterDir,
  user: superuser,
  password: superuserPassword,
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (!existsSync(join(clusterDir, 'PG_VERSION'))) {
  await server.initialise();
}

await server.start();

// Create the application database once; the cluster is reused afterwards.
const admin = postgres(`postgres://${superuser}:${superuserPassword}@127.0.0.1:${port}/postgres`, {
  max: 1,
  onnotice: () => {},
});
const [row] = await admin.unsafe(`SELECT 1 FROM pg_database WHERE datname = '${database}'`);
if (!row) {
  await admin.unsafe(`CREATE DATABASE ${database}`);
}
await admin.end();

console.log(`[pg] ready on 127.0.0.1:${port} (database "${database}", data dir "${dataDir}")`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await server.stop();
  } catch {
    /* already stopped */
  }
  process.exit(0);
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

// Keep the event loop alive without burning CPU.
setInterval(() => {}, 1 << 30);
