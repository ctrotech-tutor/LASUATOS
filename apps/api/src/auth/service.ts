import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPasswordOrDummy,
} from '@lasuatos/auth';
import type { EmailTransport } from '../email/transport.js';
import type { AuthRepository, StudentSessionAccount } from './repository.js';

const VERIFICATION_TTL_MILLISECONDS = 30 * 60 * 1_000;
const SESSION_TTL_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const VERIFICATION_RESEND_COOLDOWN_MILLISECONDS = 2 * 60 * 1_000;

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

  constructor() {
    super('Email or password was not accepted.');
    this.name = 'InvalidLoginError';
  }
}

export class InvalidVerificationError extends Error {
  readonly statusCode = 400;

  constructor() {
    super('The verification link is invalid or has expired.');
    this.name = 'InvalidVerificationError';
  }
}

export interface StudentRegistrationInput {
  readonly displayName: string;
  readonly email: string;
  readonly matricNumber: string;
  readonly password: string;
}

export interface IssuedStudentSession {
  readonly token: string;
  readonly student: StudentSessionAccount;
}

export interface StudentAuthServiceOptions {
  readonly repository: AuthRepository;
  readonly emailTransport?: EmailTransport;
  readonly institutionSlug: string;
  readonly now?: () => Date;
}

export class StudentAuthService {
  readonly #repository: AuthRepository;
  readonly #emailTransport: EmailTransport | undefined;
  readonly #institutionSlug: string;
  readonly #now: () => Date;

  constructor(options: StudentAuthServiceOptions) {
    this.#repository = options.repository;
    this.#emailTransport = options.emailTransport;
    this.#institutionSlug = options.institutionSlug;
    this.#now = options.now ?? (() => new Date());
  }

  async registerStudent(input: StudentRegistrationInput): Promise<void> {
    if (!this.#emailTransport) throw new AuthOperationUnavailableError();

    const now = this.#now();
    const token = createOpaqueToken();
    const result = await this.#repository.createPendingStudent({
      institutionSlug: this.#institutionSlug,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      passwordHash: await hashPassword(input.password),
      matricNumber: input.matricNumber.trim(),
      verificationTokenHash: hashOpaqueToken(token),
      verificationExpiresAt: new Date(now.getTime() + VERIFICATION_TTL_MILLISECONDS),
      verificationRequestedAt: now,
    });

    if (result.kind === 'institution_missing') throw new AuthOperationUnavailableError();
    if (result.kind === 'duplicate') return;

    try {
      await this.#emailTransport.sendVerification({
        to: result.email,
        displayName: result.displayName,
        token,
      });
    } catch {
      throw new EmailDeliveryDeferredError();
    }
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
    } catch {
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

  async login(email: string, password: string): Promise<IssuedStudentSession> {
    const account = await this.#repository.findStudentCredentials(
      email.trim().toLowerCase(),
      this.#institutionSlug,
    );
    const passwordMatches = await verifyPasswordOrDummy(password, account?.passwordHash ?? null);
    if (!account || !passwordMatches || account.status !== 'active' || !account.emailVerified) {
      throw new InvalidLoginError();
    }

    const now = this.#now();
    const token = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MILLISECONDS);
    const student = await this.#repository.createSession(
      account.id,
      hashOpaqueToken(token),
      now,
      expiresAt,
    );
    if (!student) throw new InvalidLoginError();
    return { token, student };
  }

  async getSession(token: string): Promise<StudentSessionAccount | null> {
    return this.#repository.findSession(hashOpaqueToken(token), this.#now());
  }

  async logout(token: string): Promise<void> {
    await this.#repository.revokeSession(hashOpaqueToken(token), this.#now());
  }
}
