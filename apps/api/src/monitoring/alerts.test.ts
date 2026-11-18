import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import { operatorAlertMessage } from '../email/transport.js';
import { MemoryRateLimitStore, RateLimiter } from '../security/rate-limit.js';
import { DAILY_ALERT_LIMIT, OperatorAlerts, coarseBrowser, scrubAlertText, type OperatorAlert, type OperatorAlertEmail } from './alerts.js';

const servers: ReturnType<typeof buildServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function alert(overrides: Partial<OperatorAlert> = {}): OperatorAlert {
  return {
    kind: 'server_error',
    summary: 'POST /api/v1/lecture/check-in failed (TypeError)',
    details: { request: 'POST /api/v1/lecture/check-in', requestId: 'req-1' },
    fingerprint: 'abc',
    occurredAt: new Date('2026-11-13T08:00:00.000Z'),
    ...overrides,
  };
}

function setup(options: { recipients?: string[]; now?: () => Date } = {}) {
  const sent: OperatorAlertEmail[] = [];
  const log = { error: vi.fn(), warn: vi.fn() };
  const alerts = new OperatorAlerts({
    recipients: options.recipients ?? ['ops@example.net'],
    sender: { sendOperatorAlert: async (email) => { sent.push(email); } },
    limiter: new RateLimiter({ store: new MemoryRateLimitStore(), ...(options.now ? { now: options.now } : {}) }),
    log,
  });
  return { alerts, sent, log };
}

describe('operator alerts', () => {
  it('emails every recipient once, then holds repeats of the same problem', async () => {
    const { alerts, sent, log } = setup({ recipients: ['ops@example.net', 'dev@example.net'] });
    await expect(alerts.report(alert())).resolves.toBe('emailed');
    await expect(alerts.report(alert())).resolves.toBe('throttled');
    expect(sent.map((email) => email.to)).toEqual(['ops@example.net', 'dev@example.net']);
    // Every occurrence is still logged for Vercel's logs.
    expect(log.error).toHaveBeenCalledTimes(2);
    // A different problem is its own alert.
    await expect(alerts.report(alert({ fingerprint: 'other' }))).resolves.toBe('emailed');
  });

  it('sends the same problem again after its quiet period', async () => {
    let now = new Date('2026-11-13T08:00:00.000Z');
    const { alerts } = setup({ now: () => now });
    await alerts.report(alert());
    now = new Date(now.getTime() + 29 * 60_000);
    await expect(alerts.report(alert())).resolves.toBe('throttled');
    now = new Date(now.getTime() + 2 * 60_000);
    await expect(alerts.report(alert())).resolves.toBe('emailed');
  });

  it('caps alerts per day so a crash loop cannot use up the email plan', async () => {
    const { alerts, sent } = setup();
    for (let index = 0; index < DAILY_ALERT_LIMIT + 5; index += 1) await alerts.report(alert({ fingerprint: `f${index}` }));
    expect(sent).toHaveLength(DAILY_ALERT_LIMIT);
  });

  it('only logs when no recipient is configured, and never throws when email fails', async () => {
    const { alerts, sent } = setup({ recipients: [] });
    await expect(alerts.report(alert())).resolves.toBe('logged');
    expect(sent).toHaveLength(0);

    const log = { error: vi.fn(), warn: vi.fn() };
    const failing = new OperatorAlerts({
      recipients: ['ops@example.net'],
      sender: { sendOperatorAlert: async () => { throw new Error('provider down'); } },
      log,
    });
    await expect(failing.report(alert())).resolves.toBe('logged');
    expect(log.warn).toHaveBeenCalled();
  });

  it('hides connection strings, keys and tokens from alert text', () => {
    const text = scrubAlertText('connect postgresql://user:pass@host/db failed; key xkeysib-abcdef0123456789abcdef token=secret123 ok');
    expect(text).not.toContain('pass@host');
    expect(text).not.toContain('abcdef0123456789');
    expect(text).not.toContain('secret123');
    expect(text).toContain('token=[hidden]');
  });

  it('describes a crash report’s browser without the phone model', () => {
    expect(coarseBrowser('Mozilla/5.0 (Linux; Android 14; SM-A146P Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36')).toBe('Chrome 131 on Android 14');
    expect(coarseBrowser('Mozilla/5.0 (Linux; Android 13; TECNO KI5q) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36')).toBe('Samsung Internet 26 on Android 13');
    expect(coarseBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('Safari 18 on iOS 18');
    expect(coarseBrowser('Mozilla/5.0 (Linux; Android 12; Infinix X6816 Build/SP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/en_US;FBAV/400.0]')).toBe('Facebook in-app browser on Android 12');
    expect(coarseBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toBe('Edge 131 on Windows');
    expect(coarseBrowser('curl/8.4')).toBe('Another browser on another system');
  });

  it('removes email addresses that a provider quotes back', () => {
    const text = scrubAlertText('Brevo 400: invalid recipient adaeze.okafor@st.lasu.edu.ng (blocked) for postgresql://u:p@db.example/x');
    expect(text).not.toContain('adaeze');
    expect(text).toContain('invalid recipient [email] (blocked)');
    expect(text).toContain('postgresql://[hidden]');
  });

  it('renders a readable email with the facts and how to find the full error', () => {
    const message = operatorAlertMessage({ ...alert(), to: 'ops@example.net' }, 'https://lasuatos.example');
    expect(message.subject).toContain('Something failed on LASUATOS');
    expect(message.text).toContain('requestId: req-1');
    expect(message.text).toContain('Vercel');
    expect(message.html).not.toContain('<script');
  });
});

describe('alerts from the server', () => {
  it('reports unexpected server errors but not ordinary client errors', async () => {
    const report = vi.fn<(alert: OperatorAlert) => Promise<'emailed'>>(async () => 'emailed');
    const server = buildServer({ logger: false, alerts: { report } });
    servers.push(server);
    server.get('/api/v1/test/boom', async () => { throw new TypeError('cannot read properties of undefined'); });
    server.get('/api/v1/test/missing', async () => { throw Object.assign(new Error('nope'), { statusCode: 404 }); });

    const boom = await server.inject({ method: 'GET', url: '/api/v1/test/boom' });
    expect(boom.statusCode).toBe(500);
    // The user sees nothing of the error itself.
    expect(boom.body).not.toContain('cannot read');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toMatchObject({
      kind: 'server_error',
      summary: 'GET /api/v1/test/boom failed (TypeError)',
      details: { error: 'TypeError: cannot read properties of undefined' },
    });

    expect((await server.inject({ method: 'GET', url: '/api/v1/test/missing' })).statusCode).toBe(404);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('accepts page crash reports from browsers without exposing anything back', async () => {
    const report = vi.fn<(alert: OperatorAlert) => Promise<'emailed'>>(async () => 'emailed');
    const server = buildServer({ logger: false, alerts: { report }, trustedOrigins: ['https://lasuatos.example'] });
    servers.push(server);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/client-errors',
      headers: { origin: 'https://lasuatos.example' },
      payload: { message: 'x is not a function', name: 'TypeError', path: '/sessions/abc?token=secret#frag', digest: '12345' },
    });
    expect(response.statusCode).toBe(204);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'page_error',
      details: expect.objectContaining({ page: '/sessions/abc', error: 'TypeError: x is not a function', digest: '12345' }),
    }));
    // Malformed reports are ignored quietly.
    const junk = await server.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { origin: 'https://lasuatos.example' }, payload: { nope: true } });
    expect(junk.statusCode).toBe(204);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('alerts when the database is behind the code', async () => {
    const report = vi.fn<(alert: OperatorAlert) => Promise<'emailed'>>(async () => 'emailed');
    const server = buildServer({ logger: false, alerts: { report }, checkDatabase: async () => undefined, checkSchema: async () => 'behind' });
    servers.push(server);
    expect((await server.inject({ method: 'GET', url: '/api/v1/ready' })).statusCode).toBe(503);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schema_behind' }));
  });
});
