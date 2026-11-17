import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { ValidationError } from './errors.js';

/**
 * Crypto helpers.
 *
 * Nothing here implements a primitive: everything delegates to Node's OpenSSL
 * bindings. What this module owns is the *policy* -- token length, encoding,
 * hashing before storage, constant-time comparison.
 */

/** Cryptographically random URL-safe token (default: 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Base32 without padding -- the alphabet TOTP secrets use. */
export function randomBase32(bytes = 20): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const buffer = randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

/** Random numeric code as a zero-padded string (recovery codes, email OTPs). */
export function randomNumericCode(length = 10): string {
  if (length < 6 || length > 32) throw new ValidationError('Code length must be between 6 and 32.');
  let output = '';
  for (let i = 0; i < length; i += 1) output += randomInt(0, 10).toString();
  return output;
}

/** Lowercase hex SHA-256. Used to store tokens/secrets so a DB leak is not a session leak. */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** URL-safe base64 SHA-256 -- shorter, used where the value ends up in a URL. */
export function sha256Base64Url(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('base64url');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * AES-256-GCM envelope encryption for secrets at rest (gateway credentials,
 * TOTP seeds). Key comes from env/KMS -- never from the database.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string, key: Buffer): string {
  assertKey(key);
  const parts = payload.split('.');
  if (parts.length !== 3) throw new ValidationError('Malformed encrypted payload.');
  const [iv, tag, ciphertext] = parts as [string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new ValidationError('Encryption key must be exactly 32 bytes (AES-256).');
  }
}

/** UUIDv4. Used for row ids; ids are random so they are never guessable. */
export function newId(): string {
  return randomUUID();
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}
