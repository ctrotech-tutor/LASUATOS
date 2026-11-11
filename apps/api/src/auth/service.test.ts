import { describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken, hashPassword, verifyPassword } from '@lasuatos/auth';
import type { EmailTransport, VerificationEmail } from '../email/transport.js';
import type {
  AccountCredential,
  AuthRepository,
  LecturerSessionAccount,
  PendingStudentRegistration,
  StudentSessionAccount,
} from './repository.js';
import {
  AuthOperationUnavailableError,
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
    createPendingStudent: async () => ({ kind: 'duplicate' }),
    issueEmailVerificationResend: async () => ({ kind: 'missing' }),
    completeEmailVerification: async () => null,
    findCredentials: async () => null,
    createSession: async () => null,
    findSession: async () => null,
    revokeSession: async () => undefined,
    ...overrides,
  };
}

function transport(send: (message: VerificationEmail) => Promise<void> = async () => undefined): EmailTransport {
  return { sendVerification: send };
}

describe('student authentication service', () => {
  it('hashes the password and sends an expiring verification token without storing the raw token', async () => {
    let inserted: PendingStudentRegistration | undefined;
    let sent: VerificationEmail | undefined;
    const auth = new StudentAuthService({
      repository: repository({
        createPendingStudent: async (input) => {
          inserted = input;
          return { kind: 'created', email: input.email, displayName: input.displayName };
        },
      }),
      emailTransport: transport(async (message) => { sent = message; }),
      institutionSlug: 'lasu',
      now: () => now,
    });

    await auth.registerStudent({
      displayName: '  Amina Student ',
      email: ' Amina@Example.NET ',
      matricNumber: ' 00012345 ',
      password: 'a sufficiently long password',
    });

    expect(inserted).toBeDefined();
    expect(inserted).toMatchObject({
      institutionSlug: 'lasu',
      email: 'amina@example.net',
      displayName: 'Amina Student',
      matricNumber: '00012345',
      verificationRequestedAt: now,
      verificationExpiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    await expect(verifyPassword('a sufficiently long password', inserted!.passwordHash)).resolves.toBe(true);
    expect(sent).toMatchObject({ to: 'amina@example.net', displayName: 'Amina Student' });
    expect(inserted!.verificationTokenHash).toBe(hashOpaqueToken(sent!.token));
    expect(inserted!.verificationTokenHash).not.toBe(sent!.token);
  });

  it('does not create a pending account if email delivery is not configured', async () => {
    const createPendingStudent = vi.fn(async () => ({ kind: 'duplicate' as const }));
    const auth = new StudentAuthService({
      repository: repository({ createPendingStudent }),
      institutionSlug: 'lasu',
      now: () => now,
    });

    await expect(auth.registerStudent({
      displayName: 'Amina',
      email: 'amina@example.net',
      matricNumber: '00012345',
      password: 'a sufficiently long password',
    })).rejects.toBeInstanceOf(AuthOperationUnavailableError);
    expect(createPendingStudent).not.toHaveBeenCalled();
  });

  it('keeps duplicate registration generic and does not send a second message', async () => {
    const sendVerification = vi.fn(async () => undefined);
    const auth = new StudentAuthService({
      repository: repository({ createPendingStudent: async () => ({ kind: 'duplicate' }) }),
      emailTransport: transport(sendVerification),
      institutionSlug: 'lasu',
      now: () => now,
    });

    await expect(auth.registerStudent({
      displayName: 'Amina',
      email: 'amina@example.net',
      matricNumber: '00012345',
      password: 'a sufficiently long password',
    })).resolves.toBeUndefined();
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
