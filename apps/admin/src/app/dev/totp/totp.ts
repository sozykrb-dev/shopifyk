import * as OTPAuth from 'otpauth';

/**
 * The current 6-digit code for the seeded demo account (server side only).
 *
 * `pnpm totp` on the command line does the same thing.
 */
export const SEED_TOTP_PERIOD = 30;

let cached: OTPAuth.TOTP | null = null;

function totpForSeed(): OTPAuth.TOTP {
  const secret = process.env.SEED_TOTP_SECRET;
  if (!secret) {
    throw new Error('SEED_TOTP_SECRET is not set.');
  }
  cached ??= new OTPAuth.TOTP({
    issuer: process.env.TOTP_ISSUER ?? 'Velnorix',
    label: process.env.DEV_TOTP_EMAIL ?? 'owner@velnorix.test',
    algorithm: 'SHA1',
    digits: 6,
    period: SEED_TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return cached;
}

export function currentSeedTotpCode(): string {
  return totpForSeed().generate();
}

export function secondsUntilNextCode(): number {
  return SEED_TOTP_PERIOD - (Math.floor(Date.now() / 1000) % SEED_TOTP_PERIOD);
}
