export interface PendingStudentRegistration {
  readonly institutionSlug: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly matricNumber: string;
  readonly verificationTokenHash: string;
  readonly verificationExpiresAt: Date;
  readonly verificationRequestedAt: Date;
}

export type RegistrationInsertResult =
  | { readonly kind: 'created'; readonly email: string; readonly displayName: string }
  | { readonly kind: 'duplicate' }
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
  createPendingStudent(input: PendingStudentRegistration): Promise<RegistrationInsertResult>;
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
}
