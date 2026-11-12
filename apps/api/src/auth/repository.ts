export interface StudentAccountRegistration {
  readonly institutionSlug: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  /** Normalised: upper case, no spaces. */
  readonly matricNumber: string;
  readonly entryLevel: 100 | 200 | 300;
  /** Optional mailbox confirmation link; the account works without it. */
  readonly verificationTokenHash: string;
  readonly verificationExpiresAt: Date;
  readonly verificationRequestedAt: Date;
  /** The new account is signed in immediately with this session. */
  readonly sessionTokenHash: string;
  readonly sessionExpiresAt: Date;
}

export type RegistrationInsertResult =
  | { readonly kind: 'created'; readonly email: string; readonly displayName: string; readonly student: StudentSessionAccount }
  | { readonly kind: 'duplicate_email' }
  | { readonly kind: 'duplicate_matric' }
  | { readonly kind: 'institution_missing' };

export interface EmailVerificationResend {
  readonly institutionSlug: string;
  readonly email: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly requestedAt: Date;
  readonly cooldownMilliseconds: number;
}

export type EmailVerificationResendResult =
  | { readonly kind: 'issued'; readonly email: string; readonly displayName: string }
  | { readonly kind: 'cooldown' }
  | { readonly kind: 'missing' };

export interface PasswordResetIssue {
  readonly institutionSlug: string;
  readonly email: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly requestedAt: Date;
  readonly cooldownMilliseconds: number;
}

export type PasswordResetIssueResult =
  | { readonly kind: 'issued'; readonly email: string; readonly displayName: string }
  | { readonly kind: 'cooldown' }
  | { readonly kind: 'missing' };

export type PasswordResetCompletion =
  | { readonly kind: 'reset'; readonly email: string; readonly displayName: string; readonly revokedSessions: number }
  | { readonly kind: 'invalid' };

/** Password material for the signed-in account, looked up by session. */
export interface SessionPasswordRecord {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string | null;
}

export interface AccountSessionRecord {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date | null;
  readonly expiresAt: Date;
  readonly current: boolean;
}

export interface AccountCredential {
  readonly accountType: 'student' | 'lecturer' | 'administrator';
  readonly id: string;
  readonly passwordHash: string | null;
  readonly status: 'invited' | 'active' | 'suspended' | 'closed';
  readonly emailVerified: boolean;
}

export interface AdministratorSessionAccount {
  readonly accountType: 'administrator';
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly emailVerified: true;
  readonly institutionName: string;
  readonly institutionId: string;
  readonly role: 'department_administrator' | 'faculty_administrator' | 'institution_administrator';
  readonly scope:
    | { readonly type: 'institution'; readonly id: string; readonly label: string; readonly institutionId: string }
    | { readonly type: 'faculty'; readonly id: string; readonly label: string; readonly institutionId: string }
    | { readonly type: 'department'; readonly id: string; readonly label: string; readonly facultyName: string; readonly institutionId: string };
  readonly sessionExpiresAt: Date;
}

export interface StudentSessionAccount {
  readonly accountType: 'student';
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly matricNumber: string;
  readonly matricNumberVerified: boolean;
  readonly sessionExpiresAt: Date;
}

export interface LecturerSessionAccount {
  readonly accountType: 'lecturer';
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly sessionExpiresAt: Date;
}

export type AuthenticatedAccount =
  | StudentSessionAccount
  | LecturerSessionAccount
  | AdministratorSessionAccount;

export interface AuthRepository {
  createStudentAccount(input: StudentAccountRegistration): Promise<RegistrationInsertResult>;
  issueEmailVerificationResend(input: EmailVerificationResend): Promise<EmailVerificationResendResult>;
  completeEmailVerification(input: {
    readonly tokenHash: string;
    readonly sessionTokenHash: string;
    readonly now: Date;
    readonly sessionExpiresAt: Date;
  }): Promise<StudentSessionAccount | null>;
  findCredentials(email: string, institutionSlug: string): Promise<AccountCredential | null>;
  createSession(
    userId: string,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<AuthenticatedAccount | null>;
  findSession(tokenHash: string, now: Date): Promise<AuthenticatedAccount | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  /**
   * Stores a reset token for an active account (one per user, replaced after
   * the cooldown). `missing` covers unknown and inactive accounts alike so
   * callers cannot tell them apart.
   */
  issuePasswordReset(input: PasswordResetIssue): Promise<PasswordResetIssueResult>;
  /**
   * Atomically consumes a valid token, replaces the password hash and revokes
   * every live session of that user.
   */
  completePasswordReset(input: {
    readonly tokenHash: string;
    readonly passwordHash: string;
    readonly now: Date;
  }): Promise<PasswordResetCompletion>;
  findSessionPassword(sessionTokenHash: string, now: Date): Promise<SessionPasswordRecord | null>;
  /** Replaces the password hash and revokes every other live session; returns how many were revoked. */
  changePassword(input: {
    readonly userId: string;
    readonly currentSessionTokenHash: string;
    readonly passwordHash: string;
    readonly now: Date;
  }): Promise<number>;
  listSessions(sessionTokenHash: string, now: Date): Promise<AccountSessionRecord[] | null>;
  /** Revokes the user's other live sessions, or just `sessionId` when given. Null when the caller's session is invalid. */
  revokeOtherSessions(input: {
    readonly sessionTokenHash: string;
    readonly sessionId?: string;
    readonly now: Date;
  }): Promise<number | null>;
}
