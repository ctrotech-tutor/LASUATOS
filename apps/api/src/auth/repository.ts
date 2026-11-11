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

export interface StudentCredentialAccount {
  readonly id: string;
  readonly passwordHash: string | null;
  readonly status: 'invited' | 'active' | 'suspended' | 'closed';
  readonly emailVerified: boolean;
}

export interface StudentSessionAccount {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly matricNumber: string;
  readonly matricNumberVerified: boolean;
  readonly sessionExpiresAt: Date;
}

export interface AuthRepository {
  createPendingStudent(input: PendingStudentRegistration): Promise<RegistrationInsertResult>;
  issueEmailVerificationResend(input: EmailVerificationResend): Promise<EmailVerificationResendResult>;
  completeEmailVerification(input: {
    readonly tokenHash: string;
    readonly sessionTokenHash: string;
    readonly now: Date;
    readonly sessionExpiresAt: Date;
  }): Promise<StudentSessionAccount | null>;
  findStudentCredentials(email: string, institutionSlug: string): Promise<StudentCredentialAccount | null>;
  createSession(
    userId: string,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<StudentSessionAccount | null>;
  findSession(tokenHash: string, now: Date): Promise<StudentSessionAccount | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
}
