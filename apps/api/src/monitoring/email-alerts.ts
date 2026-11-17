import { EMAIL_PROVIDER_LABEL, utcDay, type EmailChainEvent, type ProviderAttempt } from '../email/failover.js';
import { lagosWhen } from '../email/messages.js';
import { scrubAlertText, type OperatorAlert } from './alerts.js';

/**
 * Turns the email chain's events into operator alerts (ADR 029). Fingerprints are
 * chosen so a long evening on the backup provider is one email, not hundreds: a
 * switch is grouped by provider and reason, a quota warning by provider, level and
 * day, and "all failing" is one problem.
 */

const WHY: Record<ProviderAttempt['why'], string> = {
  quota: 'daily limit reached',
  setup: 'setup problem',
  network: 'could not be reached',
  recipient: 'address refused',
  unknown: 'refused',
  paused: 'paused',
  full: 'daily limit reached',
};

function attemptFacts(attempts: readonly ProviderAttempt[]): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const attempt of attempts) {
    const name = EMAIL_PROVIDER_LABEL[attempt.provider];
    facts[name] = scrubAlertText(attempt.reason, 300);
    if (attempt.until) facts[`${name} paused until`] = lagosWhen(attempt.until);
  }
  return facts;
}

export function emailAlertFor(event: EmailChainEvent, now: Date): OperatorAlert {
  switch (event.type) {
    case 'failover': {
      const first = event.failed[0]!;
      const refused = event.failed.map((attempt) => `${EMAIL_PROVIDER_LABEL[attempt.provider]} (${WHY[attempt.why]})`).join(', ');
      return {
        kind: 'email_failover',
        summary: `${refused} refused; sent through ${EMAIL_PROVIDER_LABEL[event.delivered]}`,
        details: { ...attemptFacts(event.failed), 'sent through': EMAIL_PROVIDER_LABEL[event.delivered] },
        fingerprint: `failover-${first.provider}-${first.why}`.slice(0, 24),
        occurredAt: now,
      };
    }
    case 'all_failed':
      return {
        kind: 'email_failing',
        summary: event.attempts.length > 1
          ? `every email provider refused the message (${event.attempts.map((attempt) => `${EMAIL_PROVIDER_LABEL[attempt.provider]}: ${WHY[attempt.why]}`).join(', ')})`
          : `${EMAIL_PROVIDER_LABEL[event.attempts[0]?.provider ?? 'brevo']} refused the message (${WHY[event.attempts[0]?.why ?? 'unknown']}) and no other provider is set up`,
        details: attemptFacts(event.attempts),
        fingerprint: 'email-failing',
        occurredAt: now,
      };
    case 'quota': {
      const name = EMAIL_PROVIDER_LABEL[event.provider];
      const full = event.sent >= event.limit;
      return {
        kind: 'email_quota',
        summary: full
          ? `${name} has used all ${event.limit} of today’s emails${event.next ? `; ${EMAIL_PROVIDER_LABEL[event.next]} takes over` : ' and no other provider is set up'}`
          : `${name} has sent ${event.sent} of its ${event.limit} emails today`,
        details: {
          'takes over next': event.next ? EMAIL_PROVIDER_LABEL[event.next] : 'nobody: add a fallback provider (see docs/DEPLOYMENT.md)',
          resets: event.provider === 'gmail' ? 'about 24 hours after the first sends' : 'midnight UTC (01:00 Lagos time)',
        },
        fingerprint: `quota-${event.provider}-${full ? 'full' : 'near'}-${utcDay(now).slice(5)}`.slice(0, 24),
        occurredAt: now,
      };
    }
  }
}
