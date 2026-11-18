import { createHash } from 'node:crypto';
import type { RateLimiter } from '../security/rate-limit.js';

/**
 * Operator alerts: tell the people running LASUATOS when something breaks,
 * instead of waiting for a lecturer to complain. Alerts are emailed (through
 * the configured email provider) to ALERT_EMAIL and always logged.
 *
 * Email is throttled through the shared rate-limit store, so every serverless
 * instance agrees: the same problem is emailed at most once per `repeatAfter`
 * and no more than DAILY_ALERT_LIMIT alerts go out per day, which keeps a
 * crash loop from using up the free plan's 300 emails/day.
 */

export type OperatorAlertKind =
  | 'server_error'
  | 'page_error'
  | 'schema_behind'
  // ADR 029: email delivery and trends.
  | 'email_failover'
  | 'email_failing'
  | 'email_quota'
  | 'error_rate'
  | 'rate_limited'
  | 'sign_in_failures'
  | 'google_failing'
  // ADR 035: database backups.
  | 'backup_failed'
  | 'backup_late';

export const OPERATOR_ALERT_KINDS: readonly OperatorAlertKind[] = [
  'server_error', 'page_error', 'schema_behind', 'email_failover', 'email_failing', 'email_quota', 'error_rate', 'rate_limited', 'sign_in_failures', 'google_failing',
  'backup_failed', 'backup_late',
];

export type AlertOutcome = 'emailed' | 'throttled' | 'logged';

/** Keeps a short history of alerts for the System health page (ADR 029). */
export interface AlertEventStore {
  record(alert: OperatorAlert, outcome: AlertOutcome): Promise<void>;
}

export interface OperatorAlert {
  readonly kind: OperatorAlertKind;
  /** One line, e.g. "POST /api/v1/lecture/check-in failed (TypeError)". */
  readonly summary: string;
  /** Short facts for whoever fixes it. Never passwords, tokens or cookies. */
  readonly details: Readonly<Record<string, string>>;
  /** Groups repeats of the same problem (route + error name, page + message…). */
  readonly fingerprint: string;
  readonly occurredAt: Date;
}

export interface OperatorAlertEmail extends OperatorAlert {
  readonly to: string;
}

export interface OperatorAlertSender {
  sendOperatorAlert(email: OperatorAlertEmail): Promise<void>;
}

export interface AlertLog {
  error(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAILY_ALERT_LIMIT = 20;
/**
 * Page errors come from browsers, and anyone can send one: they get a share of
 * the day's emails of their own, checked first, so made-up reports cannot use
 * up the budget that server alerts need (ADR 033).
 */
export const DAILY_PAGE_ERROR_LIMIT = 5;

const REPEAT_AFTER: Record<OperatorAlertKind, number> = {
  server_error: 30 * MINUTE,
  page_error: 60 * MINUTE,
  schema_behind: 6 * HOUR,
  email_failover: 6 * HOUR,
  email_failing: 30 * MINUTE,
  email_quota: 12 * HOUR,
  error_rate: HOUR,
  rate_limited: HOUR,
  sign_in_failures: HOUR,
  google_failing: HOUR,
  // A failed night is told once; a manual re-run that fails again within 6 hours is not.
  backup_failed: 6 * HOUR,
  // Checked once a day by the clean-up job, so this is "once a day while it lasts".
  backup_late: 20 * HOUR,
};

/**
 * Keeps alert text short and free of anything that looks like a secret or an
 * email address (a provider's refusal can quote the recipient). Alert records
 * hold no personal data: the privacy notice says so.
 */
export function scrubAlertText(value: string, maxLength = 300): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://[hidden]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(?:xkeysib|re|sk|pk)[-_][A-Za-z0-9_-]{12,}/g, '[hidden-key]')
    .replace(/\b(token|password|secret|cookie|authorization)=[^\s&;]+/gi, '$1=[hidden]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * "Chrome 131 on Android 14" from a browser's user-agent string: enough to
 * reproduce a crash, without the phone model or build numbers that narrow it
 * down to one person's phone (the contact page describes a device the same way).
 */
export function coarseBrowser(userAgent: string): string {
  const ua = userAgent.slice(0, 400);
  const version = (pattern: RegExp) => pattern.exec(ua)?.[1];
  const browser = /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook in-app browser'
    : /Instagram/.test(ua) ? 'Instagram in-app browser'
      : version(/Edg(?:A|iOS)?\/(\d+)/) ? `Edge ${version(/Edg(?:A|iOS)?\/(\d+)/)}`
        : version(/OPR\/(\d+)/) ? `Opera ${version(/OPR\/(\d+)/)}`
          : version(/SamsungBrowser\/(\d+)/) ? `Samsung Internet ${version(/SamsungBrowser\/(\d+)/)}`
            : version(/(?:Firefox|FxiOS)\/(\d+)/) ? `Firefox ${version(/(?:Firefox|FxiOS)\/(\d+)/)}`
              : version(/(?:Chrome|CriOS)\/(\d+)/) ? `Chrome ${version(/(?:Chrome|CriOS)\/(\d+)/)}`
                : version(/Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari/) ? `Safari ${version(/Version\/(\d+)/)}`
                  : 'Another browser';
  const system = version(/Android (\d+)/) ? `Android ${version(/Android (\d+)/)}`
    : /iPhone|iPad|iPod/.test(ua) ? `iOS${version(/OS (\d+)_/) ? ` ${version(/OS (\d+)_/)}` : ''}`
      : /Windows NT/.test(ua) ? 'Windows'
        : /CrOS/.test(ua) ? 'ChromeOS'
          : /Mac OS X/.test(ua) ? 'macOS'
            : /Linux/.test(ua) ? 'Linux' : 'another system';
  return `${browser} on ${system}`;
}

export function fingerprintOf(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);
}

export class OperatorAlerts {
  readonly #recipients: readonly string[];
  readonly #sender: OperatorAlertSender | undefined;
  readonly #limiter: Pick<RateLimiter, 'consume'> | undefined;
  readonly #log: AlertLog;
  readonly #history: AlertEventStore | undefined;

  constructor(options: {
    readonly recipients: readonly string[];
    readonly sender?: OperatorAlertSender | undefined;
    readonly limiter?: Pick<RateLimiter, 'consume'> | undefined;
    readonly log: AlertLog;
    readonly history?: AlertEventStore | undefined;
  }) {
    this.#recipients = options.recipients;
    this.#sender = options.sender;
    this.#limiter = options.limiter;
    this.#log = options.log;
    this.#history = options.history;
  }

  /** True when alerts can actually be emailed (recipients and a provider are set). */
  get emailing(): boolean {
    return this.#recipients.length > 0 && this.#sender !== undefined;
  }

  /**
   * Logs the alert and emails it unless the same problem was emailed recently.
   * Never throws: monitoring must not break the request that tripped it.
   */
  async report(alert: OperatorAlert): Promise<AlertOutcome> {
    const outcome = await this.#deliver(alert);
    if (this.#history) {
      await this.#history.record(alert, outcome).catch((error: unknown) => {
        this.#log.warn({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Operator alert could not be saved for System health');
      });
    }
    return outcome;
  }

  async #deliver(alert: OperatorAlert): Promise<AlertOutcome> {
    this.#log.error({ alert: alert.kind, fingerprint: alert.fingerprint, ...alert.details }, `Operator alert: ${alert.summary}`);
    if (!this.emailing) return 'logged';
    try {
      if (this.#limiter) {
        if (alert.kind === 'page_error') {
          const pages = await this.#limiter.consume([
            { name: 'operator-alert:repeat', subject: `${alert.kind}:${alert.fingerprint}`, limit: 1, windowMilliseconds: REPEAT_AFTER[alert.kind] },
            { name: 'operator-alert:daily:page', subject: 'all', limit: DAILY_PAGE_ERROR_LIMIT, windowMilliseconds: 24 * HOUR },
          ]);
          if (!pages.allowed) return 'throttled';
          const daily = await this.#limiter.consume([{ name: 'operator-alert:daily', subject: 'all', limit: DAILY_ALERT_LIMIT, windowMilliseconds: 24 * HOUR }]);
          if (!daily.allowed) return 'throttled';
        } else {
          const decision = await this.#limiter.consume([
            { name: 'operator-alert:repeat', subject: `${alert.kind}:${alert.fingerprint}`, limit: 1, windowMilliseconds: REPEAT_AFTER[alert.kind] },
            { name: 'operator-alert:daily', subject: 'all', limit: DAILY_ALERT_LIMIT, windowMilliseconds: 24 * HOUR },
          ]);
          if (!decision.allowed) return 'throttled';
        }
      }
      await Promise.all(this.#recipients.map((to) => this.#sender!.sendOperatorAlert({ ...alert, to })));
      return 'emailed';
    } catch (error) {
      this.#log.warn({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Operator alert email could not be sent');
      return 'logged';
    }
  }
}

/** Waits for `work`, but never longer than `milliseconds` (serverless responses must not hang on email). */
export async function within<T>(work: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), milliseconds); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
