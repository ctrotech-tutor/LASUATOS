import { describe, expect, it } from 'vitest';
import { PublicStatusSchema, SystemHealthSchema } from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { EmailDeliveryError } from '../email/errors.js';
import { ProviderChain, type Mailer } from '../email/failover.js';
import { OperatorAlerts } from './alerts.js';
import { HealthError, HealthService, MemoryHealthRepository, PUBLIC_STATUS_TTL } from './health.js';

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

describe('public status (ADR 034)', () => {
  const quota = new EmailDeliveryError('quota', 'quota');
  const send = (chain: ProviderChain) => chain.deliver({ to: 'a@example.net', displayName: 'A', subject: 's', text: 't', html: 'h' }).catch(() => undefined);

  it('says everything is operational, with coarse states only', async () => {
    const status = PublicStatusSchema.parse(await service({ faceCheck: 'required' }).health.publicStatus());
    expect(status.components).toEqual({ core: 'operational', errors: 'operational', email: 'operational', google: 'operational', face: 'operational' });
    // Nothing internal: no provider names, counts, versions or errors.
    expect(JSON.stringify(status)).not.toMatch(/brevo|gmail|commit|region|migration|count/i);
  });

  it('is down when the database is unreachable or behind the code, and everything that needs it with it', async () => {
    const unreachable = await service({ faceCheck: 'required', checkDatabase: async () => { throw new Error('no route'); } }).health.publicStatus();
    expect(unreachable.components).toMatchObject({ core: 'down', email: 'down', google: 'down', face: 'down' });
    const behind = await service({ checkSchema: async () => 'behind' }).health.publicStatus();
    expect(behind.components.core).toBe('down');
  });

  it('keeps email operational while a fallback works, and down when every provider is used up', async () => {
    const primaryFull = new ProviderChain({ mailers: [mailer('brevo', quota), mailer('gmail')], now: () => now });
    await send(primaryFull);
    expect((await service({ email: primaryFull }).health.publicStatus()).components.email).toBe('operational');

    const allFull = new ProviderChain({ mailers: [mailer('brevo', quota), mailer('gmail', quota)], now: () => now });
    await send(allFull);
    expect((await service({ email: allFull }).health.publicStatus()).components.email).toBe('down');
    expect((await service({ email: undefined }).health.publicStatus()).components.email).toBe('down');
  });

  it('reads the trend counters: errors, Google and the face engine', async () => {
    const snapshot = async () => [
      { signal: 'server_errors' as const, count: 15, threshold: 15, windowMinutes: 10 },
      { signal: 'google_broken' as const, count: 5, threshold: 5, windowMinutes: 15 },
      { signal: 'face_unavailable' as const, count: 3, threshold: 3, windowMinutes: 10 },
    ];
    const status = await service({ faceCheck: 'required', signals: { snapshot } }).health.publicStatus();
    expect(status.components).toMatchObject({ errors: 'degraded', google: 'degraded', face: 'down' });
  });

  it('marks features turned off here as off', async () => {
    const status = await service({ faceCheck: 'off', googleConfigured: false }).health.publicStatus();
    expect(status.components).toMatchObject({ face: 'off', google: 'off' });
  });

  it('answers from one check for a short while, so outside traffic cannot load the database', async () => {
    let clock = now.getTime();
    let checks = 0;
    const { health } = service({ now: () => new Date(clock), checkDatabase: async () => { checks += 1; } });
    await Promise.all([health.publicStatus(), health.publicStatus(), health.publicStatus()]);
    expect(checks).toBe(1);
    clock += PUBLIC_STATUS_TTL + 1;
    await health.publicStatus();
    expect(checks).toBe(2);
  });
});
