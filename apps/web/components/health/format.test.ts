import type { HealthEmailProvider, SystemHealth } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { bars, overallLine, problems, since, stateLine, usageLine, when } from './format';

const now = Date.parse('2026-11-10T14:00:00Z');

function provider(overrides: Partial<HealthEmailProvider> = {}): HealthEmailProvider {
  return {
    provider: 'brevo', role: 'primary', limit: 300, sentToday: 120, failedToday: 0, lastSuccessAt: '2026-11-10T13:58:00.000Z',
    lastFailureAt: null, lastFailureKind: null, lastFailureReason: null, pausedUntil: null, state: 'ready', history: [80, 0, 120], ...overrides,
  };
}

function health(overrides: Partial<SystemHealth> = {}): SystemHealth {
  return {
    checkedAt: '2026-11-10T14:00:00.000Z',
    overall: 'ok',
    database: { status: 'up', latencyMs: 12, schema: 'current', migration: '0030_ops_health', pool: { total: 2, idle: 1, waiting: 0, max: 10 } },
    email: { configured: true, current: 'brevo', providers: [provider(), provider({ provider: 'gmail', role: 'fallback', limit: 500, sentToday: 0, history: [0, 0, 0] })], days: ['2026-11-08', '2026-11-09', '2026-11-10'], alertsEmailing: true, alertRecipients: 1 },
    alerts: [],
    signals: [{ signal: 'sign_in_failures', count: 3, threshold: 80, windowMinutes: 15 }],
    cron: { configured: true, lastRunAt: '2026-11-10T02:30:00.000Z', state: 'ok' },
    google: { configured: true },
    rateLimitStore: 'postgres',
    release: { commit: 'abc1234def', region: 'fra1' },
    ...overrides,
  };
}

describe('System health wording', () => {
  it('reads times in Lagos', () => {
    expect(when('2026-11-10T13:05:00.000Z', now)).toBe('2:05 pm');
    expect(when('2026-11-09T13:05:00.000Z', now)).toBe('yesterday 2:05 pm');
    expect(since('2026-11-10T13:56:00.000Z', now)).toBe('4 min ago');
    expect(since('2026-11-10T02:30:00.000Z', now)).toBe('12 h ago');
  });

  it('says how much of the allowance is used and why a provider is skipped', () => {
    expect(usageLine(provider())).toBe('120 of 300 today');
    expect(usageLine(provider({ limit: null }))).toBe('120 today');
    expect(stateLine(provider(), now)).toBeNull();
    expect(stateLine(provider({ state: 'paused', pausedUntil: '2026-11-11T00:00:00.000Z', lastFailureKind: 'quota' }), now))
      .toBe('Skipped until Wed, 11 Nov, 1:00 am (daily limit reached). Still tried if every other provider fails.');
    expect(bars([0, 150, 300], 300)).toEqual([0, 0.5, 1]);
    expect(bars([0, 4, 8], null)).toEqual([0, 0.5, 1]);
  });

  it('has nothing to list when all is well', () => {
    expect(problems(health(), now)).toEqual([]);
    expect(overallLine(health(), now)).toBe('Emails go through Brevo, the database answers in 12 ms, and nothing unusual in the last hours.');
  });

  it('lists what is wrong, the most urgent first', () => {
    const paused = provider({ state: 'full', sentToday: 300 });
    const report = health({
      overall: 'down',
      database: { status: 'up', latencyMs: 12, schema: 'behind', migration: '0030_ops_health', pool: null },
      email: { ...health().email, current: 'gmail', providers: [paused, health().email.providers[1]!] },
      cron: { configured: true, lastRunAt: '2026-11-08T02:30:00.000Z', state: 'late' },
      signals: [{ signal: 'rate_limited', count: 75, threshold: 60, windowMinutes: 10 }],
    });
    expect(problems(report, now)).toEqual([
      { tone: 'down', text: 'The database is behind this release (needs 0030_ops_health). Run the migrations.' },
      { tone: 'attention', text: 'Brevo has used all 300 of today’s emails. Emails go through Gmail meanwhile.' },
      { tone: 'attention', text: 'The nightly clean-up last ran 2 days ago. Check Cron Jobs in Vercel.' },
      { tone: 'attention', text: 'Refused as too fast: 75 in 10 minutes (alert at 60).' },
    ]);
    expect(overallLine(report, now)).toBe('4 things below.');
  });

  it('explains a lone recent alert when nothing else is wrong', () => {
    const report = health({ overall: 'attention', alerts: [{ id: '1', kind: 'server_error', summary: 'TypeError in GET /api/v1/sessions', outcome: 'emailed', occurredAt: '2026-11-10T13:30:00.000Z' }] });
    expect(problems(report, now)).toEqual([{ tone: 'attention', text: 'Server error 30 min ago: TypeError in GET /api/v1/sessions.' }]);
  });

  it('is urgent when no provider is set up or every one is skipped', () => {
    expect(problems(health({ overall: 'down', email: { ...health().email, configured: false, current: null, providers: [] } }), now)[0]!.tone).toBe('down');
    const skipped = health({ overall: 'down', email: { ...health().email, current: null, providers: [provider({ state: 'paused', pausedUntil: '2026-11-10T14:30:00.000Z', lastFailureKind: 'setup' })] } });
    expect(problems(skipped, now).map((problem) => problem.text)).toEqual([
      'Every email provider is skipped. Emails are still tried, but are probably not arriving.',
      'Brevo is skipped (setup problem).',
    ]);
  });
});
