import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import {
  departments,
  emailVerificationTokens,
  faculties,
  institutions,
  lecturerProfiles,
  passwordResetTokens,
  studentProfiles,
  userRoleAssignments,
  userSessions,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import type {
  AccountCredential,
  AdministratorSessionAccount,
  AuthRepository,
  AccountSessionRecord,
  AuthenticatedAccount,
  EmailVerificationResend,
  PasswordResetCompletion,
  PasswordResetIssue,
  PasswordResetIssueResult,
  SessionPasswordRecord,
  LecturerSessionAccount,
  EmailVerificationResendResult,
  StudentAccountRegistration,
  RegistrationInsertResult,
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
    accountType: 'student',
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    matricNumber: user.studentNumber,
    matricNumberVerified: user.studentNumberVerifiedAt !== null,
    sessionExpiresAt,
  };
}

function toLecturerSessionAccount(
  user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
  },
  sessionExpiresAt: Date,
): LecturerSessionAccount {
  return {
    accountType: 'lecturer',
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    sessionExpiresAt,
  };
}

function lecturerRoleScope() {
  return and(
    eq(userRoleAssignments.role, 'lecturer'),
    eq(userRoleAssignments.institutionId, users.institutionId),
    or(
      eq(userRoleAssignments.scopeType, 'institution'),
      and(
        eq(userRoleAssignments.scopeType, 'faculty'),
        eq(userRoleAssignments.facultyId, departments.facultyId),
      ),
      and(
        eq(userRoleAssignments.scopeType, 'department'),
        eq(userRoleAssignments.departmentId, lecturerProfiles.departmentId),
      ),
    ),
  );
}

function administratorRoleScope() {
  return and(
    eq(userRoleAssignments.institutionId, users.institutionId),
    or(
      and(
        eq(userRoleAssignments.role, 'institution_administrator'),
        eq(userRoleAssignments.scopeType, 'institution'),
      ),
      and(
        eq(userRoleAssignments.role, 'faculty_administrator'),
        eq(userRoleAssignments.scopeType, 'faculty'),
      ),
      and(
        eq(userRoleAssignments.role, 'department_administrator'),
        eq(userRoleAssignments.scopeType, 'department'),
      ),
    ),
  );
}

function activeAdministratorScope() {
  return or(
    eq(userRoleAssignments.role, 'institution_administrator'),
    and(
      eq(userRoleAssignments.role, 'faculty_administrator'),
      eq(faculties.isActive, true),
    ),
    and(
      eq(userRoleAssignments.role, 'department_administrator'),
      eq(departments.isActive, true),
      eq(faculties.isActive, true),
    ),
  );
}

function administratorRoleOrder() {
  return sql`case ${userRoleAssignments.role}
    when 'department_administrator' then 0
    when 'faculty_administrator' then 1
    else 2
  end`;
}

type AdministratorRow = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly institutionId: string | null;
  readonly institutionName: string;
  readonly role: string;
  readonly scopeType: string;
  readonly facultyId: string | null;
  readonly facultyName: string | null;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
};

function toAdministratorSessionAccount(
  user: AdministratorRow,
  sessionExpiresAt: Date,
): AdministratorSessionAccount | null {
  if (!user.institutionId) return null;
  const base = {
    accountType: 'administrator' as const,
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: true as const,
    institutionName: user.institutionName,
    institutionId: user.institutionId,
    sessionExpiresAt,
  };

  if (user.role === 'institution_administrator' && user.scopeType === 'institution') {
    return {
      ...base,
      role: 'institution_administrator',
      scope: {
        type: 'institution',
        id: user.institutionId,
        label: user.institutionName,
        institutionId: user.institutionId,
      },
    };
  }
  if (user.role === 'faculty_administrator' && user.scopeType === 'faculty' && user.facultyId && user.facultyName) {
    return {
      ...base,
      role: 'faculty_administrator',
      scope: {
        type: 'faculty',
        id: user.facultyId,
        label: user.facultyName,
        institutionId: user.institutionId,
      },
    };
  }
  if (user.role === 'department_administrator' && user.scopeType === 'department' && user.departmentId && user.departmentName && user.facultyName) {
    return {
      ...base,
      role: 'department_administrator',
      scope: {
        type: 'department',
        id: user.departmentId,
        label: user.departmentName,
        facultyName: user.facultyName,
        institutionId: user.institutionId,
      },
    };
  }
  return null;
}

const SESSION_TOUCH_INTERVAL_MILLISECONDS = 5 * 60 * 1_000;

/** Live (unrevoked, unexpired) sessions condition. */
function liveSession(now: Date) {
  return and(isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now));
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createStudentAccount(input: StudentAccountRegistration): Promise<RegistrationInsertResult> {
    return this.database.transaction(async (transaction) => {
      const [institution] = await transaction
        .select({ id: institutions.id })
        .from(institutions)
        .where(eq(institutions.slug, input.institutionSlug))
        .limit(1);
      if (!institution) return { kind: 'institution_missing' };

      const [existingEmail] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.institutionId, institution.id), sql`lower(${users.email}) = ${input.email}`))
        .limit(1);
      if (existingEmail) return { kind: 'duplicate_email' };

      const [existingMatric] = await transaction
        .select({ id: studentProfiles.userId })
        .from(studentProfiles)
        .innerJoin(users, eq(users.id, studentProfiles.userId))
        .where(and(
          eq(studentProfiles.institutionId, institution.id),
          sql`upper(${studentProfiles.studentNumber}) = ${input.matricNumber}`,
          ne(users.status, 'closed'),
        ))
        .limit(1);
      if (existingMatric) return { kind: 'duplicate_matric' };

      const [user] = await transaction
        .insert(users)
        .values({
          institutionId: institution.id,
          email: input.email,
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          // Students can sign in straight away; confirming the mailbox is optional
          // and is recorded in email_verified_at when the link is used.
          status: 'active',
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!user) return { kind: 'duplicate_email' };

      await transaction.insert(studentProfiles).values({
        userId: user.id,
        institutionId: institution.id,
        departmentId: null,
        studentNumber: input.matricNumber,
        studentNumberVerifiedAt: null,
        entryLevel: input.entryLevel,
      });
      await transaction
        .insert(userRoleAssignments)
        .values({
          userId: user.id,
          role: 'student',
          scopeType: 'institution',
          institutionId: institution.id,
          facultyId: null,
          departmentId: null,
        })
        .onConflictDoNothing();
      await transaction.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash: input.verificationTokenHash,
        expiresAt: input.verificationExpiresAt,
        requestedAt: input.verificationRequestedAt,
      });
      await transaction.insert(userSessions).values({
        userId: user.id,
        tokenHash: input.sessionTokenHash,
        expiresAt: input.sessionExpiresAt,
        lastSeenAt: input.verificationRequestedAt,
      });

      return {
        kind: 'created',
        email: input.email,
        displayName: input.displayName,
        student: toStudentSessionAccount({
          id: user.id,
          email: input.email,
          displayName: input.displayName,
          studentNumber: input.matricNumber,
          studentNumberVerifiedAt: null,
        }, input.sessionExpiresAt),
      };
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
          inArray(users.status, ['invited', 'active']),
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
          inArray(users.status, ['invited', 'active']),
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
          inArray(users.status, ['invited', 'active']),
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

  async findCredentials(email: string, institutionSlug: string): Promise<AccountCredential | null> {
    const [administrator] = await this.database
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .innerJoin(institutions, eq(users.institutionId, institutions.id))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, users.id),
        administratorRoleScope(),
      ))
      .leftJoin(departments, and(
        eq(departments.id, userRoleAssignments.departmentId),
        eq(departments.institutionId, users.institutionId),
      ))
      .leftJoin(faculties, and(
        eq(faculties.institutionId, users.institutionId),
        or(
          eq(faculties.id, userRoleAssignments.facultyId),
          eq(faculties.id, departments.facultyId),
        ),
      ))
      .where(and(
        eq(institutions.slug, institutionSlug),
        sql`lower(${users.email}) = ${email}`,
        activeAdministratorScope(),
      ))
      .limit(1);
    if (administrator) {
      return {
        accountType: 'administrator',
        id: administrator.id,
        passwordHash: administrator.passwordHash,
        status: administrator.status,
        emailVerified: administrator.emailVerifiedAt !== null,
      };
    }

    const [student] = await this.database
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .innerJoin(institutions, eq(users.institutionId, institutions.id))
      .innerJoin(studentProfiles, and(
        eq(studentProfiles.userId, users.id),
        eq(studentProfiles.institutionId, users.institutionId),
      ))
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
    if (student) {
      return {
        accountType: 'student',
        id: student.id,
        passwordHash: student.passwordHash,
        status: student.status,
        emailVerified: student.emailVerifiedAt !== null,
      };
    }

    const [lecturer] = await this.database
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .innerJoin(institutions, eq(users.institutionId, institutions.id))
      .innerJoin(lecturerProfiles, and(
        eq(lecturerProfiles.userId, users.id),
        eq(lecturerProfiles.institutionId, users.institutionId),
      ))
      .innerJoin(departments, and(
        eq(departments.id, lecturerProfiles.departmentId),
        eq(departments.institutionId, lecturerProfiles.institutionId),
      ))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, users.id),
        lecturerRoleScope(),
      ))
      .where(and(
        eq(institutions.slug, institutionSlug),
        sql`lower(${users.email}) = ${email}`,
        eq(departments.isActive, true),
      ))
      .limit(1);
    return lecturer ? {
      accountType: 'lecturer',
      id: lecturer.id,
      passwordHash: lecturer.passwordHash,
      status: lecturer.status,
      emailVerified: lecturer.emailVerifiedAt !== null,
    } : null;
  }

  async createSession(
    userId: string,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<AuthenticatedAccount | null> {
    return this.database.transaction(async (transaction) => {
      const [administrator] = await transaction
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          institutionId: users.institutionId,
          institutionName: institutions.name,
          role: userRoleAssignments.role,
          scopeType: userRoleAssignments.scopeType,
          facultyId: userRoleAssignments.facultyId,
          facultyName: faculties.name,
          departmentId: userRoleAssignments.departmentId,
          departmentName: departments.name,
        })
        .from(users)
        .innerJoin(institutions, eq(users.institutionId, institutions.id))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          administratorRoleScope(),
        ))
        .leftJoin(departments, and(
          eq(departments.id, userRoleAssignments.departmentId),
          eq(departments.institutionId, users.institutionId),
        ))
        .leftJoin(faculties, and(
          eq(faculties.institutionId, users.institutionId),
          or(
            eq(faculties.id, userRoleAssignments.facultyId),
            eq(faculties.id, departments.facultyId),
          ),
        ))
        .where(and(
          eq(users.id, userId),
          eq(users.status, 'active'),
            activeAdministratorScope(),
        ))
        .orderBy(
          administratorRoleOrder(),
          userRoleAssignments.facultyId,
          userRoleAssignments.departmentId,
        )
        .limit(1);
      if (administrator) {
        const account = toAdministratorSessionAccount(administrator, expiresAt);
        if (account) {
          await transaction.insert(userSessions).values({
            userId,
            tokenHash,
            expiresAt,
            lastSeenAt: now,
          });
          return account;
        }
      }

      const [student] = await transaction
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          studentNumber: studentProfiles.studentNumber,
          studentNumberVerifiedAt: studentProfiles.studentNumberVerifiedAt,
        })
        .from(users)
        .innerJoin(studentProfiles, and(
          eq(studentProfiles.userId, users.id),
          eq(studentProfiles.institutionId, users.institutionId),
        ))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          eq(userRoleAssignments.role, 'student'),
          eq(userRoleAssignments.scopeType, 'institution'),
          eq(userRoleAssignments.institutionId, users.institutionId),
        ))
        .where(and(
          eq(users.id, userId),
          eq(users.status, 'active'),
          ))
        .limit(1);
      if (student) {
        await transaction.insert(userSessions).values({
          userId,
          tokenHash,
          expiresAt,
          lastSeenAt: now,
        });
        return toStudentSessionAccount(student, expiresAt);
      }

      const [lecturer] = await transaction
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .innerJoin(lecturerProfiles, and(
          eq(lecturerProfiles.userId, users.id),
          eq(lecturerProfiles.institutionId, users.institutionId),
        ))
        .innerJoin(departments, and(
          eq(departments.id, lecturerProfiles.departmentId),
          eq(departments.institutionId, lecturerProfiles.institutionId),
        ))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          lecturerRoleScope(),
        ))
        .where(and(
          eq(users.id, userId),
          eq(users.status, 'active'),
          eq(departments.isActive, true),
          ))
        .limit(1);
      if (!lecturer) return null;

      await transaction.insert(userSessions).values({
        userId,
        tokenHash,
        expiresAt,
        lastSeenAt: now,
      });
      return toLecturerSessionAccount(lecturer, expiresAt);
    });
  }

  async findSession(tokenHash: string, now: Date): Promise<AuthenticatedAccount | null> {
    const account = await this.lookupSession(tokenHash, now);
    if (account) {
      // Throttled so an active session writes at most once per interval.
      await this.database
        .update(userSessions)
        .set({ lastSeenAt: now })
        .where(and(
          eq(userSessions.tokenHash, tokenHash),
          or(
            isNull(userSessions.lastSeenAt),
            lt(userSessions.lastSeenAt, new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MILLISECONDS)),
          ),
        ));
    }
    return account;
  }

  private async lookupSession(tokenHash: string, now: Date): Promise<AuthenticatedAccount | null> {
    const [administrator] = await this.database
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        institutionId: users.institutionId,
        institutionName: institutions.name,
        role: userRoleAssignments.role,
        scopeType: userRoleAssignments.scopeType,
        facultyId: userRoleAssignments.facultyId,
        facultyName: faculties.name,
        departmentId: userRoleAssignments.departmentId,
        departmentName: departments.name,
        sessionExpiresAt: userSessions.expiresAt,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .innerJoin(institutions, eq(users.institutionId, institutions.id))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, users.id),
        administratorRoleScope(),
      ))
      .leftJoin(departments, and(
        eq(departments.id, userRoleAssignments.departmentId),
        eq(departments.institutionId, users.institutionId),
      ))
      .leftJoin(faculties, and(
        eq(faculties.institutionId, users.institutionId),
        or(
          eq(faculties.id, userRoleAssignments.facultyId),
          eq(faculties.id, departments.facultyId),
        ),
      ))
      .where(and(
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
        eq(users.status, 'active'),
        activeAdministratorScope(),
      ))
      .orderBy(
        administratorRoleOrder(),
        userRoleAssignments.facultyId,
        userRoleAssignments.departmentId,
      )
      .limit(1);
    if (administrator) {
      const account = toAdministratorSessionAccount(administrator, administrator.sessionExpiresAt);
      if (account) return account;
    }

    const [student] = await this.database
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
      .innerJoin(studentProfiles, and(
        eq(studentProfiles.userId, users.id),
        eq(studentProfiles.institutionId, users.institutionId),
      ))
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
      ))
      .limit(1);
    if (student) return toStudentSessionAccount(student, student.sessionExpiresAt);

    const [lecturer] = await this.database
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        sessionExpiresAt: userSessions.expiresAt,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .innerJoin(lecturerProfiles, and(
        eq(lecturerProfiles.userId, users.id),
        eq(lecturerProfiles.institutionId, users.institutionId),
      ))
      .innerJoin(departments, and(
        eq(departments.id, lecturerProfiles.departmentId),
        eq(departments.institutionId, lecturerProfiles.institutionId),
      ))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, users.id),
        lecturerRoleScope(),
      ))
      .where(and(
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
        eq(users.status, 'active'),
        eq(departments.isActive, true),
      ))
      .limit(1);
    return lecturer ? toLecturerSessionAccount(lecturer, lecturer.sessionExpiresAt) : null;
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

  async issuePasswordReset(input: PasswordResetIssue): Promise<PasswordResetIssueResult> {
    return this.database.transaction(async (transaction) => {
      const [user] = await transaction
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .innerJoin(institutions, eq(users.institutionId, institutions.id))
        .where(and(
          eq(institutions.slug, input.institutionSlug),
          sql`lower(${users.email}) = ${input.email}`,
          eq(users.status, 'active'),
          isNotNull(users.passwordHash),
        ))
        .limit(1);
      if (!user) return { kind: 'missing' as const };

      const [existing] = await transaction
        .select({ requestedAt: passwordResetTokens.requestedAt })
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, user.id))
        .for('update')
        .limit(1);
      if (existing && input.requestedAt.getTime() - existing.requestedAt.getTime() < input.cooldownMilliseconds) {
        return { kind: 'cooldown' as const };
      }

      const values = {
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        requestedAt: input.requestedAt,
        consumedAt: null,
      };
      await transaction
        .insert(passwordResetTokens)
        .values({ userId: user.id, ...values })
        .onConflictDoUpdate({ target: passwordResetTokens.userId, set: values });
      return { kind: 'issued' as const, email: user.email, displayName: user.displayName };
    });
  }

  async completePasswordReset(input: {
    readonly tokenHash: string;
    readonly passwordHash: string;
    readonly now: Date;
  }): Promise<PasswordResetCompletion> {
    return this.database.transaction(async (transaction) => {
      const [reset] = await transaction
        .select({ userId: passwordResetTokens.userId })
        .from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.tokenHash, input.tokenHash),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, input.now),
        ))
        .for('update')
        .limit(1);
      if (!reset) return { kind: 'invalid' as const };

      const [user] = await transaction
        .select({ id: users.id, email: users.email, displayName: users.displayName, emailVerifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(and(
          eq(users.id, reset.userId),
          eq(users.status, 'active'),
        ))
        .for('update')
        .limit(1);
      // Consume the token even when the account is no longer eligible, so it cannot be retried later.
      await transaction
        .update(passwordResetTokens)
        .set({ consumedAt: input.now })
        .where(eq(passwordResetTokens.userId, reset.userId));
      if (!user) return { kind: 'invalid' as const };

      await transaction
        .update(users)
        // Following the emailed link also proves the mailbox works.
        .set({ passwordHash: input.passwordHash, updatedAt: input.now, emailVerifiedAt: user.emailVerifiedAt ?? input.now })
        .where(eq(users.id, user.id));
      const revoked = await transaction
        .update(userSessions)
        .set({ revokedAt: input.now })
        .where(and(eq(userSessions.userId, user.id), liveSession(input.now)))
        .returning({ id: userSessions.id });
      return { kind: 'reset' as const, email: user.email, displayName: user.displayName, revokedSessions: revoked.length };
    });
  }

  async findSessionPassword(sessionTokenHash: string, now: Date): Promise<SessionPasswordRecord | null> {
    const [row] = await this.database
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(and(
        eq(userSessions.tokenHash, sessionTokenHash),
        liveSession(now),
        eq(users.status, 'active'),
      ))
      .limit(1);
    return row ?? null;
  }

  async changePassword(input: {
    readonly userId: string;
    readonly currentSessionTokenHash: string;
    readonly passwordHash: string;
    readonly now: Date;
  }): Promise<number> {
    return this.database.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ passwordHash: input.passwordHash, updatedAt: input.now })
        .where(eq(users.id, input.userId));
      // A pending reset link must not be usable after the password changes.
      await transaction
        .update(passwordResetTokens)
        .set({ consumedAt: input.now })
        .where(and(eq(passwordResetTokens.userId, input.userId), isNull(passwordResetTokens.consumedAt)));
      const revoked = await transaction
        .update(userSessions)
        .set({ revokedAt: input.now })
        .where(and(
          eq(userSessions.userId, input.userId),
          ne(userSessions.tokenHash, input.currentSessionTokenHash),
          liveSession(input.now),
        ))
        .returning({ id: userSessions.id });
      return revoked.length;
    });
  }

  private async sessionOwner(sessionTokenHash: string, now: Date): Promise<string | null> {
    const [row] = await this.database
      .select({ userId: userSessions.userId })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(and(eq(userSessions.tokenHash, sessionTokenHash), liveSession(now), eq(users.status, 'active')))
      .limit(1);
    return row?.userId ?? null;
  }

  async listSessions(sessionTokenHash: string, now: Date): Promise<AccountSessionRecord[] | null> {
    const userId = await this.sessionOwner(sessionTokenHash, now);
    if (!userId) return null;
    const rows = await this.database
      .select({
        id: userSessions.id,
        tokenHash: userSessions.tokenHash,
        createdAt: userSessions.createdAt,
        lastSeenAt: userSessions.lastSeenAt,
        expiresAt: userSessions.expiresAt,
      })
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), liveSession(now)))
      .orderBy(desc(userSessions.lastSeenAt), desc(userSessions.createdAt))
      .limit(100);
    return rows.map(({ tokenHash, ...row }) => ({ ...row, current: tokenHash === sessionTokenHash }));
  }

  async revokeOtherSessions(input: {
    readonly sessionTokenHash: string;
    readonly sessionId?: string;
    readonly now: Date;
  }): Promise<number | null> {
    const userId = await this.sessionOwner(input.sessionTokenHash, input.now);
    if (!userId) return null;
    const revoked = await this.database
      .update(userSessions)
      .set({ revokedAt: input.now })
      .where(and(
        eq(userSessions.userId, userId),
        ne(userSessions.tokenHash, input.sessionTokenHash),
        input.sessionId ? eq(userSessions.id, input.sessionId) : undefined,
        liveSession(input.now),
      ))
      .returning({ id: userSessions.id });
    return revoked.length;
  }
}
