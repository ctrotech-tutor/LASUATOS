import { describe, expect, it } from 'vitest';
import type { SecurityNoticeEmail, StudentEmailCodeEmail, StudentEmailCodeSender } from '../email/transport.js';
import type { StudentSessionAccount } from '../auth/repository.js';
import type { ClassListRecord, StudentAccountRecord, StudentRepository } from './repository.js';
import { StudentService, StudentError } from './service.js';

/*
 * A linked personal email (ADR 040): the repository is a stub with a code row
 * that plays the issue/check pair, so the service's own rules are what the
 * tests pin down.
 */

const now = new Date('2026-11-10T12:00:00.000Z');
const userId = '3c4ad7b8-377d-4ea9-a7bf-f7db874f388c';

const sessionAccount: StudentSessionAccount = {
  accountType: 'student' as const,
  id: userId,
  email: '24-0591-001@st.lasu.edu.ng',
  displayName: 'Amina Student',
  matricNumber: '240591001',
  matricNumberVerified: true,
  sessionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
};

function studentRecord(overrides: Partial<StudentAccountRecord> = {}): StudentAccountRecord {
  return {
    userId,
    institutionId: 'inst-1',
    email: '24-0591-001@st.lasu.edu.ng',
    emailVerified: true,
    matricNumber: '240591001',
    passwordIsDefault: false,
    secondaryEmail: null,
    secondaryEmailVerified: false,
    mailDelivery: 'primary',
    ...overrides,
  };
}

function entry(overrides: Partial<ClassListRecord> = {}): ClassListRecord {
  return {
    id: 'entry-1',
    institutionId: 'inst-1',
    departmentId: 'dept-1',
    departmentName: 'Computer Science',
    facultyId: 'fac-1',
    facultyName: 'Science',
    programmeYears: 4,
    matricNumber: '240591001',
    jambNumber: null,
    jambJoined: false,
    surname: 'Odejobi',
    firstName: 'Amina',
    middleName: null,
    lasuEmail: '24-0591-001@st.lasu.edu.ng',
    entryYear: 2025,
    entryLevel: 100,
    studentUserId: userId,
    accountEmail: '24-0591-001@st.lasu.edu.ng',
    accountEmailVerified: true,
    accountVouched: false,
    accountPasswordIsDefault: false,
    faceRegistered: false,
    isRep: false,
    addedByName: null,
    updatedAt: now,
    ...overrides,
  };
}

interface CodeRow {
  readonly email: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
  attempts: number;
  readonly createdAt: Date;
}

/**
 * The bit of the repository these flows touch, with the issued code kept so
 * `checkEmailCode` can do what the SQL does: a wrong guess counts, a right one
 * deletes the row.
 */
function stub(options: {
  readonly student?: StudentAccountRecord | null;
  readonly entry?: ClassListRecord | null;
  readonly emailTaken?: boolean;
  readonly previous?: string | null;
  readonly passwordMatches?: boolean;
} = {}) {
  const notices: SecurityNoticeEmail[] = [];
  const codes: StudentEmailCodeEmail[] = [];
  const audited: string[] = [];
  let row: CodeRow | null = null;
  let linked: { email: string; previous: string | null } | null = null;
  let removed = false;
  const record = options.student !== undefined ? options.student : studentRecord();
  const list = options.entry !== undefined ? options.entry : entry();
  const repository = {
    findInstitutionId: async () => 'inst-1',
    findStudentAccount: async () => record,
    findEntryByUser: async () => list,
    findEntryByMatric: async () => list,
    findFaceProfile: async () => null,
    secondaryEmailTaken: async () => options.emailTaken ?? false,
    setSecondaryEmail: async (input: { email: string }) => {
      linked = { email: input.email, previous: options.previous ?? null };
      return { kind: 'updated' as const, previous: options.previous ?? null };
    },
    removeSecondaryEmail: async () => {
      removed = true;
      return options.previous ?? null;
    },
    setMailDelivery: async (input: { delivery: 'primary' | 'secondary' }) => {
      return input.delivery === 'secondary' && !(record?.secondaryEmailVerified && record.secondaryEmail) ? 'no_secondary' as const : 'updated' as const;
    },
    issueEmailCode: async (input: { email: string; codeHash: string; expiresAt: Date; now: Date }) => {
      row = { email: input.email, codeHash: input.codeHash, expiresAt: input.expiresAt, attempts: 0, createdAt: input.now };
      return { kind: 'issued' as const };
    },
    checkEmailCode: async (input: { hashFor: (email: string) => string; maxAttempts: number; now: Date }) => {
      const held = row;
      if (!held) return { kind: 'missing' as const };
      if (held.expiresAt <= input.now) return { kind: 'expired' as const };
      if (held.codeHash !== input.hashFor(held.email)) {
        held.attempts += 1;
        if (held.attempts >= input.maxAttempts) row = null;
        return { kind: 'wrong' as const, attemptsLeft: Math.max(0, input.maxAttempts - held.attempts) };
      }
      row = null;
      return { kind: 'ok' as const, email: held.email };
    },
    audit: async (event: { action: string }) => { audited.push(event.action); },
  } as unknown as StudentRepository;

  const emailSender: StudentEmailCodeSender = {
    sendSecurityNotice: async (message) => { notices.push(message); },
    sendStudentEmailCode: async (message) => { codes.push(message); },
  };

  const service = new StudentService({
    repository,
    institutionSlug: 'lasu',
    emailSender,
    now: () => now,
    credentials: { verifyStudent: async () => (options.passwordMatches ?? true) ? userId : null },
  });

  return {
    service,
    notices,
    codes,
    audited,
    linked: () => linked,
    removed: () => removed,
    /** The code that was sent and accepted as its hash demands (from the sender's mail). */
    code: () => codes.at(-1)?.code ?? '',
  };
}

describe('linking a personal email (ADR 040)', () => {
  it('sends a code to the personal address once the password checks out', async () => {
    const { service, codes } = stub();
    const sent = await service.requestSecondaryEmailCode(sessionAccount, { password: 'secret-words', email: 'Amina@gmail.com' });
    expect(sent).toMatchObject({ status: 'sent', email: 'amina@gmail.com' });
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ to: 'amina@gmail.com', purpose: 'secondary' });
  });

  it('refuses a LASU address and the account’s own email', async () => {
    const { service } = stub();
    await expect(service.requestSecondaryEmailCode(sessionAccount, { password: 'x'.repeat(8), email: '24-0591-001@st.lasu.edu.ng' }))
      .rejects.toThrow(/LASU address/i);
    await expect(service.requestSecondaryEmailCode(sessionAccount, { password: 'x'.repeat(8), email: '90-0000-000@st.lasu.edu.ng' }))
      .rejects.toThrow(/LASU address/i);
    await expect(service.requestSecondaryEmailCode(sessionAccount, { password: 'x'.repeat(8), email: 'not-an-email' }))
      .rejects.toThrow(/full email/i);
  });

  it('refuses an address another account or class list uses', async () => {
    const { service } = stub({ emailTaken: true });
    await expect(service.requestSecondaryEmailCode(sessionAccount, { password: 'x'.repeat(8), email: 'taken@gmail.com' }))
      .rejects.toThrow(/already used/);
  });

  it('refuses without the password, and on a session started with the starting password', async () => {
    const wrongPassword = stub({ passwordMatches: false });
    await expect(wrongPassword.service.requestSecondaryEmailCode(sessionAccount, { password: 'x'.repeat(8), email: 'amina@gmail.com' }))
      .rejects.toThrow(/password is not right/i);

    const defaultPassword = stub({ student: studentRecord({ passwordIsDefault: true }) });
    const startingSession = { ...sessionAccount, startingPasswordSession: true };
    await expect(defaultPassword.service.requestSecondaryEmailCode(startingSession, { password: 'x'.repeat(8), email: 'amina@gmail.com' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('links the address the code went to, tells the LASU address, and audits it', async () => {
    const { service, code, linked, notices, audited } = stub();
    await service.requestSecondaryEmailCode(sessionAccount, { password: 'x'.repeat(8), email: 'amina@gmail.com' });
    const result = await service.verifySecondaryEmail(sessionAccount, code());
    expect(result).toEqual({ status: 'verified', email: 'amina@gmail.com' });
    expect(linked()).toEqual({ email: 'amina@gmail.com', previous: null });
    expect(audited).toEqual(['secondary_email_added']);
    // The LASU address is always told: it is the one address a hijacker cannot redirect.
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ to: '24-0591-001@st.lasu.edu.ng', kind: 'secondary_email_added', secondaryEmail: 'amina@gmail.com' });
  });

  it('a code that was never asked for, or a wrong one, links nothing', async () => {
    const { service, linked } = stub();
    await expect(service.verifySecondaryEmail(sessionAccount, '123456')).rejects.toThrow(/Ask for a code first/);
    await service.requestSecondaryEmailCode(sessionAccount, { password: 'x'.repeat(8), email: 'amina@gmail.com' });
    await expect(service.verifySecondaryEmail(sessionAccount, '000000')).rejects.toThrow(/not right/);
    expect(linked()).toBeNull();
  });

  it('changing tells both the LASU address and the replaced personal email', async () => {
    const { service, code, notices, audited } = stub({
      student: studentRecord({ secondaryEmail: 'old@gmail.com', secondaryEmailVerified: true, mailDelivery: 'secondary' }),
      previous: 'old@gmail.com',
    });
    await service.requestSecondaryEmailCode(sessionAccount, { password: 'x'.repeat(8), email: 'new@gmail.com' });
    const result = await service.verifySecondaryEmail(sessionAccount, code());
    expect(result.status).toBe('verified');
    expect(audited).toEqual(['secondary_email_changed']);
    expect(notices.map((notice) => `${notice.kind}→${notice.to}`)).toEqual([
      'secondary_email_changed→24-0591-001@st.lasu.edu.ng',
      'secondary_email_removed→old@gmail.com',
    ]);
  });

  it('removes only with the password, and tells both addresses', async () => {
    const { service, notices, audited, removed } = stub({ previous: 'amina@gmail.com' });
    const result = await service.removeSecondaryEmail(sessionAccount, { password: 'x'.repeat(8) });
    expect(result.status).toBe('removed');
    expect(removed()).toBe(true);
    expect(audited).toEqual(['secondary_email_removed']);
    expect(notices.map((notice) => notice.to).sort()).toEqual(['24-0591-001@st.lasu.edu.ng', 'amina@gmail.com']);
  });

  it('refuses to remove what was never linked', async () => {
    const { service } = stub({ previous: null });
    await expect(service.removeSecondaryEmail(sessionAccount, { password: 'x'.repeat(8) })).rejects.toThrow(/No personal email/);
  });

  it('mail can only go to a personal email that is linked and verified', async () => {
    const { service } = stub();
    await expect(service.setMailDelivery(sessionAccount, 'secondary')).rejects.toThrow(/Link a personal email first/);

    const linkedAccount = stub({ student: studentRecord({ secondaryEmail: 'amina@gmail.com', secondaryEmailVerified: true, mailDelivery: 'primary' }) });
    await expect(linkedAccount.service.setMailDelivery(sessionAccount, 'secondary')).resolves.toEqual({ status: 'updated', mailDelivery: 'secondary' });
  });
});

describe('mail through the linked personal email (ADR 040)', () => {
  const linkedStudent = studentRecord({ secondaryEmail: 'amina@gmail.com', secondaryEmailVerified: true, mailDelivery: 'secondary' });

  it('a password-reset code goes to the address the student reads, masked for the stranger asking', async () => {
    const { service, codes } = stub({ student: linkedStudent });
    const sent = await service.requestPasswordCode({ matricNumber: '240591001' });
    expect(codes[0]).toMatchObject({ to: 'amina@gmail.com', purpose: 'reset' });
    // The reply names only a masked address, like every code answer.
    expect(sent.email).not.toContain('amina');
    expect(sent.email).toContain('@gmail.com');
  });

  it('a code reset still works on the account email when delivery is primary', async () => {
    const { service, codes } = stub();
    await service.requestPasswordCode({ matricNumber: '240591001' });
    expect(codes[0]).toMatchObject({ to: '24-0591-001@st.lasu.edu.ng', purpose: 'reset' });
  });

  it('an account with no confirmed email but a verified personal email can still reset', async () => {
    const { service, codes } = stub({
      student: studentRecord({ emailVerified: false, secondaryEmail: 'amina@gmail.com', secondaryEmailVerified: true, mailDelivery: 'secondary' }),
      entry: entry({ accountEmail: '24-0591-001@st.lasu.edu.ng', accountEmailVerified: false }),
    });
    await service.requestPasswordCode({ matricNumber: '240591001' });
    expect(codes[0]).toMatchObject({ to: 'amina@gmail.com', purpose: 'reset' });
  });

  it('an open account with nothing proven is told to open again', async () => {
    const { service } = stub({
      student: studentRecord({ emailVerified: false }),
      entry: entry({ accountEmailVerified: false }),
    });
    await expect(service.requestPasswordCode({ matricNumber: '240591001' })).rejects.toThrow(StudentError);
  });
});
