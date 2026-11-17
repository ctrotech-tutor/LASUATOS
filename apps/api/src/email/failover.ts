import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import { emailProviderDays, type DatabaseClient } from '@lasuatos/database';
import { EmailDeliveryError, emailFailureKind, emailFailureReason, type EmailFailureKind } from './errors.js';
import type { OutgoingMessage } from './messages.js';

/**
 * Email provider failover (ADR 029).
 *
 * The free plans cap each provider per day (Brevo 300, Resend 100, Gmail about 500),
 * and a lecture-start rush of sign-up codes can use Brevo's allowance by noon. The
 * chain sends through the first provider that is not known to be out of quota or
 * broken, and moves on to the next one when a provider refuses:
 *
 * - every send and refusal is counted per provider per UTC day in Postgres, so all
 *   serverless instances share one picture (no cold instance wastes 15 seconds on a
 *   provider another instance already found exhausted);
 * - a provider that reached its daily limit, or refused for quota, setup or network
 *   reasons, is skipped until a pause runs out (midnight UTC for a used-up quota);
 * - skipped providers are still tried last, so the bookkeeping can never be the
 *   reason an email is not sent;
 * - an address that cannot receive mail fails at once (another provider would
 *   refuse it too).
 *
 * The counts hold no addresses or content. Store failures never stop a send.
 */

export type EmailProviderName = 'brevo' | 'gmail' | 'resend' | 'mailpit';

export const EMAIL_PROVIDER_LABEL: Readonly<Record<EmailProviderName, string>> = {
  brevo: 'Brevo',
  gmail: 'Gmail',
  resend: 'Resend',
  mailpit: 'Mailpit',
};

/** Free-plan daily allowances; EMAIL_DAILY_LIMITS overrides them. Null: no limit. */
export const DEFAULT_DAILY_LIMITS: Readonly<Record<EmailProviderName, number | null>> = {
  brevo: 300,
  resend: 100,
  gmail: 500,
  mailpit: null,
};

/** Share of the daily limit at which the operator is warned. */
export const NEARLY_FULL_SHARE = 0.9;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface Mailer {
  readonly provider: EmailProviderName;
  deliver(message: OutgoingMessage): Promise<void>;
}

export interface ProviderDayRecord {
  readonly provider: EmailProviderName;
  /** UTC date, YYYY-MM-DD. */
  readonly day: string;
  readonly sent: number;
  readonly failed: number;
  readonly lastSuccessAt: Date | null;
  readonly lastFailureAt: Date | null;
  readonly lastFailureKind: EmailFailureKind | null;
  readonly lastFailureReason: string | null;
  readonly pausedUntil: Date | null;
}

export interface ProviderFailure {
  readonly kind: EmailFailureKind;
  readonly reason: string;
  readonly pausedUntil: Date | null;
}

export interface EmailUsageStore {
  /** Rows for these providers on these UTC days (missing rows mean nothing happened). */
  read(providers: readonly EmailProviderName[], days: readonly string[]): Promise<ProviderDayRecord[]>;
  /** Counts a delivery, clears any pause, and returns the provider's count for the day. */
  recordSent(provider: EmailProviderName, now: Date): Promise<number>;
  recordFailure(provider: EmailProviderName, now: Date, failure: ProviderFailure): Promise<void>;
  /** Deletes rows for days before `day`; returns how many. */
  prune(day: string): Promise<number>;
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The UTC days ending with `at`, oldest first. */
export function utcDays(at: Date, count: number): string[] {
  const days: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    days.push(utcDay(new Date(at.getTime() - offset * 24 * HOUR)));
  }
  return days;
}

export function nextUtcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
}

/**
 * How long every instance skips a provider after a refusal. Brevo and Resend reset
 * their daily allowance at midnight UTC; Gmail's window rolls over 24 hours, so it is
 * retried every few hours rather than locked out for a day.
 */
export function pauseUntil(provider: EmailProviderName, kind: EmailFailureKind, now: Date): Date | null {
  switch (kind) {
    case 'quota':
      return provider === 'gmail' ? new Date(now.getTime() + 3 * HOUR) : nextUtcMidnight(now);
    case 'setup':
      return new Date(now.getTime() + 30 * MINUTE);
    case 'network':
    case 'unknown':
      return new Date(now.getTime() + 2 * MINUTE);
    case 'recipient':
      return null;
  }
}

export type SkipReason = 'paused' | 'full' | EmailFailureKind;

export interface ProviderAttempt {
  readonly provider: EmailProviderName;
  readonly why: SkipReason;
  readonly reason: string;
  readonly until: Date | null;
}

export type EmailChainEvent =
  /** A provider refused during this send, and a later one delivered it. */
  | { readonly type: 'failover'; readonly delivered: EmailProviderName; readonly failed: readonly ProviderAttempt[] }
  /** Every provider refused: the email was not sent. */
  | { readonly type: 'all_failed'; readonly attempts: readonly ProviderAttempt[] }
  /** A provider just reached 90% (or all) of its daily limit. */
  | { readonly type: 'quota'; readonly provider: EmailProviderName; readonly sent: number; readonly limit: number; readonly next: EmailProviderName | null };

export interface ProviderStatus {
  readonly provider: EmailProviderName;
  readonly role: 'primary' | 'fallback';
  readonly limit: number | null;
  readonly sentToday: number;
  readonly failedToday: number;
  readonly lastSuccessAt: Date | null;
  readonly lastFailureAt: Date | null;
  readonly lastFailureKind: EmailFailureKind | null;
  readonly lastFailureReason: string | null;
  readonly pausedUntil: Date | null;
  /** `ready`: will be tried in order; `paused`: skipped after a refusal; `full`: used its daily limit. */
  readonly state: 'ready' | 'paused' | 'full';
  /** Sent per UTC day, oldest first (same days as EmailChainStatus.days). */
  readonly history: readonly number[];
}

export interface EmailChainStatus {
  readonly days: readonly string[];
  readonly providers: readonly ProviderStatus[];
  /** The provider the next email goes through, or null when every one is skipped (all are then tried anyway). */
  readonly current: EmailProviderName | null;
}

interface ProviderView {
  sent: number;
  failed: number;
  pausedUntil: Date | null;
  last: ProviderDayRecord | null;
}

/** Process-local usage counts, for development, tests and the operator commands. */
export class MemoryEmailUsageStore implements EmailUsageStore {
  readonly #rows = new Map<string, ProviderDayRecord>();

  async read(providers: readonly EmailProviderName[], days: readonly string[]): Promise<ProviderDayRecord[]> {
    const rows: ProviderDayRecord[] = [];
    for (const day of days) {
      for (const provider of providers) {
        const row = this.#rows.get(`${provider}|${day}`);
        if (row) rows.push(row);
      }
    }
    return rows;
  }

  #row(provider: EmailProviderName, day: string): ProviderDayRecord {
    return this.#rows.get(`${provider}|${day}`) ?? {
      provider, day, sent: 0, failed: 0, lastSuccessAt: null, lastFailureAt: null, lastFailureKind: null, lastFailureReason: null, pausedUntil: null,
    };
  }

  async recordSent(provider: EmailProviderName, now: Date): Promise<number> {
    const day = utcDay(now);
    const row = this.#row(provider, day);
    const next = { ...row, sent: row.sent + 1, lastSuccessAt: now, pausedUntil: null };
    this.#rows.set(`${provider}|${day}`, next);
    // A pause carried over from yesterday is lifted too.
    for (const [key, value] of this.#rows) {
      if (value.provider === provider && value.pausedUntil) this.#rows.set(key, { ...value, pausedUntil: null });
    }
    return next.sent;
  }

  async recordFailure(provider: EmailProviderName, now: Date, failure: ProviderFailure): Promise<void> {
    const day = utcDay(now);
    const row = this.#row(provider, day);
    this.#rows.set(`${provider}|${day}`, {
      ...row,
      failed: row.failed + 1,
      lastFailureAt: now,
      lastFailureKind: failure.kind,
      lastFailureReason: failure.reason.slice(0, 400),
      pausedUntil: failure.pausedUntil ?? row.pausedUntil,
    });
  }

  async prune(day: string): Promise<number> {
    let deleted = 0;
    for (const [key, value] of this.#rows) {
      if (value.day < day) {
        this.#rows.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

/** Usage counts shared by every API instance (table email_provider_days). */
export class PostgresEmailUsageStore implements EmailUsageStore {
  readonly #database: Pick<DatabaseClient, 'insert' | 'select' | 'update' | 'delete'>;

  constructor(database: Pick<DatabaseClient, 'insert' | 'select' | 'update' | 'delete'>) {
    this.#database = database;
  }

  async read(providers: readonly EmailProviderName[], days: readonly string[]): Promise<ProviderDayRecord[]> {
    if (!providers.length || !days.length) return [];
    const rows = await this.#database
      .select()
      .from(emailProviderDays)
      .where(and(inArray(emailProviderDays.provider, [...providers]), inArray(emailProviderDays.day, [...days])));
    return rows.map((row) => ({
      provider: row.provider as EmailProviderName,
      day: row.day,
      sent: Number(row.sent),
      failed: Number(row.failed),
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
      lastFailureKind: (row.lastFailureKind as EmailFailureKind | null) ?? null,
      lastFailureReason: row.lastFailureReason,
      pausedUntil: row.pausedUntil,
    }));
  }

  async recordSent(provider: EmailProviderName, now: Date): Promise<number> {
    const day = utcDay(now);
    const [row] = await this.#database
      .insert(emailProviderDays)
      .values({ provider, day, sent: 1, lastSuccessAt: now })
      .onConflictDoUpdate({
        target: [emailProviderDays.provider, emailProviderDays.day],
        set: { sent: sql`${emailProviderDays.sent} + 1`, lastSuccessAt: now, pausedUntil: null },
      })
      .returning({ sent: emailProviderDays.sent });
    // A pause set late yesterday (a Gmail quota pause runs past midnight) is lifted by a success.
    await this.#database
      .update(emailProviderDays)
      .set({ pausedUntil: null })
      .where(and(inArray(emailProviderDays.provider, [provider]), lt(emailProviderDays.day, day), gte(emailProviderDays.pausedUntil, now)));
    return row ? Number(row.sent) : 1;
  }

  async recordFailure(provider: EmailProviderName, now: Date, failure: ProviderFailure): Promise<void> {
    const reason = failure.reason.slice(0, 400);
    await this.#database
      .insert(emailProviderDays)
      .values({
        provider,
        day: utcDay(now),
        failed: 1,
        lastFailureAt: now,
        lastFailureKind: failure.kind,
        lastFailureReason: reason,
        pausedUntil: failure.pausedUntil,
      })
      .onConflictDoUpdate({
        target: [emailProviderDays.provider, emailProviderDays.day],
        set: {
          failed: sql`${emailProviderDays.failed} + 1`,
          lastFailureAt: now,
          lastFailureKind: failure.kind,
          lastFailureReason: reason,
          ...(failure.pausedUntil ? { pausedUntil: failure.pausedUntil } : {}),
        },
      });
  }

  async prune(day: string): Promise<number> {
    const deleted = await this.#database
      .delete(emailProviderDays)
      .where(lt(emailProviderDays.day, day))
      .returning({ provider: emailProviderDays.provider });
    return deleted.length;
  }
}

export interface ProviderChainOptions {
  readonly mailers: readonly Mailer[];
  readonly limits?: Partial<Record<EmailProviderName, number | null>>;
  readonly usage?: EmailUsageStore;
  readonly now?: () => Date;
  /** Told about failovers, total failures and quotas running out (for operator alerts). */
  readonly onEvent?: (event: EmailChainEvent) => Promise<void> | void;
  /** Told when the usage store fails (the send carries on regardless). */
  readonly onStoreError?: (error: unknown) => void;
}

export interface ChainDeliveryOptions {
  /**
   * True for operator alerts themselves: they fail over like any email, but raise no
   * events (an alert about failing email must not trigger another alert).
   */
  readonly quiet?: boolean;
}

export class ProviderChain {
  readonly #mailers: readonly Mailer[];
  readonly #limits: Readonly<Record<EmailProviderName, number | null>>;
  readonly #usage: EmailUsageStore;
  readonly #now: () => Date;
  readonly #onEvent: ProviderChainOptions['onEvent'];
  readonly #onStoreError: ProviderChainOptions['onStoreError'];

  constructor(options: ProviderChainOptions) {
    if (!options.mailers.length) throw new Error('An email provider chain needs at least one provider.');
    this.#mailers = options.mailers;
    this.#limits = { ...DEFAULT_DAILY_LIMITS, ...options.limits };
    this.#usage = options.usage ?? new MemoryEmailUsageStore();
    this.#now = options.now ?? (() => new Date());
    this.#onEvent = options.onEvent;
    this.#onStoreError = options.onStoreError;
  }

  get providers(): readonly EmailProviderName[] {
    return this.#mailers.map((mailer) => mailer.provider);
  }

  get usage(): EmailUsageStore {
    return this.#usage;
  }

  limitOf(provider: EmailProviderName): number | null {
    return this.#limits[provider];
  }

  async #views(now: Date): Promise<Map<EmailProviderName, ProviderView>> {
    const views = new Map<EmailProviderName, ProviderView>();
    const [yesterday, today] = utcDays(now, 2) as [string, string];
    let rows: ProviderDayRecord[] = [];
    try {
      rows = await this.#usage.read(this.providers, [yesterday, today]);
    } catch (error) {
      this.#onStoreError?.(error);
    }
    for (const provider of this.providers) views.set(provider, { sent: 0, failed: 0, pausedUntil: null, last: null });
    for (const row of rows) {
      const view = views.get(row.provider);
      if (!view) continue;
      if (row.day === today) {
        view.sent = row.sent;
        view.failed = row.failed;
        view.last = row;
      }
      if (row.pausedUntil && (!view.pausedUntil || row.pausedUntil > view.pausedUntil)) view.pausedUntil = row.pausedUntil;
    }
    return views;
  }

  #skip(provider: EmailProviderName, view: ProviderView | undefined, now: Date): 'paused' | 'full' | null {
    if (!view) return null;
    if (view.pausedUntil && view.pausedUntil > now) return 'paused';
    const limit = this.#limits[provider];
    if (limit !== null && view.sent >= limit) return 'full';
    return null;
  }

  async #emit(event: EmailChainEvent, options: ChainDeliveryOptions): Promise<void> {
    if (options.quiet || !this.#onEvent) return;
    try {
      await this.#onEvent(event);
    } catch {
      // Alerts must never change the outcome of a send.
    }
  }

  async deliver(message: OutgoingMessage, options: ChainDeliveryOptions = {}): Promise<void> {
    const now = this.#now();
    const views = await this.#views(now);
    const ready: Mailer[] = [];
    const skipped: Mailer[] = [];
    for (const mailer of this.#mailers) {
      (this.#skip(mailer.provider, views.get(mailer.provider), now) ? skipped : ready).push(mailer);
    }

    const failed: ProviderAttempt[] = [];
    let firstError: unknown;
    // Skipped providers go last rather than not at all.
    for (const mailer of [...ready, ...skipped]) {
      try {
        await mailer.deliver(message);
      } catch (error) {
        firstError ??= error;
        const kind = emailFailureKind(error);
        const reason = emailFailureReason(error);
        const until = pauseUntil(mailer.provider, kind, this.#now());
        failed.push({ provider: mailer.provider, why: kind, reason, until });
        await this.#usage.recordFailure(mailer.provider, this.#now(), { kind, reason, pausedUntil: until }).catch((storeError: unknown) => this.#onStoreError?.(storeError));
        if (kind === 'recipient') throw error;
        continue;
      }

      const sent = await this.#usage.recordSent(mailer.provider, this.#now()).catch((storeError: unknown) => {
        this.#onStoreError?.(storeError);
        return null;
      });
      if (failed.length) await this.#emit({ type: 'failover', delivered: mailer.provider, failed }, options);
      const limit = this.#limits[mailer.provider];
      if (sent !== null && limit !== null && (sent === limit || sent === Math.ceil(limit * NEARLY_FULL_SHARE))) {
        const next = this.#mailers.find((other) => other.provider !== mailer.provider && !failed.some((attempt) => attempt.provider === other.provider) && !this.#skip(other.provider, views.get(other.provider), now));
        await this.#emit({ type: 'quota', provider: mailer.provider, sent, limit, next: next?.provider ?? null }, options);
      }
      return;
    }

    await this.#emit({ type: 'all_failed', attempts: failed }, options);
    if (failed.length === 1) throw firstError;
    throw new EmailDeliveryError(
      `Every email provider refused the message. ${failed.map((attempt) => `${EMAIL_PROVIDER_LABEL[attempt.provider]}: ${attempt.reason}`).join(' | ')}`.slice(0, 1_200),
      failed[0]?.why === 'paused' || failed[0]?.why === 'full' ? 'unknown' : (failed[0]?.why ?? 'unknown'),
    );
  }

  /** Where each provider stands today, plus the last `days` days' counts (for System health). */
  async status(days = 7): Promise<EmailChainStatus> {
    const now = this.#now();
    const dayList = utcDays(now, days);
    const today = dayList.at(-1)!;
    const rows = await this.#usage.read(this.providers, utcDays(now, Math.max(days, 2)));
    const views = await this.#views(now);
    const providers = this.#mailers.map((mailer, index): ProviderStatus => {
      const view = views.get(mailer.provider)!;
      const todayRow = rows.find((row) => row.provider === mailer.provider && row.day === today) ?? null;
      const skip = this.#skip(mailer.provider, view, now);
      return {
        provider: mailer.provider,
        role: index === 0 ? 'primary' : 'fallback',
        limit: this.#limits[mailer.provider],
        sentToday: todayRow?.sent ?? 0,
        failedToday: todayRow?.failed ?? 0,
        lastSuccessAt: latest(rows, mailer.provider, 'lastSuccessAt'),
        lastFailureAt: latest(rows, mailer.provider, 'lastFailureAt'),
        lastFailureKind: latestRow(rows, mailer.provider)?.lastFailureKind ?? null,
        lastFailureReason: latestRow(rows, mailer.provider)?.lastFailureReason ?? null,
        pausedUntil: view.pausedUntil && view.pausedUntil > now ? view.pausedUntil : null,
        state: skip ?? 'ready',
        history: dayList.map((day) => rows.find((row) => row.provider === mailer.provider && row.day === day)?.sent ?? 0),
      };
    });
    return { days: dayList, providers, current: providers.find((provider) => provider.state === 'ready')?.provider ?? null };
  }
}

function latest(rows: readonly ProviderDayRecord[], provider: EmailProviderName, field: 'lastSuccessAt' | 'lastFailureAt'): Date | null {
  let best: Date | null = null;
  for (const row of rows) {
    const value = row[field];
    if (row.provider === provider && value && (!best || value > best)) best = value;
  }
  return best;
}

function latestRow(rows: readonly ProviderDayRecord[], provider: EmailProviderName): ProviderDayRecord | null {
  let best: ProviderDayRecord | null = null;
  for (const row of rows) {
    if (row.provider === provider && row.lastFailureAt && (!best?.lastFailureAt || row.lastFailureAt > best.lastFailureAt)) best = row;
  }
  return best;
}

/**
 * Reads EMAIL_DAILY_LIMITS, e.g. "brevo:300,gmail:450". `0` or `none` removes a limit
 * (a paid plan). Unknown providers and malformed entries are reported, not ignored.
 */
export function parseDailyLimits(value: string): { limits: Partial<Record<EmailProviderName, number | null>>; errors: string[] } {
  const limits: Partial<Record<EmailProviderName, number | null>> = {};
  const errors: string[] = [];
  for (const entry of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    const match = /^(brevo|gmail|resend|mailpit)\s*[:=]\s*(\d{1,7}|none)$/i.exec(entry);
    if (!match) {
      errors.push(`"${entry.slice(0, 40)}" is not provider:number (for example brevo:300).`);
      continue;
    }
    const provider = match[1]!.toLowerCase() as EmailProviderName;
    const amount = match[2]!.toLowerCase();
    limits[provider] = amount === 'none' || amount === '0' ? null : Number(amount);
  }
  return { limits, errors };
}
