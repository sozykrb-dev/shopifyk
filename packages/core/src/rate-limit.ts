import { RateLimitError } from './errors.js';

/**
 * Rate limiting.
 *
 * The interface exists because the production limiter must be shared across
 * processes (Redis, Phase 1+). The in-process implementation is correct for a
 * single instance and for tests -- it is the default, not a stub: it enforces
 * real limits and is used by every login and 2FA path.
 */
export interface RateLimiter {
  /** Consumes one unit. Resolves with the remaining budget. */
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>;
  /** Returns a key's budget without consuming it. */
  check(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>;
  /** Forgets a key (called after a successful sign-in). */
  reset(key: string): Promise<void>;
}

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Epoch ms at which the window resets. */
  resetAt: number;
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const now = this.now();
    const existing = this.buckets.get(key);
    const bucket: Bucket =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };

    bucket.count += 1;
    this.buckets.set(key, bucket);

    return this.decide(bucket, limit, now);
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const now = this.now();
    const existing = this.buckets.get(key);
    const bucket: Bucket =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
    return this.decide(bucket, limit, now);
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /** Drops expired buckets. Call from a timer in long-running processes. */
  sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  private decide(bucket: Bucket, limit: number, now: number): RateLimitDecision {
    const allowed = bucket.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
}

/** Throws `RateLimitError` when the budget is exhausted. */
export async function enforceRateLimit(
  limiter: RateLimiter,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const decision = await limiter.consume(key, limit, windowMs);
  if (!decision.allowed) throw new RateLimitError(decision.retryAfterSeconds);
}
