import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { ValidationError } from '@velnorix/core';
import { authEnv } from './env.js';

/**
 * Password hashing with Argon2id.
 *
 * We use a vetted implementation (Rust bindings to the reference argon2) with
 * the OWASP-recommended parameters. Nothing about the crypto is hand-rolled;
 * what this module owns is the *policy*: minimum length, composition rules and
 * the fact that a wrong password costs the same time as a right one.
 */

const ARGON2_OPTIONS = {
  // Argon2id = 2. The library exports it as a `const enum`, which cannot be
  // imported by value under `isolatedModules`, so the numeric id is written
  // out here and asserted below.
  algorithm: 2,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export type PasswordPolicy = {
  minLength: number;
  maxLength: number;
  requireLowercase: boolean;
  requireUppercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  /** Rejects the passwords that show up in every credential-stuffing list. */
  denyList: readonly string[];
};

const COMMON_PASSWORDS = [
  'password',
  'password1',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'iloveyou',
  'velnorix',
  'shopify',
  'admin12345',
  'letmein1234',
];

export const PASSWORD_POLICY: Omit<PasswordPolicy, 'minLength'> & { minLength?: number } = {
  maxLength: 128,
  requireLowercase: true,
  requireUppercase: true,
  requireDigit: true,
  requireSymbol: true,
  denyList: COMMON_PASSWORDS,
};

export type PasswordCheck = { valid: boolean; problems: readonly string[] };

/** Password rules, reported as a list so the UI can show all of them at once. */
export function checkPasswordStrength(password: string): PasswordCheck {
  const minLength = authEnv().PASSWORD_MIN_LENGTH;
  const problems: string[] = [];

  if (password.length < minLength) problems.push(`at least ${minLength} characters`);
  if (password.length > PASSWORD_POLICY.maxLength) {
    problems.push(`at most ${PASSWORD_POLICY.maxLength} characters`);
  }
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (/\p{Nd}/u.test(password) === false) problems.push('a digit');
  if (!/[^A-Za-z0-9\p{Nd}]/u.test(password)) problems.push('a symbol');
  if (/\s/.test(password)) problems.push('no spaces');

  const lowered = password.toLowerCase();
  if (PASSWORD_POLICY.denyList.some((common) => lowered.includes(common))) {
    problems.push('something less predictable');
  }

  return { valid: problems.length === 0, problems };
}

export function assertStrongPassword(password: string): void {
  const check = checkPasswordStrength(password);
  if (!check.valid) {
    throw new ValidationError(`Password must contain ${check.problems.join(', ')}.`);
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertStrongPassword(password);
  return argonHash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password against its hash.
 *
 * A malformed hash, a wrong password and a missing user all return `false` --
 * callers must not be able to tell them apart (see `DUMMY_HASH`).
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await argonVerify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A real Argon2id hash of a random password, used to burn the same CPU time
 * when an account does not exist. Without it, response timing tells an attacker
 * which emails are registered.
 */
let dummyHash: string | null = null;

export async function dummyVerify(): Promise<void> {
  if (!dummyHash) dummyHash = await argonHash(randomPasswordForTiming(), ARGON2_OPTIONS);
  await argonVerify(dummyHash, randomPasswordForTiming(), ARGON2_OPTIONS);
}

function randomPasswordForTiming(): string {
  // Any string works: the point is to spend one Argon2 verification.
  return 'timing-equalisation-password';
}
