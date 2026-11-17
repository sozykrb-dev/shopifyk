#!/usr/bin/env node
/**
 * Small control script for the local development database:
 *
 *   node scripts/pg.mjs start | stop | status
 *
 * `start` spawns `pg-server.mjs` detached and waits until the port accepts
 * connections, so `pnpm bootstrap` can chain straight into migrations.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const port = Number(process.env.PGPORT ?? 5433);
const dataDir = process.env.PGDATA_DIR ?? join(root, '.pgdata');
const pidFile = join(dataDir, 'server.pid');
const logFile = join(dataDir, 'server.log');

function isRunning() {
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForPort(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.setTimeout(1000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`Postgres did not open port ${port} in time.`));
        else setTimeout(attempt, 300);
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`Postgres did not open port ${port} in time.`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

async function start() {
  if (isRunning()) {
    console.log(
      `[pg] already running (pid ${readFileSync(pidFile, 'utf8').trim()}) on port ${port}`,
    );
    return;
  }

  mkdirSync(dataDir, { recursive: true });
  const out = (await import('node:fs')).openSync(logFile, 'a');
  const child = spawn(process.execPath, [join(here, 'pg-server.mjs')], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));

  await waitForPort();
  console.log(`[pg] started on port ${port} (pid ${child.pid}, logs: ${logFile})`);
}

async function stop() {
  if (!isRunning()) {
    console.log('[pg] not running');
    rmSync(pidFile, { force: true });
    return;
  }
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!isRunning()) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  rmSync(pidFile, { force: true });
  console.log('[pg] stopped');
}

const command = process.argv[2] ?? 'status';
if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (command === 'status')
  console.log(isRunning() ? `[pg] running on port ${port}` : '[pg] stopped');
else {
  console.error(`Unknown command: ${command}. Use start, stop or status.`);
  process.exit(1);
}
