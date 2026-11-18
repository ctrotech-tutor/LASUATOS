import { rateLimitKey, type RateLimitStore } from '../security/rate-limit.js';
import type { OperatorAlert, OperatorAlertKind, OperatorAlerts } from './alerts.js';

/**
 * Trend alerts (ADR 029). A single server error already emails the operator; these
 * watch for *patterns* that no single request shows: many requests refused for going
 * too fast, the error rate climbing, a wave of failed sign-ins, Google sign-in checks
 * failing. Each signal is a counter in the shared rate-limit store (Postgres in
 * production, so every serverless instance adds to the same count) over a fixed
 * window; the request that takes a count to its threshold raises the alert, and the
 * alert's own throttle keeps repeats down.
 *
 * Counts only: no addresses, accounts or request bodies are stored.
 */

export type SignalName = 'rate_limited' | 'server_errors' | 'sign_in_failures' | 'google_broken' | 'google_refused' | 'face_unavailable';

interface SignalRule {
  readonly threshold: number;
  readonly windowMilliseconds: number;
  readonly kind: OperatorAlertKind;
  readonly summary: (threshold: number, minutes: number) => string;
  readonly fix: string;
}

const MINUTE = 60_000;

export const SIGNAL_RULES: Readonly<Record<SignalName, SignalRule>> = {
  rate_limited: {
    threshold: 60,
    windowMilliseconds: 10 * MINUTE,
    kind: 'rate_limited',
    summary: (threshold, minutes) => `rate limits hit hard: ${threshold} requests refused as too fast in ${minutes} minutes`,
    fix: 'Usually one hall at lecture start or someone guessing passwords. If real students are being refused, look at the limit named below in rate-limit-policies.ts; if it is one address hammering, nothing to do: the limit is working.',
  },
  server_errors: {
    threshold: 15,
    windowMilliseconds: 10 * MINUTE,
    kind: 'error_rate',
    summary: (threshold, minutes) => `error rate up: ${threshold} requests failed with a server error in ${minutes} minutes`,
    fix: 'Check Vercel → Logs for the failing route, and the database (Neon) for connection or quota problems. The individual errors are emailed separately.',
  },
  sign_in_failures: {
    threshold: 80,
    windowMilliseconds: 15 * MINUTE,
    kind: 'sign_in_failures',
    summary: (threshold, minutes) => `sign-ins failing: ${threshold} wrong-password sign-ins in ${minutes} minutes`,
    fix: 'Either someone is trying passwords (the sign-in limits slow them down) or sign-in itself is broken after a change. Try signing in yourself; check Vercel → Logs.',
  },
  google_broken: {
    threshold: 5,
    windowMilliseconds: 15 * MINUTE,
    kind: 'google_failing',
    summary: (threshold, minutes) => `Google checks failing: ${threshold} Google sign-ins could not be verified in ${minutes} minutes`,
    fix: 'Either Google’s keys could not be fetched (a network problem, usually brief) or GOOGLE_CLIENT_ID does not match the OAuth client the page uses. Students can still use emailed codes and passwords.',
  },
  google_refused: {
    threshold: 30,
    windowMilliseconds: 15 * MINUTE,
    kind: 'google_failing',
    summary: (threshold, minutes) => `Google checks failing: ${threshold} Google sign-ins refused in ${minutes} minutes`,
    fix: 'Many students are coming back from Google with answers that are too old or do not match their request. Check that the server clock and PUBLIC_APP_URL are right and that /auth/google loads.',
  },
  face_unavailable: {
    threshold: 3,
    windowMilliseconds: 10 * MINUTE,
    kind: 'server_error',
    summary: (threshold, minutes) => `face checks failing: the face engine could not start ${threshold} times in ${minutes} minutes`,
    fix: 'Students get "Face checks are not available right now" and cannot mark attendance by themselves. Check Vercel → Logs for the engine error (usually a missing model file or too little memory after a change), and tell lecturers to add students by hand meanwhile.',
  },
};

/** Google refusals that point at our setup or Google being unreachable, not at the student. */
const GOOGLE_BROKEN_REASONS = new Set(['keys_unavailable', 'audience', 'issuer', 'signature']);

export function googleSignal(reason: string): SignalName {
  return GOOGLE_BROKEN_REASONS.has(reason) ? 'google_broken' : 'google_refused';
}

export interface SignalSnapshot {
  readonly signal: SignalName;
  readonly count: number;
  readonly threshold: number;
  readonly windowMinutes: number;
}

export class SignalMonitor {
  readonly #store: RateLimitStore;
  readonly #alerts: Pick<OperatorAlerts, 'report'>;
  readonly #now: () => Date;

  constructor(options: { readonly store: RateLimitStore; readonly alerts: Pick<OperatorAlerts, 'report'>; readonly now?: () => Date }) {
    this.#store = options.store;
    this.#alerts = options.alerts;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Counts one occurrence; raises the alert when this one reaches the threshold.
   * Never throws: monitoring must not break the request it is counting.
   */
  async count(signal: SignalName, details: Readonly<Record<string, string>> = {}): Promise<void> {
    const rule = SIGNAL_RULES[signal];
    const now = this.#now();
    try {
      const hit = await this.#store.hit(rateLimitKey(`signal:${signal}`, 'all'), rule.windowMilliseconds, now);
      if (hit.count !== rule.threshold) return;
      const minutes = Math.round(rule.windowMilliseconds / MINUTE);
      const alert: OperatorAlert = {
        kind: rule.kind,
        summary: rule.summary(rule.threshold, minutes),
        details: { ...details, fix: rule.fix },
        fingerprint: `signal-${signal}`,
        occurredAt: now,
      };
      await this.#alerts.report(alert);
    } catch {
      // A store or alert failure is already logged where it happened.
    }
  }

  /** The current window's counts, for System health. */
  async snapshot(): Promise<SignalSnapshot[]> {
    const now = this.#now();
    return Promise.all((Object.keys(SIGNAL_RULES) as SignalName[]).map(async (signal) => {
      const rule = SIGNAL_RULES[signal];
      const current = this.#store.peek ? await this.#store.peek(rateLimitKey(`signal:${signal}`, 'all'), now).catch(() => null) : null;
      return { signal, count: current?.count ?? 0, threshold: rule.threshold, windowMinutes: Math.round(rule.windowMilliseconds / MINUTE) };
    }));
  }
}
