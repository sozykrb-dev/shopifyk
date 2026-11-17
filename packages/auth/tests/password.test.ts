import { describe, expect, it } from 'vitest';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../src/password.js';

describe('password hashing', () => {
  it('hashes with argon2id and verifies the right password', async () => {
    const hash = await hashPassword('Sahara!Dune#2026');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('Velnorix');
    await expect(verifyPassword(hash, 'Sahara!Dune#2026')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Sahara!Dune#2026');
    await expect(verifyPassword(hash, 'Sahara!Dune#2026o')).resolves.toBe(false);
  });

  it('produces a different hash every time (salted)', async () => {
    const a = await hashPassword('Sahara!Dune#2026');
    const b = await hashPassword('Sahara!Dune#2026');
    expect(a).not.toBe(b);
  });

  it('returns false for a malformed or empty hash instead of throwing', async () => {
    await expect(verifyPassword('', 'whatever')).resolves.toBe(false);
    await expect(verifyPassword('$argon2id$garbage', 'whatever')).resolves.toBe(false);
  });
});

describe('password policy', () => {
  it('requires length, case, digit and symbol', () => {
    const weak = checkPasswordStrength('short');
    expect(weak.valid).toBe(false);
    expect(weak.problems.join(' ')).toMatch(/lowercase|uppercase|digit|symbol|characters/);

    expect(checkPasswordStrength('Sahara!Dune#2026').valid).toBe(true);
  });

  it('rejects common passwords and spaces', () => {
    expect(checkPasswordStrength('Velnorix12345!').valid).toBe(false);
    expect(checkPasswordStrength('Velnorix#2026 Demo').valid).toBe(false);
  });

  it('refuses to hash a weak password', async () => {
    await expect(hashPassword('password')).rejects.toThrow(/Password must contain/);
  });
});
