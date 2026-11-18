import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword } from '@lasuatos/auth';
import { SystemHealthSchema } from '@lasuatos/contracts';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { EmailDeliveryError } from '../email/errors.js';
import { PostgresEmailUsageStore, ProviderChain, type EmailChainEvent, type Mailer } from '../email/failover.js';
import type { OutgoingMessage } from '../email/messages.js';
import { OperatorAlerts, type OperatorAlertEmail } from '../monitoring/alerts.js';
import { emailAlertFor } from '../monitoring/email-alerts.js';
import { HealthService, PostgresHealthRepository } from '../monitoring/health.js';
import { BackupMonitor, PostgresBackupRepository } from '../monitoring/backups.js';
import { SignalMonitor } from '../monitoring/signals.js';
import { PostgresRateLimitStore, RateLimiter } from '../security/rate-limit.js';
import { INSTITUTION_SLUG, LECTURER_EMAIL, LECTURER_PASSWORD, applyMigrations, ids, jsonBody, seedLecturerFixture, sessionCookie } from './harness.js';

/**
 * ADR 029 end to end on PostgreSQL: Brevo runs out of quota, the email goes through
 * Gmail, every instance then skips Brevo; the switch is alerted once and listed on
 * System health with today's counts; a wave of wrong passwords raises one trend
 * alert; only institution administrators can open the page; old rows are pruned.
 */

const ADMIN_ID = 'c7777777-7777-4777-8777-777777777777';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';

class FakeMailer implements Mailer {
  failure: EmailDeliveryError | null = null;
  readonly sent: OutgoingMessage[] = [];
  calls = 0;
  constructor(readonly provider: 'brevo' | 'gmail') {}
  async deliver(message: OutgoingMessage): Promise<void> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    this.sent.push(message);
  }
}

const message: OutgoingMessage = { to: 'student@st.lasu.edu.ng', displayName: 'Amina', subject: 'Code', text: '123456', html: '<p>123456</p>' };

it('system health: email failover, alerts, trends, access and pruning', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    await seedLecturerFixture(client);
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, password_hash, status) VALUES ($1, $2, $3, 'E2E Admin', $4, 'active')`,
      [ADMIN_ID, ids.institution, ADMIN_EMAIL, await hashPassword(ADMIN_PASSWORD)],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'institution_administrator', 'institution', $2)`,
      [ADMIN_ID, ids.institution],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    let clock = new Date('2026-11-10T09:00:00Z');
    const now = () => clock;
    const store = new PostgresRateLimitStore(database);
    const limiter = new RateLimiter({ store, now });
    const repository = new PostgresHealthRepository(database);
    const alertEmails: OperatorAlertEmail[] = [];
    const alerts = new OperatorAlerts({
      recipients: ['ops@e2e.invalid'],
      sender: { sendOperatorAlert: async (email) => { alertEmails.push(email); } },
      limiter,
      log: { error: () => undefined, warn: () => undefined },
      history: repository,
    });

    // Two "instances" share one database: the second learns Brevo is out from the first.
    const events: EmailChainEvent[] = [];
    const brevoA = new FakeMailer('brevo');
    const gmailA = new FakeMailer('gmail');
    const brevoB = new FakeMailer('brevo');
    const gmailB = new FakeMailer('gmail');
    const onEvent = async (event: EmailChainEvent) => {
      events.push(event);
      await alerts.report(emailAlertFor(event, clock));
    };
    const instanceA = new ProviderChain({ mailers: [brevoA, gmailA], usage: new PostgresEmailUsageStore(database), now, onEvent });
    const instanceB = new ProviderChain({ mailers: [brevoB, gmailB], usage: new PostgresEmailUsageStore(database), now, onEvent });

    await instanceA.deliver(message); // Brevo delivers
    brevoA.failure = new EmailDeliveryError('Brevo refused the message (HTTP 402): not_enough_credits', 'quota');
    brevoB.failure = brevoA.failure;
    await instanceA.deliver(message); // Brevo refuses, Gmail delivers
    await instanceB.deliver(message); // straight to Gmail
    await instanceA.deliver(message); // straight to Gmail; a repeat switch would be throttled anyway
    expect(brevoB.calls).toBe(0);
    expect(gmailA.sent.length + gmailB.sent.length).toBe(3);
    expect(events.filter((event) => event.type === 'failover')).toHaveLength(1);
    expect(alertEmails).toHaveLength(1);
    expect(alertEmails[0]).toMatchObject({ kind: 'email_failover', summary: 'Brevo (daily limit reached) refused; sent through Gmail' });

    // Wrong passwords: the 80th in 15 minutes raises one alert.
    const signals = new SignalMonitor({ store, alerts, now });
    for (let index = 0; index < 85; index += 1) await signals.count('sign_in_failures', { 'last request': 'POST /api/v1/auth/login' });
    expect(alertEmails.filter((email) => email.kind === 'sign_in_failures')).toHaveLength(1);

    // The daily clean-up ran on its own 3 hours ago.
    await client.query(
      `INSERT INTO student_audit_events (institution_id, actor_user_id, action, subject_user_id, matric_number, details, created_at)
       VALUES ($1, NULL, 'retention_run', NULL, NULL, 'faces=0 check_photos=0 scheduled=true', $2)`,
      [ids.institution, new Date(clock.getTime() - 3 * 60 * 60_000).toISOString()],
    );

    // Last night's backup reported in (ADR 035); GitHub's signature is checked in backups.test.ts.
    const source = 'ctrotech-tutor/LASUATOS';
    const runUrl = (runId: number) => `https://github.com/${source}/actions/runs/${runId}`;
    const backups = new BackupMonitor({
      sourceRepository: source,
      audience: 'https://lasuatos.e2e.invalid',
      repository: new PostgresBackupRepository(database, runUrl),
      verifier: { verify: async () => ({ repository: source, workflowRef: `${source}/.github/workflows/backup.yml@refs/heads/main`, eventName: 'schedule', runId: 900, runAttempt: 1 }) },
      alerts,
      now,
    });

    const auth = new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG });
    const health = new HealthService({
      repository,
      email: instanceA,
      signals,
      checkDatabase: async () => { await client.query('select 1'); },
      checkSchema: async () => 'current',
      poolStats: () => ({ total: 2, idle: 1, waiting: 0, max: 3 }),
      alertRecipients: 1,
      cronConfigured: true,
      googleConfigured: true,
      backups,
      rateLimitStore: 'postgres',
      release: { commit: 'abc1234', region: 'fra1' },
      now,
    });
    const server = buildServer({ logger: false, secureCookies: false, auth, health, backups, openStudentSignUp: false });
    const backupReport = {
      runId: 900,
      runAttempt: 1,
      status: 'ok',
      stage: 'done',
      startedAt: '2026-11-10T02:10:00.000Z',
      finishedAt: '2026-11-10T02:14:00.000Z',
      tag: 'db-20261110-021000',
      location: 'https://github.com/ctrotech-tutor/lasuatos-backups/releases/tag/db-20261110-021000',
      sizeBytes: 3_600_000,
      sha256: 'b'.repeat(64),
      tables: 47,
      rows: 1_234,
      kept: 3,
      oldestKeptAt: '2026-11-08T02:10:00.000Z',
      readOnlyLogin: true,
      schemaCurrent: true,
    };
    const posted = await server.inject({ method: 'POST', url: '/api/v1/ops/backups', headers: { authorization: `Bearer ${'t'.repeat(40)}` }, payload: backupReport });
    expect(posted.statusCode).toBe(204);
    // The same attempt sent twice is one row.
    expect((await server.inject({ method: 'POST', url: '/api/v1/ops/backups', headers: { authorization: `Bearer ${'t'.repeat(40)}` }, payload: backupReport })).statusCode).toBe(204);
    const login = async (email: string, password: string) => sessionCookie((await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })).headers);
    const get = (cookie?: string) => server.inject({ method: 'GET', url: '/api/v1/admin/health', ...(cookie ? { headers: { cookie } } : {}) });

    expect((await get()).statusCode).toBe(401);
    expect((await get(await login(LECTURER_EMAIL, LECTURER_PASSWORD))).statusCode).toBe(403);

    const response = await get(await login(ADMIN_EMAIL, ADMIN_PASSWORD));
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const report = SystemHealthSchema.parse(jsonBody(response));
    expect(report.overall).toBe('attention');
    expect(report.database).toMatchObject({ status: 'up', schema: 'current', pool: { max: 3 } });
    expect(report.email.current).toBe('gmail');
    expect(report.email.providers).toEqual([
      expect.objectContaining({ provider: 'brevo', role: 'primary', state: 'paused', sentToday: 1, failedToday: 1, lastFailureKind: 'quota', pausedUntil: '2026-11-11T00:00:00.000Z' }),
      expect.objectContaining({ provider: 'gmail', role: 'fallback', state: 'ready', sentToday: 3, limit: 500 }),
    ]);
    expect(report.email.providers[1]!.history.at(-1)).toBe(3);
    expect(report.alerts.map((alert) => [alert.kind, alert.outcome])).toEqual(expect.arrayContaining([
      ['email_failover', 'emailed'],
      ['sign_in_failures', 'emailed'],
    ]));
    expect(report.signals.find((signal) => signal.signal === 'sign_in_failures')).toMatchObject({ count: 85, threshold: 80 });
    expect(report.cron).toMatchObject({ configured: true, state: 'ok' });
    expect(report.release).toEqual({ commit: 'abc1234', region: 'fra1' });
    expect(report.backups).toMatchObject({ configured: true, state: 'ok', goodLast7Days: 1, workflowUrl: `https://github.com/${source}/actions/workflows/backup.yml` });
    expect(report.backups.last).toEqual(report.backups.lastGood);
    expect(report.backups.lastGood).toMatchObject({ status: 'ok', stage: 'done', tables: 47, rows: 1_234, sizeBytes: 3_600_000, readOnlyLogin: true, runUrl: runUrl(900), finishedAt: '2026-11-10T02:14:00.000Z' });

    // A month and a half later: alerts older than 30 days go; email counts and backup reports
    // stay for 90. No backup has come since, so the daily check emails about it.
    clock = new Date('2026-12-25T09:00:00Z');
    expect(await health.prune()).toEqual({ alerts: report.alerts.length, emailDays: 0, backupRuns: 0, backups: 'late' });
    expect(alertEmails.at(-1)).toMatchObject({ kind: 'backup_late', summary: expect.stringContaining('2026-11-10T02:14:00.000Z') });
    clock = new Date('2027-02-15T09:00:00Z');
    expect(await health.prune()).toEqual({ alerts: 1, emailDays: 2, backupRuns: 1, backups: 'never' });
    await server.close();
  } finally {
    await client.close();
  }
}, 60_000);
