import type { HealthBackupRun, HealthEmailProvider, SystemHealth } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { backupContents, backupKept, bars, formatBytes, overallLine, problems, since, stateLine, usageLine, when } from './format';

const now = Date.parse('2026-11-10T14:00:00Z');

function provider(overrides: Partial<HealthEmailProvider> = {}): HealthEmailProvider {
  return {
    provider: 'brevo', role: 'primary', limit: 300, sentToday: 120, failedToday: 0, lastSuccessAt: '2026-11-10T13:58:00.000Z',
    lastFailureAt: null, lastFailureKind: null, lastFailureReason: null, pausedUntil: null, state: 'ready', history: [80, 0, 120], ...overrides,
  };
}

function backupRun(overrides: Partial<HealthBackupRun> = {}): HealthBackupRun {
  return {
    status: 'ok', stage: 'done', message: null, finishedAt: '2026-11-10T01:34:00.000Z',
    location: 'https://github.com/ctrotech-tutor/lasuatos-backups/releases/tag/db-20261110-013000', runUrl: 'https://github.com/ctrotech-tutor/LASUATOS/actions/runs/1',
    sizeBytes: 3_640_000, tables: 47, rows: 12_345, kept: 12, oldestKeptAt: '2026-09-15T01:30:00.000Z', readOnlyLogin: true, ...overrides,
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
    backups: { configured: true, state: 'ok', last: backupRun(), lastGood: backupRun(), goodLast7Days: 7, workflowUrl: 'https://github.com/ctrotech-tutor/LASUATOS/actions/workflows/backup.yml' },
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

  it('describes backups and says plainly when they stopped', () => {
    expect(formatBytes(950)).toBe('950 B');
    expect(formatBytes(3_640_000)).toBe('3.6 MB');
    expect(formatBytes(1_200_000_000)).toBe('1.2 GB');
    expect(formatBytes(250_000_000)).toBe('250 MB');
    expect(backupContents(backupRun())).toBe('47 tables, 12,345 rows');
    expect(backupKept(backupRun())).toBe('12 copies, oldest 15 Sept');
    expect(backupContents(backupRun({ tables: null }))).toBeNull();

    const failed = backupRun({ status: 'failed', stage: 'verify', finishedAt: '2026-11-10T01:40:00.000Z', message: 'differs' });
    const yesterday = backupRun({ finishedAt: '2026-11-09T01:34:00.000Z' });
    expect(problems(health({ overall: 'attention', backups: { ...health().backups, state: 'failed', last: failed, lastGood: yesterday } }), now)).toEqual([
      { tone: 'attention', text: 'The last backup failed while checking the restored copy. The last good copy is from yesterday 2:34 am.' },
    ]);
    expect(problems(health({ overall: 'attention', backups: { ...health().backups, state: 'failed', last: failed, lastGood: null } }), now)[0]!.text)
      .toBe('The last backup failed while checking the restored copy. There is no good copy yet.');
    const old = backupRun({ finishedAt: '2026-11-09T02:00:00.000Z' });
    expect(problems(health({ overall: 'attention', backups: { ...health().backups, state: 'late', last: old, lastGood: old } }), now)[0]!.text)
      .toBe('No good backup for 36 h. Check the backup workflow in GitHub.');
    expect(problems(health({ overall: 'attention', backups: { ...health().backups, state: 'never', last: null, lastGood: null } }), now)[0]!.text)
      .toMatch(/^No backup has been reported yet/);
    expect(problems(health({ backups: { configured: false, state: 'off', last: null, lastGood: null, goodLast7Days: 0, workflowUrl: null } }), now)).toEqual([]);
  });
});
