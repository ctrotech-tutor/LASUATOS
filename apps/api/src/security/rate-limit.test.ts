import { describe, expect, it, vi } from 'vitest';
import {
  MemoryRateLimitStore,
  RateLimiter,
  rateLimitKey,
  type RateLimitStore,
} from './rate-limit.js';

const start = new Date('2026-11-10T09:00:00.000Z');
const at = (milliseconds: number) => new Date(start.getTime() + milliseconds);

describe('rate-limit key', () => {
  it('is a stable SHA-256 digest that never contains the raw subject', () => {
    const key = rateLimitKey('auth.login:email', 'amina@example.net');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(rateLimitKey('auth.login:email', 'amina@example.net'));
    expect(key).not.toContain('amina');
  });

  it('separates policies that share a subject', () => {
    expect(rateLimitKey('auth.login:ip', '10.0.0.1')).not.toBe(rateLimitKey('auth.register:ip', '10.0.0.1'));
  });
});

describe('memory rate-limit store', () => {
  it('counts within a fixed window and starts a new window once it expires', async () => {
    const store = new MemoryRateLimitStore();
    await expect(store.hit('k', 60_000, at(0))).resolves.toEqual({ count: 1, resetAt: at(60_000) });
    await expect(store.hit('k', 60_000, at(59_999))).resolves.toEqual({ count: 2, resetAt: at(60_000) });
    await expect(store.hit('k', 60_000, at(60_000))).resolves.toEqual({ count: 1, resetAt: at(120_000) });
  });

  it('keeps memory bounded by evicting the oldest windows', async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 3 });
    for (const key of ['a', 'b', 'c', 'd']) await store.hit(key, 60_000, at(0));
    expect(store.size).toBe(3);
    // `a` was evicted, so it starts again at 1.
    await expect(store.hit('a', 60_000, at(1))).resolves.toMatchObject({ count: 1 });
  });
});

describe('rate limiter', () => {
  const rule = (name: string, limit: number, windowMilliseconds = 60_000) => ({
    name,
    subject: 'subject',
    limit,
    windowMilliseconds,
  });

  it('allows requests up to the limit and reports Retry-After once exceeded', async () => {
    let now = at(0);
    const limiter = new RateLimiter({ store: new MemoryRateLimitStore(), now: () => now });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(limiter.consume([rule('login', 3)])).resolves.toEqual({ allowed: true });
    }
    now = at(15_000);
    await expect(limiter.consume([rule('login', 3)])).resolves.toEqual({
      allowed: false,
      rule: 'login',
      retryAfterSeconds: 45,
    });
    now = at(60_000);
    await expect(limiter.consume([rule('login', 3)])).resolves.toEqual({ allowed: true });
  });

  it('counts every rule and reports the one with the longest wait', async () => {
    const store = new MemoryRateLimitStore();
    const hit = vi.spyOn(store, 'hit');
    const limiter = new RateLimiter({ store, now: () => at(0) });
    const rules = [rule('short', 1, 60_000), rule('long', 1, 3_600_000)];
    await limiter.consume(rules);
    await expect(limiter.consume(rules)).resolves.toEqual({ allowed: false, rule: 'long', retryAfterSeconds: 3_600 });
    expect(hit).toHaveBeenCalledTimes(4);
  });

  it('allows an empty rule set without touching the store', async () => {
    const store: RateLimitStore = { hit: vi.fn() };
    await expect(new RateLimiter({ store }).consume([])).resolves.toEqual({ allowed: true });
    expect(store.hit).not.toHaveBeenCalled();
  });

  it('fails open and reports store errors so sign-in and check-in stay available', async () => {
    const onStoreError = vi.fn();
    const failure = new Error('database unavailable');
    const limiter = new RateLimiter({ store: { hit: async () => { throw failure; } }, onStoreError });
    await expect(limiter.consume([rule('login', 1)])).resolves.toEqual({ allowed: true });
    expect(onStoreError).toHaveBeenCalledWith(failure);
  });
});
