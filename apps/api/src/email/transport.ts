import type { OperatorAlertEmail, OperatorAlertSender } from '../monitoring/alerts.js';
import type { ContactNotifier, ContactReceipt, ContactTeamNotice } from '../contact/service.js';
import { createTransport } from 'nodemailer';
import type { Environment } from '../env.js';
import {
  contactReceiptMessage,
  contactTeamMessage,
  disputeResolvedMessage,
  disputeSubmittedMessage,
  operatorAlertMessage,
  passwordResetMessage,
  securityNoticeMessage,
  staffInvitationMessage,
  studentEmailCodeMessage,
  testMessage,
  verificationMessage,
  type OutgoingMessage,
} from './messages.js';

export {
  contactReceiptMessage,
  contactTeamMessage,
  disputeResolvedMessage,
  disputeSubmittedMessage,
  fragmentLink,
  lagosWhen,
  operatorAlertMessage,
  passwordResetMessage,
  securityNoticeMessage,
  staffInvitationMessage,
  studentEmailCodeMessage,
  testMessage,
  verificationMessage,
  type OutgoingMessage,
} from './messages.js';

const EMAIL_PROVIDER_TIMEOUT_MILLISECONDS = 15_000;

export interface VerificationEmail {
  readonly to: string;
  readonly displayName: string;
  readonly token: string;
}

export interface PasswordResetEmail {
  readonly to: string;
  readonly displayName: string;
  readonly token: string;
}

/** Account-security events the owner is told about after they happen. */
export type SecurityNoticeKind = 'password_reset' | 'password_changed' | 'account_taken_over' | 'account_released' | 'matric_added';

export interface SecurityNoticeEmail {
  readonly to: string;
  readonly displayName: string;
  readonly kind: SecurityNoticeKind;
  readonly occurredAt: Date;
  /** The student account's matric number, for the student notices. */
  readonly matricNumber?: string | undefined;
}

export interface StaffInvitationEmail {
  readonly to: string;
  readonly displayName: string;
  readonly token: string;
  readonly roleLabel: string;
  readonly scopeLabel: string;
  readonly institutionName: string;
  /** Null when the invitation came from the server-side bootstrap command. */
  readonly invitedByName: string | null;
  readonly expiresAt: Date;
}

/** A lecturer is told a student disputed attendance (sent once per session batch, not per dispute). */
export interface DisputeSubmittedNoticeEmail {
  readonly to: string;
  readonly displayName: string;
  readonly courseCode: string;
  readonly sessionTitle: string;
  readonly sessionStartsAt: Date;
  readonly studentName: string;
  /** Open disputes the lecturer has across all assigned offerings, including this one. */
  readonly openDisputeCount: number;
}

/** A student is told the lecturer's decision on their dispute. */
export interface DisputeResolvedNoticeEmail {
  readonly to: string;
  readonly displayName: string;
  readonly courseCode: string;
  readonly sessionTitle: string;
  readonly sessionStartsAt: Date;
  readonly decision: 'upheld' | 'rejected';
  readonly note: string;
  readonly lecturerName: string;
}

/** Attendance-dispute notices. Optional: transports that cannot send them are simply skipped. */
/** A six-digit code that proves a student can open their LASU mailbox. */
export interface StudentEmailCodeEmail {
  readonly to: string;
  readonly displayName: string;
  readonly code: string;
  readonly expiresInMinutes: number;
  /**
   * 'open': opening an account; 'move': an existing account switching to its
   * LASU address; 'face': confirming new face photos for the account;
   * 'reset': choosing a new password (forgot password); 'open_jamb':
   * opening an account with a personal email (a student on a JAMB number, no
   * LASU email yet); 'matric': a JAMB-number student adding their matric
   * number and LASU email.
   */
  readonly purpose: 'open' | 'move' | 'face' | 'reset' | 'open_jamb' | 'matric';
}

export interface StudentEmailCodeSender {
  sendStudentEmailCode(email: StudentEmailCodeEmail): Promise<void>;
  /** Tells the owner about a change to their account after it happened. Optional for test doubles. */
  sendSecurityNotice?(email: SecurityNoticeEmail): Promise<void>;
}

export interface DisputeNotifier {
  sendDisputeSubmittedNotice(email: DisputeSubmittedNoticeEmail): Promise<void>;
  sendDisputeResolvedNotice(email: DisputeResolvedNoticeEmail): Promise<void>;
}

export interface EmailTransport {
  sendVerification(email: VerificationEmail): Promise<void>;
  sendPasswordReset(email: PasswordResetEmail): Promise<void>;
  sendSecurityNotice(email: SecurityNoticeEmail): Promise<void>;
  sendStaffInvitation(email: StaffInvitationEmail): Promise<void>;
}

export class EmailDeliveryError extends Error {
  /**
   * Why the provider refused, plus a fix when the cause is a known setup mistake.
   * For server logs and operator commands only: never send it to API clients.
   * Credentials are removed before it is stored.
   */
  readonly reason: string;

  constructor(reason = 'The email provider did not say why.') {
    super('The email provider did not accept the message.');
    this.name = 'EmailDeliveryError';
    this.reason = reason;
  }
}

/** A loggable explanation for any error thrown while sending email. */
export function emailFailureReason(error: unknown): string {
  if (error instanceof EmailDeliveryError) return error.reason;
  return error instanceof Error ? error.message : String(error);
}

const MAX_REASON_LENGTH = 400;

function cleanReason(text: string, secrets: readonly (string | undefined)[]): string {
  let cleaned = text.replace(/\s+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret && secret.length >= 4) cleaned = cleaned.split(secret).join('[hidden]');
  }
  return cleaned.length > MAX_REASON_LENGTH ? `${cleaned.slice(0, MAX_REASON_LENGTH)}…` : cleaned;
}

/** Turns the provider's answer into one line an operator can act on. */
export function describeApiProviderFailure(
  provider: 'brevo' | 'resend',
  status: number,
  responseText: string,
): string {
  const name = provider === 'brevo' ? 'Brevo' : 'Resend';
  let detail = responseText;
  try {
    const parsed = JSON.parse(responseText) as { message?: unknown; code?: unknown };
    if (typeof parsed.message === 'string') {
      detail = typeof parsed.code === 'string' ? `${parsed.code}: ${parsed.message}` : parsed.message;
    }
  } catch {
    // Not JSON: keep the raw text.
  }
  const fix = provider === 'brevo' ? brevoFix(status, detail) : resendFix(status, detail);
  return `${name} refused the message (HTTP ${status}): ${detail || 'no details'}${fix ? ` Fix: ${fix}` : ''}`;
}

function brevoFix(status: number, detail: string): string | undefined {
  if (/unrecogni[sz]ed ip|authori[sz]ed ip/i.test(detail)) {
    return 'in Brevo open Security → Authorised IPs and click "Deactivate blocking" (Vercel has no fixed IP address).';
  }
  if (status === 401 || /key not found|api[- ]?key/i.test(detail)) {
    return 'BREVO_API_KEY is wrong. Create one in Brevo under SMTP & API → API Keys; it starts with "xkeysib-" (the SMTP key "xsmtpsib-" does not work here).';
  }
  if (/sender/i.test(detail)) {
    return 'EMAIL_FROM_ADDRESS must be a sender you verified in Brevo (Senders, Domains & Dedicated IPs → Senders).';
  }
  if (/activat|suspend|blocked/i.test(detail)) {
    return 'Brevo has not enabled sending on this account. Check the Brevo dashboard and your inbox for a message from Brevo.';
  }
  if (status === 429 || /limit|quota|credit/i.test(detail)) {
    return 'the daily sending limit was reached (300 emails/day on the free plan). It resets tomorrow.';
  }
  return undefined;
}

function resendFix(status: number, detail: string): string | undefined {
  if (status === 401 || (status === 403 && /api key/i.test(detail))) return 'RESEND_API_KEY is wrong.';
  if (/domain|verify/i.test(detail)) {
    return 'Resend only sends to other people from a domain you verified; EMAIL_FROM_ADDRESS must use that domain.';
  }
  if (status === 429) return 'the sending limit was reached.';
  return undefined;
}

function describeNetworkFailure(host: string, error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `${host} did not answer within ${EMAIL_PROVIDER_TIMEOUT_MILLISECONDS / 1000} seconds.`;
  }
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
  const code = cause && 'code' in cause && typeof cause.code === 'string' ? ` (${cause.code})` : '';
  return `Could not reach ${host}${code}. Check the internet connection or firewall.`;
}

/** Explains nodemailer (SMTP) errors without echoing credentials. */
export function describeSmtpFailure(
  service: string,
  error: unknown,
  secrets: readonly (string | undefined)[],
): string {
  const details = (error ?? {}) as { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown };
  const code = typeof details.code === 'string' ? details.code : undefined;
  const raw = typeof details.response === 'string'
    ? details.response
    : typeof details.message === 'string' ? details.message : String(error);
  let fix: string | undefined;
  if (code === 'EAUTH' || details.responseCode === 535) {
    fix = service === 'Gmail'
      ? 'Gmail refused the login. GMAIL_APP_PASSWORD must be a 16-letter App Password (myaccount.google.com/apppasswords) created on the same Google account as GMAIL_USER.'
      : 'the SMTP username or password is wrong.';
  } else if (code && ['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ECONNREFUSED', 'ECONNRESET'].includes(code)) {
    fix = 'the mail server could not be reached. This network may block outgoing mail ports; an HTTPS provider such as Brevo avoids that.';
  }
  return cleanReason(`${service} refused the message${code ? ` (${code})` : ''}: ${raw}${fix ? ` Fix: ${fix}` : ''}`, secrets);
}

/** Builds each message once; providers only implement delivery. */
abstract class MessageTransport implements EmailTransport, DisputeNotifier, OperatorAlertSender, StudentEmailCodeSender, ContactNotifier {
  protected abstract readonly publicAppUrl: string;
  protected abstract deliver(message: OutgoingMessage): Promise<void>;

  sendVerification(email: VerificationEmail): Promise<void> {
    return this.deliver(verificationMessage(email, this.publicAppUrl));
  }

  sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    return this.deliver(passwordResetMessage(email, this.publicAppUrl));
  }

  sendSecurityNotice(email: SecurityNoticeEmail): Promise<void> {
    return this.deliver(securityNoticeMessage(email, this.publicAppUrl));
  }

  sendStudentEmailCode(email: StudentEmailCodeEmail): Promise<void> {
    return this.deliver(studentEmailCodeMessage(email, this.publicAppUrl));
  }

  sendStaffInvitation(email: StaffInvitationEmail): Promise<void> {
    return this.deliver(staffInvitationMessage(email, this.publicAppUrl));
  }

  sendDisputeSubmittedNotice(email: DisputeSubmittedNoticeEmail): Promise<void> {
    return this.deliver(disputeSubmittedMessage(email, this.publicAppUrl));
  }

  sendDisputeResolvedNotice(email: DisputeResolvedNoticeEmail): Promise<void> {
    return this.deliver(disputeResolvedMessage(email, this.publicAppUrl));
  }

  sendOperatorAlert(email: OperatorAlertEmail): Promise<void> {
    return this.deliver(operatorAlertMessage(email, this.publicAppUrl));
  }

  sendContactToTeam(notice: ContactTeamNotice): Promise<void> {
    return this.deliver(contactTeamMessage(notice, this.publicAppUrl));
  }

  sendContactReceipt(receipt: ContactReceipt): Promise<void> {
    return this.deliver(contactReceiptMessage(receipt, this.publicAppUrl));
  }

  sendTest(to: string, provider: string, sentAt: Date): Promise<void> {
    return this.deliver(testMessage(to, provider, sentAt, this.publicAppUrl));
  }
}

/** The dispute notifier behind a configured transport, when it can send dispute notices. */
export function disputeNotifierFor(transport: EmailTransport | undefined): DisputeNotifier | undefined {
  return transport instanceof MessageTransport ? transport : undefined;
}

/** The student email-code sender behind a configured transport. */
export function studentEmailCodeSenderFor(transport: EmailTransport | undefined): StudentEmailCodeSender | undefined {
  return transport instanceof MessageTransport ? transport : undefined;
}

/** The operator-alert sender behind a configured transport. */
export function operatorAlertSenderFor(transport: EmailTransport | undefined): OperatorAlertSender | undefined {
  return transport instanceof MessageTransport ? transport : undefined;
}

/** The contact-message notifier behind a configured transport. */
export function contactNotifierFor(transport: EmailTransport | undefined): ContactNotifier | undefined {
  return transport instanceof MessageTransport ? transport : undefined;
}

/** Sends a harmless test message; used by the `email:test` operator command. */
export function sendTestEmail(transport: EmailTransport, to: string, provider: string, sentAt = new Date()): Promise<void> {
  if (!(transport instanceof MessageTransport)) {
    return Promise.reject(new Error('This email transport cannot send test messages.'));
  }
  return transport.sendTest(to, provider, sentAt);
}

class GmailTransport extends MessageTransport {
  readonly #transporter: ReturnType<typeof createTransport>;
  readonly #secrets: readonly (string | undefined)[];
  readonly #fromAddress: string;
  readonly #fromName: string;
  protected readonly publicAppUrl: string;

  constructor(environment: Environment) {
    super();
    const user = environment.GMAIL_USER;
    if (!user) throw new Error('Gmail is not fully configured.');
    this.#fromAddress = environment.EMAIL_FROM_ADDRESS ?? user;
    this.#fromName = environment.EMAIL_FROM_NAME;
    this.publicAppUrl = environment.PUBLIC_APP_URL;
    this.#secrets = [
      environment.GMAIL_APP_PASSWORD,
      environment.GMAIL_APP_PASSWORD?.replace(/\s+/g, ''),
      environment.GMAIL_CLIENT_SECRET,
      environment.GMAIL_REFRESH_TOKEN,
    ];

    const oauthCredentials = [
      environment.GMAIL_CLIENT_ID,
      environment.GMAIL_CLIENT_SECRET,
      environment.GMAIL_REFRESH_TOKEN,
    ];
    if (oauthCredentials.every(Boolean)) {
      const [clientId, clientSecret, refreshToken] = oauthCredentials;
      this.#transporter = createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        connectionTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
        greetingTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
        socketTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
        auth: {
          type: 'OAuth2',
          user,
          clientId,
          clientSecret,
          refreshToken,
        },
      });
      return;
    }

    const appPassword = environment.GMAIL_APP_PASSWORD;
    if (!appPassword) throw new Error('Gmail is not fully configured.');
    this.#transporter = createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      connectionTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
      greetingTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
      socketTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
      auth: { user, pass: appPassword },
    });
  }

  protected async deliver(message: OutgoingMessage): Promise<void> {
    try {
      await this.#transporter.sendMail({
        from: { name: this.#fromName, address: this.#fromAddress },
        to: message.to,
        ...(message.replyTo ? { replyTo: { name: message.replyTo.name, address: message.replyTo.email } } : {}),
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      throw new EmailDeliveryError(describeSmtpFailure('Gmail', error, this.#secrets));
    }
  }
}

class MailpitTransport extends MessageTransport {
  readonly #transporter: ReturnType<typeof createTransport>;
  readonly #fromAddress: string;
  readonly #fromName: string;
  protected readonly publicAppUrl: string;

  constructor(environment: Environment) {
    super();
    if (!environment.EMAIL_FROM_ADDRESS) throw new Error('Mailpit is not fully configured.');
    this.#fromAddress = environment.EMAIL_FROM_ADDRESS;
    this.#fromName = environment.EMAIL_FROM_NAME;
    this.publicAppUrl = environment.PUBLIC_APP_URL;
    this.#transporter = createTransport({
      host: environment.MAILPIT_HOST,
      port: environment.MAILPIT_PORT,
      secure: false,
      connectionTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
      greetingTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
      socketTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
    });
  }

  protected async deliver(message: OutgoingMessage): Promise<void> {
    try {
      await this.#transporter.sendMail({
        from: { name: this.#fromName, address: this.#fromAddress },
        to: message.to,
        ...(message.replyTo ? { replyTo: { name: message.replyTo.name, address: message.replyTo.email } } : {}),
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      throw new EmailDeliveryError(describeSmtpFailure('Mailpit', error, []));
    }
  }
}

class ApiEmailTransport extends MessageTransport {
  readonly #provider: 'brevo' | 'resend';
  readonly #apiKey: string;
  readonly #fromAddress: string;
  readonly #fromName: string;
  protected readonly publicAppUrl: string;
  readonly #fetch: typeof fetch;

  constructor(
    provider: 'brevo' | 'resend',
    apiKey: string,
    fromAddress: string,
    fromName: string,
    publicAppUrl: string,
    fetchImplementation: typeof fetch,
  ) {
    super();
    this.#provider = provider;
    this.#apiKey = apiKey;
    this.#fromAddress = fromAddress;
    this.#fromName = fromName;
    this.publicAppUrl = publicAppUrl;
    this.#fetch = fetchImplementation;
  }

  protected async deliver(message: OutgoingMessage): Promise<void> {
    const url = this.#provider === 'brevo'
      ? 'https://api.brevo.com/v3/smtp/email'
      : 'https://api.resend.com/emails';
    const headers = this.#provider === 'brevo'
      ? { 'api-key': this.#apiKey }
      : { authorization: `Bearer ${this.#apiKey}` };
    const body = this.#provider === 'brevo'
      ? {
          sender: { name: this.#fromName, email: this.#fromAddress },
          to: [{ email: message.to, name: message.displayName }],
          ...(message.replyTo ? { replyTo: { email: message.replyTo.email, name: message.replyTo.name } } : {}),
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }
      : {
          from: `${this.#fromName} <${this.#fromAddress}>`,
          to: [message.to],
          ...(message.replyTo ? { reply_to: message.replyTo.email } : {}),
          subject: message.subject,
          html: message.html,
          text: message.text,
        };

    const host = new URL(url).host;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MILLISECONDS),
      });
    } catch (error) {
      throw new EmailDeliveryError(describeNetworkFailure(host, error));
    }
    if (response.ok) return;
    const responseText = await response.text().catch(() => '');
    throw new EmailDeliveryError(
      cleanReason(describeApiProviderFailure(this.#provider, response.status, responseText), [this.#apiKey]),
    );
  }
}

export function createEmailTransport(
  environment: Environment,
  fetchImplementation: typeof fetch = globalThis.fetch,
): EmailTransport | undefined {
  switch (environment.EMAIL_PROVIDER) {
    case 'none':
      return undefined;
    case 'mailpit':
      return new MailpitTransport(environment);
    case 'gmail':
      return new GmailTransport(environment);
    case 'brevo':
      if (!environment.BREVO_API_KEY || !environment.EMAIL_FROM_ADDRESS) {
        throw new Error('Brevo is not fully configured.');
      }
      return new ApiEmailTransport(
        'brevo',
        environment.BREVO_API_KEY,
        environment.EMAIL_FROM_ADDRESS,
        environment.EMAIL_FROM_NAME,
        environment.PUBLIC_APP_URL,
        fetchImplementation,
      );
    case 'resend':
      if (!environment.RESEND_API_KEY || !environment.EMAIL_FROM_ADDRESS) {
        throw new Error('Resend is not fully configured.');
      }
      return new ApiEmailTransport(
        'resend',
        environment.RESEND_API_KEY,
        environment.EMAIL_FROM_ADDRESS,
        environment.EMAIL_FROM_NAME,
        environment.PUBLIC_APP_URL,
        fetchImplementation,
      );
  }
}
