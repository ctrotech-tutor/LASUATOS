import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import { backupRuns, type DatabaseClient } from '@lasuatos/database';
import type { BackupReport, HealthBackupRun, HealthBackups } from '@lasuatos/contracts';
import { scrubAlertText, within, type OperatorAlerts } from './alerts.js';

/**
 * Database backups (ADR 035). The GitHub workflow backs the database up every night and then
 * reports here; this keeps the history, shows it on System health, emails when a run fails,
 * and (from the daily clean-up job) emails when no good backup has arrived for 30 hours, which
 * also catches a workflow that silently stopped running.
 *
 * Reports are authenticated with no shared secret: the workflow sends a GitHub Actions OIDC
 * token, signed by GitHub, which says which repository, workflow file, branch and run it comes
 * from. Only the backup workflow on main of BACKUP_SOURCE_REPOSITORY is believed.
 */

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
/** Nightly, so a day plus GitHub's scheduling delays (often up to an hour at busy times). */
export const BACKUP_LATE_AFTER = 30 * HOUR;
export const BACKUP_HISTORY_DAYS = 90;
export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const CLOCK_SKEW_SECONDS = 60;
export const BACKUP_WORKFLOW_PATH = '.github/workflows/backup.yml';

export class BackupReportError extends Error {
  readonly exposeDetail = true;

  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'BackupReportError';
  }
}

export interface GithubRunClaims {
  readonly repository: string;
  readonly workflowRef: string;
  readonly eventName: string;
  readonly runId: number;
  readonly runAttempt: number;
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const decodeJson = (part: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
  return value as Record<string, unknown>;
};

/** Verifies GitHub Actions OIDC tokens (RS256, keys from GitHub's JWKS, cached for an hour). */
export class GithubOidcVerifier {
  readonly #fetch: Fetch;
  readonly #now: () => number;
  #keys: { readonly at: number; readonly byId: Map<string, JsonWebKey> } | null = null;
  #lastRefresh = 0;

  constructor(options: { readonly fetch?: Fetch; readonly now?: () => number } = {}) {
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? Date.now;
  }

  async #key(kid: string): Promise<JsonWebKey | undefined> {
    const now = this.#now();
    const fresh = this.#keys && now - this.#keys.at < HOUR;
    if (fresh && this.#keys!.byId.has(kid)) return this.#keys!.byId.get(kid);
    // GitHub rotates keys: an unknown key id refreshes the set, but at most every 5 minutes.
    if (!fresh || now - this.#lastRefresh > 5 * 60_000) {
      this.#lastRefresh = now;
      const response = await this.#fetch(GITHUB_JWKS_URL, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new BackupReportError(503, 'GitHub’s signing keys could not be fetched. The workflow will report again tomorrow.');
      const body = await response.json() as { keys?: (JsonWebKey & { kid?: string })[] };
      this.#keys = { at: now, byId: new Map((body.keys ?? []).filter((key) => key.kid).map((key) => [key.kid!, key])) };
    }
    return this.#keys?.byId.get(kid);
  }

  /** The run the token was issued to, or a 401 if it is not a valid token for `audience`. */
  async verify(token: string, audience: string): Promise<GithubRunClaims> {
    const refuse = (why: string): never => {
      throw new BackupReportError(401, `This report is not from the backup workflow (${why}).`);
    };
    const parts = token.split('.');
    if (parts.length !== 3) refuse('not a token');
    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = decodeJson(parts[0]!);
      claims = decodeJson(parts[1]!);
    } catch {
      return refuse('unreadable token');
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') refuse('unexpected signature type');
    const jwk = await this.#key(header.kid as string);
    if (!jwk) refuse('unknown signing key');
    const signed = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk!, format: 'jwk' }), Buffer.from(parts[2]!, 'base64url'));
    if (!signed) refuse('bad signature');

    const now = Math.floor(this.#now() / 1_000);
    if (claims.iss !== GITHUB_OIDC_ISSUER) refuse('wrong issuer');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)) refuse(`issued for ${String(audiences[0] ?? 'nobody')}, not ${audience}`);
    if (typeof claims.exp !== 'number' || claims.exp < now - CLOCK_SKEW_SECONDS) refuse('expired');
    if (typeof claims.nbf === 'number' && claims.nbf > now + CLOCK_SKEW_SECONDS) refuse('not valid yet');
    const text = (name: string) => (typeof claims[name] === 'string' ? claims[name] as string : refuse(`no ${name}`));
    return {
      repository: text('repository'),
      workflowRef: text('workflow_ref'),
      eventName: text('event_name'),
      runId: Number(text('run_id')),
      runAttempt: Number(text('run_attempt')),
    };
  }
}

export interface StoredBackupRun extends HealthBackupRun {
  readonly runId: number;
}

export interface BackupRepository {
  record(report: BackupReport, runUrl: string): Promise<void>;
  latest(): Promise<StoredBackupRun | null>;
  latestGood(): Promise<StoredBackupRun | null>;
  countGoodSince(since: Date): Promise<number>;
  prune(before: Date): Promise<number>;
}

const toRun = (row: typeof backupRuns.$inferSelect, runUrl: (runId: number) => string): StoredBackupRun => ({
  runId: row.runId,
  status: row.status as 'ok' | 'failed',
  stage: row.stage as StoredBackupRun['stage'],
  message: row.message,
  finishedAt: row.finishedAt.toISOString(),
  location: row.location,
  runUrl: runUrl(row.runId),
  sizeBytes: row.sizeBytes,
  tables: row.tables,
  rows: row.rows,
  kept: row.kept,
  oldestKeptAt: row.oldestKeptAt?.toISOString() ?? null,
  readOnlyLogin: row.readOnlyLogin,
});

export class PostgresBackupRepository implements BackupRepository {
  readonly #database: DatabaseClient;
  readonly #runUrl: (runId: number) => string;

  constructor(database: DatabaseClient, runUrl: (runId: number) => string) {
    this.#database = database;
    this.#runUrl = runUrl;
  }

  async record(report: BackupReport): Promise<void> {
    const values = {
      runId: report.runId,
      runAttempt: report.runAttempt,
      status: report.status,
      stage: report.stage,
      message: report.message ? scrubAlertText(report.message) : null,
      startedAt: new Date(report.startedAt),
      finishedAt: new Date(report.finishedAt),
      tag: report.tag ?? null,
      location: report.location ?? null,
      sizeBytes: report.sizeBytes ?? null,
      sha256: report.sha256 ?? null,
      tables: report.tables ?? null,
      rows: report.rows ?? null,
      kept: report.kept ?? null,
      oldestKeptAt: report.oldestKeptAt ? new Date(report.oldestKeptAt) : null,
      readOnlyLogin: report.readOnlyLogin ?? null,
      schemaCurrent: report.schemaCurrent ?? null,
    };
    // A re-sent report of the same attempt replaces the first; it never adds a second row.
    await this.#database.insert(backupRuns).values(values).onConflictDoUpdate({ target: [backupRuns.runId, backupRuns.runAttempt], set: { ...values, receivedAt: new Date() } });
  }

  async latest(): Promise<StoredBackupRun | null> {
    const [row] = await this.#database.select().from(backupRuns).orderBy(desc(backupRuns.finishedAt)).limit(1);
    return row ? toRun(row, this.#runUrl) : null;
  }

  async latestGood(): Promise<StoredBackupRun | null> {
    const [row] = await this.#database.select().from(backupRuns).where(eq(backupRuns.status, 'ok')).orderBy(desc(backupRuns.finishedAt)).limit(1);
    return row ? toRun(row, this.#runUrl) : null;
  }

  async countGoodSince(since: Date): Promise<number> {
    const [row] = await this.#database.select({ value: count() }).from(backupRuns).where(and(eq(backupRuns.status, 'ok'), gte(backupRuns.finishedAt, since)));
    return Number(row?.value ?? 0);
  }

  async prune(before: Date): Promise<number> {
    const rows = await this.#database.delete(backupRuns).where(lt(backupRuns.finishedAt, before)).returning({ id: backupRuns.id });
    return rows.length;
  }
}

/** For tests and development without a database. */
export class MemoryBackupRepository implements BackupRepository {
  readonly runs: (StoredBackupRun & { runAttempt: number })[] = [];
  readonly #runUrl: (runId: number) => string;

  constructor(runUrl: (runId: number) => string = (runId) => `https://github.com/example/runs/${runId}`) {
    this.#runUrl = runUrl;
  }

  async record(report: BackupReport): Promise<void> {
    const run = {
      runId: report.runId,
      runAttempt: report.runAttempt,
      status: report.status,
      stage: report.stage,
      message: report.message ?? null,
      finishedAt: new Date(report.finishedAt).toISOString(),
      location: report.location ?? null,
      runUrl: this.#runUrl(report.runId),
      sizeBytes: report.sizeBytes ?? null,
      tables: report.tables ?? null,
      rows: report.rows ?? null,
      kept: report.kept ?? null,
      oldestKeptAt: report.oldestKeptAt ?? null,
      readOnlyLogin: report.readOnlyLogin ?? null,
    };
    const index = this.runs.findIndex((item) => item.runId === run.runId && item.runAttempt === run.runAttempt);
    if (index === -1) this.runs.push(run);
    else this.runs[index] = run;
  }

  #sorted() {
    return [...this.runs].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  }

  async latest() {
    return this.#sorted()[0] ?? null;
  }

  async latestGood() {
    return this.#sorted().find((run) => run.status === 'ok') ?? null;
  }

  async countGoodSince(since: Date) {
    return this.runs.filter((run) => run.status === 'ok' && new Date(run.finishedAt) >= since).length;
  }

  async prune(before: Date) {
    const keep = this.runs.filter((run) => new Date(run.finishedAt) >= before);
    const removed = this.runs.length - keep.length;
    this.runs.splice(0, this.runs.length, ...keep);
    return removed;
  }
}

export interface BackupMonitorOptions {
  /** owner/name of the repository whose backup workflow may report (BACKUP_SOURCE_REPOSITORY). */
  readonly sourceRepository: string | undefined;
  /** The OIDC audience the workflow asks for: this app's origin. */
  readonly audience: string;
  readonly repository: BackupRepository;
  readonly verifier?: Pick<GithubOidcVerifier, 'verify'>;
  readonly alerts?: Pick<OperatorAlerts, 'report'>;
  readonly now?: () => Date;
}

const EVENTS = new Set(['schedule', 'workflow_dispatch']);

export class BackupMonitor {
  readonly #options: BackupMonitorOptions;
  readonly #verifier: Pick<GithubOidcVerifier, 'verify'>;
  readonly #now: () => Date;

  constructor(options: BackupMonitorOptions) {
    this.#options = options;
    this.#verifier = options.verifier ?? new GithubOidcVerifier();
    this.#now = options.now ?? (() => new Date());
  }

  get configured(): boolean {
    return Boolean(this.#options.sourceRepository);
  }

  runUrl(runId: number): string {
    return `https://github.com/${this.#options.sourceRepository}/actions/runs/${runId}`;
  }

  /** Accepts a report from the backup workflow, after proving that is where it came from. */
  async receive(token: string, report: BackupReport): Promise<void> {
    const source = this.#options.sourceRepository;
    if (!source) throw new BackupReportError(404, 'Backups are not set up here (BACKUP_SOURCE_REPOSITORY is not set).');
    const claims = await this.#verifier.verify(token, this.#options.audience);
    const expectedRef = `${source}/${BACKUP_WORKFLOW_PATH}@refs/heads/main`.toLowerCase();
    if (claims.repository.toLowerCase() !== source.toLowerCase()) throw new BackupReportError(403, `Reports are accepted from ${source} only.`);
    if (claims.workflowRef.toLowerCase() !== expectedRef) throw new BackupReportError(403, `Reports are accepted from ${BACKUP_WORKFLOW_PATH} on main only.`);
    if (!EVENTS.has(claims.eventName)) throw new BackupReportError(403, 'Reports are accepted from scheduled or manual runs only.');
    if (claims.runId !== report.runId || claims.runAttempt !== report.runAttempt) throw new BackupReportError(403, 'The report does not belong to the run that signed it.');
    if (report.location && !report.location.startsWith('https://github.com/')) throw new BackupReportError(400, 'A backup lives in a GitHub repository.');

    await this.#options.repository.record(report, this.runUrl(report.runId));
    if (report.status === 'failed' && this.#options.alerts) {
      // The report is saved; the email must not keep the workflow (or the function) waiting.
      await within(this.#options.alerts.report({
        kind: 'backup_failed',
        summary: scrubAlertText(`backup failed at ${report.stage}: ${report.message ?? 'no details'}`),
        details: { step: report.stage, run: this.runUrl(report.runId) },
        fingerprint: `backup-failed-${report.stage}`,
        occurredAt: this.#now(),
      }), 8_000);
    }
  }

  async status(): Promise<HealthBackups> {
    const workflowUrl = this.#options.sourceRepository ? `https://github.com/${this.#options.sourceRepository}/actions/workflows/backup.yml` : null;
    const now = this.#now();
    const [last, lastGood, goodLast7Days] = await Promise.all([
      this.#options.repository.latest(),
      this.#options.repository.latestGood(),
      this.#options.repository.countGoodSince(new Date(now.getTime() - 7 * DAY)),
    ]);
    const strip = (run: StoredBackupRun | null): HealthBackupRun | null => {
      if (!run) return null;
      const rest: HealthBackupRun & { runId?: number } = { ...run };
      delete rest.runId;
      return rest;
    };
    const state: HealthBackups['state'] = !this.configured
      ? 'off'
      : !last ? 'never'
        : last.status === 'failed' ? 'failed'
          : !lastGood || now.getTime() - new Date(lastGood.finishedAt).getTime() > BACKUP_LATE_AFTER ? 'late' : 'ok';
    return { configured: this.configured, state, last: strip(last), lastGood: strip(lastGood), goodLast7Days, workflowUrl };
  }

  /** Daily, from the clean-up job: emails while there has been no good backup for 30 hours. */
  async checkLate(): Promise<HealthBackups['state']> {
    const status = await this.status();
    if (status.state === 'late' || status.state === 'never') {
      const since = status.lastGood ? `the last good one finished ${status.lastGood.finishedAt}` : 'none has been reported yet';
      await this.#options.alerts?.report({
        kind: 'backup_late',
        summary: `no good database backup for over 30 hours (${since})`,
        details: { workflow: status.workflowUrl ?? 'not set up' },
        fingerprint: 'backup-late',
        occurredAt: this.#now(),
      });
    }
    return status.state;
  }

  prune(): Promise<number> {
    return this.#options.repository.prune(new Date(this.#now().getTime() - BACKUP_HISTORY_DAYS * DAY));
  }
}
