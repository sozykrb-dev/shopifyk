import {
  decryptSecret,
  encryptSecret,
  randomBase32,
  randomNumericCode,
  sha256Hex,
} from '@velnorix/core';
import * as OTPAuth from 'otpauth';
import { authEnv } from './env.js';

/**
 * TOTP (RFC 6238) two-factor authentication.
 *
 * The library implements the algorithm; this module owns the policy:
 *  - 6 digits, 30-second period, SHA-1 (what every authenticator app expects);
 *  - one step of clock-drift tolerance in each direction;
 *  - seeds encrypted at rest with the platform key, never stored in plaintext;
 *  - a used code cannot be replayed within its window (the caller persists
 *    `lastUsedAt` and rejects an identical code, see `isReplay`).
 */

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD = 30;
/** Accepts one step before and one step after the current one (+-30s). */
export const TOTP_WINDOW = 1;

export type TotpSetup = {
  /** Base32 seed, shown once so the user can type it manually. */
  secret: string;
  /** otpauth:// URI for QR codes. */
  uri: string;
};

function totpFor(secret: string, accountLabel: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: authEnv().TOTP_ISSUER,
    label: accountLabel,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/** Generates a new seed plus the URI that authenticator apps scan. */
export function createTotpSetup(accountLabel: string): TotpSetup {
  const secret = randomBase32(20);
  return { secret, uri: totpFor(secret, accountLabel).toString() };
}

/** Verifies a 6-digit code with clock-drift tolerance. */
export function verifyTotpCode(secret: string, code: string, accountLabel = 'velnorix'): boolean {
  const normalised = code.replace(/\D/g, '');
  if (normalised.length !== TOTP_DIGITS) return false;

  const delta = totpFor(secret, accountLabel).validate({ token: normalised, window: TOTP_WINDOW });
  return delta !== null;
}

/** Encrypts a seed before it is written to the database. */
export function encryptTotpSecret(secret: string): string {
  return encryptSecret(secret, authEnv().TOTP_ENCRYPTION_KEY);
}

export function decryptTotpSecret(stored: string): string {
  return decryptSecret(stored, authEnv().TOTP_ENCRYPTION_KEY);
}

/**
 * A code that was already accepted in the same window must not be accepted
 * again: `lastUsedAt` is compared against the start of the current step.
 */
export function isReplay(lastUsedAt: Date | null, now: Date = new Date()): boolean {
  if (!lastUsedAt) return false;
  const stepStart = Math.floor(now.getTime() / 1000 / TOTP_PERIOD) * TOTP_PERIOD * 1000;
  const previousStepStart = stepStart - TOTP_WINDOW * TOTP_PERIOD * 1000;
  return lastUsedAt.getTime() >= previousStepStart;
}

/* -------------------------------------------------------------------------- */
/* Recovery codes                                                              */
/* -------------------------------------------------------------------------- */

export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_CODE_LENGTH = 10;

/** Generates plain codes (returned once) and their hashes (stored). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): {
  plain: string[];
  hashes: string[];
} {
  const plain = Array.from({ length: count }, () => randomNumericCode(RECOVERY_CODE_LENGTH));
  return { plain, hashes: plain.map((code) => hashRecoveryCode(code)) };
}

export function hashRecoveryCode(code: string): string {
  return sha256Hex(code.replace(/\D/g, ''));
}
