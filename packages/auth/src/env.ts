import { loadEnv } from '@velnorix/core/env';
import { z } from 'zod';

const ENV_KEY = Symbol('@velnorix/auth');

const authEnvSchema = z.object({
  /** AES-256-GCM key for TOTP seeds at rest: 32 bytes, base64 or hex. */
  TOTP_ENCRYPTION_KEY: z
    .string()
    .min(1, 'TOTP_ENCRYPTION_KEY is required')
    .transform((value, ctx) => {
      const buffer = Buffer.from(value, 'base64');
      if (buffer.length === 32) return buffer;
      const hex = Buffer.from(value, 'hex');
      if (hex.length === 32) return hex;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex).',
      });
      return z.NEVER;
    }),
  SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(1_800),
  SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(43_200),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  EMAIL_VERIFICATION_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(86_400),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
  TOTP_ISSUER: z.string().min(1).default('Velnorix'),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export function authEnv(): AuthEnv {
  return loadEnv(ENV_KEY, authEnvSchema);
}
