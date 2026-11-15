import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  classListEntries,
  classRepresentatives,
  departments,
  emailVerificationTokens,
  faculties,
  institutions,
  lectureFaceChecks,
  passwordResetTokens,
  studentAuditEvents,
  studentEmailCodes,
  studentFaceProfiles,
  studentProfiles,
  studentSetupCodes,
  userRoleAssignments,
  userSessions,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import { isLasuStudentEmail, studentDisplayName } from '@lasuatos/contracts';
import type {
  ClassListActor,
  ClassListRecord,
  ClassListRowWrite,
  ClassListSummaryRecord,
  DepartmentRecord,
  EmailCodeCheck,
  EmailCodeIssue,
  FaceCheckWrite,
  FaceProfileRecord,
  FaceProfileWrite,
  ImportOutcome,
  OpenAccountResult,
  StudentAccountRecord,
  StudentAuditRecord,
  StudentAuditWrite,
  StudentRepository,
} from './repository.js';

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
type Queryable = DatabaseClient | Transaction;

const addedBy = alias(users, 'class_list_added_by');
const account = alias(users, 'class_list_account');
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * A class list's year is the set (the year the class started at 100 level);
 * a student profile's is the year the student was admitted, which is later
 * for Direct Entry: the 2024 set's 200-level entrants were admitted in 2025.
 */
export function admissionYear(setYear: number, entryLevel: number): number {
  return setYear + Math.max(0, Math.round(entryLevel / 100) - 1);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class ClassListEmailConflictError extends Error {
  readonly statusCode = 409;
  readonly exposeDetail = true;
  constructor() {
    super('A LASU email in this list is already on another student’s entry or account. Check the emails and try again.');
    this.name = 'ClassListEmailConflictError';
  }
}

export class PostgresStudentRepository implements StudentRepository {
  constructor(private readonly database: DatabaseClient) {}

  #entryQuery(db: Queryable = this.database) {
    return db
      .select({
        id: classListEntries.id,
        institutionId: classListEntries.institutionId,
        departmentId: classListEntries.departmentId,
        departmentName: departments.name,
        facultyId: departments.facultyId,
        facultyName: faculties.name,
        programmeYears: departments.programmeYears,
        matricNumber: classListEntries.matricNumber,
        surname: classListEntries.surname,
        firstName: classListEntries.firstName,
        middleName: classListEntries.middleName,
        lasuEmail: classListEntries.lasuEmail,
        entryYear: classListEntries.entryYear,
        entryLevel: classListEntries.entryLevel,
        studentUserId: classListEntries.studentUserId,
        vouchedAt: classListEntries.vouchedAt,
        accountEmail: account.email,
        accountEmailVerifiedAt: account.emailVerifiedAt,
        accountPasswordIsDefault: account.passwordIsDefault,
        faceUserId: studentFaceProfiles.userId,
        isRep: sql<boolean>`exists (select 1 from ${classRepresentatives} where ${classRepresentatives.studentUserId} = ${classListEntries.studentUserId} and ${classRepresentatives.revokedAt} is null)`,
        addedByName: addedBy.displayName,
        updatedAt: classListEntries.updatedAt,
      })
      .from(classListEntries)
      .innerJoin(departments, eq(departments.id, classListEntries.departmentId))
      .innerJoin(faculties, eq(faculties.id, departments.facultyId))
      .leftJoin(account, eq(account.id, classListEntries.studentUserId))
      .leftJoin(studentFaceProfiles, eq(studentFaceProfiles.userId, classListEntries.studentUserId))
      .leftJoin(addedBy, eq(addedBy.id, classListEntries.addedByUserId))
      .$dynamic();
  }

  static #toRecord(row: {
    id: string; institutionId: string; departmentId: string; departmentName: string; facultyId: string; facultyName: string;
    programmeYears: number; matricNumber: string; surname: string; firstName: string; middleName: string | null; lasuEmail: string | null;
    entryYear: number; entryLevel: number; studentUserId: string | null; vouchedAt: Date | null; accountEmail: string | null;
    accountEmailVerifiedAt: Date | null; accountPasswordIsDefault: boolean | null; faceUserId: string | null;
    isRep: boolean | null; addedByName: string | null; updatedAt: Date;
  }): ClassListRecord {
    const email = row.accountEmail?.toLowerCase() ?? null;
    return {
      id: row.id,
      institutionId: row.institutionId,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      facultyId: row.facultyId,
      facultyName: row.facultyName,
      programmeYears: row.programmeYears,
      matricNumber: row.matricNumber,
      surname: row.surname,
      firstName: row.firstName,
      middleName: row.middleName,
      lasuEmail: row.lasuEmail,
      entryYear: row.entryYear,
      entryLevel: (row.entryLevel === 200 || row.entryLevel === 300 ? row.entryLevel : 100),
      studentUserId: row.studentUserId,
      accountEmail: email,
      accountEmailVerified: Boolean(email && row.accountEmailVerifiedAt && email.endsWith('@st.lasu.edu.ng')),
      accountVouched: row.studentUserId !== null && row.vouchedAt !== null,
      accountPasswordIsDefault: row.accountPasswordIsDefault ?? false,
      faceRegistered: row.faceUserId !== null,
      isRep: Boolean(row.isRep),
      addedByName: row.addedByName,
      updatedAt: row.updatedAt,
    };
  }

  async findInstitutionId(slug: string): Promise<string | null> {
    const [row] = await this.database.select({ id: institutions.id }).from(institutions).where(eq(institutions.slug, slug)).limit(1);
    return row?.id ?? null;
  }

  async findEntryByMatric(institutionId: string, matricNumber: string): Promise<ClassListRecord | null> {
    const [row] = await this.#entryQuery()
      .where(and(eq(classListEntries.institutionId, institutionId), eq(classListEntries.matricNumber, matricNumber)))
      .limit(1);
    return row ? PostgresStudentRepository.#toRecord(row) : null;
  }

  async findEntryById(institutionId: string, entryId: string): Promise<ClassListRecord | null> {
    const [row] = await this.#entryQuery()
      .where(and(eq(classListEntries.institutionId, institutionId), eq(classListEntries.id, entryId)))
      .limit(1);
    return row ? PostgresStudentRepository.#toRecord(row) : null;
  }

  async findEntryByUser(userId: string): Promise<ClassListRecord | null> {
    const [row] = await this.#entryQuery().where(eq(classListEntries.studentUserId, userId)).limit(1);
    return row ? PostgresStudentRepository.#toRecord(row) : null;
  }

  async findStudentAccount(userId: string): Promise<StudentAccountRecord | null> {
    const [row] = await this.database
      .select({
        userId: users.id,
        institutionId: users.institutionId,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        matricNumber: studentProfiles.studentNumber,
        passwordIsDefault: users.passwordIsDefault,
      })
      .from(users)
      .innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .where(and(eq(users.id, userId), eq(users.status, 'active')))
      .limit(1);
    if (!row?.institutionId) return null;
    return {
      userId: row.userId,
      institutionId: row.institutionId,
      email: row.email.toLowerCase(),
      emailVerified: row.emailVerifiedAt !== null,
      matricNumber: row.matricNumber,
      passwordIsDefault: row.passwordIsDefault,
    };
  }

  async emailInUse(institutionId: string, email: string, options: { readonly exceptUserId?: string | null; readonly exceptEntryId?: string | null }): Promise<boolean> {
    const lower = email.toLowerCase();
    const [user] = await this.database
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.institutionId, institutionId),
        sql`lower(${users.email}) = ${lower}`,
        options.exceptUserId ? ne(users.id, options.exceptUserId) : undefined,
      ))
      .limit(1);
    if (user) return true;
    const [entry] = await this.database
      .select({ id: classListEntries.id })
      .from(classListEntries)
      .where(and(
        eq(classListEntries.institutionId, institutionId),
        sql`lower(${classListEntries.lasuEmail}) = ${lower}`,
        options.exceptEntryId ? ne(classListEntries.id, options.exceptEntryId) : undefined,
      ))
      .limit(1);
    return Boolean(entry);
  }

  async findStudentUserByMatric(institutionId: string, matricNumber: string): Promise<string | null> {
    return this.#studentUserByMatric(this.database, institutionId, matricNumber);
  }

  async #studentUserByMatric(db: Queryable, institutionId: string, matricNumber: string): Promise<string | null> {
    const [row] = await db
      .select({ id: users.id })
      .from(studentProfiles)
      .innerJoin(users, eq(users.id, studentProfiles.userId))
      .where(and(
        eq(studentProfiles.institutionId, institutionId),
        sql`upper(regexp_replace(${studentProfiles.studentNumber}, '[^A-Za-z0-9]', '', 'g')) = ${matricNumber}`,
        ne(users.status, 'closed'),
      ))
      .limit(1);
    return row?.id ?? null;
  }

  async findClassListActor(userId: string): Promise<ClassListActor | null> {
    const [user] = await this.database
      .select({ id: users.id, institutionId: users.institutionId })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.status, 'active')))
      .limit(1);
    if (!user?.institutionId) return null;
    const [rep] = await this.database
      .select({
        role: classRepresentatives.role,
        facultyId: classRepresentatives.facultyId,
        departmentId: classRepresentatives.departmentId,
        entryYear: classRepresentatives.entryYear,
      })
      .from(classRepresentatives)
      .where(and(eq(classRepresentatives.studentUserId, userId), isNull(classRepresentatives.revokedAt)))
      .limit(1);
    return { userId: user.id, institutionId: user.institutionId, classRep: rep ?? null };
  }

  async listDepartments(institutionId: string): Promise<DepartmentRecord[]> {
    return this.database
      .select({ id: departments.id, code: departments.code, name: departments.name, facultyId: departments.facultyId, facultyName: faculties.name })
      .from(departments)
      .innerJoin(faculties, eq(faculties.id, departments.facultyId))
      .where(and(eq(departments.institutionId, institutionId), eq(departments.isActive, true)))
      .orderBy(faculties.name, departments.name);
  }

  async listEntries(institutionId: string, departmentId: string, entryYear: number | null): Promise<ClassListRecord[]> {
    const rows = await this.#entryQuery()
      .where(and(
        eq(classListEntries.institutionId, institutionId),
        eq(classListEntries.departmentId, departmentId),
        entryYear === null ? undefined : eq(classListEntries.entryYear, entryYear),
      ))
      .orderBy(classListEntries.surname, classListEntries.firstName)
      .limit(3000);
    return rows.map((row) => PostgresStudentRepository.#toRecord(row));
  }

  async summarizeLists(institutionId: string, departmentIds: readonly string[], entryYear: number | null): Promise<ClassListSummaryRecord[]> {
    if (departmentIds.length === 0) return [];
    const account = alias(users, 'summary_account');
    // The same test as #toRecord's accountEmailVerified: a confirmed LASU student address.
    const confirmed = sql`(${account.emailVerifiedAt} is not null and lower(${account.email}) like '%@st.lasu.edu.ng')`;
    const rows = await this.database
      .select({
        departmentId: classListEntries.departmentId,
        entryYear: classListEntries.entryYear,
        total: sql<number>`count(*)::int`,
        opened: sql<number>`count(${classListEntries.studentUserId})::int`,
        confirmed: sql<number>`count(*) filter (where ${confirmed})::int`,
        confirmedWithFace: sql<number>`count(*) filter (where ${confirmed} and ${studentFaceProfiles.userId} is not null)::int`,
        updatedAt: sql<Date>`max(${classListEntries.updatedAt})`,
      })
      .from(classListEntries)
      .leftJoin(account, eq(account.id, classListEntries.studentUserId))
      .leftJoin(studentFaceProfiles, eq(studentFaceProfiles.userId, classListEntries.studentUserId))
      .where(and(
        eq(classListEntries.institutionId, institutionId),
        inArray(classListEntries.departmentId, [...departmentIds]),
        entryYear === null ? undefined : eq(classListEntries.entryYear, entryYear),
      ))
      .groupBy(classListEntries.departmentId, classListEntries.entryYear)
      .orderBy(classListEntries.departmentId, desc(classListEntries.entryYear));
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt) }));
  }

  async findEntriesByMatric(institutionId: string, matricNumbers: readonly string[]): Promise<ClassListRecord[]> {
    if (matricNumbers.length === 0) return [];
    const rows = await this.#entryQuery()
      .where(and(eq(classListEntries.institutionId, institutionId), inArray(classListEntries.matricNumber, [...matricNumbers])));
    return rows.map((row) => PostgresStudentRepository.#toRecord(row));
  }

  /**
   * Whether an account has proved it belongs to the student on the list: it
   * signs in with a LASU student address that was confirmed with a code.
   */
  async #accountProven(db: Queryable, userId: string): Promise<{ proven: boolean; email: string } | null> {
    const [row] = await db.select({ email: users.email, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return null;
    return { proven: row.verifiedAt !== null && isLasuStudentEmail(row.email.toLowerCase()), email: row.email.toLowerCase() };
  }

  /**
   * Copies the list's identity onto the student's account and profile. The
   * class, level and matric number always follow the list. The name, and the
   * mark that the matric number is confirmed, are copied only once the
   * account has proved it is that student (a confirmed LASU email, or opened
   * with the HOC's setup code): an older account someone else may have opened
   * with the matric number must not start showing the real student's name.
   */
  async #applyToAccount(tx: Transaction, userId: string, entry: {
    readonly departmentId: string; readonly matricNumber: string; readonly entryYear: number; readonly entryLevel: number;
    readonly firstName: string; readonly middleName: string | null; readonly surname: string;
    readonly vouchedAt?: Date | null | undefined;
  }, now: Date): Promise<void> {
    const state = await this.#accountProven(tx, userId);
    if (!state) return;
    const proven = state.proven || Boolean(entry.vouchedAt);
    if (proven) {
      await tx.update(users)
        .set({ displayName: studentDisplayName(entry), updatedAt: now })
        .where(eq(users.id, userId));
    }
    await tx.update(studentProfiles)
      .set({
        departmentId: entry.departmentId,
        studentNumber: entry.matricNumber,
        ...(proven ? { studentNumberVerifiedAt: now } : {}),
        entryYear: admissionYear(entry.entryYear, entry.entryLevel),
        entryLevel: entry.entryLevel,
        updatedAt: now,
      })
      .where(eq(studentProfiles.userId, userId));
  }

  async importEntries(input: {
    readonly institutionId: string;
    readonly departmentId: string;
    readonly entryYear: number;
    readonly rows: readonly ClassListRowWrite[];
    readonly actorUserId: string;
    readonly now: Date;
  }): Promise<ImportOutcome> {
    try {
      return await this.database.transaction(async (tx) => {
        let added = 0;
        let updated = 0;
        let unchanged = 0;
        let linked = 0;
        for (const row of input.rows) {
          const [existing] = await tx
            .select()
            .from(classListEntries)
            .where(and(eq(classListEntries.institutionId, input.institutionId), eq(classListEntries.matricNumber, row.matricNumber)))
            .for('update')
            .limit(1);
          let entryId: string;
          let studentUserId: string | null;
          let nameChanged = false;
          if (existing) {
            entryId = existing.id;
            studentUserId = existing.studentUserId;
            const changes: Partial<typeof classListEntries.$inferInsert> = {};
            if (existing.surname !== row.surname) changes.surname = row.surname;
            if (existing.firstName !== row.firstName) changes.firstName = row.firstName;
            if ((existing.middleName ?? null) !== row.middleName) changes.middleName = row.middleName;
            if (row.lasuEmail !== null && (existing.lasuEmail ?? null) !== row.lasuEmail) changes.lasuEmail = row.lasuEmail;
            if (existing.entryLevel !== row.entryLevel) changes.entryLevel = row.entryLevel;
            if (existing.departmentId !== input.departmentId) changes.departmentId = input.departmentId;
            if (existing.entryYear !== input.entryYear) changes.entryYear = input.entryYear;
            if (Object.keys(changes).length === 0) {
              unchanged += 1;
            } else {
              nameChanged = 'surname' in changes || 'firstName' in changes || 'middleName' in changes || 'departmentId' in changes || 'entryYear' in changes || 'entryLevel' in changes;
              await tx.update(classListEntries)
                .set({ ...changes, updatedByUserId: input.actorUserId, updatedAt: input.now })
                .where(eq(classListEntries.id, existing.id));
              updated += 1;
            }
          } else {
            const [inserted] = await tx.insert(classListEntries).values({
              institutionId: input.institutionId,
              departmentId: input.departmentId,
              matricNumber: row.matricNumber,
              surname: row.surname,
              firstName: row.firstName,
              middleName: row.middleName,
              lasuEmail: row.lasuEmail,
              entryYear: input.entryYear,
              entryLevel: row.entryLevel,
              addedByUserId: input.actorUserId,
              createdAt: input.now,
              updatedAt: input.now,
            }).returning({ id: classListEntries.id });
            entryId = inserted!.id;
            studentUserId = null;
            added += 1;
          }
          const identity = { ...row, departmentId: input.departmentId, entryYear: input.entryYear, vouchedAt: existing?.vouchedAt ?? null };
          if (!studentUserId) {
            // An account opened before the list arrived is matched by matric number, so its
            // attendance stays with the student. Until it confirms the LASU email it keeps its
            // own name and can be taken over by whoever does (see openAccount).
            const userId = await this.#studentUserByMatric(tx, input.institutionId, row.matricNumber);
            if (userId) {
              const [alreadyLinked] = await tx.select({ id: classListEntries.id }).from(classListEntries)
                .where(eq(classListEntries.studentUserId, userId)).limit(1);
              if (!alreadyLinked) {
                await tx.update(classListEntries).set({ studentUserId: userId }).where(eq(classListEntries.id, entryId));
                await this.#applyToAccount(tx, userId, identity, input.now);
                linked += 1;
              }
            }
          } else if (nameChanged) {
            await this.#applyToAccount(tx, studentUserId, identity, input.now);
          }
        }
        await tx.insert(studentAuditEvents).values({
          institutionId: input.institutionId,
          actorUserId: input.actorUserId,
          action: 'class_list_imported',
          details: `department=${input.departmentId} set=${input.entryYear} rows=${input.rows.length} added=${added} updated=${updated} unchanged=${unchanged} linked=${linked}`,
          createdAt: input.now,
        });
        return { added, updated, unchanged, linked };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ClassListEmailConflictError();
      throw error;
    }
  }

  async updateEntry(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly changes: Partial<ClassListRowWrite>;
    readonly actorUserId: string;
    readonly now: Date;
  }): Promise<'updated' | 'matric_taken' | 'email_taken' | 'missing'> {
    try {
      return await this.database.transaction(async (tx) => {
        const [existing] = await tx.select().from(classListEntries)
          .where(and(eq(classListEntries.id, input.entryId), eq(classListEntries.institutionId, input.institutionId)))
          .for('update').limit(1);
        if (!existing) return 'missing';
        const changes: Partial<typeof classListEntries.$inferInsert> = {};
        const changed: string[] = [];
        for (const key of ['matricNumber', 'surname', 'firstName', 'middleName', 'lasuEmail', 'entryLevel'] as const) {
          const value = input.changes[key];
          if (value === undefined) continue;
          if ((existing[key] ?? null) === value) continue;
          (changes as Record<string, unknown>)[key] = value;
          changed.push(key);
        }
        if (changed.length === 0) return 'updated';
        if (changes.matricNumber) {
          const [clash] = await tx.select({ id: classListEntries.id }).from(classListEntries)
            .where(and(eq(classListEntries.institutionId, input.institutionId), eq(classListEntries.matricNumber, changes.matricNumber), ne(classListEntries.id, existing.id)))
            .limit(1);
          if (clash) return 'matric_taken';
        }
        await tx.update(classListEntries)
          .set({ ...changes, updatedByUserId: input.actorUserId, updatedAt: input.now })
          .where(eq(classListEntries.id, existing.id));
        if (existing.studentUserId) {
          await this.#applyToAccount(tx, existing.studentUserId, {
            departmentId: existing.departmentId,
            entryYear: existing.entryYear,
            matricNumber: changes.matricNumber ?? existing.matricNumber,
            entryLevel: changes.entryLevel ?? existing.entryLevel,
            firstName: changes.firstName ?? existing.firstName,
            middleName: changes.middleName !== undefined ? changes.middleName ?? null : existing.middleName,
            surname: changes.surname ?? existing.surname,
            vouchedAt: existing.vouchedAt,
          }, input.now);
        }
        await tx.insert(studentAuditEvents).values({
          institutionId: input.institutionId,
          actorUserId: input.actorUserId,
          action: 'class_list_entry_updated',
          subjectUserId: existing.studentUserId,
          matricNumber: changes.matricNumber ?? existing.matricNumber,
          details: `changed=${changed.join(',')}${changes.matricNumber ? ` previous_matric=${existing.matricNumber}` : ''}`,
          createdAt: input.now,
        });
        return 'updated';
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'email_taken';
      throw error;
    }
  }

  async removeEntry(input: { readonly entryId: string; readonly institutionId: string; readonly actorUserId: string }): Promise<'removed' | 'linked' | 'missing'> {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(classListEntries)
        .where(and(eq(classListEntries.id, input.entryId), eq(classListEntries.institutionId, input.institutionId)))
        .for('update').limit(1);
      if (!existing) return 'missing';
      if (existing.studentUserId) return 'linked';
      await tx.delete(classListEntries).where(eq(classListEntries.id, existing.id));
      await tx.insert(studentAuditEvents).values({
        institutionId: input.institutionId,
        actorUserId: input.actorUserId,
        action: 'class_list_entry_removed',
        matricNumber: existing.matricNumber,
        details: `department=${existing.departmentId} set=${existing.entryYear}`,
      });
      return 'removed';
    });
  }

  async listAudit(institutionId: string, scope: { readonly matricNumbers: readonly string[]; readonly departmentId: string; readonly entryYear: number | null }, limit: number): Promise<StudentAuditRecord[]> {
    const listEvents = sql`${studentAuditEvents.details} like ${scope.entryYear === null ? `department=${scope.departmentId} %` : `department=${scope.departmentId} set=${scope.entryYear}%`}`;
    const actor = alias(users, 'student_audit_actor');
    const rows = await this.database
      .select({
        id: studentAuditEvents.id,
        action: studentAuditEvents.action,
        actorName: actor.displayName,
        matricNumber: studentAuditEvents.matricNumber,
        details: studentAuditEvents.details,
        createdAt: studentAuditEvents.createdAt,
      })
      .from(studentAuditEvents)
      .leftJoin(actor, eq(actor.id, studentAuditEvents.actorUserId))
      .where(and(
        eq(studentAuditEvents.institutionId, institutionId),
        scope.matricNumbers.length
          ? or(inArray(studentAuditEvents.matricNumber, [...scope.matricNumbers]), listEvents)
          : listEvents,
      ))
      .orderBy(desc(studentAuditEvents.createdAt))
      .limit(limit);
    return rows;
  }

  async audit(event: StudentAuditWrite): Promise<void> {
    await this.database.insert(studentAuditEvents).values({
      institutionId: event.institutionId,
      actorUserId: event.actorUserId,
      action: event.action,
      subjectUserId: event.subjectUserId ?? null,
      matricNumber: event.matricNumber ?? null,
      details: event.details ?? '',
    });
  }

  async issueEmailCode(input: {
    readonly entryId: string;
    readonly email: string;
    readonly codeHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly cooldownSeconds: number;
    readonly dailyCap: number;
  }): Promise<EmailCodeIssue> {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(studentEmailCodes)
        .where(eq(studentEmailCodes.classListEntryId, input.entryId)).for('update').limit(1);
      if (existing) {
        const sinceLast = (input.now.getTime() - existing.requestedAt.getTime()) / 1000;
        if (sinceLast < input.cooldownSeconds) {
          return { kind: 'cooldown', retryAfterSeconds: Math.ceil(input.cooldownSeconds - sinceLast) };
        }
        const windowOpen = input.now.getTime() - existing.windowStartedAt.getTime() < DAY_MILLISECONDS;
        if (windowOpen && existing.sendCount >= input.dailyCap) return { kind: 'daily_cap' };
        await tx.update(studentEmailCodes).set({
          email: input.email,
          codeHash: input.codeHash,
          attempts: 0,
          sendCount: windowOpen ? existing.sendCount + 1 : 1,
          windowStartedAt: windowOpen ? existing.windowStartedAt : input.now,
          requestedAt: input.now,
          expiresAt: input.expiresAt,
        }).where(eq(studentEmailCodes.classListEntryId, input.entryId));
        return { kind: 'issued' };
      }
      await tx.insert(studentEmailCodes).values({
        classListEntryId: input.entryId,
        email: input.email,
        codeHash: input.codeHash,
        attempts: 0,
        sendCount: 1,
        windowStartedAt: input.now,
        requestedAt: input.now,
        expiresAt: input.expiresAt,
      });
      return { kind: 'issued' };
    });
  }

  async checkEmailCode(input: {
    readonly entryId: string;
    readonly hashFor: (email: string) => string;
    readonly now: Date;
    readonly maxAttempts: number;
  }): Promise<EmailCodeCheck> {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(studentEmailCodes)
        .where(eq(studentEmailCodes.classListEntryId, input.entryId)).for('update').limit(1);
      if (!existing || existing.attempts >= input.maxAttempts) return { kind: 'missing' };
      if (existing.expiresAt <= input.now) return { kind: 'expired' };
      if (input.hashFor(existing.email) !== existing.codeHash) {
        const attempts = existing.attempts + 1;
        await tx.update(studentEmailCodes).set({ attempts }).where(eq(studentEmailCodes.classListEntryId, input.entryId));
        return { kind: 'wrong', attemptsLeft: Math.max(0, input.maxAttempts - attempts) };
      }
      // Spent, but the row stays so the daily send limit keeps counting.
      await tx.update(studentEmailCodes)
        .set({ attempts: input.maxAttempts, expiresAt: input.now })
        .where(eq(studentEmailCodes.classListEntryId, input.entryId));
      return { kind: 'ok', email: existing.email };
    });
  }

  async openAccount(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly passwordHash: string;
    readonly sessionTokenHash: string;
    readonly sessionExpiresAt: Date;
    readonly now: Date;
    readonly vouchedByUserId: string | null;
  }): Promise<OpenAccountResult> {
    const how = input.vouchedByUserId ? 'a setup code from the HOC' : 'a code sent to the LASU email';
    const vouched = input.vouchedByUserId ? { vouchedByUserId: input.vouchedByUserId, vouchedAt: input.now } : { vouchedByUserId: null, vouchedAt: null };
    try {
      return await this.database.transaction(async (tx) => {
        const [entry] = await tx.select().from(classListEntries)
          .where(and(eq(classListEntries.id, input.entryId), eq(classListEntries.institutionId, input.institutionId)))
          .for('update').limit(1);
        if (!entry) return { kind: 'claimed' };
        // The older account in the way, if any: linked to this entry, or using its matric number.
        let existingUserId = entry.studentUserId;
        if (!existingUserId) {
          const byMatric = await this.#studentUserByMatric(tx, input.institutionId, entry.matricNumber);
          if (byMatric) {
            const [linkedElsewhere] = await tx.select({ id: classListEntries.id }).from(classListEntries)
              .where(eq(classListEntries.studentUserId, byMatric)).limit(1);
            if (linkedElsewhere) return { kind: 'matric_taken' };
            existingUserId = byMatric;
          }
        }
        const [clash] = await tx.select({ id: users.id }).from(users)
          .where(and(
            eq(users.institutionId, input.institutionId),
            sql`lower(${users.email}) = ${input.email}`,
            existingUserId ? ne(users.id, existingUserId) : undefined,
          )).limit(1);

        if (existingUserId) {
          const [current] = await tx.select({ email: users.email, verifiedAt: users.emailVerifiedAt, status: users.status })
            .from(users).where(eq(users.id, existingUserId)).for('update').limit(1);
          if (!current) return { kind: 'claimed' };
          // A confirmed LASU email is the proof of who owns an account: it cannot be taken over.
          if (current.verifiedAt !== null && isLasuStudentEmail(current.email.toLowerCase())) {
            return entry.studentUserId ? { kind: 'claimed' } : { kind: 'matric_taken' };
          }
          if (clash) return { kind: 'email_taken' };
          const userId = existingUserId;
          await tx.update(users).set({
            email: input.email,
            emailVerifiedAt: input.emailVerified ? input.now : null,
            displayName: studentDisplayName(entry),
            passwordHash: input.passwordHash,
            passwordIsDefault: true,
            status: 'active',
            updatedAt: input.now,
          }).where(eq(users.id, userId));
          // Whoever used the account before is signed out everywhere and loses every way back in.
          const revoked = await tx.update(userSessions).set({ revokedAt: input.now })
            .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, input.now)))
            .returning({ id: userSessions.id });
          await tx.update(passwordResetTokens).set({ consumedAt: input.now })
            .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.consumedAt)));
          await tx.update(emailVerificationTokens).set({ consumedAt: input.now })
            .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.consumedAt)));
          // A face registered by the previous user is not this student's.
          const faces = await tx.delete(studentFaceProfiles).where(eq(studentFaceProfiles.userId, userId)).returning({ userId: studentFaceProfiles.userId });
          await tx.update(studentProfiles).set({
            departmentId: entry.departmentId,
            studentNumber: entry.matricNumber,
            // Proved with the LASU email code, or vouched for by the HOC's setup code.
            studentNumberVerifiedAt: input.now,
            entryYear: admissionYear(entry.entryYear, entry.entryLevel),
            entryLevel: entry.entryLevel,
            updatedAt: input.now,
          }).where(eq(studentProfiles.userId, userId));
          await tx.insert(userRoleAssignments).values({
            userId,
            role: 'student',
            scopeType: 'institution',
            institutionId: input.institutionId,
            facultyId: null,
            departmentId: null,
          }).onConflictDoNothing();
          await tx.insert(userSessions).values({
            userId,
            tokenHash: input.sessionTokenHash,
            expiresAt: input.sessionExpiresAt,
            lastSeenAt: input.now,
          });
          await tx.update(classListEntries)
            .set({ studentUserId: userId, lasuEmail: entry.lasuEmail ?? input.email, ...vouched, updatedAt: input.now })
            .where(eq(classListEntries.id, entry.id));
          await tx.insert(studentAuditEvents).values({
            institutionId: input.institutionId,
            actorUserId: input.vouchedByUserId,
            action: 'account_taken_over',
            subjectUserId: userId,
            matricNumber: entry.matricNumber,
            details: `older account handed to the listed student with ${how}; previous email ${current.email.toLowerCase()}; ${revoked.length} session(s) signed out${faces.length ? '; previous face deleted' : ''}; attendance kept`,
            createdAt: input.now,
          });
          return { kind: 'taken_over', userId, previousEmail: current.email.toLowerCase() };
        }

        if (clash) return { kind: 'email_taken' };
        const [user] = await tx.insert(users).values({
          institutionId: input.institutionId,
          email: input.email,
          displayName: studentDisplayName(entry),
          passwordHash: input.passwordHash,
          passwordIsDefault: true,
          status: 'active',
          emailVerifiedAt: input.emailVerified ? input.now : null,
          createdAt: input.now,
          updatedAt: input.now,
        }).returning({ id: users.id });
        const userId = user!.id;
        await tx.insert(studentProfiles).values({
          userId,
          institutionId: input.institutionId,
          departmentId: entry.departmentId,
          studentNumber: entry.matricNumber,
          studentNumberVerifiedAt: input.now,
          entryYear: admissionYear(entry.entryYear, entry.entryLevel),
          entryLevel: entry.entryLevel,
        });
        await tx.insert(userRoleAssignments).values({
          userId,
          role: 'student',
          scopeType: 'institution',
          institutionId: input.institutionId,
          facultyId: null,
          departmentId: null,
        }).onConflictDoNothing();
        await tx.insert(userSessions).values({
          userId,
          tokenHash: input.sessionTokenHash,
          expiresAt: input.sessionExpiresAt,
          lastSeenAt: input.now,
        });
        await tx.update(classListEntries)
          .set({ studentUserId: userId, lasuEmail: entry.lasuEmail ?? input.email, ...vouched, updatedAt: input.now })
          .where(eq(classListEntries.id, entry.id));
        await tx.insert(studentAuditEvents).values({
          institutionId: input.institutionId,
          actorUserId: input.vouchedByUserId,
          action: 'account_opened',
          subjectUserId: userId,
          matricNumber: entry.matricNumber,
          details: `opened with ${how}`,
          createdAt: input.now,
        });
        return { kind: 'created', userId };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: 'email_taken' };
      throw error;
    }
  }

  async resetPasswordWithCode(input: {
    readonly userId: string;
    readonly institutionId: string;
    readonly matricNumber: string;
    readonly passwordHash: string;
    readonly sessionTokenHash: string;
    readonly sessionExpiresAt: Date;
    readonly now: Date;
  }): Promise<{ readonly kind: 'reset'; readonly signedOutSessions: number } | { readonly kind: 'missing' }> {
    return this.database.transaction(async (tx) => {
      const [user] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.userId), eq(users.status, 'active'))).for('update').limit(1);
      if (!user) return { kind: 'missing' as const };
      await tx.update(users).set({ passwordHash: input.passwordHash, passwordIsDefault: false, updatedAt: input.now }).where(eq(users.id, user.id));
      const revoked = await tx.update(userSessions).set({ revokedAt: input.now })
        .where(and(eq(userSessions.userId, user.id), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, input.now)))
        .returning({ id: userSessions.id });
      await tx.update(passwordResetTokens).set({ consumedAt: input.now })
        .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.consumedAt)));
      await tx.insert(userSessions).values({ userId: user.id, tokenHash: input.sessionTokenHash, expiresAt: input.sessionExpiresAt, lastSeenAt: input.now });
      await tx.insert(studentAuditEvents).values({
        institutionId: input.institutionId,
        actorUserId: null,
        action: 'password_reset_with_code',
        subjectUserId: user.id,
        matricNumber: input.matricNumber,
        details: `new password chosen with a code sent to the LASU email; ${revoked.length} session(s) signed out`,
        createdAt: input.now,
      });
      return { kind: 'reset' as const, signedOutSessions: revoked.length };
    });
  }

  async issueSetupCode(input: {
    readonly entryId: string;
    readonly codeHash: string;
    readonly issuedByUserId: string;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    const values = { codeHash: input.codeHash, issuedByUserId: input.issuedByUserId, attempts: 0, issuedAt: input.now, expiresAt: input.expiresAt, usedAt: null };
    await this.database.insert(studentSetupCodes)
      .values({ classListEntryId: input.entryId, ...values })
      .onConflictDoUpdate({ target: studentSetupCodes.classListEntryId, set: values });
  }

  async useSetupCode(input: {
    readonly entryId: string;
    readonly codeHash: string;
    readonly now: Date;
    readonly maxAttempts: number;
  }): Promise<{ readonly kind: 'ok'; readonly issuedByUserId: string } | { readonly kind: 'wrong'; readonly attemptsLeft: number } | { readonly kind: 'expired' } | { readonly kind: 'missing' }> {
    return this.database.transaction(async (tx) => {
      const [code] = await tx.select().from(studentSetupCodes)
        .where(eq(studentSetupCodes.classListEntryId, input.entryId)).for('update').limit(1);
      if (!code || code.usedAt || code.attempts >= input.maxAttempts) return { kind: 'missing' as const };
      if (code.expiresAt <= input.now) return { kind: 'expired' as const };
      if (code.codeHash !== input.codeHash) {
        const attempts = code.attempts + 1;
        await tx.update(studentSetupCodes).set({ attempts }).where(eq(studentSetupCodes.classListEntryId, input.entryId));
        return { kind: 'wrong' as const, attemptsLeft: Math.max(0, input.maxAttempts - attempts) };
      }
      await tx.update(studentSetupCodes).set({ usedAt: input.now }).where(eq(studentSetupCodes.classListEntryId, input.entryId));
      return { kind: 'ok' as const, issuedByUserId: code.issuedByUserId };
    });
  }

  async releaseAccount(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly listEmail: string;
    readonly unusablePasswordHash: string;
    readonly actorUserId: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<
    | { readonly kind: 'released'; readonly userId: string; readonly previousEmail: string; readonly signedOutSessions: number; readonly faceDeleted: boolean }
    | { readonly kind: 'missing' | 'not_proven' | 'same_email' | 'email_taken' }
  > {
    const listEmail = input.listEmail.toLowerCase();
    try {
      return await this.database.transaction(async (tx) => {
        const [entry] = await tx.select().from(classListEntries)
          .where(and(eq(classListEntries.id, input.entryId), eq(classListEntries.institutionId, input.institutionId)))
          .for('update').limit(1);
        if (!entry) return { kind: 'missing' as const };
        if (!entry.studentUserId) return { kind: 'not_proven' as const };
        const userId = entry.studentUserId;
        const [user] = await tx.select({ email: users.email, verifiedAt: users.emailVerifiedAt })
          .from(users).where(eq(users.id, userId)).for('update').limit(1);
        if (!user) return { kind: 'missing' as const };
        const previousEmail = user.email.toLowerCase();
        if (user.verifiedAt === null || !isLasuStudentEmail(previousEmail)) return { kind: 'not_proven' as const };
        if (listEmail === previousEmail) return { kind: 'same_email' as const };
        const [userClash] = await tx.select({ id: users.id }).from(users)
          .where(and(eq(users.institutionId, input.institutionId), sql`lower(${users.email}) = ${listEmail}`, ne(users.id, userId))).limit(1);
        const [entryClash] = await tx.select({ id: classListEntries.id }).from(classListEntries)
          .where(and(eq(classListEntries.institutionId, input.institutionId), sql`lower(${classListEntries.lasuEmail}) = ${listEmail}`, ne(classListEntries.id, entry.id))).limit(1);
        if (userClash || entryClash) return { kind: 'email_taken' as const };

        // The address is freed (whoever owns it may need it for their own account);
        // the reserved .invalid domain can never receive mail or sign in.
        await tx.update(users).set({
          email: `released.${userId.slice(0, 8)}.${input.now.getTime().toString(36)}@account.invalid`,
          emailVerifiedAt: null,
          passwordHash: input.unusablePasswordHash,
          passwordIsDefault: false,
          updatedAt: input.now,
        }).where(eq(users.id, userId));
        const revoked = await tx.update(userSessions).set({ revokedAt: input.now })
          .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, input.now)))
          .returning({ id: userSessions.id });
        await tx.update(passwordResetTokens).set({ consumedAt: input.now })
          .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.consumedAt)));
        await tx.update(emailVerificationTokens).set({ consumedAt: input.now })
          .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.consumedAt)));
        const faces = await tx.delete(studentFaceProfiles).where(eq(studentFaceProfiles.userId, userId)).returning({ userId: studentFaceProfiles.userId });
        await tx.update(studentProfiles).set({ studentNumberVerifiedAt: null, updatedAt: input.now }).where(eq(studentProfiles.userId, userId));
        await tx.update(classListEntries)
          .set({ lasuEmail: listEmail, vouchedByUserId: null, vouchedAt: null, updatedAt: input.now })
          .where(eq(classListEntries.id, entry.id));
        // A code already sent to the old address, or an old setup code, must not open it again.
        await tx.update(studentEmailCodes).set({ expiresAt: input.now })
          .where(and(eq(studentEmailCodes.classListEntryId, entry.id), gt(studentEmailCodes.expiresAt, input.now)));
        await tx.update(studentSetupCodes).set({ usedAt: input.now })
          .where(and(eq(studentSetupCodes.classListEntryId, entry.id), isNull(studentSetupCodes.usedAt)));
        await tx.insert(studentAuditEvents).values({
          institutionId: input.institutionId,
          actorUserId: input.actorUserId,
          action: 'account_released',
          subjectUserId: userId,
          matricNumber: entry.matricNumber,
          details: `released from ${previousEmail}; class list email now ${listEmail}; ${revoked.length} session(s) signed out${faces.length ? '; face deleted' : ''}; attendance kept. Reason: ${input.reason}`,
          createdAt: input.now,
        });
        return { kind: 'released' as const, userId, previousEmail, signedOutSessions: revoked.length, faceDeleted: faces.length > 0 };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: 'email_taken' };
      throw error;
    }
  }

  async confirmAccountEmail(input: {
    readonly userId: string;
    readonly entryId: string;
    readonly email: string;
    readonly now: Date;
  }): Promise<'updated' | 'email_taken' | 'claimed'> {
    try {
      return await this.database.transaction(async (tx) => {
        const [entry] = await tx.select().from(classListEntries)
          .where(eq(classListEntries.id, input.entryId)).for('update').limit(1);
        if (!entry || (entry.studentUserId && entry.studentUserId !== input.userId)) return 'claimed';
        const [clash] = await tx.select({ id: users.id }).from(users)
          .where(and(eq(users.institutionId, entry.institutionId), sql`lower(${users.email}) = ${input.email}`, ne(users.id, input.userId))).limit(1);
        if (clash) return 'email_taken';
        await tx.update(users).set({ email: input.email, emailVerifiedAt: input.now, updatedAt: input.now }).where(eq(users.id, input.userId));
        await this.#applyToAccount(tx, input.userId, entry, input.now);
        await tx.update(classListEntries)
          .set({ studentUserId: input.userId, lasuEmail: entry.lasuEmail ?? input.email, updatedAt: input.now })
          .where(eq(classListEntries.id, entry.id));
        await tx.insert(studentAuditEvents).values({
          institutionId: entry.institutionId,
          actorUserId: null,
          action: 'email_confirmed',
          subjectUserId: input.userId,
          matricNumber: entry.matricNumber,
          details: 'existing account moved to its LASU email',
          createdAt: input.now,
        });
        return 'updated';
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'email_taken';
      throw error;
    }
  }

  async findFaceProfile(userId: string): Promise<FaceProfileRecord | null> {
    const [row] = await this.database
      .select({
        userId: studentFaceProfiles.userId,
        model: studentFaceProfiles.model,
        templates: studentFaceProfiles.templates,
        enrolledAt: studentFaceProfiles.enrolledAt,
        replaceAllowedUntil: studentFaceProfiles.replaceAllowedUntil,
      })
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async findFacePhoto(userId: string): Promise<Buffer | null> {
    const [row] = await this.database.select({ photo: studentFaceProfiles.photo }).from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.userId, userId)).limit(1);
    return row?.photo ? Buffer.from(row.photo) : null;
  }

  async listFaceCentroids(institutionId: string, exceptUserId: string): Promise<Array<{ readonly userId: string; readonly centroid: number[] }>> {
    return this.database
      .select({ userId: studentFaceProfiles.userId, centroid: studentFaceProfiles.centroid })
      .from(studentFaceProfiles)
      .where(and(eq(studentFaceProfiles.institutionId, institutionId), ne(studentFaceProfiles.userId, exceptUserId)));
  }

  async saveFaceProfile(input: FaceProfileWrite): Promise<'saved' | 'exists'> {
    const rows = await this.database.insert(studentFaceProfiles).values({
      userId: input.userId,
      institutionId: input.institutionId,
      model: input.model,
      templates: input.templates,
      centroid: input.centroid,
      photo: input.photo,
      quality: input.quality,
      consentedAt: input.consentedAt,
      enrolledAt: input.now,
    }).onConflictDoNothing().returning({ userId: studentFaceProfiles.userId });
    return rows.length ? 'saved' : 'exists';
  }

  async deleteFaceProfile(userId: string): Promise<boolean> {
    const rows = await this.database.delete(studentFaceProfiles).where(eq(studentFaceProfiles.userId, userId)).returning({ userId: studentFaceProfiles.userId });
    return rows.length > 0;
  }

  async saveFaceCheck(input: FaceCheckWrite): Promise<void> {
    const values = {
      institutionId: input.institutionId,
      lectureSessionId: input.lectureSessionId,
      studentUserId: input.studentUserId,
      score: input.score.toFixed(4),
      real: input.real.toFixed(4),
      live: input.live.toFixed(4),
      needsReview: input.needsReview,
      photo: input.photo,
      createdAt: input.now,
    };
    await this.database.insert(lectureFaceChecks).values(values).onConflictDoUpdate({
      target: [lectureFaceChecks.lectureSessionId, lectureFaceChecks.studentUserId],
      set: {
        score: values.score, real: values.real, live: values.live, needsReview: values.needsReview, photo: values.photo, createdAt: values.createdAt,
        // A new check starts without a review.
        reviewStatus: null, reviewedByUserId: null, reviewedAt: null, reviewNote: null,
      },
    });
  }

  async countFaceFailures(userId: string, lectureSessionId: string, since: Date): Promise<number> {
    const [row] = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(studentAuditEvents)
      .where(and(
        eq(studentAuditEvents.subjectUserId, userId),
        eq(studentAuditEvents.action, 'face_check_failed'),
        sql`${studentAuditEvents.details} like ${`session=${lectureSessionId} %`}`,
        gt(studentAuditEvents.createdAt, since),
      ));
    return Number(row?.count ?? 0);
  }

  async faceFailures(userId: string, lectureSessionId: string, since: Date): Promise<{ count: number; lastReason: string | null }> {
    const [row] = await this.database
      .select({
        count: sql<number>`count(*)::int`,
        last: sql<string | null>`(array_agg(${studentAuditEvents.details} order by ${studentAuditEvents.createdAt} desc))[1]`,
      })
      .from(studentAuditEvents)
      .where(and(
        eq(studentAuditEvents.subjectUserId, userId),
        eq(studentAuditEvents.action, 'face_check_failed'),
        sql`${studentAuditEvents.details} like ${`session=${lectureSessionId} %`}`,
        gt(studentAuditEvents.createdAt, since),
      ));
    const reason = row?.last ? /reason=([a-z_]+)/.exec(row.last)?.[1] ?? null : null;
    return { count: Number(row?.count ?? 0), lastReason: reason };
  }

  async countAudit(subjectUserId: string, action: string, since: Date): Promise<number> {
    const [row] = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(studentAuditEvents)
      .where(and(eq(studentAuditEvents.subjectUserId, subjectUserId), eq(studentAuditEvents.action, action), gt(studentAuditEvents.createdAt, since)));
    return Number(row?.count ?? 0);
  }

  async allowFaceReplacement(userId: string, until: Date): Promise<boolean> {
    const rows = await this.database.update(studentFaceProfiles)
      .set({ replaceAllowedUntil: until })
      .where(eq(studentFaceProfiles.userId, userId))
      .returning({ userId: studentFaceProfiles.userId });
    return rows.length > 0;
  }

  async replaceFaceProfile(input: FaceProfileWrite): Promise<'replaced' | 'not_allowed'> {
    const rows = await this.database.update(studentFaceProfiles)
      .set({
        model: input.model,
        templates: input.templates,
        centroid: input.centroid,
        photo: input.photo,
        quality: input.quality,
        consentedAt: input.consentedAt,
        enrolledAt: input.now,
        replaceAllowedUntil: null,
      })
      .where(and(
        eq(studentFaceProfiles.userId, input.userId),
        eq(studentFaceProfiles.institutionId, input.institutionId),
        gt(studentFaceProfiles.replaceAllowedUntil, input.now),
      ))
      .returning({ userId: studentFaceProfiles.userId });
    return rows.length ? 'replaced' : 'not_allowed';
  }

  async findEmailOwners(institutionId: string, emails: readonly string[]): Promise<Array<{ email: string; matricNumber: string | null }>> {
    const lower = [...new Set(emails.map((email) => email.toLowerCase()))];
    if (lower.length === 0) return [];
    const listed = await this.database
      .select({ email: sql<string>`lower(${classListEntries.lasuEmail})`, matricNumber: classListEntries.matricNumber })
      .from(classListEntries)
      .where(and(eq(classListEntries.institutionId, institutionId), inArray(sql`lower(${classListEntries.lasuEmail})`, lower)));
    const accounts = await this.database
      .select({
        email: sql<string>`lower(${users.email})`,
        matricNumber: sql<string | null>`upper(regexp_replace(${studentProfiles.studentNumber}, '[^A-Za-z0-9]', '', 'g'))`,
      })
      .from(users)
      .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .where(and(eq(users.institutionId, institutionId), inArray(sql`lower(${users.email})`, lower)));
    return [...listed, ...accounts];
  }

  async findFaceCheckPhoto(lectureSessionId: string, studentUserId: string): Promise<Buffer | null> {
    const [row] = await this.database.select({ photo: lectureFaceChecks.photo }).from(lectureFaceChecks)
      .where(and(eq(lectureFaceChecks.lectureSessionId, lectureSessionId), eq(lectureFaceChecks.studentUserId, studentUserId))).limit(1);
    return row?.photo ? Buffer.from(row.photo) : null;
  }
}
