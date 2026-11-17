import { describe, expect, it, vi } from 'vitest';
import { loadEnvironment } from '../env.js';
import { EmailDeliveryError } from './errors.js';
import {
  MemoryEmailUsageStore,
  nextUtcMidnight,
  parseDailyLimits,
  pauseUntil,
  ProviderChain,
  utcDays,
  type EmailChainEvent,
  type EmailProviderName,
  type EmailUsageStore,
  type Mailer,
} from './failover.js';
import type { OutgoingMessage } from './messages.js';
import { classifyApiProviderFailure, classifySmtpFailure, createEmailTransport, emailChainFor } from './transport.js';

const message: OutgoingMessage = {
  to: 'student@st.lasu.edu.ng',
  displayName: 'Amina',
  subject: 'Your LASUATOS code',
  text: 'Your code is 123456',
  html: '<p>Your code is 123456</p>',
};

class FakeMailer implements Mailer {
  readonly sent: OutgoingMessage[] = [];
  failure: EmailDeliveryError | null = null;
  calls = 0;

  constructor(readonly provider: EmailProviderName) {}

  async deliver(outgoing: OutgoingMessage): Promise<void> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    this.sent.push(outgoing);
  }
}

function setup(options: { limits?: Partial<Record<EmailProviderName, number | null>>; usage?: EmailUsageStore; start?: string } = {}) {
  let now = new Date(options.start ?? '2026-11-10T09:00:00Z');
  const brevo = new FakeMailer('brevo');
  const gmail = new FakeMailer('gmail');
  const events: EmailChainEvent[] = [];
  const storeErrors: unknown[] = [];
  const usage = options.usage ?? new MemoryEmailUsageStore();
  const chain = new ProviderChain({
    mailers: [brevo, gmail],
    usage,
    ...(options.limits ? { limits: options.limits } : {}),
    now: () => now,
    onEvent: (event) => { events.push(event); },
    onStoreError: (error) => storeErrors.push(error),
  });
  return {
    chain, brevo, gmail, events, storeErrors, usage,
    advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); },
    at: (iso: string) => { now = new Date(iso); },
  };
}

describe('email provider failover', () => {
  it('sends through the first provider and counts the send', async () => {
    const { chain, brevo, gmail, events } = setup();
    await chain.deliver(message);
    expect(brevo.sent).toHaveLength(1);
    expect(gmail.calls).toBe(0);
    expect(events).toEqual([]);
    const status = await chain.status();
    expect(status.current).toBe('brevo');
    expect(status.providers[0]).toMatchObject({ provider: 'brevo', role: 'primary', sentToday: 1, limit: 300, state: 'ready' });
    expect(status.providers[1]).toMatchObject({ provider: 'gmail', role: 'fallback', sentToday: 0, limit: 500 });
  });

  it('moves to the next provider when Brevo runs out of quota, and skips Brevo until midnight UTC', async () => {
    const { chain, brevo, gmail, events, advance, at } = setup();
    brevo.failure = new EmailDeliveryError('Brevo refused the message (HTTP 402): not_enough_credits', 'quota');

    await chain.deliver(message);
    expect(gmail.sent).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'failover', delivered: 'gmail', failed: [{ provider: 'brevo', why: 'quota' }] });
    expect((events[0] as unknown as { failed: { until: Date }[] }).failed[0]!.until.toISOString()).toBe('2026-11-11T00:00:00.000Z');

    // Every later send that day goes straight to Gmail: Brevo is not even tried.
    advance(60 * 60_000);
    await chain.deliver(message);
    expect(brevo.calls).toBe(1);
    expect(gmail.sent).toHaveLength(2);
    expect(events).toHaveLength(1);
    const status = await chain.status();
    expect(status.current).toBe('gmail');
    expect(status.providers[0]).toMatchObject({ state: 'paused', failedToday: 1, lastFailureKind: 'quota' });

    // After midnight UTC Brevo is first again.
    brevo.failure = null;
    at('2026-11-11T00:05:00Z');
    await chain.deliver(message);
    expect(brevo.sent).toHaveLength(1);
    expect((await chain.status()).providers[0]).toMatchObject({ state: 'ready', sentToday: 1 });
  });

  it('switches before the limit is hit and warns at 90% and 100%', async () => {
    const { chain, brevo, gmail, events } = setup({ limits: { brevo: 10 } });
    for (let index = 0; index < 12; index += 1) await chain.deliver(message);
    expect(brevo.sent).toHaveLength(10);
    expect(gmail.sent).toHaveLength(2);
    expect(events).toEqual([
      { type: 'quota', provider: 'brevo', sent: 9, limit: 10, next: 'gmail' },
      { type: 'quota', provider: 'brevo', sent: 10, limit: 10, next: 'gmail' },
    ]);
    expect((await chain.status()).providers[0]).toMatchObject({ state: 'full', sentToday: 10 });
  });

  it('still tries a skipped provider last, so bookkeeping never stops an email', async () => {
    const { chain, brevo, gmail, events } = setup({ limits: { brevo: 1, gmail: 1 } });
    await chain.deliver(message); // brevo 1/1
    await chain.deliver(message); // gmail 1/1
    await chain.deliver(message); // both "full": brevo is tried anyway and accepts
    expect(brevo.sent).toHaveLength(2);
    expect(gmail.sent).toHaveLength(1);
    expect(events.filter((event) => event.type === 'all_failed')).toEqual([]);
  });

  it('reports when every provider refuses, with each reason', async () => {
    const { chain, brevo, gmail, events } = setup();
    brevo.failure = new EmailDeliveryError('Brevo refused the message (HTTP 401): Key not found', 'setup');
    gmail.failure = new EmailDeliveryError('Gmail refused the message (EAUTH)', 'setup');
    const error = await chain.deliver(message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).reason).toContain('Brevo: Brevo refused the message (HTTP 401)');
    expect((error as EmailDeliveryError).reason).toContain('Gmail: Gmail refused the message (EAUTH)');
    expect((error as EmailDeliveryError).kind).toBe('setup');
    expect(events).toEqual([{ type: 'all_failed', attempts: [
      expect.objectContaining({ provider: 'brevo', why: 'setup' }),
      expect.objectContaining({ provider: 'gmail', why: 'setup' }),
    ] }]);
  });

  it('keeps the provider’s own error when there is only one provider', async () => {
    const only = new FakeMailer('brevo');
    only.failure = new EmailDeliveryError('Brevo refused the message (HTTP 401): unrecognised IP address', 'setup');
    const chain = new ProviderChain({ mailers: [only] });
    await expect(chain.deliver(message)).rejects.toBe(only.failure);
  });

  it('does not fail over for an address that cannot receive mail', async () => {
    const { chain, brevo, gmail } = setup();
    brevo.failure = new EmailDeliveryError('Brevo refused the message (HTTP 400): email is not valid', 'recipient');
    await expect(chain.deliver(message)).rejects.toBe(brevo.failure);
    expect(gmail.calls).toBe(0);
    // And Brevo is not paused for everyone else.
    expect((await chain.status()).providers[0]).toMatchObject({ state: 'ready', failedToday: 1 });
  });

  it('pauses briefly for network trouble and retries afterwards', async () => {
    const { chain, brevo, gmail, advance } = setup();
    brevo.failure = new EmailDeliveryError('api.brevo.com did not answer within 9 seconds.', 'network');
    await chain.deliver(message);
    brevo.failure = null;
    advance(60_000);
    await chain.deliver(message);
    expect(brevo.calls).toBe(1); // still paused after one minute
    advance(2 * 60_000);
    await chain.deliver(message);
    expect(brevo.sent).toHaveLength(1);
    expect(gmail.sent).toHaveLength(2);
  });

  it('a success lifts a pause carried over from yesterday', async () => {
    const { chain, brevo, gmail, at } = setup({ start: '2026-11-10T23:00:00Z' });
    gmail.failure = new EmailDeliveryError('550 5.4.5 Daily user sending limit exceeded', 'quota');
    brevo.failure = new EmailDeliveryError('timeout', 'network');
    await chain.deliver(message).catch(() => undefined);
    // Gmail's quota pause runs 3 hours, past midnight.
    at('2026-11-11T00:30:00Z');
    expect((await chain.status()).providers[1]).toMatchObject({ state: 'paused' });
    brevo.failure = null;
    gmail.failure = null;
    await chain.deliver(message); // Brevo delivers
    expect(gmail.calls).toBe(1);
  });

  it('sends anyway when the usage store is down', async () => {
    const broken: EmailUsageStore = {
      read: vi.fn(async () => { throw new Error('connection refused'); }),
      recordSent: vi.fn(async () => { throw new Error('connection refused'); }),
      recordFailure: vi.fn(async () => { throw new Error('connection refused'); }),
      prune: vi.fn(async () => 0),
    };
    const { chain, brevo, storeErrors } = setup({ usage: broken });
    await chain.deliver(message);
    expect(brevo.sent).toHaveLength(1);
    expect(storeErrors.length).toBeGreaterThanOrEqual(2);
  });

  it('raises no events for operator alerts themselves', async () => {
    const { chain, brevo, gmail, events } = setup();
    brevo.failure = new EmailDeliveryError('quota', 'quota');
    await chain.deliver(message, { quiet: true });
    expect(gmail.sent).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it('keeps seven days of counts for System health and prunes old days', async () => {
    const { chain, usage, at } = setup({ start: '2026-11-04T10:00:00Z' });
    await chain.deliver(message);
    at('2026-11-10T10:00:00Z');
    await chain.deliver(message);
    await chain.deliver(message);
    const status = await chain.status(7);
    expect(status.days).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    expect(status.providers[0]!.history).toEqual([1, 0, 0, 0, 0, 0, 2]);
    expect(await usage.prune('2026-11-05')).toBe(1);
  });
});

describe('pauses and limits', () => {
  it('pauses Brevo and Resend until midnight UTC, Gmail for a few hours, setup problems for half an hour', () => {
    const now = new Date('2026-11-10T15:20:00Z');
    expect(pauseUntil('brevo', 'quota', now)?.toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(pauseUntil('resend', 'quota', now)?.toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(pauseUntil('gmail', 'quota', now)?.toISOString()).toBe('2026-11-10T18:20:00.000Z');
    expect(pauseUntil('brevo', 'setup', now)?.toISOString()).toBe('2026-11-10T15:50:00.000Z');
    expect(pauseUntil('brevo', 'network', now)?.toISOString()).toBe('2026-11-10T15:22:00.000Z');
    expect(pauseUntil('brevo', 'recipient', now)).toBeNull();
    expect(nextUtcMidnight(new Date('2026-12-31T23:59:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(utcDays(new Date('2026-11-01T00:30:00Z'), 2)).toEqual(['2026-10-31', '2026-11-01']);
  });

  it('reads EMAIL_DAILY_LIMITS', () => {
    expect(parseDailyLimits('brevo:300, gmail=450,resend:none')).toEqual({ limits: { brevo: 300, gmail: 450, resend: null }, errors: [] });
    expect(parseDailyLimits('brevo:lots').errors).toHaveLength(1);
    expect(parseDailyLimits('')).toEqual({ limits: {}, errors: [] });
  });
});

describe('classifying provider refusals', () => {
  it('sorts Brevo and Resend answers', () => {
    expect(classifyApiProviderFailure('brevo', 402, '{"code":"not_enough_credits","message":"You don\'t have enough credits"}')).toBe('quota');
    expect(classifyApiProviderFailure('brevo', 429, '{"message":"daily limit reached"}')).toBe('quota');
    expect(classifyApiProviderFailure('brevo', 429, '{"message":"Too many requests"}')).toBe('network');
    expect(classifyApiProviderFailure('brevo', 401, '{"code":"unauthorized","message":"We have detected you are using an unrecognised IP address"}')).toBe('setup');
    expect(classifyApiProviderFailure('brevo', 401, '{"code":"unauthorized","message":"Key not found"}')).toBe('setup');
    expect(classifyApiProviderFailure('brevo', 400, '{"code":"invalid_parameter","message":"Sender is not valid"}')).toBe('setup');
    expect(classifyApiProviderFailure('brevo', 400, '{"code":"invalid_parameter","message":"email is not valid in to"}')).toBe('recipient');
    expect(classifyApiProviderFailure('brevo', 503, 'upstream')).toBe('network');
    expect(classifyApiProviderFailure('resend', 403, '{"message":"The gmail.com domain is not verified"}')).toBe('setup');
    expect(classifyApiProviderFailure('resend', 429, '{"name":"daily_quota_exceeded","message":"You have reached your daily email sending quota"}')).toBe('quota');
    expect(classifyApiProviderFailure('resend', 422, '{"message":"Invalid `to` field"}')).toBe('recipient');
  });

  it('sorts Gmail SMTP errors', () => {
    expect(classifySmtpFailure({ code: 'EMESSAGE', responseCode: 550, response: '550-5.4.5 Daily user sending limit exceeded' })).toBe('quota');
    expect(classifySmtpFailure({ code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' })).toBe('setup');
    expect(classifySmtpFailure({ code: 'ETIMEDOUT', message: 'Connection timeout' })).toBe('network');
    expect(classifySmtpFailure({ code: 'EMESSAGE', responseCode: 421, response: '421-4.7.0 Try again later' })).toBe('network');
    expect(classifySmtpFailure({ code: 'EENVELOPE', responseCode: 553, response: 'Recipient address rejected' })).toBe('setup');
    expect(classifySmtpFailure({ code: 'EENVELOPE', message: 'No recipients defined' })).toBe('recipient');
  });
});

describe('the configured transport', () => {
  it('fails over from Brevo to Resend through the real adapters', async () => {
    const calls: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      calls.push(String(input));
      expect(init?.signal).toBeDefined();
      if (String(input).includes('brevo')) return Response.json({ code: 'not_enough_credits', message: 'Not enough credits' }, { status: 402 });
      return new Response(null, { status: 202 });
    });
    const events: EmailChainEvent[] = [];
    const environment = loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-secret',
      RESEND_API_KEY: 're_secret_key_1234',
      EMAIL_FROM_ADDRESS: 'noreply@attendance.example.edu',
      PUBLIC_APP_URL: 'https://pilot.example.net',
    });
    const transport = createEmailTransport(environment, fetchImplementation, { onEvent: (event) => { events.push(event); } });
    expect(emailChainFor(transport)?.providers).toEqual(['brevo', 'resend']);
    await transport?.sendPasswordReset({ to: 'student@example.net', displayName: 'Amina', token: 'c'.repeat(43) });
    expect(calls).toEqual(['https://api.brevo.com/v3/smtp/email', 'https://api.resend.com/emails']);
    expect(events[0]).toMatchObject({ type: 'failover', delivered: 'resend', failed: [{ provider: 'brevo', why: 'quota' }] });
    // The next email goes straight to Resend.
    await transport?.sendPasswordReset({ to: 'student@example.net', displayName: 'Amina', token: 'd'.repeat(43) });
    expect(calls.at(-1)).toBe('https://api.resend.com/emails');
    expect(calls).toHaveLength(3);
  });

  it('sends through one named provider for the email:test command', () => {
    const environment = loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-secret',
      GMAIL_USER: 'lasuatos@gmail.com',
      GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
      EMAIL_FROM_ADDRESS: 'lasuatos@gmail.com',
    });
    expect(emailChainFor(createEmailTransport(environment))?.providers).toEqual(['brevo', 'gmail']);
    expect(emailChainFor(createEmailTransport(environment, globalThis.fetch, { only: 'gmail' }))?.providers).toEqual(['gmail']);
  });
});
