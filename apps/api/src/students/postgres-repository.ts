import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  classListEntries,
  classRepresentatives,
  departments,
  faculties,
  institutions,
  lectureFaceChecks,
  studentAuditEvents,
  studentEmailCodes,
  studentFaceProfiles,
  studentProfiles,
  userRoleAssignments,
  userSessions,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import { studentDisplayName } from '@lasuatos/contracts';
import type {
  ClassListActor,
  ClassListRecord,
  ClassListRowWrite,
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
        matricNumber: classListEntries.matricNumber,
        surname: classListEntries.surname,
        firstName: classListEntries.firstName,
        middleName: classListEntries.middleName,
        lasuEmail: classListEntries.lasuEmail,
        entryYear: classListEntries.entryYear,
        entryLevel: classListEntries.entryLevel,
        studentUserId: classListEntries.studentUserId,
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
    matricNumber: string; surname: string; firstName: string; middleName: string | null; lasuEmail: string | null;
    entryYear: number; entryLevel: number; studentUserId: string | null; accountEmail: string | null;
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
      .select({ id: departments.id, name: departments.name, facultyId: departments.facultyId, facultyName: faculties.name })
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

  async findEntriesByMatric(institutionId: string, matricNumbers: readonly string[]): Promise<ClassListRecord[]> {
    if (matricNumbers.length === 0) return [];
    const rows = await this.#entryQuery()
      .where(and(eq(classListEntries.institutionId, institutionId), inArray(classListEntries.matricNumber, [...matricNumbers])));
    return rows.map((row) => PostgresStudentRepository.#toRecord(row));
  }

  /** Copies the list's identity onto the student's account and profile. */
  async #applyToAccount(tx: Transaction, userId: string, entry: {
    readonly departmentId: string; readonly matricNumber: string; readonly entryYear: number; readonly entryLevel: number;
    readonly firstName: string; readonly middleName: string | null; readonly surname: string;
  }, now: Date): Promise<void> {
    await tx.update(users)
      .set({ displayName: studentDisplayName(entry), updatedAt: now })
      .where(eq(users.id, userId));
    await tx.update(studentProfiles)
      .set({
        departmentId: entry.departmentId,
        studentNumber: entry.matricNumber,
        studentNumberVerifiedAt: now,
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
          const identity = { ...row, departmentId: input.departmentId, entryYear: input.entryYear };
          if (!studentUserId) {
            // A student who opened an account before the list arrived is matched by matric number.
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
    readonly passwordHash: string;
    readonly sessionTokenHash: string;
    readonly sessionExpiresAt: Date;
    readonly now: Date;
  }): Promise<OpenAccountResult> {
    try {
      return await this.database.transaction(async (tx) => {
        const [entry] = await tx.select().from(classListEntries)
          .where(and(eq(classListEntries.id, input.entryId), eq(classListEntries.institutionId, input.institutionId)))
          .for('update').limit(1);
        if (!entry || entry.studentUserId) return { kind: 'claimed' };
        if (await this.#studentUserByMatric(tx, input.institutionId, entry.matricNumber)) return { kind: 'matric_taken' };
        const [clash] = await tx.select({ id: users.id }).from(users)
          .where(and(eq(users.institutionId, input.institutionId), sql`lower(${users.email}) = ${input.email}`)).limit(1);
        if (clash) return { kind: 'email_taken' };
        const [user] = await tx.insert(users).values({
          institutionId: input.institutionId,
          email: input.email,
          displayName: studentDisplayName(entry),
          passwordHash: input.passwordHash,
          passwordIsDefault: true,
          status: 'active',
          emailVerifiedAt: input.now,
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
          .set({ studentUserId: userId, lasuEmail: entry.lasuEmail ?? input.email, updatedAt: input.now })
          .where(eq(classListEntries.id, entry.id));
        await tx.insert(studentAuditEvents).values({
          institutionId: input.institutionId,
          actorUserId: null,
          action: 'account_opened',
          subjectUserId: userId,
          matricNumber: entry.matricNumber,
          details: 'opened with a code sent to the LASU email',
          createdAt: input.now,
        });
        return { kind: 'created', userId };
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
      .select({ userId: studentFaceProfiles.userId, model: studentFaceProfiles.model, templates: studentFaceProfiles.templates, enrolledAt: studentFaceProfiles.enrolledAt })
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
      set: { score: values.score, real: values.real, live: values.live, needsReview: values.needsReview, photo: values.photo, createdAt: values.createdAt },
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

  async findFaceCheckPhoto(lectureSessionId: string, studentUserId: string): Promise<Buffer | null> {
    const [row] = await this.database.select({ photo: lectureFaceChecks.photo }).from(lectureFaceChecks)
      .where(and(eq(lectureFaceChecks.lectureSessionId, lectureSessionId), eq(lectureFaceChecks.studentUserId, studentUserId))).limit(1);
    return row?.photo ? Buffer.from(row.photo) : null;
  }
}
