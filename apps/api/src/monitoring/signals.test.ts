import { describe, expect, it } from 'vitest';
import { MemoryRateLimitStore } from '../security/rate-limit.js';
import { buildServer, signalFor } from '../server.js';
import type { OperatorAlert } from './alerts.js';
import { emailAlertFor } from './email-alerts.js';
import { googleSignal, SignalMonitor } from './signals.js';

function monitor(start = '2026-11-10T07:55:00Z') {
  let now = new Date(start);
  const raised: OperatorAlert[] = [];
  const signals = new SignalMonitor({
    store: new MemoryRateLimitStore(),
    alerts: { report: async (alert) => { raised.push(alert); return 'emailed'; } },
    now: () => now,
  });
  return { signals, raised, advance: (minutes: number) => { now = new Date(now.getTime() + minutes * 60_000); } };
}

describe('trend alerts', () => {
  it('raises one alert when a count reaches its threshold within the window', async () => {
    const { signals, raised, advance } = monitor();
    for (let index = 0; index < 59; index += 1) await signals.count('rate_limited', { 'last request': 'POST /api/v1/auth/login' });
    expect(raised).toEqual([]);
    await signals.count('rate_limited', { 'last request': 'POST /api/v1/auth/login' });
    for (let index = 0; index < 40; index += 1) await signals.count('rate_limited');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      kind: 'rate_limited',
      summary: 'rate limits hit hard: 60 requests refused as too fast in 10 minutes',
      fingerprint: 'signal-rate_limited',
      details: expect.objectContaining({ 'last request': 'POST /api/v1/auth/login' }),
    });
    expect(await signals.snapshot()).toEqual(expect.arrayContaining([{ signal: 'rate_limited', count: 100, threshold: 60, windowMinutes: 10 }]));
    // A new window starts counting again.
    advance(11);
    for (let index = 0; index < 60; index += 1) await signals.count('rate_limited');
    expect(raised).toHaveLength(2);
  });

  it('spreads out slowly: 59 refusals every ten minutes never alert', async () => {
    const { signals, raised, advance } = monitor();
    for (let window = 0; window < 3; window += 1) {
      for (let index = 0; index < 59; index += 1) await signals.count('rate_limited');
      advance(10);
    }
    expect(raised).toEqual([]);
  });

  it('treats setup-type Google refusals as more urgent than students’ stale answers', async () => {
    expect(googleSignal('audience')).toBe('google_broken');
    expect(googleSignal('keys_unavailable')).toBe('google_broken');
    expect(googleSignal('expired')).toBe('google_refused');
    expect(googleSignal('nonce')).toBe('google_refused');
    const { signals, raised } = monitor();
    for (let index = 0; index < 5; index += 1) await signals.count(googleSignal('audience'), { reason: 'audience' });
    expect(raised).toHaveLength(1);
    expect(raised[0]!.kind).toBe('google_failing');
  });

  it('never throws, even when the store or the alert fails', async () => {
    const signals = new SignalMonitor({
      store: { hit: async () => { throw new Error('database down'); } },
      alerts: { report: async () => { throw new Error('no'); } },
    });
    await expect(signals.count('server_errors')).resolves.toBeUndefined();
    expect((await signals.snapshot()).every((signal) => signal.count === 0)).toBe(true);
  });
});

describe('which requests feed a trend', () => {
  it('counts refusals, server errors and wrong passwords only', () => {
    expect(signalFor('POST /api/v1/auth/login', 429)).toBe('rate_limited');
    expect(signalFor('GET /api/v1/sessions', 500)).toBe('server_errors');
    expect(signalFor('GET /api/v1/ready', 503)).toBeNull();
    expect(signalFor('POST /api/v1/auth/login', 401)).toBe('sign_in_failures');
    expect(signalFor('POST /api/v1/lecture/check-in', 401)).toBe('sign_in_failures');
    expect(signalFor('GET /api/v1/auth/session', 401)).toBeNull();
    expect(signalFor('GET /api/v1/admin/health', 200)).toBeNull();
  });

  it('counts a failed request before its answer is sent', async () => {
    const counted: string[] = [];
    const server = buildServer({ logger: false, signals: { count: async (signal) => { counted.push(signal); } } });
    server.get('/api/v1/test-boom', async () => { throw new Error('boom'); });
    expect((await server.inject({ method: 'GET', url: '/api/v1/test-boom' })).statusCode).toBe(500);
    expect((await server.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    expect(counted).toEqual(['server_errors']);
    await server.close();
  });

  it('counts requests the origin guard blocks, with where they came from, and nothing else that answers 403', async () => {
    const counted: { signal: string; details: Readonly<Record<string, string>> | undefined }[] = [];
    const server = buildServer({
      logger: false,
      trustedOrigins: ['https://lasuatos.example.edu'],
      signals: { count: async (signal, details) => { counted.push({ signal, details }); } },
    });
    server.post('/api/v1/test-forbidden', async (_request, reply) => reply.code(403).send({ status: 403 }));
    const blocked = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login?next=/x',
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://lasuatos.example.com.ng', cookie: 'lasuatos_session=abc' },
      payload: { email: 'a@example.net', password: 'x' },
    });
    expect(blocked.statusCode).toBe(403);
    expect((await server.inject({ method: 'POST', url: '/api/v1/test-forbidden', headers: { 'sec-fetch-site': 'same-origin' } })).statusCode).toBe(403);
    expect(counted).toEqual([{
      signal: 'origin_blocked',
      details: { 'last request': 'POST /api/v1/auth/login', origin: 'https://lasuatos.example.com.ng', 'Sec-Fetch-Site': 'cross-site' },
    }]);
    await server.close();
  });

  it('still refuses a blocked request when counting it fails', async () => {
    const server = buildServer({ logger: false, signals: { count: async () => { throw new Error('store down'); } } });
    const response = await server.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'sec-fetch-site': 'cross-site' }, payload: {} });
    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it('alerts once when blocked requests pile up, naming the origin so a new domain is easy to spot', async () => {
    const { signals, raised } = monitor();
    for (let index = 0; index < 25; index += 1) await signals.count('origin_blocked', { origin: 'https://lasuatos.com.ng' });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ kind: 'origin_blocked', fingerprint: 'signal-origin_blocked', details: { origin: 'https://lasuatos.com.ng' } });
    expect(raised[0]?.details.fix).toContain('TRUSTED_ORIGINS');
  });
});

describe('email alerts', () => {
  const now = new Date('2026-11-10T13:05:00Z');

  it('describes a switch and groups repeats by provider and reason', () => {
    const alert = emailAlertFor({
      type: 'failover',
      delivered: 'gmail',
      failed: [{ provider: 'brevo', why: 'quota', reason: 'Brevo refused the message (HTTP 402): not_enough_credits', until: new Date('2026-11-11T00:00:00Z') }],
    }, now);
    expect(alert).toMatchObject({
      kind: 'email_failover',
      summary: 'Brevo (daily limit reached) refused; sent through Gmail',
      fingerprint: 'failover-brevo-quota',
      details: { Brevo: 'Brevo refused the message (HTTP 402): not_enough_credits', 'Brevo paused until': 'Wed, 11 Nov 2026, 01:00 WAT', 'sent through': 'Gmail' },
    });
  });

  it('says when nobody can take over', () => {
    expect(emailAlertFor({ type: 'all_failed', attempts: [{ provider: 'brevo', why: 'setup', reason: 'Key not found', until: null }] }, now).summary)
      .toBe('Brevo refused the message (setup problem) and no other provider is set up');
    expect(emailAlertFor({ type: 'quota', provider: 'brevo', sent: 300, limit: 300, next: null }, now).summary)
      .toBe('Brevo has used all 300 of today’s emails and no other provider is set up');
    const near = emailAlertFor({ type: 'quota', provider: 'brevo', sent: 270, limit: 300, next: 'gmail' }, now);
    expect(near.summary).toBe('Brevo has sent 270 of its 300 emails today');
    expect(near.fingerprint).toBe('quota-brevo-near-11-10');
  });
});
