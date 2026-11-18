import { desc, lt, sql } from 'drizzle-orm';
import { LATEST_MIGRATION, operatorAlertEvents, type DatabaseClient } from '@lasuatos/database';
import type { HealthAlert, PublicComponentState, PublicStatus, SystemHealth } from '@lasuatos/contracts';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { ProviderChain } from '../email/failover.js';
import { utcDay } from '../email/failover.js';
import type { AlertEventStore, AlertOutcome, OperatorAlert, OperatorAlertKind } from './alerts.js';
import type { SignalMonitor } from './signals.js';

/**
 * System health (ADR 029): one page for the institution administrators that answers
 * "is LASUATOS working right now?" (database, email providers and today's counts,
 * the daily clean-up, recent alerts and trend counters) without opening Vercel.
 */

const DAY = 24 * 60 * 60 * 1_000;
const ALERT_HISTORY_DAYS = 30;
const EMAIL_HISTORY_DAYS = 90;
const CRON_LATE_AFTER = 26 * 60 * 60 * 1_000;
/** How long one instance reuses its public status answer, so outside traffic cannot load the database. */
export const PUBLIC_STATUS_TTL = 20_000;
/** A database slower than this to answer one query is shown as degraded. */
export const SLOW_DATABASE_MS = 1_500;

export class HealthError extends Error {
  readonly exposeDetail = true;

  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'HealthError';
  }
}

export interface RecentAlert {
  readonly id: string;
  readonly kind: OperatorAlertKind;
  readonly summary: string;
  readonly outcome: AlertOutcome;
  readonly occurredAt: Date;
}

export interface HealthRepository extends AlertEventStore {
  recentAlerts(limit: number): Promise<RecentAlert[]>;
  pruneAlerts(before: Date): Promise<number>;
  /** When the daily clean-up last ran on its own (not started by an administrator). */
  lastScheduledRetention(institutionId: string): Promise<Date | null>;
}

export class PostgresHealthRepository implements HealthRepository {
  readonly #database: DatabaseClient;

  constructor(database: DatabaseClient) {
    this.#database = database;
  }

  async record(alert: OperatorAlert, outcome: AlertOutcome): Promise<void> {
    await this.#database.insert(operatorAlertEvents).values({
      kind: alert.kind,
      summary: alert.summary.slice(0, 300),
      fingerprint: alert.fingerprint.slice(0, 24),
      outcome,
      occurredAt: alert.occurredAt,
    });
  }

  async recentAlerts(limit: number): Promise<RecentAlert[]> {
    const rows = await this.#database
      .select()
      .from(operatorAlertEvents)
      .orderBy(desc(operatorAlertEvents.occurredAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as OperatorAlertKind,
      summary: row.summary,
      outcome: row.outcome as AlertOutcome,
      occurredAt: row.occurredAt,
    }));
  }

  async pruneAlerts(before: Date): Promise<number> {
    const rows = await this.#database
      .delete(operatorAlertEvents)
      .where(lt(operatorAlertEvents.occurredAt, before))
      .returning({ id: operatorAlertEvents.id });
    return rows.length;
  }

  async lastScheduledRetention(institutionId: string): Promise<Date | null> {
    const result = await this.#database.execute<{ created_at: Date | string }>(sql`
      select ev.created_at from student_audit_events ev
      where ev.institution_id = ${institutionId}::uuid and ev.action = 'retention_run'
        and ev.subject_user_id is null and ev.actor_user_id is null
      order by ev.created_at desc
      limit 1
    `);
    const value = result.rows[0]?.created_at;
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
  }
}

/** For tests and development without a database. */
export class MemoryHealthRepository implements HealthRepository {
  readonly alerts: RecentAlert[] = [];
  lastRetention: Date | null = null;
  #next = 0;

  async record(alert: OperatorAlert, outcome: AlertOutcome): Promise<void> {
    this.alerts.unshift({ id: `alert-${++this.#next}`, kind: alert.kind, summary: alert.summary, outcome, occurredAt: alert.occurredAt });
  }

  async recentAlerts(limit: number): Promise<RecentAlert[]> {
    return [...this.alerts].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, limit);
  }

  async pruneAlerts(before: Date): Promise<number> {
    const keep = this.alerts.filter((alert) => alert.occurredAt >= before);
    const removed = this.alerts.length - keep.length;
    this.alerts.splice(0, this.alerts.length, ...keep);
    return removed;
  }

  async lastScheduledRetention(): Promise<Date | null> {
    return this.lastRetention;
  }
}

export interface HealthServiceOptions {
  readonly repository: HealthRepository;
  readonly email?: ProviderChain | undefined;
  readonly signals?: Pick<SignalMonitor, 'snapshot'> | undefined;
  readonly checkDatabase?: () => Promise<void>;
  readonly checkSchema?: () => Promise<'current' | 'behind' | 'unknown'>;
  readonly poolStats?: () => { total: number; idle: number; waiting: number; max: number };
  readonly alertRecipients: number;
  readonly cronConfigured: boolean;
  readonly googleConfigured: boolean;
  /** FACE_CHECK: whether check-ins compare faces at all. */
  readonly faceCheck?: 'required' | 'off';
  readonly rateLimitStore: SystemHealth['rateLimitStore'];
  readonly release: SystemHealth['release'];
  readonly now?: () => Date;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export class HealthService {
  readonly #options: HealthServiceOptions;
  readonly #now: () => Date;
  #publicStatus: { readonly at: number; readonly value: Promise<PublicStatus> } | null = null;

  constructor(options: HealthServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async report(account: AuthenticatedAccount): Promise<SystemHealth> {
    if (account.accountType !== 'administrator' || account.role !== 'institution_administrator') {
      throw new HealthError(403, 'Only institution administrators can open System health.');
    }
    const options = this.#options;
    const now = this.#now();

    let databaseStatus: 'up' | 'down' = 'down';
    let latencyMs: number | null = null;
    if (options.checkDatabase) {
      const started = performance.now();
      try {
        await options.checkDatabase();
        databaseStatus = 'up';
        latencyMs = Math.round(performance.now() - started);
      } catch {
        databaseStatus = 'down';
      }
    }
    const schema = databaseStatus === 'up' && options.checkSchema ? await options.checkSchema().catch(() => 'unknown' as const) : 'unknown';

    const [email, alerts, signals, lastRun] = await Promise.all([
      options.email ? options.email.status(7).catch(() => null) : Promise.resolve(null),
      options.repository.recentAlerts(20).catch((): RecentAlert[] => []),
      options.signals ? options.signals.snapshot().catch(() => []) : Promise.resolve([]),
      options.cronConfigured ? options.repository.lastScheduledRetention(account.institutionId).catch(() => null) : Promise.resolve(null),
    ]);

    const cronState: SystemHealth['cron']['state'] = !options.cronConfigured
      ? 'off'
      : !lastRun ? 'never' : now.getTime() - lastRun.getTime() > CRON_LATE_AFTER ? 'late' : 'ok';

    const providers = (email?.providers ?? []).map((provider) => ({
      provider: provider.provider,
      role: provider.role,
      limit: provider.limit,
      sentToday: provider.sentToday,
      failedToday: provider.failedToday,
      lastSuccessAt: iso(provider.lastSuccessAt),
      lastFailureAt: iso(provider.lastFailureAt),
      lastFailureKind: provider.lastFailureKind,
      lastFailureReason: provider.lastFailureReason,
      pausedUntil: iso(provider.pausedUntil),
      state: provider.state,
      history: [...provider.history],
    }));

    const recentFailing = alerts.some((alert) => alert.kind === 'email_failing' && now.getTime() - alert.occurredAt.getTime() < 30 * 60_000);
    const down = databaseStatus === 'down' || schema === 'behind' || !options.email || recentFailing || (providers.length > 0 && providers.every((provider) => provider.state !== 'ready'));
    const attention = cronState === 'late' || cronState === 'never'
      || providers.some((provider) => provider.state !== 'ready')
      || signals.some((signal) => signal.count >= signal.threshold)
      || alerts.some((alert) => now.getTime() - alert.occurredAt.getTime() < 6 * 60 * 60_000 && alert.kind !== 'email_quota');

    return {
      checkedAt: now.toISOString(),
      overall: down ? 'down' : attention ? 'attention' : 'ok',
      database: {
        status: databaseStatus,
        latencyMs,
        schema,
        migration: LATEST_MIGRATION.tag,
        pool: options.poolStats ? options.poolStats() : null,
      },
      email: {
        configured: Boolean(options.email),
        current: email?.current ?? null,
        providers,
        days: [...(email?.days ?? [])],
        alertsEmailing: Boolean(options.email) && options.alertRecipients > 0,
        alertRecipients: options.alertRecipients,
      },
      alerts: alerts.map((alert): HealthAlert => ({
        id: alert.id,
        kind: alert.kind,
        summary: alert.summary,
        outcome: alert.outcome,
        occurredAt: alert.occurredAt.toISOString(),
      })),
      signals,
      cron: { configured: options.cronConfigured, lastRunAt: iso(lastRun), state: cronState },
      google: { configured: options.googleConfigured },
      rateLimitStore: options.rateLimitStore,
      release: options.release,
    };
  }

  /**
   * Public status for the independent status page (ADR 034): coarse states only.
   * No sign-in needed, so it holds nothing an outsider should not see, and one
   * answer is reused for PUBLIC_STATUS_TTL so it cannot be used to load the database.
   */
  publicStatus(): Promise<PublicStatus> {
    const now = this.#now().getTime();
    const cached = this.#publicStatus;
    if (cached && now - cached.at < PUBLIC_STATUS_TTL) return cached.value;
    const value = this.#computePublicStatus().catch((error: unknown) => {
      // Never keep a failed answer: the next probe asks again.
      this.#publicStatus = null;
      throw error;
    });
    this.#publicStatus = { at: now, value };
    return value;
  }

  async #computePublicStatus(): Promise<PublicStatus> {
    const options = this.#options;
    const now = this.#now();

    let core: PublicComponentState = 'down';
    if (options.checkDatabase) {
      const started = performance.now();
      try {
        await options.checkDatabase();
        const elapsed = performance.now() - started;
        const schema = options.checkSchema ? await options.checkSchema().catch(() => 'unknown' as const) : 'unknown';
        core = schema === 'behind' ? 'down' : elapsed > SLOW_DATABASE_MS ? 'degraded' : 'operational';
      } catch {
        core = 'down';
      }
    }

    const reachable = core !== 'down';
    const [email, alerts, signals] = reachable
      ? await Promise.all([
          options.email ? options.email.status(1).catch(() => null) : Promise.resolve(null),
          options.repository.recentAlerts(20).catch((): RecentAlert[] => []),
          options.signals ? options.signals.snapshot().catch(() => []) : Promise.resolve([]),
        ])
      : [null, [] as RecentAlert[], []];
    const over = (name: string) => signals.some((signal) => signal.signal === name && signal.count >= signal.threshold);

    // Emails go out while any provider will take them; a used-up primary with a working
    // fallback is invisible to students. Down when every provider is skipped or sending
    // has failed in the last 30 minutes.
    const recentEmailFailure = alerts.some((alert) => alert.kind === 'email_failing' && now.getTime() - alert.occurredAt.getTime() < 30 * 60_000);
    const emailState: PublicComponentState = !options.email
      ? 'down'
      : !reachable
        ? 'down'
        : recentEmailFailure || (email !== null && email.current === null)
          ? 'down'
          : email === null ? 'degraded' : 'operational';

    return {
      service: 'lasuatos',
      checkedAt: now.toISOString(),
      components: {
        core,
        errors: over('server_errors') ? 'degraded' : 'operational',
        email: emailState,
        google: !options.googleConfigured ? 'off' : !reachable ? 'down' : over('google_broken') ? 'degraded' : 'operational',
        face: options.faceCheck === 'off' ? 'off' : !reachable ? 'down' : over('face_unavailable') ? 'down' : 'operational',
      },
    };
  }

  /** Daily retention: alert history after 30 days, email counts after 90. */
  async prune(): Promise<{ alerts: number; emailDays: number }> {
    const now = this.#now();
    const alerts = await this.#options.repository.pruneAlerts(new Date(now.getTime() - ALERT_HISTORY_DAYS * DAY)).catch(() => 0);
    const emailDays = this.#options.email
      ? await this.#options.email.usage.prune(utcDay(new Date(now.getTime() - EMAIL_HISTORY_DAYS * DAY))).catch(() => 0)
      : 0;
    return { alerts, emailDays };
  }
}
