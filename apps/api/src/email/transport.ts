import type { OperatorAlertEmail, OperatorAlertSender } from '../monitoring/alerts.js';
import { createTransport } from 'nodemailer';
import type { Environment } from '../env.js';

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
export type SecurityNoticeKind = 'password_reset' | 'password_changed';

export interface SecurityNoticeEmail {
  readonly to: string;
  readonly displayName: string;
  readonly kind: SecurityNoticeKind;
  readonly occurredAt: Date;
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
  /** 'open': opening an account; 'move': an existing account switching to its LASU address. */
  readonly purpose: 'open' | 'move';
}

export interface StudentEmailCodeSender {
  sendStudentEmailCode(email: StudentEmailCodeEmail): Promise<void>;
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

interface OutgoingMessage {
  readonly to: string;
  readonly displayName: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

interface EmailLayout {
  readonly heading: string;
  readonly displayName: string;
  readonly intro: string;
  readonly action?: { readonly label: string; readonly url: string };
  /** A one-time code shown large (instead of a link). */
  readonly code?: string;
  readonly notes: readonly string[];
}

/** Renders the shared plain-text and HTML layout; every interpolated value is escaped. */
function renderEmail(layout: EmailLayout): { readonly text: string; readonly html: string } {
  const text = [
    `Hello ${layout.displayName},`,
    '',
    layout.intro,
    ...(layout.action ? [layout.action.url] : []),
    ...(layout.code ? ['', `    ${layout.code}`] : []),
    '',
    ...layout.notes,
  ].join('\n');
  const note = (value: string) => `<p style="color:#61707c;font-size:13px">${escapeHtml(value)}</p>`;
  const html = [
    '<!doctype html>',
    '<html lang="en"><body style="margin:0;background:#f5f7f8;color:#172635;font-family:Arial,sans-serif;line-height:1.6">',
    '<main style="max-width:560px;margin:32px auto;padding:28px;background:#fff;border:1px solid #e3e8eb;border-radius:10px">',
    '<p style="margin:0 0 18px;color:#153b5b;font-size:12px;font-weight:bold;letter-spacing:.08em">LASUATOS</p>',
    `<h1 style="margin:0 0 12px;font-size:22px">${escapeHtml(layout.heading)}</h1>`,
    `<p>Hello ${escapeHtml(layout.displayName)},</p>`,
    `<p>${escapeHtml(layout.intro)}</p>`,
    layout.action
      ? `<p style="margin:24px 0"><a href="${escapeHtml(layout.action.url)}" style="display:inline-block;padding:11px 16px;border-radius:6px;background:#153b5b;color:#fff;text-decoration:none;font-weight:bold">${escapeHtml(layout.action.label)}</a></p>`
      : '',
    layout.code
      ? `<p style="margin:24px 0;font-family:'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:.3em;color:#153b5b">${escapeHtml(layout.code)}</p>`
      : '',
    ...layout.notes.map(note),
    '</main></body></html>',
  ].join('');
  return { text, html };
}

/** Tokens travel in the URL fragment so they never reach server or proxy logs. */
export function fragmentLink(publicAppUrl: string, path: string, token: string): string {
  const url = new URL(path, publicAppUrl);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

const lagosTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

export function verificationMessage(email: VerificationEmail, publicAppUrl: string): OutgoingMessage {
  return {
    to: email.to,
    displayName: email.displayName,
    subject: 'Confirm your LASUATOS email address',
    ...renderEmail({
      heading: 'Confirm your email',
      displayName: email.displayName,
      intro: 'Confirm your email address to finish creating your LASUATOS student account:',
      action: { label: 'Confirm email address', url: fragmentLink(publicAppUrl, '/verify-email', email.token) },
      notes: [
        'This link expires in 30 minutes and can only be used once.',
        'Email confirmation verifies access to this mailbox only. It does not verify LASU student status or the matric number you entered.',
        'If you did not start this registration, you can ignore this message.',
      ],
    }),
  };
}

export function studentEmailCodeMessage(email: StudentEmailCodeEmail): OutgoingMessage {
  return {
    to: email.to,
    displayName: email.displayName,
    subject: `${email.code} is your LASUATOS code`,
    ...renderEmail({
      heading: email.purpose === 'open' ? 'Open your LASUATOS account' : 'Confirm your LASU email',
      displayName: email.displayName,
      intro: email.purpose === 'open'
        ? 'Enter this code in LASUATOS to confirm this is your LASU student email and open your attendance account:'
        : 'Enter this code in LASUATOS to confirm this is your LASU student email:',
      code: email.code,
      notes: [
        `The code expires in ${email.expiresInMinutes} minutes. Nobody from LASUATOS will ever ask you for it.`,
        'If you did not ask for this code, someone may have typed your matric number. You can ignore this message; tell your HOC if it keeps happening.',
      ],
    }),
  };
}

export function passwordResetMessage(email: PasswordResetEmail, publicAppUrl: string): OutgoingMessage {
  return {
    to: email.to,
    displayName: email.displayName,
    subject: 'Reset your LASUATOS password',
    ...renderEmail({
      heading: 'Reset your password',
      displayName: email.displayName,
      intro: 'Someone asked to reset the password for your LASUATOS account. If it was you, choose a new password here:',
      action: { label: 'Choose a new password', url: fragmentLink(publicAppUrl, '/reset-password', email.token) },
      notes: [
        'This link expires in 30 minutes and can only be used once. Resetting your password signs you out on every device.',
        'If you did not ask for this, ignore this message; your password will not change.',
        'LASUATOS staff will never ask you for your password.',
      ],
    }),
  };
}

export function staffInvitationMessage(email: StaffInvitationEmail, publicAppUrl: string): OutgoingMessage {
  const inviter = email.invitedByName ? `${email.invitedByName} has invited you` : 'You have been invited';
  return {
    to: email.to,
    displayName: email.displayName,
    subject: `Your LASUATOS ${email.roleLabel.toLowerCase()} invitation`,
    ...renderEmail({
      heading: 'You have been invited to LASUATOS',
      displayName: email.displayName,
      intro: `${inviter} to join LASUATOS at ${email.institutionName} as ${email.roleLabel} for ${email.scopeLabel}. Choose a password to activate your account:`,
      action: { label: 'Accept invitation', url: fragmentLink(publicAppUrl, '/accept-invitation', email.token) },
      notes: [
        `This link works once and expires on ${lagosTime.format(email.expiresAt)} (Africa/Lagos).`,
        'If you were not expecting this invitation, ignore this message and no account will be created.',
        'LASUATOS staff will never ask you for your password.',
      ],
    }),
  };
}

export function securityNoticeMessage(email: SecurityNoticeEmail): OutgoingMessage {
  const when = `${lagosTime.format(email.occurredAt)} (Africa/Lagos)`;
  const reset = email.kind === 'password_reset';
  return {
    to: email.to,
    displayName: email.displayName,
    subject: reset ? 'Your LASUATOS password was reset' : 'Your LASUATOS password was changed',
    ...renderEmail({
      heading: reset ? 'Your password was reset' : 'Your password was changed',
      displayName: email.displayName,
      intro: reset
        ? `The password for your LASUATOS account was reset on ${when}, and every signed-in device was signed out.`
        : `The password for your LASUATOS account was changed on ${when}. Other signed-in devices were signed out.`,
      notes: [
        'If this was you, no action is needed.',
        'If it was not you, reset your password straight away from the sign-in page and tell your department’s LASUATOS administrator.',
      ],
    }),
  };
}

export function disputeSubmittedMessage(email: DisputeSubmittedNoticeEmail, publicAppUrl: string): OutgoingMessage {
  const others = email.openDisputeCount - 1;
  return {
    to: email.to,
    displayName: email.displayName,
    subject: `Attendance dispute: ${email.courseCode} · ${email.sessionTitle}`,
    ...renderEmail({
      heading: 'A student disputed their attendance',
      displayName: email.displayName,
      intro: `${email.studentName} has disputed their attendance for ${email.courseCode} · ${email.sessionTitle} (${lagosTime.format(email.sessionStartsAt)}). Review the statement and decide whether to mark them present:`,
      action: { label: 'Review disputes', url: new URL('/lecturer/disputes', publicAppUrl).toString() },
      notes: [
        others > 0
          ? `You have ${others} other open ${others === 1 ? 'dispute' : 'disputes'} waiting as well.`
          : 'This is your only open dispute right now.',
        'To keep your inbox quiet, LASUATOS emails you once when the first dispute for a lecture arrives — later disputes for the same lecture appear on the disputes page without another email.',
      ],
    }),
  };
}

export function disputeResolvedMessage(email: DisputeResolvedNoticeEmail, publicAppUrl: string): OutgoingMessage {
  const upheld = email.decision === 'upheld';
  return {
    to: email.to,
    displayName: email.displayName,
    subject: upheld
      ? `Dispute accepted: ${email.courseCode} · ${email.sessionTitle}`
      : `Dispute not accepted: ${email.courseCode} · ${email.sessionTitle}`,
    ...renderEmail({
      heading: upheld ? 'Your attendance dispute was accepted' : 'Your attendance dispute was not accepted',
      displayName: email.displayName,
      intro: upheld
        ? `${email.lecturerName} accepted your dispute for ${email.courseCode} · ${email.sessionTitle} (${lagosTime.format(email.sessionStartsAt)}). You are now marked present for that lecture.`
        : `${email.lecturerName} did not accept your dispute for ${email.courseCode} · ${email.sessionTitle} (${lagosTime.format(email.sessionStartsAt)}). Your attendance record for that lecture is unchanged.`,
      action: { label: 'View my attendance', url: new URL('/attendance', publicAppUrl).toString() },
      notes: [
        `Lecturer’s note: “${email.note}”`,
        'If you think a mistake has been made, speak to your lecturer or department.',
      ],
    }),
  };
}

const ALERT_HEADINGS: Record<OperatorAlertEmail['kind'], { subject: string; heading: string; intro: string; action: string; path: string }> = {
  server_error: {
    subject: 'Something failed on LASUATOS',
    heading: 'A request failed on the server',
    intro: 'Someone using LASUATOS hit an unexpected server error. They saw a generic “something went wrong” message.',
    action: 'Open the site',
    path: '/',
  },
  page_error: {
    subject: 'A page crashed on LASUATOS',
    heading: 'A page crashed in someone’s browser',
    intro: 'A LASUATOS page stopped working in a user’s browser and showed the error screen.',
    action: 'Open the site',
    path: '/',
  },
  schema_behind: {
    subject: 'LASUATOS database needs updating',
    heading: 'The database is behind this release',
    intro: 'The live site is running code that expects database updates that have not been applied, so newer features fail. Production deploys apply them automatically; redeploy the latest production build, or run pnpm prod:migrate.',
    action: 'Check site status',
    path: '/api/v1/ready',
  },
};

export function operatorAlertMessage(email: OperatorAlertEmail, publicAppUrl: string): OutgoingMessage {
  const copy = ALERT_HEADINGS[email.kind];
  const facts = Object.entries(email.details).map(([key, value]) => `${key}: ${value}`);
  return {
    to: email.to,
    displayName: 'LASUATOS operator',
    subject: `${copy.subject}: ${email.summary}`.slice(0, 160),
    ...renderEmail({
      heading: copy.heading,
      displayName: 'LASUATOS operator',
      intro: `${copy.intro} ${email.summary} — ${lagosTime.format(email.occurredAt)} (Africa/Lagos).`,
      action: { label: copy.action, url: new URL(copy.path, publicAppUrl).toString() },
      notes: [
        ...facts,
        'Find the request ID in Vercel → your project → Logs to see the full error.',
        'You get one email per problem at most every 30 minutes (page crashes: hourly; database updates: every 6 hours), and no more than 20 alerts a day.',
      ],
    }),
  };
}

export function testMessage(to: string, provider: string, sentAt: Date): OutgoingMessage {
  return {
    to,
    displayName: to,
    subject: 'LASUATOS email test',
    ...renderEmail({
      heading: 'Email delivery works',
      displayName: to,
      intro: `This is a test message from LASUATOS, sent through ${provider} on ${lagosTime.format(sentAt)} (Africa/Lagos). If you can read it, sign-up confirmations, password resets and staff invitations can reach this mailbox.`,
      notes: ['You can delete this message. No account was created or changed.'],
    }),
  };
}

/** Builds each message once; providers only implement delivery. */
abstract class MessageTransport implements EmailTransport, DisputeNotifier, OperatorAlertSender, StudentEmailCodeSender {
  protected abstract readonly publicAppUrl: string;
  protected abstract deliver(message: OutgoingMessage): Promise<void>;

  sendVerification(email: VerificationEmail): Promise<void> {
    return this.deliver(verificationMessage(email, this.publicAppUrl));
  }

  sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    return this.deliver(passwordResetMessage(email, this.publicAppUrl));
  }

  sendSecurityNotice(email: SecurityNoticeEmail): Promise<void> {
    return this.deliver(securityNoticeMessage(email));
  }

  sendStudentEmailCode(email: StudentEmailCodeEmail): Promise<void> {
    return this.deliver(studentEmailCodeMessage(email));
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

  sendTest(to: string, provider: string, sentAt: Date): Promise<void> {
    return this.deliver(testMessage(to, provider, sentAt));
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
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }
      : {
          from: `${this.#fromName} <${this.#fromAddress}>`,
          to: [message.to],
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
