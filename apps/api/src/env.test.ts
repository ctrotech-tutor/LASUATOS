import { describe, expect, it } from 'vitest';
import { RETENTION_DEFAULTS } from '@lasuatos/contracts';
import { emailProviderOrder, environmentWarnings, loadEnvironment, parseTrustProxy, splitList } from './env.js';

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

  it('uses the Vercel production domain when PUBLIC_APP_URL is unset, never over an explicit value', () => {
    expect(loadEnvironment({
      NODE_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'lasuatos.vercel.app',
    }).PUBLIC_APP_URL).toBe('https://lasuatos.vercel.app');
    expect(loadEnvironment({
      NODE_ENV: 'production',
      PUBLIC_APP_URL: 'https://attendance.example.edu',
      VERCEL_PROJECT_PRODUCTION_URL: 'lasuatos.vercel.app',
    }).PUBLIC_APP_URL).toBe('https://attendance.example.edu');
  });

  it('validates the serverless database settings', () => {
    const defaults = loadEnvironment({ NODE_ENV: 'test' });
    expect(defaults.DATABASE_POOL_MAX).toBeUndefined();
    expect(defaults.DATABASE_CONNECT_TIMEOUT_MS).toBe(10_000);
    expect(loadEnvironment({ NODE_ENV: 'test', DATABASE_POOL_MAX: '' }).DATABASE_POOL_MAX).toBeUndefined();
    expect(loadEnvironment({ NODE_ENV: 'test', DATABASE_POOL_MAX: '2' }).DATABASE_POOL_MAX).toBe(2);
    expect(() => loadEnvironment({ NODE_ENV: 'test', DATABASE_POOL_MAX: '0' })).toThrow();
    expect(() => loadEnvironment({ NODE_ENV: 'test', DATABASE_CONNECT_TIMEOUT_MS: '10' })).toThrow();
  });

  it('warns when production has no email delivery or database', () => {
    const production = loadEnvironment({ NODE_ENV: 'production', PUBLIC_APP_URL: 'https://attendance.example.edu' });
    const warnings = environmentWarnings(production).join('\n');
    expect(warnings).toContain('EMAIL_PROVIDER is "none"');
    expect(warnings).toContain('DATABASE_URL is not set');
    expect(environmentWarnings(loadEnvironment({ NODE_ENV: 'development' }))).toEqual([]);
  });
});

describe('email provider failover order (ADR 029)', () => {
  const brevo = { NODE_ENV: 'test', EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'xkeysib-key', EMAIL_FROM_ADDRESS: 'lasuatos@gmail.com' } as const;
  const gmail = { GMAIL_USER: 'lasuatos@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' } as const;

  it('adds every other configured provider by default (this is how production gets Gmail as Brevo’s backup)', () => {
    expect(emailProviderOrder(loadEnvironment({ ...brevo, ...gmail }))).toEqual(['brevo', 'gmail']);
    expect(emailProviderOrder(loadEnvironment(brevo))).toEqual(['brevo']);
    expect(emailProviderOrder(loadEnvironment({ NODE_ENV: 'test' }))).toEqual([]);
  });

  it('leaves Resend out of the automatic list when the sender is a free mail address it can never send from', () => {
    expect(emailProviderOrder(loadEnvironment({ ...brevo, ...gmail, RESEND_API_KEY: 're_key_123456789' }))).toEqual(['brevo', 'gmail']);
    expect(emailProviderOrder(loadEnvironment({ ...brevo, EMAIL_FROM_ADDRESS: 'noreply@attendance.example.edu', ...gmail, RESEND_API_KEY: 're_key_123456789' }))).toEqual(['brevo', 'gmail', 'resend']);
  });

  it('follows an explicit list, and none turns failover off', () => {
    const resendToo = { ...brevo, EMAIL_FROM_ADDRESS: 'noreply@attendance.example.edu', ...gmail, RESEND_API_KEY: 're_key_123456789' };
    expect(emailProviderOrder(loadEnvironment({ ...resendToo, EMAIL_FALLBACK_PROVIDERS: 'resend, gmail' }))).toEqual(['brevo', 'resend', 'gmail']);
    expect(emailProviderOrder(loadEnvironment({ ...resendToo, EMAIL_FALLBACK_PROVIDERS: 'NONE' }))).toEqual(['brevo']);
  });

  it('never adds fallbacks to local Mailpit capture', () => {
    expect(emailProviderOrder(loadEnvironment({ NODE_ENV: 'development', EMAIL_PROVIDER: 'mailpit', EMAIL_FROM_ADDRESS: 'lasuatos@example.net', ...gmail }))).toEqual(['mailpit']);
  });

  it('refuses fallbacks that are unknown, repeated or missing credentials, and malformed limits', () => {
    expect(() => loadEnvironment({ ...brevo, EMAIL_FALLBACK_PROVIDERS: 'sendgrid' })).toThrow(/auto, none, or a list/);
    expect(() => loadEnvironment({ ...brevo, ...gmail, EMAIL_FALLBACK_PROVIDERS: 'brevo,gmail' })).toThrow(/listed twice/);
    expect(() => loadEnvironment({ ...brevo, EMAIL_FALLBACK_PROVIDERS: 'gmail' })).toThrow(/GMAIL_USER and GMAIL_APP_PASSWORD/);
    expect(() => loadEnvironment({ ...brevo, EMAIL_DAILY_LIMITS: 'brevo=lots' })).toThrow(/brevo:300/);
    expect(loadEnvironment({ ...brevo, EMAIL_DAILY_LIMITS: 'brevo:250' }).EMAIL_DAILY_LIMITS).toBe('brevo:250');
  });

  it('warns in production when there is no backup provider, and when Resend cannot send from the sender', () => {
    const production = { ...brevo, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://lasuatos.example.net' } as const;
    expect(environmentWarnings(loadEnvironment(production)).join(' ')).toContain('Only one email provider (brevo)');
    expect(environmentWarnings(loadEnvironment({ ...production, ...gmail })).join(' ')).not.toContain('Only one email provider');
    expect(environmentWarnings(loadEnvironment({ ...production, EMAIL_FALLBACK_PROVIDERS: 'none' })).join(' ')).not.toContain('Only one email provider');
    expect(environmentWarnings(loadEnvironment({ ...production, RESEND_API_KEY: 're_key_123456789', EMAIL_FALLBACK_PROVIDERS: 'resend' })).join(' ')).toContain('Resend only sends from a domain you verified');
  });
});

describe('blank number settings', () => {
  it('treats a blank number setting as unset, never as 0', () => {
    const environment = loadEnvironment({
      API_PORT: '',
      FACE_QUEUE_BUDGET_MS: '',
      RETENTION_GRACE_MONTHS: ' ',
      RETENTION_ACTIVE_DAYS: '',
      RETENTION_CHECK_PHOTO_DAYS: '',
      DATABASE_CONNECT_TIMEOUT_MS: '',
      DATABASE_POOL_MAX: '',
      MAILPIT_PORT: '',
    });
    expect(environment.API_PORT).toBe(4_000);
    expect(environment.FACE_QUEUE_BUDGET_MS).toBe(15_000);
    expect(environment.RETENTION_GRACE_MONTHS).toBe(RETENTION_DEFAULTS.graceMonths);
    expect(environment.RETENTION_ACTIVE_DAYS).toBe(RETENTION_DEFAULTS.activeWithinDays);
    expect(environment.RETENTION_CHECK_PHOTO_DAYS).toBe(RETENTION_DEFAULTS.checkPhotoDays);
    expect(environment.DATABASE_CONNECT_TIMEOUT_MS).toBe(10_000);
    expect(environment.DATABASE_POOL_MAX).toBeUndefined();
    expect(environment.MAILPIT_PORT).toBe(1_025);
  });

  it('still reads and checks a number that is set', () => {
    expect(loadEnvironment({ RETENTION_GRACE_MONTHS: '0', FACE_QUEUE_BUDGET_MS: '2000' })).toMatchObject({ RETENTION_GRACE_MONTHS: 0, FACE_QUEUE_BUDGET_MS: 2_000 });
    expect(() => loadEnvironment({ FACE_QUEUE_BUDGET_MS: '500' })).toThrow();
    expect(() => loadEnvironment({ RETENTION_CHECK_PHOTO_DAYS: 'soon' })).toThrow();
  });
});
