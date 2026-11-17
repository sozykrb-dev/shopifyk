import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter, enforceRateLimit } from '../src/rate-limit.js';
import { RateLimitError } from '../src/errors.js';

describe('InMemoryRateLimiter', () => {
  it('allows up to the limit then blocks', async () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i += 1) {
      await expect(limiter.consume('login:1.2.3.4', 3, 60_000)).resolves.toMatchObject({
        allowed: true,
      });
    }
    const blocked = await limiter.consume('login:1.2.3.4', 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('isolates keys', async () => {
    const limiter = new InMemoryRateLimiter();
    await limiter.consume('a', 1, 60_000);
    await expect(limiter.consume('b', 1, 60_000)).resolves.toMatchObject({ allowed: true });
  });

  it('resets after a successful sign-in', async () => {
    const limiter = new InMemoryRateLimiter();
    await limiter.consume('user:1', 1, 60_000);
    await limiter.reset('user:1');
    await expect(limiter.consume('user:1', 1, 60_000)).resolves.toMatchObject({ allowed: true });
  });

  it('expires the window', async () => {
    let now = 1_000_000;
    const limiter = new InMemoryRateLimiter(() => now);
    await limiter.consume('k', 1, 1_000);
    await expect(limiter.consume('k', 1, 1_000)).resolves.toMatchObject({ allowed: false });
    now += 2_000;
    await expect(limiter.consume('k', 1, 1_000)).resolves.toMatchObject({ allowed: true });
  });

  it('throws RateLimitError through enforceRateLimit', async () => {
    const limiter = new InMemoryRateLimiter();
    await enforceRateLimit(limiter, 'k', 1, 60_000);
    await expect(enforceRateLimit(limiter, 'k', 1, 60_000)).rejects.toBeInstanceOf(RateLimitError);
  });
});
