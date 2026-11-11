import { describe, expect, it, vi } from 'vitest';
import { loadEnvironment } from '../env.js';
import { createEmailTransport, EmailDeliveryError } from './transport.js';

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
