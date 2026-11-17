import { z } from 'zod';
import { ConfigurationError } from './errors.js';

/**
 * Environment loading helpers.
 *
 * Every app loads its env ONCE through `loadEnv` so a misconfigured deployment
 * fails at boot with a readable list of problems instead of at 3am with an
 * `undefined` in the middle of a payment.
 */

export type EnvSource = Record<string, string | undefined>;

const cache = new Map<symbol, unknown>();

/**
 * Validates `source` (defaults to `process.env`) against `schema` and caches the
 * result. Unknown keys are ignored on purpose: hosting platforms inject dozens
 * of variables we do not care about.
 */
export function loadEnv<S extends z.ZodTypeAny>(
  key: symbol,
  schema: S,
  source: EnvSource = process.env,
): z.infer<S> {
  if (cache.has(key)) return cache.get(key) as z.infer<S>;

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigurationError(`Invalid environment configuration:\n${problems}`);
  }

  cache.set(key, parsed.data);
  return parsed.data;
}

/** Clears the env cache. Only useful in tests. */
export function resetEnvCache(): void {
  cache.clear();
}

/** `true`/`1`/`yes`/`on` (case-insensitive) -> true, anything else -> false. */
export const envFlag = z.union([z.boolean(), z.string(), z.undefined()]).transform((value, ctx) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined) return false;
  const normalised = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(normalised)) return false;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: `expected a boolean, got "${value}"` });
  return z.NEVER;
});

/** Comma separated list -> trimmed array, with empty entries removed. */
export const envList = (defaultValue: string[] = []) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? defaultValue
        : value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
    );

/** Port that accepts both a number and a numeric string. */
export const envPort = (defaultValue: number) =>
  z.coerce.number().int().min(1).max(65535).default(defaultValue);

/** Postgres/Redis style connection string with a sanity check. */
export const envUrl = z.string().refine((value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, 'must be a valid URL');
