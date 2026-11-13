import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPasswordOrDummy,
} from '@lasuatos/auth';
import { emailFailureReason, type EmailTransport, type SecurityNoticeKind } from '../email/transport.js';
import type {
  AccountCredential,
  AccountSessionRecord,
  AuthRepository,
  AuthenticatedAccount,
  StudentSessionAccount,
} from './repository.js';

const VERIFICATION_TTL_MILLISECONDS = 30 * 60 * 1_000;
export const SESSION_TTL_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const VERIFICATION_RESEND_COOLDOWN_MILLISECONDS = 2 * 60 * 1_000;
export const PASSWORD_RESET_TTL_MILLISECONDS = 30 * 60 * 1_000;
export const PASSWORD_RESET_COOLDOWN_MILLISECONDS = 2 * 60 * 1_000;

export interface SecurityEventLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export class AuthOperationUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Account registration is not configured.');
    this.name = 'AuthOperationUnavailableError';
  }
}

export class EmailDeliveryDeferredError extends Error {
  constructor() {
    super('The verification message could not be delivered.');
    this.name = 'EmailDeliveryDeferredError';
  }
}

export class InvalidLoginError extends Error {
  readonly statusCode = 401;
  readonly exposeDetail = true;

  constructor() {
    super('That email or matric number and password do not match an account. Check both and try again.');
    this.name = 'InvalidLoginError';
  }
}

export class DuplicateAccountError extends Error {
  readonly statusCode = 409;
  readonly exposeDetail = true;

  constructor(readonly field: 'email' | 'matric') {
    super(field === 'email'
      ? 'An account already uses this email address. Sign in instead, or reset your password if you have forgotten it.'
      : 'This matric number is already registered. Sign in with that account, or ask your HOC or an administrator for help if it is not yours.');
    this.name = 'DuplicateAccountError';
  }
}

/** Upper case without spaces, so "24 0591001" and "240591001" are the same student. */
export function normalizeMatricNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export class InvalidVerificationError extends Error {
  readonly statusCode = 400;

  constructor() {
    super('The verification link is invalid or has expired.');
    this.name = 'InvalidVerificationError';
  }
}

export class InvalidPasswordResetError extends Error {
  readonly statusCode = 400;
  readonly exposeDetail = true;

  constructor() {
    super('This password reset link is invalid, has expired or has already been used. Request a new one.');
    this.name = 'InvalidPasswordResetError';
  }
}

export class SessionRequiredError extends Error {
  readonly statusCode = 401;

  constructor() {
    super('Sign in to continue.');
    this.name = 'SessionRequiredError';
  }
}

export class ProfileFieldError extends Error {
  readonly exposeDetail = true;

  constructor(message: string, readonly statusCode: 400 | 409 = 400) {
    super(message);
    this.name = 'ProfileFieldError';
  }
}

export class CurrentPasswordRejectedError extends Error {
  readonly statusCode = 400;
  readonly exposeDetail = true;

  constructor() {
    super('Your current password was not accepted.');
    this.name = 'CurrentPasswordRejectedError';
  }
}

export class PasswordUnchangedError extends Error {
  readonly statusCode = 400;
  readonly exposeDetail = true;

  constructor() {
    super('Choose a new password that is different from your current one.');
    this.name = 'PasswordUnchangedError';
  }
}

export interface StudentRegistrationInput {
  readonly displayName: string;
  readonly email: string;
  readonly matricNumber: string;
  readonly password: string;
  /** 100 (UTME, default) or 200/300 (Direct Entry); self-declared. */
  readonly entryLevel?: 100 | 200 | 300 | undefined;
}

export interface IssuedStudentSession {
  readonly token: string;
  readonly student: StudentSessionAccount;
}

export interface IssuedAccountSession {
  readonly token: string;
  readonly account: AuthenticatedAccount;
}

export interface StudentAuthServiceOptions {
  readonly repository: AuthRepository;
  readonly emailTransport?: EmailTransport;
  readonly institutionSlug: string;
  readonly now?: () => Date;
  /** Receives non-fatal delivery failures for security notices. */
  readonly logger?: SecurityEventLogger;
}

export class StudentAuthService {
  readonly #repository: AuthRepository;
  readonly #emailTransport: EmailTransport | undefined;
  readonly #institutionSlug: string;
  readonly #now: () => Date;
  readonly #logger: SecurityEventLogger | undefined;

  constructor(options: StudentAuthServiceOptions) {
    this.#logger = options.logger;
    this.#repository = options.repository;
    this.#emailTransport = options.emailTransport;
    this.#institutionSlug = options.institutionSlug;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Creates a student account that is signed in straight away. A mailbox
   * confirmation link is sent when email is configured, but nothing waits on
   * it: a delivery failure is logged and the account still works.
   */
  async registerStudent(input: StudentRegistrationInput): Promise<IssuedStudentSession> {
    const now = this.#now();
    const verificationToken = createOpaqueToken();
    const sessionToken = createOpaqueToken();
    const result = await this.#repository.createStudentAccount({
      institutionSlug: this.#institutionSlug,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim().replace(/\s+/g, ' '),
      passwordHash: await hashPassword(input.password),
      matricNumber: normalizeMatricNumber(input.matricNumber),
      entryLevel: input.entryLevel ?? 100,
      verificationTokenHash: hashOpaqueToken(verificationToken),
      verificationExpiresAt: new Date(now.getTime() + VERIFICATION_TTL_MILLISECONDS),
      verificationRequestedAt: now,
      sessionTokenHash: hashOpaqueToken(sessionToken),
      sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MILLISECONDS),
    });

    if (result.kind === 'institution_missing') throw new AuthOperationUnavailableError();
    if (result.kind === 'duplicate_email') throw new DuplicateAccountError('email');
    if (result.kind === 'duplicate_matric') throw new DuplicateAccountError('matric');

    if (this.#emailTransport) {
      try {
        await this.#emailTransport.sendVerification({
          to: result.email,
          displayName: result.displayName,
          token: verificationToken,
        });
      } catch (error) {
        this.#logger?.warn({ reason: emailFailureReason(error) }, 'Verification email could not be delivered');
      }
    }
    return { token: sessionToken, student: result.student };
  }

  async resendVerification(email: string): Promise<void> {
    if (!this.#emailTransport) throw new AuthOperationUnavailableError();

    const now = this.#now();
    const token = createOpaqueToken();
    const result = await this.#repository.issueEmailVerificationResend({
      institutionSlug: this.#institutionSlug,
      email: email.trim().toLowerCase(),
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MILLISECONDS),
      requestedAt: now,
      cooldownMilliseconds: VERIFICATION_RESEND_COOLDOWN_MILLISECONDS,
    });
    if (result.kind !== 'issued') return;

    try {
      await this.#emailTransport.sendVerification({
        to: result.email,
        displayName: result.displayName,
        token,
      });
    } catch (error) {
      this.#logger?.warn({ reason: emailFailureReason(error) }, 'Verification email could not be delivered');
      throw new EmailDeliveryDeferredError();
    }
  }

  async verifyEmail(token: string): Promise<IssuedStudentSession> {
    const now = this.#now();
    const sessionToken = createOpaqueToken();
    const student = await this.#repository.completeEmailVerification({
      tokenHash: hashOpaqueToken(token),
      sessionTokenHash: hashOpaqueToken(sessionToken),
      now,
      sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MILLISECONDS),
    });
    if (!student) throw new InvalidVerificationError();
    return { token: sessionToken, student };
  }

  /** An email address as typed, or the email of the student account with that matric number. */
  async #emailFor(identifier: string): Promise<string | null> {
    const trimmed = identifier.trim();
    if (trimmed.includes('@')) return trimmed.toLowerCase();
    const matric = normalizeMatricNumber(trimmed);
    if (!/^[A-Z0-9/-]{5,32}$/.test(matric) || !this.#repository.findStudentEmailByMatric) return null;
    return this.#repository.findStudentEmailByMatric(matric, this.#institutionSlug);
  }

  /** Signs in with an email address or (students) a matric number. */
  async login(identifier: string, password: string): Promise<IssuedAccountSession> {
    const email = await this.#emailFor(identifier);
    const account: AccountCredential | null = email
      ? await this.#repository.findCredentials(email, this.#institutionSlug)
      : null;
    const passwordMatches = await verifyPasswordOrDummy(password, account?.passwordHash ?? null);
    // Active status is what allows sign-in; confirming the mailbox is optional for students.
    if (!account || !passwordMatches || account.status !== 'active') {
      throw new InvalidLoginError();
    }

    const now = this.#now();
    const token = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MILLISECONDS);
    const authenticatedAccount = await this.#repository.createSession(
      account.id,
      hashOpaqueToken(token),
      now,
      expiresAt,
    );
    if (!authenticatedAccount || authenticatedAccount.accountType !== account.accountType) {
      throw new InvalidLoginError();
    }
    return { token, account: authenticatedAccount };
  }

  /**
   * Checks a student's email-or-matric and password without starting a
   * session: a student marking attendance on a classmate's phone. Returns the
   * student's user id, or null for anything that would fail a sign-in.
   */
  async verifyStudentCredentials(identifier: string, password: string): Promise<string | null> {
    const email = await this.#emailFor(identifier);
    const account = email ? await this.#repository.findCredentials(email, this.#institutionSlug) : null;
    const passwordMatches = await verifyPasswordOrDummy(password, account?.passwordHash ?? null);
    if (!account || !passwordMatches || account.status !== 'active' || account.accountType !== 'student') return null;
    return account.id;
  }

  async getSession(token: string): Promise<AuthenticatedAccount | null> {
    return this.#repository.findSession(hashOpaqueToken(token), this.#now());
  }

  async logout(token: string): Promise<void> {
    await this.#repository.revokeSession(hashOpaqueToken(token), this.#now());
  }

  /**
   * Starts password recovery. Callers always respond the same way: unknown,
   * unverified, inactive and cooling-down addresses are indistinguishable.
   */
  async requestPasswordReset(email: string): Promise<void> {
    if (!this.#emailTransport) throw new AuthOperationUnavailableError();
    const now = this.#now();
    const token = createOpaqueToken();
    const result = await this.#repository.issuePasswordReset({
      institutionSlug: this.#institutionSlug,
      email: email.trim().toLowerCase(),
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MILLISECONDS),
      requestedAt: now,
      cooldownMilliseconds: PASSWORD_RESET_COOLDOWN_MILLISECONDS,
    });
    if (result.kind !== 'issued') return;
    try {
      await this.#emailTransport.sendPasswordReset({ to: result.email, displayName: result.displayName, token });
    } catch (error) {
      this.#logger?.warn({ reason: emailFailureReason(error) }, 'Password reset email could not be delivered');
      throw new EmailDeliveryDeferredError();
    }
  }

  /** Sets a new password from an emailed token and signs the account out everywhere. */
  async completePasswordReset(token: string, password: string): Promise<void> {
    const now = this.#now();
    const result = await this.#repository.completePasswordReset({
      tokenHash: hashOpaqueToken(token),
      passwordHash: await hashPassword(password),
      now,
    });
    if (result.kind === 'invalid') throw new InvalidPasswordResetError();
    await this.#notify('password_reset', result.email, result.displayName, now);
  }

  /** Changes the password of the signed-in account; other sessions are signed out. */
  async changePassword(sessionToken: string, currentPassword: string, newPassword: string): Promise<number> {
    const now = this.#now();
    const sessionTokenHash = hashOpaqueToken(sessionToken);
    const record = await this.#repository.findSessionPassword(sessionTokenHash, now);
    const matches = await verifyPasswordOrDummy(currentPassword, record?.passwordHash ?? null);
    if (!record) throw new SessionRequiredError();
    if (!matches) throw new CurrentPasswordRejectedError();
    if (currentPassword === newPassword) throw new PasswordUnchangedError();
    const revoked = await this.#repository.changePassword({
      userId: record.userId,
      currentSessionTokenHash: sessionTokenHash,
      passwordHash: await hashPassword(newPassword),
      now,
    });
    await this.#notify('password_changed', record.email, record.displayName, now);
    return revoked;
  }

  /**
   * The signed-in person corrects their own name, or (students) a mistyped
   * matric number. Changing the matric number needs the current password
   * because it changes who the account claims to be.
   */
  async updateProfile(sessionToken: string, input: {
    readonly displayName?: string | undefined;
    readonly matricNumber?: string | undefined;
    readonly staffNumber?: string | undefined;
    readonly currentPassword?: string | undefined;
  }): Promise<{ readonly displayName: string; readonly matricNumber: string | null; readonly staffNumber?: string | null }> {
    const now = this.#now();
    const sessionTokenHash = hashOpaqueToken(sessionToken);
    const account = await this.#repository.findSession(sessionTokenHash, now);
    if (!account) throw new SessionRequiredError();
    let matricNumber: string | undefined;
    if (input.matricNumber !== undefined) {
      if (account.accountType !== 'student') throw new ProfileFieldError('Only student accounts have a matric number.');
      const normalized = normalizeMatricNumber(input.matricNumber);
      if (normalized !== account.matricNumber.toUpperCase()) {
        const record = await this.#repository.findSessionPassword(sessionTokenHash, now);
        const matches = await verifyPasswordOrDummy(input.currentPassword ?? '', record?.passwordHash ?? null);
        if (!record) throw new SessionRequiredError();
        if (!input.currentPassword || !matches) throw new CurrentPasswordRejectedError();
        matricNumber = normalized;
      }
    }
    let staffNumber: string | undefined;
    if (input.staffNumber !== undefined) {
      if (account.accountType !== 'lecturer') throw new ProfileFieldError('Only lecturer accounts have a staff number here.');
      if (input.staffNumber !== account.staffNumber) staffNumber = input.staffNumber;
    }
    const displayName = input.displayName !== undefined && input.displayName !== account.displayName ? input.displayName : undefined;
    if (displayName !== undefined || matricNumber !== undefined || staffNumber !== undefined) {
      const result = await this.#repository.updateProfile({ userId: account.id, displayName, matricNumber, staffNumber, now });
      if (result === 'missing') throw new SessionRequiredError();
      if (result === 'matric_verified') throw new ProfileFieldError('Your matric number has been confirmed by the university, so it can no longer be changed here.', 409);
      if (result === 'matric_taken') throw new ProfileFieldError('Another account already uses that matric number. Check it, or ask your class rep to report it.', 409);
      if (result === 'staff_number_set') throw new ProfileFieldError('Your staff number is already recorded. Ask your administrator to correct it.', 409);
      if (result === 'staff_number_taken') throw new ProfileFieldError('Another lecturer already has that staff number. Check it, or ask your administrator.', 409);
    }
    return {
      displayName: displayName ?? account.displayName,
      matricNumber: account.accountType === 'student' ? matricNumber ?? account.matricNumber : null,
      ...(account.accountType === 'lecturer' ? { staffNumber: staffNumber ?? account.staffNumber ?? null } : {}),
    };
  }

  async listSessions(sessionToken: string): Promise<AccountSessionRecord[]> {
    const sessions = await this.#repository.listSessions(hashOpaqueToken(sessionToken), this.#now());
    if (!sessions) throw new SessionRequiredError();
    return sessions;
  }

  /** Signs out every other session of the caller, or only `sessionId` when given. */
  async revokeOtherSessions(sessionToken: string, sessionId?: string): Promise<number> {
    const revoked = await this.#repository.revokeOtherSessions({
      sessionTokenHash: hashOpaqueToken(sessionToken),
      ...(sessionId ? { sessionId } : {}),
      now: this.#now(),
    });
    if (revoked === null) throw new SessionRequiredError();
    return revoked;
  }

  /** Security notices are best effort: the change already happened and must not be reported as failed. */
  async #notify(kind: SecurityNoticeKind, to: string, displayName: string, occurredAt: Date): Promise<void> {
    if (!this.#emailTransport) return;
    try {
      await this.#emailTransport.sendSecurityNotice({ to, displayName, kind, occurredAt });
    } catch (error) {
      this.#logger?.warn({ kind, reason: emailFailureReason(error) }, 'Security notice email could not be delivered');
    }
  }
}
