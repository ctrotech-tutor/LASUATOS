import type { OperatorAlert, OperatorAlerts } from './alerts.js';

/**
 * Alerts when the rate-limit store keeps failing (ADR 036). Limits fail open, so
 * while the store is down every limit is off, and nothing else says so.
 *
 * Counted in memory on each instance, because the shared store is the thing that
 * is failing. One blip is normal (a cold connection, a timeout); five within five
 * minutes on one instance is an outage. After an alert the alarm stays quiet for
 * half an hour, set before reporting, so the report (whose own throttle goes back
 * through the failing store) cannot set off another report.
 */

export const STORE_FAILURE_THRESHOLD = 5;
export const STORE_FAILURE_WINDOW_MILLISECONDS = 5 * 60_000;
export const STORE_FAILURE_QUIET_MILLISECONDS = 30 * 60_000;

export class RateLimitStoreAlarm {
  readonly #alerts: Pick<OperatorAlerts, 'report'>;
  readonly #now: () => Date;
  #failures: number[] = [];
  #quietUntil = 0;

  constructor(options: { readonly alerts: Pick<OperatorAlerts, 'report'>; readonly now?: () => Date }) {
    this.#alerts = options.alerts;
    this.#now = options.now ?? (() => new Date());
  }

  /** Records one failure; alerts when they pile up. Never throws. */
  async failed(error: unknown): Promise<void> {
    const now = this.#now();
    const at = now.getTime();
    this.#failures = this.#failures.filter((time) => time > at - STORE_FAILURE_WINDOW_MILLISECONDS);
    this.#failures.push(at);
    if (at < this.#quietUntil || this.#failures.length < STORE_FAILURE_THRESHOLD) return;
    this.#quietUntil = at + STORE_FAILURE_QUIET_MILLISECONDS;
    this.#failures = [];
    const alert: OperatorAlert = {
      kind: 'rate_limit_store',
      summary: `rate limits are off: the limit store failed ${STORE_FAILURE_THRESHOLD} times in ${STORE_FAILURE_WINDOW_MILLISECONDS / 60_000} minutes`,
      details: {
        // The name only: a database error message can quote a connection string.
        error: error instanceof Error ? error.name : 'UnknownError',
        effect: 'Requests are still allowed (limits fail open), so sign-in and check-in work, but guessing and floods are not being slowed down.',
        fix: 'Check the database (Neon): is it up, over its connection or compute quota, or suspended? Check Vercel → Logs for "Rate-limit store failed". It recovers by itself once the database answers.',
      },
      fingerprint: 'rate-limit-store',
      occurredAt: now,
    };
    try {
      await this.#alerts.report(alert);
    } catch {
      // Already logged by the alert itself.
    }
  }
}
