#!/usr/bin/env node
/**
 * Prints the current TOTP code for the seeded demo account.
 *
 * The code changes every 30 seconds, so a code written down in a README is
 * already wrong by the time you read it. Run this instead:
 *
 *   pnpm totp
 *
 * It reads SEED_TOTP_SECRET (and TOTP_ISSUER) from the root `.env`, prints the
 * live 6-digit code with the seconds left before it rolls over, and prints the
 * otpauth URI for enrolling the same secret in an authenticator app.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import * as OTPAuth from 'otpauth';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env', '.env.local']) {
  const path = join(root, file);
  if (existsSync(path)) loadDotenv({ path, override: false });
}

const secret = process.env.SEED_TOTP_SECRET;
if (!secret) {
  console.error('SEED_TOTP_SECRET is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const email = process.argv[2] ?? 'owner@velnorix.test';
const issuer = process.env.TOTP_ISSUER ?? 'Velnorix';

const totp = new OTPAuth.TOTP({
  issuer,
  label: email,
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  secret: OTPAuth.Secret.fromBase32(secret),
});

const period = 30;
const secondsLeft = period - (Math.floor(Date.now() / 1000) % period);

console.log('');
console.log(`  الحساب : ${email}`);
console.log(`  الرمز  : ${totp.generate()}   (يتغيّر بعد ${secondsLeft} ثانية)`);
console.log('');
console.log(`  للإضافة في تطبيق المصادقة: ${totp.toString()}`);
console.log('');
