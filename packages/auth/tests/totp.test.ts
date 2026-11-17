import { describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import {
  TOTP_DIGITS,
  TOTP_PERIOD,
  createTotpSetup,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  isReplay,
  verifyTotpCode,
} from '../src/totp.js';

function codeFor(secret: string): string {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
  });
  return totp.generate();
}

describe('TOTP', () => {
  it('creates a base32 seed and an otpauth URI', () => {
    const setup = createTotpSetup('owner@velnorix.test');
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.uri).toContain('issuer=Velnorix');
  });

  it('accepts the current code', () => {
    const setup = createTotpSetup('owner@velnorix.test');
    expect(verifyTotpCode(setup.secret, codeFor(setup.secret))).toBe(true);
  });

  it('rejects a wrong or malformed code', () => {
    const setup = createTotpSetup('owner@velnorix.test');
    const correct = codeFor(setup.secret);
    const wrong = correct === '000000' ? '111111' : '000000';

    expect(verifyTotpCode(setup.secret, wrong)).toBe(false);
    expect(verifyTotpCode(setup.secret, '12345')).toBe(false);
    expect(verifyTotpCode(setup.secret, 'abcdef')).toBe(false);
    expect(verifyTotpCode(setup.secret, '')).toBe(false);
  });

  it('accepts a code with spaces the user typed', () => {
    const setup = createTotpSetup('owner@velnorix.test');
    const code = codeFor(setup.secret);
    expect(verifyTotpCode(setup.secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
  });

  it('encrypts the seed at rest and round-trips it', () => {
    const setup = createTotpSetup('owner@velnorix.test');
    const stored = encryptTotpSecret(setup.secret);
    expect(stored).not.toContain(setup.secret);
    expect(decryptTotpSecret(stored)).toBe(setup.secret);
  });

  it('detects replay inside the acceptance window', () => {
    const now = new Date();
    expect(isReplay(null, now)).toBe(false);
    // Used one second ago -> still inside the same step.
    expect(isReplay(new Date(now.getTime() - 1_000), now)).toBe(true);
    // Used five minutes ago -> outside the window.
    expect(isReplay(new Date(now.getTime() - 5 * 60_000), now)).toBe(false);
  });

  it('hashes recovery codes and never stores them in plain text', () => {
    const { plain, hashes } = generateRecoveryCodes(4);
    expect(plain).toHaveLength(4);
    expect(plain.every((code) => /^\d{10}$/.test(code))).toBe(true);
    expect(hashes.every((hash) => hash !== plain[0]));
    expect(hashRecoveryCode(`  ${plain[0]} `)).toBe(hashRecoveryCode(plain[0]!));
  });
});
