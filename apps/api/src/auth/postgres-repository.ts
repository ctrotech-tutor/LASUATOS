import {
  and,
  eq,
  gt,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm';
import {
  emailVerificationTokens,
  institutions,
  studentProfiles,
  userRoleAssignments,
  userSessions,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import type {
  AuthRepository,
  EmailVerificationResend,
  EmailVerificationResendResult,
  PendingStudentRegistration,
  RegistrationInsertResult,
  StudentCredentialAccount,
  StudentSessionAccount,
} from './repository.js';

function toStudentSessionAccount(
  user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly studentNumber: string;
    readonly studentNumberVerifiedAt: Date | null;
  },
  sessionExpiresAt: Date,
): StudentSessionAccount {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    matricNumber: user.studentNumber,
    matricNumberVerified: user.studentNumberVerifiedAt !== null,
    sessionExpiresAt,
  };
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createPendingStudent(input: PendingStudentRegistration): Promise<RegistrationInsertResult> {
    return this.database.transaction(async (transaction) => {
      const [institution] = await transaction
        .select({ id: institutions.id })
        .from(institutions)
        .where(eq(institutions.slug, input.institutionSlug))
        .limit(1);
      if (!institution) return { kind: 'institution_missing' };

      const [user] = await transaction
        .insert(users)
        .values({
          institutionId: institution.id,
          email: input.email,
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          status: 'invited',
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!user) return { kind: 'duplicate' };

      await transaction.insert(studentProfiles).values({
        userId: user.id,
        institutionId: institution.id,
        departmentId: null,
        studentNumber: input.matricNumber,
        studentNumberVerifiedAt: null,
      });
      await transaction.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash: input.verificationTokenHash,
        expiresAt: input.verificationExpiresAt,
        requestedAt: input.verificationRequestedAt,
      });

      return { kind: 'created', email: input.email, displayName: input.displayName };
    });
  }

  async issueEmailVerificationResend(
    input: EmailVerificationResend,
  ): Promise<EmailVerificationResendResult> {
    return this.database.transaction(async (transaction) => {
      const [institution] = await transaction
        .select({ id: institutions.id })
        .from(institutions)
        .where(eq(institutions.slug, input.institutionSlug))
        .limit(1);
      if (!institution) return { kind: 'missing' };

      const [user] = await transaction
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(and(
          eq(users.institutionId, institution.id),
          eq(users.email, input.email),
          eq(users.status, 'invited'),
          isNull(users.emailVerifiedAt),
        ))
        .limit(1);
      if (!user) return { kind: 'missing' };

      const [verification] = await transaction
        .select({ requestedAt: emailVerificationTokens.requestedAt })
        .from(emailVerificationTokens)
        .where(and(
          eq(emailVerificationTokens.userId, user.id),
          isNull(emailVerificationTokens.consumedAt),
        ))
        .for('update')
        .limit(1);
      if (!verification) return { kind: 'missing' };
      if (input.requestedAt.getTime() - verification.requestedAt.getTime() < input.cooldownMilliseconds) {
        return { kind: 'cooldown' };
      }

      await transaction
        .update(emailVerificationTokens)
        .set({
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          requestedAt: input.requestedAt,
        })
        .where(eq(emailVerificationTokens.userId, user.id));

      return { kind: 'issued', email: user.email, displayName: user.displayName };
    });
  }

  async completeEmailVerification(input: {
    readonly tokenHash: string;
    readonly sessionTokenHash: string;
    readonly now: Date;
    readonly sessionExpiresAt: Date;
  }): Promise<StudentSessionAccount | null> {
    return this.database.transaction(async (transaction) => {
      const [verification] = await transaction
        .select({ userId: emailVerificationTokens.userId })
        .from(emailVerificationTokens)
        .where(and(
          eq(emailVerificationTokens.tokenHash, input.tokenHash),
          isNull(emailVerificationTokens.consumedAt),
          gt(emailVerificationTokens.expiresAt, input.now),
        ))
        .for('update')
        .limit(1);
      if (!verification) return null;

      const [user] = await transaction
        .select({
          id: users.id,
          institutionId: users.institutionId,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(and(
          eq(users.id, verification.userId),
          eq(users.status, 'invited'),
          isNull(users.emailVerifiedAt),
        ))
        .limit(1);
      if (!user || !user.institutionId) return null;

      const [profile] = await transaction
        .select({
          studentNumber: studentProfiles.studentNumber,
          studentNumberVerifiedAt: studentProfiles.studentNumberVerifiedAt,
        })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, user.id))
        .limit(1);
      if (!profile) return null;

      const [activatedUser] = await transaction
        .update(users)
        .set({
          status: 'active',
          emailVerifiedAt: input.now,
          updatedAt: input.now,
        })
        .where(and(
          eq(users.id, user.id),
          eq(users.status, 'invited'),
          isNull(users.emailVerifiedAt),
        ))
        .returning({ id: users.id });
      if (!activatedUser) return null;

      await transaction
        .update(emailVerificationTokens)
        .set({ consumedAt: input.now })
        .where(eq(emailVerificationTokens.userId, user.id));
      await transaction
        .insert(userRoleAssignments)
        .values({
          userId: user.id,
          role: 'student',
          scopeType: 'institution',
          institutionId: user.institutionId,
          facultyId: null,
          departmentId: null,
        })
        .onConflictDoNothing();
      await transaction.insert(userSessions).values({
        userId: user.id,
        tokenHash: input.sessionTokenHash,
        expiresAt: input.sessionExpiresAt,
        lastSeenAt: input.now,
      });

      return toStudentSessionAccount({ ...user, ...profile }, input.sessionExpiresAt);
    });
  }

  async findStudentCredentials(
    email: string,
    institutionSlug: string,
  ): Promise<StudentCredentialAccount | null> {
    const [account] = await this.database
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .innerJoin(institutions, eq(users.institutionId, institutions.id))
      .innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, users.id),
        eq(userRoleAssignments.role, 'student'),
        eq(userRoleAssignments.scopeType, 'institution'),
        eq(userRoleAssignments.institutionId, users.institutionId),
      ))
      .where(and(
        eq(institutions.slug, institutionSlug),
        sql`lower(${users.email}) = ${email}`,
      ))
      .limit(1);
    if (!account) return null;
    return {
      id: account.id,
      passwordHash: account.passwordHash,
      status: account.status,
      emailVerified: account.emailVerifiedAt !== null,
    };
  }

  async createSession(
    userId: string,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<StudentSessionAccount | null> {
    return this.database.transaction(async (transaction) => {
      const [user] = await transaction
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          studentNumber: studentProfiles.studentNumber,
          studentNumberVerifiedAt: studentProfiles.studentNumberVerifiedAt,
        })
        .from(users)
        .innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          eq(userRoleAssignments.role, 'student'),
          eq(userRoleAssignments.scopeType, 'institution'),
          eq(userRoleAssignments.institutionId, users.institutionId),
        ))
        .where(and(
          eq(users.id, userId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
        ))
        .limit(1);
      if (!user) return null;

      await transaction.insert(userSessions).values({
        userId,
        tokenHash,
        expiresAt,
        lastSeenAt: now,
      });
      return toStudentSessionAccount(user, expiresAt);
    });
  }

  async findSession(tokenHash: string, now: Date): Promise<StudentSessionAccount | null> {
    const [session] = await this.database
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        studentNumber: studentProfiles.studentNumber,
        studentNumberVerifiedAt: studentProfiles.studentNumberVerifiedAt,
        sessionExpiresAt: userSessions.expiresAt,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, users.id),
        eq(userRoleAssignments.role, 'student'),
        eq(userRoleAssignments.scopeType, 'institution'),
        eq(userRoleAssignments.institutionId, users.institutionId),
      ))
      .where(and(
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
        eq(users.status, 'active'),
        isNotNull(users.emailVerifiedAt),
      ))
      .limit(1);
    return session ? toStudentSessionAccount(session, session.sessionExpiresAt) : null;
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.database
      .update(userSessions)
      .set({ revokedAt: now })
      .where(and(
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
      ));
  }
}
