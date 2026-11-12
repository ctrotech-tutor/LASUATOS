import { describe, expect, it, vi } from 'vitest';
import { loadEnvironment } from '../env.js';
import {
  createEmailTransport,
  EmailDeliveryError,
  passwordResetMessage,
  securityNoticeMessage,
  staffInvitationMessage,
} from './transport.js';

const verificationEmail = {
  to: 'student@example.net',
  displayName: 'Amina <Student>',
  token: 'a'.repeat(43),
};

describe('email delivery adapters', () => {
  it('keeps delivery disabled until a provider is selected', () => {
    const transport = createEmailTransport(loadEnvironment({ NODE_ENV: 'test' }));
    expect(transport).toBeUndefined();
  });

  it('constructs the local Mailpit adapter without requiring external credentials', () => {
    const environment = loadEnvironment({
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'mailpit',
      EMAIL_FROM_ADDRESS: 'lasuatos@example.net',
    });

    expect(createEmailTransport(environment)).toBeDefined();
  });

  it('sends through Resend using server-side credentials and a fragment-only link', async () => {
    let requestUrl = '';
    let requestOptions: RequestInit | undefined;
    const fetchImplementation: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestOptions = init;
      return new Response(null, { status: 202 });
    };
    const environment = loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'server-secret',
      EMAIL_FROM_ADDRESS: 'pilot@example.net',
      PUBLIC_APP_URL: 'https://pilot.example.net',
    });
    const transport = createEmailTransport(environment, fetchImplementation);

    await transport?.sendVerification(verificationEmail);

    expect(requestUrl).toBe('https://api.resend.com/emails');
    expect(requestOptions?.headers).toMatchObject({
      authorization: 'Bearer server-secret',
      'content-type': 'application/json',
    });
    const body = JSON.parse(String(requestOptions?.body)) as {
      to: string[];
      html: string;
      text: string;
    };
    expect(body.to).toEqual(['student@example.net']);
    expect(body.html).toContain('Amina &lt;Student&gt;');
    expect(body.html).toContain('https://pilot.example.net/verify-email#token=');
    expect(body.html).not.toContain('student@example.net?token=');
    expect(body.text).toContain('does not verify LASU student status');
  });

  it('uses Brevo transactional email endpoint and hides provider failures', async () => {
    let requestOptions: RequestInit | undefined;
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      requestOptions = init;
      return new Response('private provider response', { status: 401 });
    });
    const environment = loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'server-secret',
      EMAIL_FROM_ADDRESS: 'pilot@example.net',
    });
    const transport = createEmailTransport(environment, fetchImplementation);

    await expect(transport?.sendVerification(verificationEmail)).rejects.toBeInstanceOf(
      EmailDeliveryError,
    );
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        headers: expect.objectContaining({ 'api-key': 'server-secret' }),
      }),
    );
    const body = JSON.parse(String(requestOptions?.body)) as {
      sender: { email: string };
      to: { email: string }[];
      htmlContent: string;
      textContent: string;
    };
    expect(body.sender.email).toBe('pilot@example.net');
    expect(body.to[0]?.email).toBe('student@example.net');
    expect(body.htmlContent).toContain('Confirm your email address');
    expect(body.textContent).toContain('mailbox only');
  });
});

describe('account security messages', () => {
  it('puts the reset token only in the URL fragment and escapes the display name', () => {
    const message = passwordResetMessage(
      { to: 'student@example.net', displayName: 'Amina <Student>', token: 'b'.repeat(43) },
      'https://pilot.example.net',
    );
    expect(message.subject).toBe('Reset your LASUATOS password');
    expect(message.text).toContain(`https://pilot.example.net/reset-password#token=${'b'.repeat(43)}`);
    expect(message.text).not.toContain('?token=');
    expect(message.html).toContain('Amina &lt;Student&gt;');
    expect(message.html).not.toContain('<Student>');
    expect(message.text).toContain('expires in 30 minutes');
    expect(message.text).toContain('signs you out on every device');
  });

  it('sends staff invitations with a fragment-only link, the role and area, and escaped names', () => {
    const invite = {
      to: 'hod@example.net',
      displayName: 'Ngozi <HOD>',
      token: 'c'.repeat(43),
      roleLabel: 'Department administrator',
      scopeLabel: 'Electronic & Computer Engineering',
      institutionName: 'Lagos State University',
      expiresAt: new Date('2026-11-17T13:05:00.000Z'),
    };
    const message = staffInvitationMessage({ ...invite, invitedByName: 'Ada <Admin>' }, 'https://pilot.example.net');
    expect(message.subject).toBe('Your LASUATOS department administrator invitation');
    expect(message.text).toContain(`https://pilot.example.net/accept-invitation#token=${'c'.repeat(43)}`);
    expect(message.text).not.toContain('?token=');
    expect(message.text).toContain('Ada <Admin> has invited you');
    expect(message.html).toContain('Ada &lt;Admin&gt;');
    expect(message.html).toContain('Electronic &amp; Computer Engineering');
    expect(message.html).not.toContain('<HOD>');
    expect(message.text).toContain('14:05'); // Lagos time
    expect(staffInvitationMessage({ ...invite, invitedByName: null }, 'https://pilot.example.net').text).toContain('You have been invited');
  });

  it('describes reset and change notices in Lagos time without any link or token', () => {
    const occurredAt = new Date('2026-11-10T13:05:00.000Z');
    const reset = securityNoticeMessage({ to: 'a@example.net', displayName: 'A', kind: 'password_reset', occurredAt });
    const changed = securityNoticeMessage({ to: 'a@example.net', displayName: 'A', kind: 'password_changed', occurredAt });
    expect(reset.subject).toBe('Your LASUATOS password was reset');
    expect(changed.subject).toBe('Your LASUATOS password was changed');
    expect(reset.text).toContain('14:05'); // UTC+1
    expect(reset.text).toContain('Africa/Lagos');
    expect(reset.html).not.toContain('<a ');
  });

  it('delivers reset emails through the configured provider', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    const transport = createEmailTransport(loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'server-secret',
      EMAIL_FROM_ADDRESS: 'pilot@example.net',
      PUBLIC_APP_URL: 'https://pilot.example.net',
    }), fetchImplementation);

    await transport?.sendPasswordReset({ to: 'student@example.net', displayName: 'Amina', token: 'c'.repeat(43) });
    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as { subject: string; text: string };
    expect(body.subject).toBe('Reset your LASUATOS password');
    expect(body.text).toContain('/reset-password#token=');
  });
});
