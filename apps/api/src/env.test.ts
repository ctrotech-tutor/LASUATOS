import { describe, expect, it } from 'vitest';
import { loadEnvironment } from './env.js';

describe('email environment configuration', () => {
  it('leaves mail delivery disabled by default', () => {
    const environment = loadEnvironment({ NODE_ENV: 'test' });

    expect(environment.EMAIL_PROVIDER).toBe('none');
    expect(environment.PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(environment.SELF_REGISTRATION_INSTITUTION_SLUG).toBe('lasu');
  });

  it('allows Mailpit only outside production and requires a test sender', () => {
    expect(loadEnvironment({
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'mailpit',
      EMAIL_FROM_ADDRESS: 'lasuatos@example.net',
    }).EMAIL_PROVIDER).toBe('mailpit');

    expect(() => loadEnvironment({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'mailpit',
      EMAIL_FROM_ADDRESS: 'lasuatos@example.net',
      PUBLIC_APP_URL: 'https://accounts.example.net',
    })).toThrow();
    expect(() => loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'mailpit',
    })).toThrow();
    expect(() => loadEnvironment({
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'mailpit',
      EMAIL_FROM_ADDRESS: 'lasuatos@example.net',
      MAILPIT_HOST: 'smtp.example.net',
    })).toThrow();
    expect(loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'mailpit',
      EMAIL_FROM_ADDRESS: 'lasuatos@example.net',
      MAILPIT_HOST: '::1',
    }).MAILPIT_HOST).toBe('::1');
  });

  it('accepts Gmail with an eligible App Password and rejects a regular password-only setup', () => {
    const environment = loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'gmail',
      GMAIL_USER: 'pilot@gmail.com',
      GMAIL_APP_PASSWORD: 'app-password-from-server-secret-store',
    });
    expect(environment.EMAIL_PROVIDER).toBe('gmail');

    expect(() => loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'gmail',
      GMAIL_USER: 'pilot@gmail.com',
      GMAIL_PASSWORD: 'regular-google-password',
    })).toThrow();
  });

  it('requires complete OAuth2 settings when using Gmail OAuth2', () => {
    expect(() => loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'gmail',
      GMAIL_USER: 'pilot@gmail.com',
      GMAIL_CLIENT_ID: 'client-id',
    })).toThrow();

    expect(loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'gmail',
      GMAIL_USER: 'pilot@gmail.com',
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
    }).EMAIL_PROVIDER).toBe('gmail');
  });

  it.each(['brevo', 'resend'] as const)('requires a key and verified sender address for %s', (provider) => {
    expect(() => loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: provider,
    })).toThrow();

    const environment = loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: provider,
      EMAIL_FROM_ADDRESS: 'notifications@example.net',
      ...(provider === 'brevo' ? { BREVO_API_KEY: 'brevo-key' } : { RESEND_API_KEY: 'resend-key' }),
    });
    expect(environment.EMAIL_PROVIDER).toBe(provider);
  });

  it('requires HTTPS application links in production', () => {
    expect(() => loadEnvironment({
      NODE_ENV: 'production',
      PUBLIC_APP_URL: 'http://localhost:3000',
    })).toThrow();
    expect(loadEnvironment({
      NODE_ENV: 'production',
      PUBLIC_APP_URL: 'https://accounts.example.net',
    }).NODE_ENV).toBe('production');
  });
});
