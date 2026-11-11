import { createTransport } from 'nodemailer';
import type { Environment } from '../env.js';

const EMAIL_PROVIDER_TIMEOUT_MILLISECONDS = 15_000;

export interface VerificationEmail {
  readonly to: string;
  readonly displayName: string;
  readonly token: string;
}

export interface EmailTransport {
  sendVerification(email: VerificationEmail): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor() {
    super('The email provider did not accept the message.');
    this.name = 'EmailDeliveryError';
  }
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

function verificationContent(email: {
  readonly displayName: string;
  readonly verificationUrl: string;
}): { readonly text: string; readonly html: string } {
  const safeName = escapeHtml(email.displayName);
  const safeUrl = escapeHtml(email.verificationUrl);
  return {
    text: [
      `Hello ${email.displayName},`,
      '',
      'Confirm your email address to finish creating your LASUATOS student account:',
      email.verificationUrl,
      '',
      'This link expires in 30 minutes and can only be used once.',
      'Email confirmation verifies access to this mailbox only. It does not verify LASU student status or the matric number you entered.',
      '',
      'If you did not start this registration, you can ignore this message.',
    ].join('\n'),
    html: [
      '<!doctype html>',
      '<html lang="en"><body style="margin:0;background:#f5f7f8;color:#172635;font-family:Arial,sans-serif;line-height:1.6">',
      '<main style="max-width:560px;margin:32px auto;padding:28px;background:#fff;border:1px solid #e3e8eb;border-radius:10px">',
      '<p style="margin:0 0 18px;color:#153b5b;font-size:12px;font-weight:bold;letter-spacing:.08em">LASUATOS</p>',
      `<h1 style="margin:0 0 12px;font-size:22px">Confirm your email</h1>`,
      `<p>Hello ${safeName},</p>`,
      '<p>Confirm your email address to finish creating your LASUATOS student account.</p>',
      `<p style="margin:24px 0"><a href="${safeUrl}" style="display:inline-block;padding:11px 16px;border-radius:6px;background:#153b5b;color:#fff;text-decoration:none;font-weight:bold">Confirm email address</a></p>`,
      '<p style="color:#61707c;font-size:13px">This link expires in 30 minutes and can only be used once.</p>',
      '<p style="color:#61707c;font-size:13px">Email confirmation verifies access to this mailbox only. It does not verify LASU student status or the matric number you entered.</p>',
      '<p style="color:#61707c;font-size:13px">If you did not start this registration, you can ignore this message.</p>',
      '</main></body></html>',
    ].join(''),
  };
}

function verificationLink(publicAppUrl: string, token: string): string {
  const url = new URL('/verify-email', publicAppUrl);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function createMessage(email: VerificationEmail, publicAppUrl: string) {
  const content = verificationContent({
    displayName: email.displayName,
    verificationUrl: verificationLink(publicAppUrl, email.token),
  });
  return {
    subject: 'Confirm your LASUATOS email address',
    text: content.text,
    html: content.html,
  };
}

class GmailTransport implements EmailTransport {
  readonly #transporter: ReturnType<typeof createTransport>;
  readonly #fromAddress: string;
  readonly #fromName: string;
  readonly #publicAppUrl: string;

  constructor(environment: Environment) {
    const user = environment.GMAIL_USER;
    if (!user) throw new Error('Gmail is not fully configured.');
    this.#fromAddress = environment.EMAIL_FROM_ADDRESS ?? user;
    this.#fromName = environment.EMAIL_FROM_NAME;
    this.#publicAppUrl = environment.PUBLIC_APP_URL;

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

  async sendVerification(email: VerificationEmail): Promise<void> {
    const message = createMessage(email, this.#publicAppUrl);
    try {
      await this.#transporter.sendMail({
        from: { name: this.#fromName, address: this.#fromAddress },
        to: email.to,
        ...message,
      });
    } catch {
      throw new EmailDeliveryError();
    }
  }
}

class MailpitTransport implements EmailTransport {
  readonly #transporter: ReturnType<typeof createTransport>;
  readonly #fromAddress: string;
  readonly #fromName: string;
  readonly #publicAppUrl: string;

  constructor(environment: Environment) {
    if (!environment.EMAIL_FROM_ADDRESS) throw new Error('Mailpit is not fully configured.');
    this.#fromAddress = environment.EMAIL_FROM_ADDRESS;
    this.#fromName = environment.EMAIL_FROM_NAME;
    this.#publicAppUrl = environment.PUBLIC_APP_URL;
    this.#transporter = createTransport({
      host: environment.MAILPIT_HOST,
      port: environment.MAILPIT_PORT,
      secure: false,
      connectionTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
      greetingTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
      socketTimeout: EMAIL_PROVIDER_TIMEOUT_MILLISECONDS,
    });
  }

  async sendVerification(email: VerificationEmail): Promise<void> {
    try {
      await this.#transporter.sendMail({
        from: { name: this.#fromName, address: this.#fromAddress },
        to: email.to,
        ...createMessage(email, this.#publicAppUrl),
      });
    } catch {
      throw new EmailDeliveryError();
    }
  }
}

class ApiEmailTransport implements EmailTransport {
  readonly #provider: 'brevo' | 'resend';
  readonly #apiKey: string;
  readonly #fromAddress: string;
  readonly #fromName: string;
  readonly #publicAppUrl: string;
  readonly #fetch: typeof fetch;

  constructor(
    provider: 'brevo' | 'resend',
    apiKey: string,
    fromAddress: string,
    fromName: string,
    publicAppUrl: string,
    fetchImplementation: typeof fetch,
  ) {
    this.#provider = provider;
    this.#apiKey = apiKey;
    this.#fromAddress = fromAddress;
    this.#fromName = fromName;
    this.#publicAppUrl = publicAppUrl;
    this.#fetch = fetchImplementation;
  }

  async sendVerification(email: VerificationEmail): Promise<void> {
    const message = createMessage(email, this.#publicAppUrl);
    const url = this.#provider === 'brevo'
      ? 'https://api.brevo.com/v3/smtp/email'
      : 'https://api.resend.com/emails';
    const headers = this.#provider === 'brevo'
      ? { 'api-key': this.#apiKey }
      : { authorization: `Bearer ${this.#apiKey}` };
    const body = this.#provider === 'brevo'
      ? {
          sender: { name: this.#fromName, email: this.#fromAddress },
          to: [{ email: email.to, name: email.displayName }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }
      : {
          from: `${this.#fromName} <${this.#fromAddress}>`,
          to: [email.to],
          ...message,
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
