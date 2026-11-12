import { describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken, hashPassword, verifyPassword } from '@lasuatos/auth';
import type {
  EmailTransport,
  PasswordResetEmail,
  SecurityNoticeEmail,
  VerificationEmail,
} from '../email/transport.js';
import type {
  PasswordResetIssue,
  AccountCredential,
  AuthRepository,
  LecturerSessionAccount,
  StudentAccountRegistration,
  StudentSessionAccount,
} from './repository.js';
import {
  AuthOperationUnavailableError,
  CurrentPasswordRejectedError,
  DuplicateAccountError,
  EmailDeliveryDeferredError,
  InvalidPasswordResetError,
  PasswordUnchangedError,
  SessionRequiredError,
  InvalidLoginError,
  InvalidVerificationError,
  StudentAuthService,
} from './service.js';

const now = new Date('2026-11-10T12:00:00.000Z');
const student: StudentSessionAccount = {
  accountType: 'student',
  id: '3c4ad7b8-377d-4ea9-a7bf-f7db874f388c',
  email: 'amina@example.net',
  displayName: 'Amina Student',
  matricNumber: '00012345',
  matricNumberVerified: false,
  sessionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
};

function repository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    createStudentAccount: async () => ({ kind: 'duplicate_email' }),
    issueEmailVerificationResend: async () => ({ kind: 'missing' }),
    completeEmailVerification: async () => null,
    findCredentials: async () => null,
    createSession: async () => null,
    findSession: async () => null,
    revokeSession: async () => undefined,
    issuePasswordReset: async () => ({ kind: 'missing' }),
    completePasswordReset: async () => ({ kind: 'invalid' }),
    findSessionPassword: async () => null,
    changePassword: async () => 0,
    listSessions: async () => null,
    revokeOtherSessions: async () => null,
    ...overrides,
  };
}

function transport(send: (message: VerificationEmail) => Promise<void> = async () => undefined): EmailTransport {
  return {
    sendVerification: send,
    sendPasswordReset: async () => undefined,
    sendSecurityNotice: async () => undefined,
    sendStaffInvitation: async () => undefined,
  };
}

describe('student authentication service', () => {
  it('creates a signed-in account, hashes the password and sends an optional confirmation link', async () => {
    let inserted: StudentAccountRegistration | undefined;
    let sent: VerificationEmail | undefined;
    const auth = new StudentAuthService({
      repository: repository({
        createStudentAccount: async (input) => {
          inserted = input;
          return { kind: 'created', email: input.email, displayName: input.displayName, student };
        },
      }),
      emailTransport: transport(async (message) => { sent = message; }),
      institutionSlug: 'lasu',
      now: () => now,
    });

    const session = await auth.registerStudent({
      displayName: '  Amina   Student ',
      email: ' Amina@Example.NET ',
      matricNumber: ' 24 0591 001 ',
      password: 'a sufficiently long password',
    });

    expect(inserted).toMatchObject({
      institutionSlug: 'lasu',
      email: 'amina@example.net',
      displayName: 'Amina Student',
      matricNumber: '240591001',
      entryLevel: 100,
      verificationRequestedAt: now,
      verificationExpiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
      sessionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    });
    await expect(verifyPassword('a sufficiently long password', inserted!.passwordHash)).resolves.toBe(true);
    expect(session.student).toBe(student);
    expect(inserted!.sessionTokenHash).toBe(hashOpaqueToken(session.token));
    expect(sent).toMatchObject({ to: 'amina@example.net', displayName: 'Amina Student' });
    expect(inserted!.verificationTokenHash).toBe(hashOpaqueToken(sent!.token));
    expect(inserted!.verificationTokenHash).not.toBe(sent!.token);
  });

  it('still creates the account when email is not configured or delivery fails', async () => {
    const created = async (input: StudentAccountRegistration) => ({
      kind: 'created' as const, email: input.email, displayName: input.displayName, student,
    });
    const withoutEmail = new StudentAuthService({ repository: repository({ createStudentAccount: created }), institutionSlug: 'lasu', now: () => now });
    const warn = vi.fn();
    const failingEmail = new StudentAuthService({
      repository: repository({ createStudentAccount: created }),
      emailTransport: transport(async () => { throw new Error('provider down'); }),
      institutionSlug: 'lasu',
      now: () => now,
      logger: { warn },
    });
    const input = { displayName: 'Amina', email: 'amina@example.net', matricNumber: '00012345', password: 'a sufficiently long password' };

    await expect(withoutEmail.registerStudent(input)).resolves.toMatchObject({ student });
    await expect(failingEmail.registerStudent(input)).resolves.toMatchObject({ student });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports a duplicate email or matric number and sends nothing', async () => {
    const sendVerification = vi.fn(async () => undefined);
    const input = { displayName: 'Amina', email: 'amina@example.net', matricNumber: '00012345', password: 'a sufficiently long password' };
    for (const kind of ['duplicate_email', 'duplicate_matric'] as const) {
      const auth = new StudentAuthService({
        repository: repository({ createStudentAccount: async () => ({ kind }) }),
        emailTransport: transport(sendVerification),
        institutionSlug: 'lasu',
        now: () => now,
      });
      const rejection = await auth.registerStudent(input).catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(DuplicateAccountError);
      expect((rejection as DuplicateAccountError).field).toBe(kind === 'duplicate_email' ? 'email' : 'matric');
    }
    expect(sendVerification).not.toHaveBeenCalled();
  });

  it('rotates and sends a new token only when the resend cooldown allows it', async () => {
    let sent: VerificationEmail | undefined;
    const auth = new StudentAuthService({
      repository: repository({
        issueEmailVerificationResend: async () => ({
          kind: 'issued',
          email: 'amina@example.net',
          displayName: 'Amina Student',
        }),
      }),
      emailTransport: transport(async (message) => { sent = message; }),
      institutionSlug: 'lasu',
      now: () => now,
    });

    await auth.resendVerification(' Amina@Example.NET ');
    expect(sent?.to).toBe('amina@example.net');
    expect(sent?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('consumes the email token and creates a separate session token', async () => {
    let verificationInput: {
      tokenHash: string;
      sessionTokenHash: string;
      now: Date;
      sessionExpiresAt: Date;
    } | undefined;
    const auth = new StudentAuthService({
      repository: repository({
        completeEmailVerification: async (input) => {
          verificationInput = input;
          return student;
        },
      }),
      institutionSlug: 'lasu',
      now: () => now,
    });

    const session = await auth.verifyEmail('v'.repeat(43));

    expect(session.student).toBe(student);
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verificationInput).toMatchObject({
      tokenHash: hashOpaqueToken('v'.repeat(43)),
      sessionTokenHash: hashOpaqueToken(session.token),
      now,
      sessionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    });
    expect(verificationInput?.sessionTokenHash).not.toBe(session.token);
  });

  it('rejects expired or reused verification tokens', async () => {
    const auth = new StudentAuthService({ repository: repository(), institutionSlug: 'lasu' });
    await expect(auth.verifyEmail('v'.repeat(43))).rejects.toBeInstanceOf(InvalidVerificationError);
  });

  it('allows an email-confirmed lecturer only when a provisioned lecturer credential is returned', async () => {
    const password = 'a sufficiently long lecturer password';
    const credential: AccountCredential = {
      accountType: 'lecturer',
      id: '9888b9df-8921-4f55-b3f9-8c5ddf18ac05',
      passwordHash: await hashPassword(password),
      status: 'active',
      emailVerified: true,
    };
    const lecturer: LecturerSessionAccount = {
      accountType: 'lecturer',
      id: credential.id,
      email: 'lecturer@example.net',
      displayName: 'Example Lecturer',
      sessionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    };
    const findCredentials = vi.fn(async () => credential);
    const createSession = vi.fn(async () => lecturer);
    const auth = new StudentAuthService({
      repository: repository({ findCredentials, createSession }),
      institutionSlug: 'lasu',
      now: () => now,
    });

    await expect(auth.login(' Lecturer@Example.NET ', password)).resolves.toMatchObject({
      account: lecturer,
    });
    expect(findCredentials).toHaveBeenCalledWith('lecturer@example.net', 'lasu');
    expect(createSession).toHaveBeenCalledWith(
      lecturer.id,
      expect.any(String),
      now,
      lecturer.sessionExpiresAt,
    );
  });

  it('uses a generic login failure for accounts without an accepted password', async () => {
    const auth = new StudentAuthService({
      repository: repository(),
      institutionSlug: 'lasu',
    });
    await expect(auth.login('unknown@example.net', 'a sufficiently long password'))
      .rejects.toBeInstanceOf(InvalidLoginError);
  });
});

describe('password recovery and account security', () => {
  const sessionToken = 's'.repeat(43);

  function recordingTransport() {
    const resets: PasswordResetEmail[] = [];
    const notices: SecurityNoticeEmail[] = [];
    const emailTransport: EmailTransport = {
      sendVerification: async () => undefined,
      sendPasswordReset: async (email) => { resets.push(email); },
      sendSecurityNotice: async (email) => { notices.push(email); },
      sendStaffInvitation: async () => undefined,
    };
    return { emailTransport, resets, notices };
  }

  it('issues a hashed, expiring reset token and emails only the raw token', async () => {
    let issued: PasswordResetIssue | undefined;
    const { emailTransport, resets } = recordingTransport();
    const auth = new StudentAuthService({
      repository: repository({
        issuePasswordReset: async (input) => {
          issued = input;
          return { kind: 'issued', email: 'amina@example.net', displayName: 'Amina Student' };
        },
      }),
      emailTransport,
      institutionSlug: 'lasu',
      now: () => now,
    });

    await auth.requestPasswordReset('  Amina@Example.NET ');

    expect(issued).toMatchObject({
      institutionSlug: 'lasu',
      email: 'amina@example.net',
      requestedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
      cooldownMilliseconds: 2 * 60 * 1_000,
    });
    expect(resets).toHaveLength(1);
    expect(resets[0]?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued!.tokenHash).toBe(hashOpaqueToken(resets[0]!.token));
    expect(issued!.tokenHash).not.toBe(resets[0]!.token);
  });

  it('sends nothing for unknown, ineligible or cooling-down addresses and still resolves', async () => {
    for (const kind of ['missing', 'cooldown'] as const) {
      const { emailTransport, resets } = recordingTransport();
      const auth = new StudentAuthService({
        repository: repository({ issuePasswordReset: async () => ({ kind }) }),
        emailTransport,
        institutionSlug: 'lasu',
      });
      await expect(auth.requestPasswordReset('nobody@example.net')).resolves.toBeUndefined();
      expect(resets).toHaveLength(0);
    }
  });

  it('refuses reset requests without email delivery and reports delivery failures as deferred', async () => {
    const unconfigured = new StudentAuthService({ repository: repository(), institutionSlug: 'lasu' });
    await expect(unconfigured.requestPasswordReset('a@example.net')).rejects.toBeInstanceOf(AuthOperationUnavailableError);

    const failing = new StudentAuthService({
      repository: repository({
        issuePasswordReset: async () => ({ kind: 'issued', email: 'a@example.net', displayName: 'A' }),
      }),
      emailTransport: {
        ...recordingTransport().emailTransport,
        sendPasswordReset: async () => { throw new Error('smtp down'); },
      },
      institutionSlug: 'lasu',
    });
    await expect(failing.requestPasswordReset('a@example.net')).rejects.toBeInstanceOf(EmailDeliveryDeferredError);
  });

  it('completes a reset with a fresh hash and sends a security notice', async () => {
    let stored: { tokenHash: string; passwordHash: string; now: Date } | undefined;
    const token = 'k'.repeat(43);
    const { emailTransport, notices } = recordingTransport();
    const auth = new StudentAuthService({
      repository: repository({
        completePasswordReset: async (input) => {
          stored = input;
          return { kind: 'reset', email: 'amina@example.net', displayName: 'Amina Student', revokedSessions: 2 };
        },
      }),
      emailTransport,
      institutionSlug: 'lasu',
      now: () => now,
    });

    await auth.completePasswordReset(token, 'a brand new passphrase');

    expect(stored?.tokenHash).toBe(hashOpaqueToken(token));
    await expect(verifyPassword('a brand new passphrase', stored!.passwordHash)).resolves.toBe(true);
    expect(notices).toEqual([{ to: 'amina@example.net', displayName: 'Amina Student', kind: 'password_reset', occurredAt: now }]);
  });

  it('rejects invalid, expired or used reset tokens with one message', async () => {
    const auth = new StudentAuthService({ repository: repository(), institutionSlug: 'lasu' });
    await expect(auth.completePasswordReset('k'.repeat(43), 'a brand new passphrase'))
      .rejects.toBeInstanceOf(InvalidPasswordResetError);
  });

  it('does not report a completed reset as failed when the notice cannot be delivered', async () => {
    const warn = vi.fn();
    const auth = new StudentAuthService({
      repository: repository({
        completePasswordReset: async () => ({ kind: 'reset', email: 'a@example.net', displayName: 'A', revokedSessions: 0 }),
      }),
      emailTransport: {
        ...recordingTransport().emailTransport,
        sendSecurityNotice: async () => { throw new Error('smtp down'); },
      },
      institutionSlug: 'lasu',
      logger: { warn },
    });
    await expect(auth.completePasswordReset('k'.repeat(43), 'a brand new passphrase')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ kind: 'password_reset', reason: 'smtp down' }, expect.any(String));
  });

  it('changes the password only after the current password is confirmed', async () => {
    const passwordHash = await hashPassword('the current passphrase');
    const changePassword = vi.fn(async () => 1);
    const { emailTransport, notices } = recordingTransport();
    const auth = new StudentAuthService({
      repository: repository({
        findSessionPassword: async (tokenHash) => tokenHash === hashOpaqueToken(sessionToken)
          ? { userId: student.id, email: student.email, displayName: student.displayName, passwordHash }
          : null,
        changePassword,
      }),
      emailTransport,
      institutionSlug: 'lasu',
      now: () => now,
    });

    await expect(auth.changePassword('x'.repeat(43), 'the current passphrase', 'another long passphrase'))
      .rejects.toBeInstanceOf(SessionRequiredError);
    await expect(auth.changePassword(sessionToken, 'wrong current passphrase', 'another long passphrase'))
      .rejects.toBeInstanceOf(CurrentPasswordRejectedError);
    await expect(auth.changePassword(sessionToken, 'the current passphrase', 'the current passphrase'))
      .rejects.toBeInstanceOf(PasswordUnchangedError);
    expect(changePassword).not.toHaveBeenCalled();

    await expect(auth.changePassword(sessionToken, 'the current passphrase', 'another long passphrase')).resolves.toBe(1);
    expect(changePassword).toHaveBeenCalledWith(expect.objectContaining({
      userId: student.id,
      currentSessionTokenHash: hashOpaqueToken(sessionToken),
      now,
    }));
    const [[{ passwordHash: newHash }]] = changePassword.mock.calls as unknown as [[{ passwordHash: string }]];
    await expect(verifyPassword('another long passphrase', newHash)).resolves.toBe(true);
    expect(notices.map((notice) => notice.kind)).toEqual(['password_changed']);
  });

  it('lists and revokes sessions only for a valid caller session', async () => {
    const revokeOtherSessions = vi.fn(async () => 2);
    const auth = new StudentAuthService({
      repository: repository({ listSessions: async () => [], revokeOtherSessions }),
      institutionSlug: 'lasu',
      now: () => now,
    });
    await expect(auth.listSessions(sessionToken)).resolves.toEqual([]);
    await expect(auth.revokeOtherSessions(sessionToken)).resolves.toBe(2);
    expect(revokeOtherSessions).toHaveBeenCalledWith({ sessionTokenHash: hashOpaqueToken(sessionToken), now });

    const anonymous = new StudentAuthService({ repository: repository(), institutionSlug: 'lasu' });
    await expect(anonymous.listSessions(sessionToken)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(anonymous.revokeOtherSessions(sessionToken, 'id')).rejects.toBeInstanceOf(SessionRequiredError);
  });
});
