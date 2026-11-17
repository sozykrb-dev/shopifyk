import pino, { type Logger, type LoggerOptions } from 'pino';
import { z } from 'zod';
import { ConfigurationError } from './errors.js';

const levelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');

const loggerEnvSchema = z.object({
  LOG_LEVEL: levelSchema,
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/** Keys that must never reach a log sink, in any nesting position. */
const REDACTED_KEYS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'tokenHash',
  'sessionToken',
  'secret',
  'secretEncrypted',
  'apiKey',
  'authorization',
  'cookie',
  'set-cookie',
  'cardNumber',
  'recoveryCode',
  'totpSecret',
];

export type LogContext = {
  requestId?: string;
  actorId?: string;
  actorType?: string;
  storeId?: string;
  [key: string]: unknown;
};

let root: Logger | null = null;

function createRootLogger(): Logger {
  const env = loggerEnvSchema.safeParse(process.env);
  if (!env.success) {
    throw new ConfigurationError(
      `Invalid logging configuration:\n${env.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }

  const isProduction = env.data.NODE_ENV === 'production';
  const isTest = env.data.NODE_ENV === 'test';

  const options: LoggerOptions = {
    level: env.data.LOG_LEVEL,
    base: undefined, // pid/hostname add nothing once every log carries a requestId
    redact: { paths: REDACTED_KEYS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  };

  if (isTest) return pino({ ...options, level: 'silent' });
  if (!isProduction) {
    // Pretty output in dev; structured JSON everywhere else.
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }
  return pino(options);
}

/** Shared root logger. Never log raw credentials through it. */
export function getLogger(): Logger {
  if (!root) root = createRootLogger();
  return root;
}

/** Logger bound to request/tenant/actor context. */
export function logWithContext(context: LogContext): Logger {
  return getLogger().child(context);
}

/** Replaces the root logger (tests). */
export function setLogger(logger: Logger | null): void {
  root = logger;
}
