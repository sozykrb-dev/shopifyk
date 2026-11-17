import * as OTPAuth from 'otpauth';

/**
 * Generates the current TOTP code for the seeded demo secret, so the end-to-end
 * suite can complete the mandatory second factor. The secret is the one written
 * by `scripts/seed.ts` (SEED_TOTP_SECRET).
 */
export function currentTotpCode(
  secret = process.env.SEED_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate();
}
