import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupReport } from '@lasuatos/contracts';
import { buildServer } from '../server.js';
import { BackupMonitor, GITHUB_OIDC_ISSUER, GithubOidcVerifier, MemoryBackupRepository, type GithubRunClaims } from './backups.js';
import type { OperatorAlert } from './alerts.js';

const AUDIENCE = 'https://lasuatos.example';
const SOURCE = 'ctrotech-tutor/LASUATOS';
const NOW = new Date('2026-11-20T03:00:00.000Z');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };

function sign(claims: Record<string, unknown>, options: { key?: typeof privateKey; kid?: string; alg?: string } = {}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = `${encode({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'key-1', typ: 'JWT' })}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256').update(head).sign(options.key ?? privateKey).toString('base64url');
  return `${head}.${signature}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(NOW.getTime() / 1_000);
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: AUDIENCE,
    exp: now + 300,
    nbf: now - 10,
    iat: now - 10,
    repository: SOURCE,
    workflow_ref: `${SOURCE}/.github/workflows/backup.yml@refs/heads/main`,
    event_name: 'schedule',
    run_id: '4242',
    run_attempt: '1',
    ...overrides,
  };
}

function verifier() {
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) }));
  return { fetch, verifier: new GithubOidcVerifier({ fetch, now: () => NOW.getTime() }) };
}

function report(overrides: Partial<BackupReport> = {}): BackupReport {
  return {
    runId: 4242,
    runAttempt: 1,
    status: 'ok',
    stage: 'done',
    message: null,
    startedAt: '2026-11-20T02:10:00.000Z',
    finishedAt: '2026-11-20T02:14:00.000Z',
    tag: 'db-20261120-021000',
    location: 'https://github.com/ctrotech-tutor/lasuatos-backups/releases/tag/db-20261120-021000',
    sizeBytes: 3_600_000,
    sha256: 'a'.repeat(64),
    tables: 47,
    rows: 1_234,
    kept: 12,
    oldestKeptAt: '2026-09-25T02:10:00.000Z',
    readOnlyLogin: true,
    schemaCurrent: true,
    ...overrides,
  };
}

const run = (overrides: Partial<GithubRunClaims> = {}): GithubRunClaims => ({
  repository: SOURCE,
  workflowRef: `${SOURCE}/.github/workflows/backup.yml@refs/heads/main`,
  eventName: 'schedule',
  runId: 4242,
  runAttempt: 1,
  ...overrides,
});

function monitor(options: { claims?: GithubRunClaims; source?: string | undefined; now?: () => Date } = {}) {
  const repository = new MemoryBackupRepository((runId) => `https://github.com/${SOURCE}/actions/runs/${runId}`);
  const alerts: OperatorAlert[] = [];
  const backups = new BackupMonitor({
    sourceRepository: 'source' in options ? options.source : SOURCE,
    audience: AUDIENCE,
    repository,
    verifier: { verify: async () => options.claims ?? run() },
    alerts: { report: async (alert) => { alerts.push(alert); return 'emailed'; } },
    now: options.now ?? (() => NOW),
  });
  return { backups, repository, alerts };
}

describe('GitHub OIDC verification', () => {
  it('accepts a token GitHub signed for this app and reads the run from it', async () => {
    const { verifier: oidc, fetch } = verifier();
    await expect(oidc.verify(sign(claims()), AUDIENCE)).resolves.toEqual(run());
    await oidc.verify(sign(claims()), AUDIENCE);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another audience', sign(claims({ aud: 'https://evil.example' })), /issued for https:\/\/evil.example/],
    ['another issuer', sign(claims({ iss: 'https://accounts.google.com' })), /wrong issuer/],
    ['an expired token', sign(claims({ exp: Math.floor(NOW.getTime() / 1_000) - 120 })), /expired/],
    ['a token from the future', sign(claims({ nbf: Math.floor(NOW.getTime() / 1_000) + 600 })), /not valid yet/],
    ['a forged signature', sign(claims(), { key: otherKey }), /bad signature/],
    ['an unknown key', sign(claims(), { kid: 'key-9' }), /unknown signing key/],
    ['an unsigned token', sign(claims(), { alg: 'none' }), /unexpected signature type/],
    ['rubbish', 'not.a.token', /unreadable/],
  ])('refuses %s', async (_name, token, message) => {
    const { verifier: oidc } = verifier();
    await expect(oidc.verify(token, AUDIENCE)).rejects.toMatchObject({ statusCode: 401, message });
  });

  it('refetches the keys at most every five minutes when GitHub rotates them', async () => {
    const { verifier: oidc, fetch } = verifier();
    await oidc.verify(sign(claims()), AUDIENCE);
    await expect(oidc.verify(sign(claims(), { kid: 'key-2' }), AUDIENCE)).rejects.toMatchObject({ statusCode: 401 });
    await expect(oidc.verify(sign(claims(), { kid: 'key-2' }), AUDIENCE)).rejects.toMatchObject({ statusCode: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('backup monitor', () => {
  it('records a good backup and shows it as ok', async () => {
    const { backups, alerts } = monitor();
    await backups.receive('token', report());
    const status = await backups.status();
    expect(status).toMatchObject({ configured: true, state: 'ok', goodLast7Days: 1, workflowUrl: `https://github.com/${SOURCE}/actions/workflows/backup.yml` });
    expect(status.last).toMatchObject({ status: 'ok', tables: 47, runUrl: `https://github.com/${SOURCE}/actions/runs/4242` });
    expect(status.last).not.toHaveProperty('runId');
    expect(alerts).toEqual([]);
  });

  it('emails when a run fails, and keeps the last good one in view', async () => {
    const { backups, alerts } = monitor({ claims: run({ runId: 4243 }) });
    await backups.receive('token', report({ runId: 4243, status: 'failed', stage: 'verify', message: 'restored copy differs: users 3 ≠ 2', finishedAt: '2026-11-20T02:20:00.000Z', tag: null, location: null, sizeBytes: null }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'backup_failed', fingerprint: 'backup-failed-verify', details: { step: 'verify' } });
    expect((await backups.status()).state).toBe('failed');
  });

  it('replaces a re-sent report of the same run attempt instead of adding one', async () => {
    const { backups, repository } = monitor();
    await backups.receive('token', report());
    await backups.receive('token', report({ rows: 1_235 }));
    expect(repository.runs).toHaveLength(1);
    expect(repository.runs[0]!.rows).toBe(1_235);
  });

  it.each([
    ['another repository', run({ repository: 'someone/fork' }), /from ctrotech-tutor\/LASUATOS only/],
    ['another workflow', run({ workflowRef: `${SOURCE}/.github/workflows/ci.yml@refs/heads/main` }), /backup.yml on main only/],
    ['another branch', run({ workflowRef: `${SOURCE}/.github/workflows/backup.yml@refs/heads/feature` }), /on main only/],
    ['a pull request', run({ eventName: 'pull_request' }), /scheduled or manual/],
    ['another run', run({ runId: 1 }), /does not belong/],
  ])('refuses a report from %s', async (_name, claimsOfRun, message) => {
    const { backups, repository } = monitor({ claims: claimsOfRun });
    await expect(backups.receive('token', report())).rejects.toMatchObject({ statusCode: 403, message });
    expect(repository.runs).toHaveLength(0);
  });

  it('refuses every report while backups are not set up, and says so on System health', async () => {
    const { backups } = monitor({ source: undefined });
    await expect(backups.receive('token', report())).rejects.toMatchObject({ statusCode: 404 });
    await expect(backups.status()).resolves.toMatchObject({ configured: false, state: 'off', workflowUrl: null });
    await expect(backups.checkLate()).resolves.toBe('off');
  });

  it('is late after 30 hours without a good backup, and the daily check emails about it', async () => {
    let now = NOW;
    const { backups, alerts } = monitor({ now: () => now });
    await expect(backups.checkLate()).resolves.toBe('never');
    expect(alerts.at(-1)).toMatchObject({ kind: 'backup_late', summary: expect.stringContaining('none has been reported') });
    await backups.receive('token', report());
    now = new Date(NOW.getTime() + 29 * 60 * 60_000);
    await expect(backups.checkLate()).resolves.toBe('ok');
    expect(alerts).toHaveLength(1);
    now = new Date(NOW.getTime() + 31 * 60 * 60_000);
    await expect(backups.checkLate()).resolves.toBe('late');
    expect(alerts).toHaveLength(2);
    expect(alerts[1]!.summary).toContain('2026-11-20T02:14:00.000Z');
  });

  it('forgets reports after 90 days', async () => {
    let now = NOW;
    const { backups, repository } = monitor({ now: () => now });
    await backups.receive('token', report());
    now = new Date(NOW.getTime() + 89 * 24 * 60 * 60_000);
    await expect(backups.prune()).resolves.toBe(0);
    now = new Date(NOW.getTime() + 91 * 24 * 60 * 60_000);
    await expect(backups.prune()).resolves.toBe(1);
    expect(repository.runs).toHaveLength(0);
  });
});

describe('POST /api/v1/ops/backups', () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('takes a signed report from the workflow, and explains refusals in its log', async () => {
    const { backups, repository } = monitor();
    const server = buildServer({ logger: false, backups });
    servers.push(server);
    const ok = await server.inject({ method: 'POST', url: '/api/v1/ops/backups', headers: { authorization: `Bearer ${'x'.repeat(40)}` }, payload: report() });
    expect(ok.statusCode).toBe(204);
    expect(repository.runs).toHaveLength(1);

    const unsigned = await server.inject({ method: 'POST', url: '/api/v1/ops/backups', payload: report() });
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.json().detail).toMatch(/identity token/);

    const invalid = await server.inject({ method: 'POST', url: '/api/v1/ops/backups', headers: { authorization: `Bearer ${'x'.repeat(40)}` }, payload: { ...report(), extra: true } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().detail).toMatch(/not valid/);

    const unproven = await server.inject({ method: 'POST', url: '/api/v1/ops/backups', headers: { authorization: `Bearer ${'x'.repeat(40)}` }, payload: report({ status: 'ok', stage: 'upload' }) });
    expect(unproven.statusCode).toBe(400);
  });

  it('is unavailable where backups are not wired', async () => {
    const server = buildServer({ logger: false });
    servers.push(server);
    const response = await server.inject({ method: 'POST', url: '/api/v1/ops/backups', headers: { authorization: `Bearer ${'x'.repeat(40)}` }, payload: report() });
    expect(response.statusCode).toBe(503);
  });
});
