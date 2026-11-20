import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPasswordOrDummy,
} from '@lasuatos/auth';
import { checkPersonName, normalizeStartingPassword } from '@lasuatos/contracts';
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

/**
 * Where a signed-in student's security notices go (ADR 040): the linked
 * personal email when they chose it, otherwise the account's email. Optional
 * fields default to the account email, so test doubles need not provide them.
 */
export function sessionDeliveryAddress(record: {
  readonly email: string;
  readonly secondaryEmail?: string | null | undefined;
  readonly secondaryEmailVerified?: boolean | undefined;
  readonly mailDelivery?: 'primary' | 'secondary' | undefined;
}): string {
  return record.mailDelivery === 'secondary' && record.secondaryEmailVerified && record.secondaryEmail
    ? record.secondaryEmail
    : record.email;
}

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

/** Signing in with Google refused, with what to do instead (the person proved they own the address, so it can be specific). */
export class GoogleSignInRefusedError extends Error {
  readonly exposeDetail = true;

  constructor(readonly statusCode: 403 | 404 | 409, message: string) {
    super(message);
    this.name = 'GoogleSignInRefusedError';
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

/**
 * A session started with the starting password changes the password only
 * with the emailed code (or Google): whoever knows a student's number and
 * surname knows the starting password too (ADR 033).
 */
export class StartingPasswordSessionError extends Error {
  readonly statusCode = 403;
  readonly exposeDetail = true;

  constructor() {
    super('You signed in with the starting password, so we need to check it is you: choose your new password in Account setup, with the code we email you.');
    this.name = 'StartingPasswordSessionError';
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
  /** Staff passkeys (ADR 037): a password sign-in on an account that has one emails a notice. */
  readonly passkeys?: { hasAny(userId: string): Promise<boolean> } | undefined;
}

export class StudentAuthService {
  readonly #repository: AuthRepository;
  readonly #emailTransport: EmailTransport | undefined;
  readonly #institutionSlug: string;
  readonly #now: () => Date;
  readonly #logger: SecurityEventLogger | undefined;
  readonly #passkeys: StudentAuthServiceOptions['passkeys'];

  constructor(options: StudentAuthServiceOptions) {
    this.#logger = options.logger;
    this.#passkeys = options.passkeys;
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

  /**
   * Checks a password. A student still on the starting password (LASU +
   * matric + SURNAME) may type it in any case and with spaces or hyphens.
   */
  async #passwordMatches(password: string, account: Pick<AccountCredential, 'passwordHash' | 'passwordIsDefault'> | null): Promise<boolean> {
    if (await verifyPasswordOrDummy(password, account?.passwordHash ?? null)) return true;
    if (!account?.passwordIsDefault) return false;
    const canonical = normalizeStartingPassword(password);
    return canonical !== password && canonical.startsWith('LASU') && verifyPasswordOrDummy(canonical, account.passwordHash);
  }

  /** Signs in with an email address (the account's own, or a student's linked personal one) or (students) a matric number. */
  async login(identifier: string, password: string): Promise<IssuedAccountSession> {
    const email = await this.#emailFor(identifier);
    let account: AccountCredential | null = email
      ? await this.#repository.findCredentials(email, this.#institutionSlug)
      : null;
    // A typed address that opens nothing may be a student's linked personal email (ADR 040).
    if (!account && email && identifier.trim().includes('@') && this.#repository.findCredentialsBySecondaryEmail) {
      account = await this.#repository.findCredentialsBySecondaryEmail(email, this.#institutionSlug);
    }
    const passwordMatches = await this.#passwordMatches(password, account);
    // Active status is what allows sign-in; confirming the mailbox is optional for students.
    if (!account || !passwordMatches || account.status !== 'active') {
      throw new InvalidLoginError();
    }

    const now = this.#now();
    const token = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MILLISECONDS);
    // A student still on the starting password could be anyone who knows their number and surname:
    // the session is marked so it cannot register a face or swap the password without an emailed code.
    const authenticatedAccount = await this.#repository.createSession(
      account.id,
      hashOpaqueToken(token),
      now,
      expiresAt,
      { startingPassword: account.accountType === 'student' && account.passwordIsDefault === true },
    );
    if (!authenticatedAccount || authenticatedAccount.accountType !== account.accountType) {
      throw new InvalidLoginError();
    }
    if (authenticatedAccount.accountType !== 'student') await this.#noticeIfPasskeyHolder(authenticatedAccount, now);
    return { token, account: authenticatedAccount };
  }

  /**
   * A staff member with a passkey has no reason to type their password, and a
   * password is what a fake sign-in page collects: so each password sign-in on
   * such an account is emailed (ADR 037). Never fails the sign-in.
   */
  async #noticeIfPasskeyHolder(account: AuthenticatedAccount, now: Date): Promise<void> {
    if (!this.#passkeys) return;
    let holder = false;
    try {
      holder = await this.#passkeys.hasAny(account.id);
    } catch (error) {
      this.#logger?.warn({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Could not check for passkeys after a password sign-in');
    }
    if (holder) await this.#notify('password_sign_in', account.email, account.displayName, now);
  }

  /**
   * Signs in the account whose email Google just vouched for (ADR 028), in
   * place of the password. Only an active account whose email is confirmed:
   * an unconfirmed student account could have been opened by someone else
   * with that address typed in, so it is never handed over this way. A
   * verified linked personal email stands on its own (ADR 040): it was
   * confirmed with its own code, so it opens the account even while the
   * account's own address is unconfirmed.
   */
  async signInWithVerifiedEmail(email: string): Promise<IssuedAccountSession> {
    const address = email.trim().toLowerCase();
    let account = await this.#repository.findCredentials(address, this.#institutionSlug);
    let viaSecondary = false;
    if (!account && this.#repository.findCredentialsBySecondaryEmail) {
      account = await this.#repository.findCredentialsBySecondaryEmail(address, this.#institutionSlug);
      viaSecondary = account !== null;
    }
    if (!account) {
      throw new GoogleSignInRefusedError(404, `No LASUATOS account uses ${address}. New student? Open your account with your matric number. Staff: use the email your invitation went to.`);
    }
    // Only a student ever has a linked personal email (the repository joins the student profile);
    // the account-type check stays so a bad query can never open a staff account through it.
    if (viaSecondary && account.accountType !== 'student') {
      throw new GoogleSignInRefusedError(403, `${address} is not a sign-in email here. Staff: use your staff email.`);
    }
    if (account.status === 'invited') {
      throw new GoogleSignInRefusedError(403, 'Your invitation hasn’t been accepted yet. Open the invitation email and choose your password first.');
    }
    if (account.status !== 'active') {
      throw new GoogleSignInRefusedError(403, 'This account is not active. Ask your HOC or an administrator for help.');
    }
    if (!account.emailVerified && !viaSecondary) {
      throw new GoogleSignInRefusedError(409, account.accountType === 'student'
        ? `${address} isn’t confirmed on your account yet. Sign in with your matric number and password, then confirm it in Account setup.`
        : `${address} isn’t confirmed on your account yet. Sign in with your password.`);
    }
    const now = this.#now();
    const token = createOpaqueToken();
    const authenticatedAccount = await this.#repository.createSession(account.id, hashOpaqueToken(token), now, new Date(now.getTime() + SESSION_TTL_MILLISECONDS));
    if (!authenticatedAccount || authenticatedAccount.accountType !== account.accountType) {
      throw new GoogleSignInRefusedError(403, 'This account is not active. Ask your HOC or an administrator for help.');
    }
    return { token, account: authenticatedAccount };
  }

  /**
   * Checks a student's email-or-matric and password without starting a
   * session: a student marking attendance on a classmate's phone. Returns the
   * student's user id, or null for anything that would fail a sign-in.
   */
  async verifyStudentCredentials(identifier: string, password: string): Promise<string | null> {
    return (await this.checkStudentCredentials(identifier, password))?.userId ?? null;
  }

  /** As verifyStudentCredentials, and whether the password that matched is the starting password. */
  async checkStudentCredentials(identifier: string, password: string): Promise<{ readonly userId: string; readonly startingPassword: boolean } | null> {
    const email = await this.#emailFor(identifier);
    const account = email ? await this.#repository.findCredentials(email, this.#institutionSlug) : null;
    const passwordMatches = await this.#passwordMatches(password, account);
    if (!account || !passwordMatches || account.status !== 'active' || account.accountType !== 'student') return null;
    return { userId: account.id, startingPassword: account.passwordIsDefault === true };
  }

  async getSession(token: string): Promise<AuthenticatedAccount | null> {
    return this.#repository.findSession(hashOpaqueToken(token), this.#now());
  }

  async logout(token: string): Promise<void> {
    await this.#repository.revokeSession(hashOpaqueToken(token), this.#now());
  }

  /**
   * Starts password recovery from an email address or (students) a matric
   * number; the link always goes to the email on the account. Callers always
   * respond the same way: unknown, unverified, inactive and cooling-down
   * accounts are indistinguishable.
   */
  async requestPasswordReset(identifier: string): Promise<void> {
    if (!this.#emailTransport) throw new AuthOperationUnavailableError();
    const email = await this.#emailFor(identifier);
    if (!email) return;
    const now = this.#now();
    const token = createOpaqueToken();
    const result = await this.#repository.issuePasswordReset({
      institutionSlug: this.#institutionSlug,
      email,
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
    await this.#notify('password_reset', result.deliveryEmail ?? result.email, result.displayName, now);
  }

  /** Changes the password of the signed-in account; other sessions are signed out. */
  async changePassword(sessionToken: string, currentPassword: string, newPassword: string): Promise<number> {
    const now = this.#now();
    const sessionTokenHash = hashOpaqueToken(sessionToken);
    const record = await this.#repository.findSessionPassword(sessionTokenHash, now);
    const matches = await this.#passwordMatches(currentPassword, record);
    if (!record) throw new SessionRequiredError();
    if (!matches) throw new CurrentPasswordRejectedError();
    // Signed in with the starting password: knowing it proves nothing, so the new one needs the emailed code.
    if (record.startingPasswordSession) throw new StartingPasswordSessionError();
    if (currentPassword === newPassword || (record.passwordIsDefault && normalizeStartingPassword(newPassword) === normalizeStartingPassword(currentPassword))) {
      throw new PasswordUnchangedError();
    }
    const revoked = await this.#repository.changePassword({
      userId: record.userId,
      currentSessionTokenHash: sessionTokenHash,
      passwordHash: await hashPassword(newPassword),
      now,
    });
    await this.#notify('password_changed', sessionDeliveryAddress(record), record.displayName, now);
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
    let displayName = input.displayName !== undefined && input.displayName !== account.displayName ? input.displayName : undefined;
    if (displayName !== undefined && account.accountType === 'student') {
      // A student confirmed against the class list is named by it: registers must show the
      // HOC's name, not one typed later. Others write their name in full, without initials.
      if (account.matricNumberVerified) {
        throw new ProfileFieldError('Your name comes from your class list, so it is corrected there: ask your HOC. It updates everywhere straight away.', 409);
      }
      const check = checkPersonName(displayName, 'name', 'full');
      if (!check.ok) throw new ProfileFieldError(check.message);
      displayName = check.value;
    }
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
