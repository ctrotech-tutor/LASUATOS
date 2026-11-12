import { describe, expect, it, vi } from 'vitest';
import { loadEnvironment } from '../env.js';
import {
  createEmailTransport,
  describeSmtpFailure,
  disputeNotifierFor,
  disputeResolvedMessage,
  disputeSubmittedMessage,
  EmailDeliveryError,
  emailFailureReason,
  passwordResetMessage,
  sendTestEmail,
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

describe('email failure reasons', () => {
  const brevoEnvironment = loadEnvironment({
    NODE_ENV: 'test',
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'xkeysib-server-secret',
    EMAIL_FROM_ADDRESS: 'pilot@example.net',
  });

  async function failureFrom(fetchImplementation: typeof fetch): Promise<EmailDeliveryError> {
    const transport = createEmailTransport(brevoEnvironment, fetchImplementation);
    const error: unknown = await transport?.sendVerification(verificationEmail).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    return error as EmailDeliveryError;
  }

  it('explains a Brevo IP block and how to fix it, without exposing it in the error message', async () => {
    const error = await failureFrom(async () => Response.json(
      { code: 'unauthorized', message: 'We have detected you are using an unrecognised IP address 203.0.113.9.' },
      { status: 401 },
    ));
    expect(error.message).toBe('The email provider did not accept the message.');
    expect(error.reason).toContain('HTTP 401');
    expect(error.reason).toContain('unrecognised IP address');
    expect(error.reason).toContain('Authorised IPs');
    expect(emailFailureReason(error)).toBe(error.reason);
  });

  it('points to the API key when Brevo rejects it and never repeats the key', async () => {
    const error = await failureFrom(async () => Response.json(
      { code: 'unauthorized', message: 'Key not found: xkeysib-server-secret' },
      { status: 401 },
    ));
    expect(error.reason).toContain('xkeysib-');
    expect(error.reason).not.toContain('server-secret');
    expect(error.reason).toContain('[hidden]');
  });

  it('points to sender verification when Brevo rejects the from address', async () => {
    const error = await failureFrom(async () => Response.json(
      { code: 'invalid_parameter', message: 'Sender is not valid' },
      { status: 400 },
    ));
    expect(error.reason).toContain('EMAIL_FROM_ADDRESS must be a sender you verified in Brevo');
  });

  it('reports network failures and timeouts by host', async () => {
    const unreachable = await failureFrom(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) });
    });
    expect(unreachable.reason).toBe('Could not reach api.brevo.com (ENOTFOUND). Check the internet connection or firewall.');
    const slow = await failureFrom(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    expect(slow.reason).toBe('api.brevo.com did not answer within 15 seconds.');
  });

  it('explains Gmail login and network failures without echoing the App Password', () => {
    const login = describeSmtpFailure(
      'Gmail',
      Object.assign(new Error('Invalid login'), {
        code: 'EAUTH',
        responseCode: 535,
        response: '535-5.7.8 Username and Password not accepted for abcdefghijklmnop',
      }),
      ['abcd efgh ijkl mnop', 'abcdefghijklmnop'],
    );
    expect(login).toContain('(EAUTH)');
    expect(login).toContain('App Password');
    expect(login).not.toContain('abcdefghijklmnop');
    const blocked = describeSmtpFailure('Gmail', Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }), []);
    expect(blocked).toContain('could not be reached');
  });

  it('sends a harmless test message through the configured provider', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const transport = createEmailTransport(brevoEnvironment, fetchImplementation);
    if (!transport) throw new Error('expected a transport');

    await sendTestEmail(transport, 'admin@example.net', 'brevo', new Date('2026-11-10T09:00:00Z'));
    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as {
      subject: string;
      to: { email: string }[];
      textContent: string;
    };
    expect(body.subject).toBe('LASUATOS email test');
    expect(body.to[0]?.email).toBe('admin@example.net');
    expect(body.textContent).toContain('sent through brevo');
    expect(body.textContent).toContain('10:00');
    expect(body.textContent).not.toContain('token=');
  });
});

describe('attendance dispute messages', () => {
  const sessionStartsAt = new Date('2026-11-03T09:00:00.000Z');

  it('tells the lecturer where to review, escapes names and never includes the statement', () => {
    const message = disputeSubmittedMessage({
      to: 'lecturer@example.net',
      displayName: 'Dr <Ade>',
      courseCode: 'ECE 301',
      sessionTitle: 'Week 3 & lab',
      sessionStartsAt,
      studentName: 'Amina <Student>',
      openDisputeCount: 3,
    }, 'https://pilot.example.net');
    expect(message.subject).toBe('Attendance dispute: ECE 301 · Week 3 & lab');
    expect(message.text).toContain('https://pilot.example.net/lecturer/disputes');
    expect(message.text).toContain('10:00'); // Lagos time
    expect(message.text).toContain('2 other open disputes');
    expect(message.html).toContain('Amina &lt;Student&gt;');
    expect(message.html).not.toContain('<Student>');
    expect(message.html).toContain('Week 3 &amp; lab');
    const single = disputeSubmittedMessage({
      to: 'l@example.net', displayName: 'L', courseCode: 'C', sessionTitle: 'S', sessionStartsAt, studentName: 'A', openDisputeCount: 1,
    }, 'https://pilot.example.net');
    expect(single.text).toContain('only open dispute');
  });

  it('gives the student the decision and the lecturer note', () => {
    const upheld = disputeResolvedMessage({
      to: 'student@example.net', displayName: 'Amina', courseCode: 'ECE 301', sessionTitle: 'Week 3',
      sessionStartsAt, decision: 'upheld', note: 'I saw you <there>.', lecturerName: 'Dr Ade',
    }, 'https://pilot.example.net');
    expect(upheld.subject).toBe('Dispute accepted: ECE 301 · Week 3');
    expect(upheld.text).toContain('now marked present');
    expect(upheld.text).toContain('https://pilot.example.net/attendance');
    expect(upheld.html).toContain('I saw you &lt;there&gt;.');
    const rejected = disputeResolvedMessage({
      to: 'student@example.net', displayName: 'Amina', courseCode: 'ECE 301', sessionTitle: 'Week 3',
      sessionStartsAt, decision: 'rejected', note: 'Not in the hall.', lecturerName: 'Dr Ade',
    }, 'https://pilot.example.net');
    expect(rejected.subject).toBe('Dispute not accepted: ECE 301 · Week 3');
    expect(rejected.text).toContain('unchanged');
  });

  it('exposes the notifier only for configured message transports', async () => {
    expect(disputeNotifierFor(undefined)).toBeUndefined();
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const transport = createEmailTransport(loadEnvironment({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-server-secret',
      EMAIL_FROM_ADDRESS: 'pilot@example.net',
      PUBLIC_APP_URL: 'https://pilot.example.net',
    }), fetchImplementation);
    const notifier = disputeNotifierFor(transport);
    expect(notifier).toBeDefined();
    await notifier?.sendDisputeResolvedNotice({
      to: 'student@example.net', displayName: 'Amina', courseCode: 'ECE 301', sessionTitle: 'Week 3',
      sessionStartsAt, decision: 'upheld', note: 'Seen in class.', lecturerName: 'Dr Ade',
    });
    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as { subject: string; to: Array<{ email: string }> };
    expect(body.subject).toBe('Dispute accepted: ECE 301 · Week 3');
    expect(body.to[0]?.email).toBe('student@example.net');
  });
});
