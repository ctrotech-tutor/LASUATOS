import { describe, expect, it } from 'vitest';
import { RateLimiter, type RateLimitStore } from '../security/rate-limit.js';
import type { OperatorAlert } from './alerts.js';
import { RateLimitStoreAlarm, STORE_FAILURE_THRESHOLD } from './store-failures.js';

function setup() {
  let now = new Date('2026-11-10T08:00:00Z');
  const raised: OperatorAlert[] = [];
  const alarm = new RateLimitStoreAlarm({ alerts: { report: async (alert) => { raised.push(alert); return 'emailed'; } }, now: () => now });
  return { alarm, raised, advance: (minutes: number) => { now = new Date(now.getTime() + minutes * 60_000); } };
}

const outage = Object.assign(new Error('connect ECONNREFUSED postgresql://user:secret@db/x'), { name: 'DatabaseError' });

describe('rate-limit store alarm (ADR 036)', () => {
  it('ignores scattered blips and alerts when failures pile up within five minutes', async () => {
    const { alarm, raised, advance } = setup();
    for (let index = 0; index < 10; index += 1) {
      await alarm.failed(outage);
      advance(2);
    }
    expect(raised).toHaveLength(0);
    for (let index = 0; index < STORE_FAILURE_THRESHOLD - 1; index += 1) {
      await alarm.failed(outage);
      advance(1);
    }
    expect(raised).toHaveLength(0);
    await alarm.failed(outage);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ kind: 'rate_limit_store', fingerprint: 'rate-limit-store', details: { error: 'DatabaseError' } });
    // Only the error's name: never its message, which can quote a connection string.
    expect(JSON.stringify(raised[0])).not.toContain('secret');
  });

  it('stays quiet for half an hour, then speaks up again if it is still failing', async () => {
    const { alarm, raised, advance } = setup();
    for (let index = 0; index < 50; index += 1) await alarm.failed(outage);
    expect(raised).toHaveLength(1);
    advance(31);
    for (let index = 0; index < STORE_FAILURE_THRESHOLD; index += 1) await alarm.failed(outage);
    expect(raised).toHaveLength(2);
  });

  it('never throws, even when the alert itself fails', async () => {
    const alarm = new RateLimitStoreAlarm({ alerts: { report: async () => { throw new Error('email down'); } } });
    for (let index = 0; index < 10; index += 1) await expect(alarm.failed(outage)).resolves.toBeUndefined();
  });

  it('lets requests through and reports once, even though reporting goes back through the failing store', async () => {
    const failing: RateLimitStore = { hit: async () => { throw outage; } };
    const raised: OperatorAlert[] = [];
    const wiring: { alarm?: RateLimitStoreAlarm } = {};
    const limiter = new RateLimiter({ store: failing, onStoreError: (error) => wiring.alarm?.failed(error) });
    // The alert's own throttle uses the same limiter, as in production.
    wiring.alarm = new RateLimitStoreAlarm({
      alerts: {
        report: async (alert) => {
          raised.push(alert);
          await limiter.consume([{ name: 'operator-alert:repeat', subject: alert.fingerprint, limit: 1, windowMilliseconds: 60_000 }]);
          return 'emailed';
        },
      },
    });
    for (let index = 0; index < 20; index += 1) {
      await expect(limiter.consume([{ name: 'auth.login:ip', subject: '203.0.113.9', limit: 1, windowMilliseconds: 60_000 }])).resolves.toEqual({ allowed: true });
    }
    expect(raised).toHaveLength(1);
  });

  it('keeps a request going when the store-error handler itself throws', async () => {
    const limiter = new RateLimiter({ store: { hit: async () => { throw outage; } }, onStoreError: () => { throw new Error('handler broke'); } });
    await expect(limiter.consume([{ name: 'x', subject: 'y', limit: 1, windowMilliseconds: 1_000 }])).resolves.toEqual({ allowed: true });
    const rejecting = new RateLimiter({ store: { hit: async () => { throw outage; } }, onStoreError: async () => { throw new Error('async handler broke'); } });
    await expect(rejecting.consume([{ name: 'x', subject: 'y', limit: 1, windowMilliseconds: 1_000 }])).resolves.toEqual({ allowed: true });
  });
});
