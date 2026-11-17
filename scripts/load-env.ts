import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/**
 * Loads `.env` (and `.env.local` when present) for CLI scripts.
 *
 * Next.js loads these files itself, so only the standalone scripts (migrate,
 * reset, seed) need this. Existing environment variables always win, which is
 * what CI and production rely on.
 */
export function loadCliEnv(): void {
  for (const file of ['.env', '.env.local']) {
    const path = join(root, file);
    if (existsSync(path)) config({ path, override: false });
  }
}
