/**
 * Why a provider refused a message, in a form the failover chain can act on (ADR 029):
 *
 * - `quota`: the day's (or plan's) sending allowance is used up. Skip this provider
 *   until it resets.
 * - `setup`: wrong API key or password, unverified sender, IP blocking, account not
 *   activated. Nothing will change until someone fixes it, so skip it for a while.
 * - `network`: the provider could not be reached, timed out, or answered 5xx / "try
 *   again later". Usually passes in a minute or two.
 * - `recipient`: this address cannot receive mail (malformed, refused). Another
 *   provider would refuse it too, so there is no failover.
 * - `unknown`: anything else; treated like a short network problem.
 */
export type EmailFailureKind = 'quota' | 'setup' | 'network' | 'recipient' | 'unknown';

export class EmailDeliveryError extends Error {
  /**
   * Why the provider refused, plus a fix when the cause is a known setup mistake.
   * For server logs and operator commands only: never send it to API clients.
   * Credentials are removed before it is stored.
   */
  readonly reason: string;
  readonly kind: EmailFailureKind;

  constructor(reason = 'The email provider did not say why.', kind: EmailFailureKind = 'unknown') {
    super('The email provider did not accept the message.');
    this.name = 'EmailDeliveryError';
    this.reason = reason;
    this.kind = kind;
  }
}

/** A loggable explanation for any error thrown while sending email. */
export function emailFailureReason(error: unknown): string {
  if (error instanceof EmailDeliveryError) return error.reason;
  return error instanceof Error ? error.message : String(error);
}

export function emailFailureKind(error: unknown): EmailFailureKind {
  return error instanceof EmailDeliveryError ? error.kind : 'unknown';
}
