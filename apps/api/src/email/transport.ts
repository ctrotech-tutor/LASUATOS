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

export interface EmailTransport {
  sendVerification(email: VerificationEmail): Promise<void>;
  sendPasswordReset(email: PasswordResetEmail): Promise<void>;
  sendSecurityNotice(email: SecurityNoticeEmail): Promise<void>;
  sendStaffInvitation(email: StaffInvitationEmail): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor() {
    super('The email provider did not accept the message.');
    this.name = 'EmailDeliveryError';
  }
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
  readonly notes: readonly string[];
}

/** Renders the shared plain-text and HTML layout; every interpolated value is escaped. */
function renderEmail(layout: EmailLayout): { readonly text: string; readonly html: string } {
  const text = [
    `Hello ${layout.displayName},`,
    '',
    layout.intro,
    ...(layout.action ? [layout.action.url] : []),
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

/** Builds each message once; providers only implement delivery. */
abstract class MessageTransport implements EmailTransport {
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

  sendStaffInvitation(email: StaffInvitationEmail): Promise<void> {
    return this.deliver(staffInvitationMessage(email, this.publicAppUrl));
  }
}

class GmailTransport extends MessageTransport {
  readonly #transporter: ReturnType<typeof createTransport>;
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
    } catch {
      throw new EmailDeliveryError();
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
    } catch {
      throw new EmailDeliveryError();
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

    try {
      const response = await this.#fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok) throw new EmailDeliveryError();
    } catch {
      throw new EmailDeliveryError();
    }
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
