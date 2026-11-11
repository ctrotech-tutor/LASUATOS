import { describe, expect, it } from 'vitest';
import { loadEnvironment, parseTrustProxy, splitList } from './env.js';

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

describe('security environment configuration', () => {
  it('defaults to a shared PostgreSQL rate-limit store behind a loopback proxy', () => {
    const environment = loadEnvironment({ NODE_ENV: 'test' });
    expect(environment.RATE_LIMIT_STORE).toBe('postgres');
    expect(parseTrustProxy(environment.TRUST_PROXY)).toEqual(['loopback']);
  });

  it('parses proxy trust lists and booleans', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('TRUE')).toBe(true);
    expect(parseTrustProxy('10.0.0.0/8, 192.168.1.4')).toEqual(['10.0.0.0/8', '192.168.1.4']);
  });

  it('refuses to disable rate limiting in production', () => {
    expect(() => loadEnvironment({
      NODE_ENV: 'production',
      PUBLIC_APP_URL: 'https://attendance.example.edu',
      RATE_LIMIT_STORE: 'off',
    })).toThrow(/Rate limiting cannot be disabled/);
    expect(loadEnvironment({ NODE_ENV: 'test', RATE_LIMIT_STORE: 'off' }).RATE_LIMIT_STORE).toBe('off');
  });

  it('accepts only bare origins in TRUSTED_ORIGINS', () => {
    expect(splitList(loadEnvironment({
      NODE_ENV: 'test',
      TRUSTED_ORIGINS: 'https://a.example.edu, http://localhost:3001',
    }).TRUSTED_ORIGINS)).toEqual(['https://a.example.edu', 'http://localhost:3001']);
    expect(() => loadEnvironment({ NODE_ENV: 'test', TRUSTED_ORIGINS: 'https://a.example.edu/path' })).toThrow();
    expect(() => loadEnvironment({ NODE_ENV: 'test', TRUSTED_ORIGINS: 'javascript:alert(1)' })).toThrow();
  });
});
