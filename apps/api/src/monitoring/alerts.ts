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

export type OperatorAlertKind = 'server_error' | 'page_error' | 'schema_behind';

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

const REPEAT_AFTER: Record<OperatorAlertKind, number> = {
  server_error: 30 * MINUTE,
  page_error: 60 * MINUTE,
  schema_behind: 6 * HOUR,
};

/** Keeps alert text short and free of anything that looks like a secret. */
export function scrubAlertText(value: string, maxLength = 300): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://[hidden]')
    .replace(/\b(?:xkeysib|re|sk|pk)[-_][A-Za-z0-9_-]{12,}/g, '[hidden-key]')
    .replace(/\b(token|password|secret|cookie|authorization)=[^\s&;]+/gi, '$1=[hidden]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function fingerprintOf(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);
}

export class OperatorAlerts {
  readonly #recipients: readonly string[];
  readonly #sender: OperatorAlertSender | undefined;
  readonly #limiter: Pick<RateLimiter, 'consume'> | undefined;
  readonly #log: AlertLog;

  constructor(options: {
    readonly recipients: readonly string[];
    readonly sender?: OperatorAlertSender | undefined;
    readonly limiter?: Pick<RateLimiter, 'consume'> | undefined;
    readonly log: AlertLog;
  }) {
    this.#recipients = options.recipients;
    this.#sender = options.sender;
    this.#limiter = options.limiter;
    this.#log = options.log;
  }

  /** True when alerts can actually be emailed (recipients and a provider are set). */
  get emailing(): boolean {
    return this.#recipients.length > 0 && this.#sender !== undefined;
  }

  /**
   * Logs the alert and emails it unless the same problem was emailed recently.
   * Never throws: monitoring must not break the request that tripped it.
   */
  async report(alert: OperatorAlert): Promise<'emailed' | 'throttled' | 'logged'> {
    this.#log.error({ alert: alert.kind, fingerprint: alert.fingerprint, ...alert.details }, `Operator alert: ${alert.summary}`);
    if (!this.emailing) return 'logged';
    try {
      if (this.#limiter) {
        const decision = await this.#limiter.consume([
          { name: 'operator-alert:repeat', subject: `${alert.kind}:${alert.fingerprint}`, limit: 1, windowMilliseconds: REPEAT_AFTER[alert.kind] },
          { name: 'operator-alert:daily', subject: 'all', limit: DAILY_ALERT_LIMIT, windowMilliseconds: 24 * HOUR },
        ]);
        if (!decision.allowed) return 'throttled';
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
