#!/usr/bin/env node
/**
 * `pnpm bootstrap` -- the one command that takes a clean clone to a running
 * platform with demo data:
 *
 *   1. install dependencies
 *   2. create .env (with a freshly generated encryption key)
 *   3. start PostgreSQL (Docker Compose when available, embedded otherwise)
 *   4. apply migrations
 *   5. seed demo accounts and two stores
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    console.error(`\n[bootstrap] command failed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return result;
}

function hasDocker() {
  const probe = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return probe.status === 0;
}

function ensureEnvFile() {
  if (existsSync(join(root, '.env'))) {
    console.log('[bootstrap] .env already exists, keeping it.');
    return;
  }
  const template = readFileSync(join(root, '.env.example'), 'utf8');
  const key = randomBytes(32).toString('base64');
  writeFileSync(
    join(root, '.env'),
    template.replace(/^TOTP_ENCRYPTION_KEY=.*$/m, `TOTP_ENCRYPTION_KEY=${key}`),
  );
  console.log('[bootstrap] created .env with a fresh TOTP encryption key.');
}

console.log('[bootstrap] 1/5 installing dependencies…');
run('pnpm', ['install']);

console.log('[bootstrap] 2/5 preparing environment…');
ensureEnvFile();

console.log('[bootstrap] 3/5 starting PostgreSQL…');
if (hasDocker()) {
  run('docker', ['compose', 'up', '-d', 'postgres']);
  console.log('[bootstrap] using docker compose (postgres on 5432).');
  console.log('[bootstrap] note: set PGPORT=5432 and the matching DATABASE_URL in .env.');
} else {
  run(process.execPath, ['scripts/pg.mjs', 'start']);
}

console.log('[bootstrap] 4/5 applying migrations…');
run('pnpm', ['db:migrate']);

console.log('[bootstrap] 5/5 seeding demo data…');
run('pnpm', ['db:seed']);

console.log('\n[bootstrap] done. Start the apps with:');
console.log('  pnpm dev            # admin on :3000, storefront on :3001');
console.log('\n  Platform console: http://localhost:3000 (or admin.<domain>)');
console.log('  Store admin:      add ?__tenant=cairo-sneakers to any URL');
console.log('  Storefront:       http://localhost:3001/?__tenant=cairo-sneakers\n');
