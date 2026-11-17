import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  isUuid,
  newId,
  randomBase32,
  randomNumericCode,
  randomToken,
  sha256Hex,
} from '../src/crypto.js';

describe('crypto helpers', () => {
  it('generates unique high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => randomToken()));
    expect(tokens.size).toBe(1000);
    expect(randomToken()).toHaveLength(43); // 32 bytes -> base64url
  });

  it('hashes deterministically', () => {
    expect(sha256Hex('velnorix')).toBe(sha256Hex('velnorix'));
    expect(sha256Hex('velnorix')).not.toBe(sha256Hex('Velnorix'));
    expect(sha256Hex('velnorix')).toHaveLength(64);
  });

  it('compares in constant time', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('produces TOTP-compatible base32 secrets', () => {
    const secret = randomBase32(20);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret).toHaveLength(32);
  });

  it('produces zero-padded numeric codes', () => {
    const code = randomNumericCode(10);
    expect(code).toMatch(/^\d{10}$/);
  });

  it('encrypts and decrypts secrets with AES-256-GCM', () => {
    const key = randomBytes(32);
    const payload = encryptSecret('sk_live_super_secret', key);
    expect(payload).not.toContain('sk_live');
    expect(decryptSecret(payload, key)).toBe('sk_live_super_secret');
  });

  it('fails closed on tampered ciphertext and wrong keys', () => {
    const key = randomBytes(32);
    const payload = encryptSecret('secret', key);
    const [iv, tag, ciphertext] = payload.split('.');
    const flipped = `${iv}.${tag}.${ciphertext?.slice(0, -2)}AA`;
    expect(() => decryptSecret(flipped, key)).toThrow();
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
    expect(() => encryptSecret('x', randomBytes(16))).toThrow();
  });

  it('creates uuids', () => {
    expect(isUuid(newId())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
