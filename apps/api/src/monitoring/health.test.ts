import { describe, expect, it } from 'vitest';
import { SystemHealthSchema } from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { EmailDeliveryError } from '../email/errors.js';
import { ProviderChain, type Mailer } from '../email/failover.js';
import { OperatorAlerts } from './alerts.js';
import { HealthError, HealthService, MemoryHealthRepository } from './health.js';

const institutionAdmin: AdministratorSessionAccount = {
  accountType: 'administrator',
  id: '33c7c76b-59a6-453d-b5a8-45ba1c985999',
  email: 'admin@example.net',
  displayName: 'Institution Administrator',
  emailVerified: true,
  institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
  institutionName: 'Lagos State University',
  role: 'institution_administrator',
  scope: { type: 'institution', id: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8', label: 'Lagos State University' },
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
} as AdministratorSessionAccount;

const departmentAdmin = { ...institutionAdmin, role: 'department_administrator' } as AdministratorSessionAccount;

const now = new Date('2026-11-10T09:00:00Z');

function mailer(provider: 'brevo' | 'gmail', failure?: EmailDeliveryError): Mailer {
  return { provider, deliver: async () => { if (failure) throw failure; } };
}

function service(overrides: Partial<ConstructorParameters<typeof HealthService>[0]> = {}) {
  const repository = new MemoryHealthRepository();
  repository.lastRetention = new Date(now.getTime() - 5 * 60 * 60_000);
  const email = new ProviderChain({ mailers: [mailer('brevo'), mailer('gmail')], now: () => now });
  return {
    repository,
    email,
    health: new HealthService({
      repository,
      email,
      checkDatabase: async () => undefined,
      checkSchema: async () => 'current',
      alertRecipients: 1,
      cronConfigured: true,
      googleConfigured: true,
      rateLimitStore: 'postgres',
      release: { commit: null, region: null },
      now: () => now,
      ...overrides,
    }),
  };
}

describe('System health', () => {
  it('is for institution administrators only', async () => {
    const { health } = service();
    await expect(health.report(departmentAdmin)).rejects.toBeInstanceOf(HealthError);
    await expect(health.report(departmentAdmin)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('is ok when the database, email and the daily clean-up are fine', async () => {
    const { health } = service();
    const report = SystemHealthSchema.parse(await health.report(institutionAdmin));
    expect(report.overall).toBe('ok');
    expect(report.email).toMatchObject({ configured: true, current: 'brevo', alertsEmailing: true });
    expect(report.cron.state).toBe('ok');
  });

  it('needs attention when the clean-up is late or a provider is paused, and is down when no provider is ready', async () => {
    const late = service();
    late.repository.lastRetention = new Date(now.getTime() - 30 * 60 * 60_000);
    expect((await late.health.report(institutionAdmin)).overall).toBe('attention');
    expect((await late.health.report(institutionAdmin)).cron.state).toBe('late');

    const quota = new EmailDeliveryError('quota', 'quota');
    const chain = new ProviderChain({ mailers: [mailer('brevo', quota), mailer('gmail')], now: () => now });
    await chain.deliver({ to: 'a@example.net', displayName: 'A', subject: 's', text: 't', html: 'h' });
    expect((await service({ email: chain }).health.report(institutionAdmin)).overall).toBe('attention');

    const dead = new ProviderChain({ mailers: [mailer('brevo', quota), mailer('gmail', quota)], now: () => now });
    await dead.deliver({ to: 'a@example.net', displayName: 'A', subject: 's', text: 't', html: 'h' }).catch(() => undefined);
    const down = await service({ email: dead }).health.report(institutionAdmin);
    expect(down.overall).toBe('down');
    expect(down.email.current).toBeNull();
  });

  it('is down when the database is unreachable or behind', async () => {
    const offline = await service({ checkDatabase: async () => { throw new Error('ECONNREFUSED'); } }).health.report(institutionAdmin);
    expect(offline.database).toMatchObject({ status: 'down', latencyMs: null, schema: 'unknown' });
    expect(offline.overall).toBe('down');
    expect((await service({ checkSchema: async () => 'behind' }).health.report(institutionAdmin)).overall).toBe('down');
  });

  it('lists recent alerts with whether they were emailed', async () => {
    const { health, repository } = service();
    const alerts = new OperatorAlerts({ recipients: [], log: { error: () => undefined, warn: () => undefined }, history: repository });
    await alerts.report({ kind: 'rate_limited', summary: 'rate limits hit hard', details: {}, fingerprint: 'signal-rate_limited', occurredAt: now });
    const report = await health.report(institutionAdmin);
    expect(report.alerts).toEqual([expect.objectContaining({ kind: 'rate_limited', outcome: 'logged', occurredAt: now.toISOString() })]);
    expect(report.overall).toBe('attention');
  });

  it('shows the clean-up as off without CRON_SECRET, and email as missing without a provider', async () => {
    const report = await service({ cronConfigured: false, email: undefined }).health.report(institutionAdmin);
    expect(report.cron.state).toBe('off');
    expect(report.email).toMatchObject({ configured: false, providers: [], alertsEmailing: false });
    expect(report.overall).toBe('down');
  });
});
