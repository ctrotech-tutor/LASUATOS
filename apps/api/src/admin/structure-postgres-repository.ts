import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  academicSessions,
  courseOfferings,
  departments,
  faculties,
  semesters,
  structureAuditEvents,
  studentProfiles,
  type DatabaseClient,
} from '@lasuatos/database';
import type { CreateResult, StructureRepository, StructureSnapshot } from './structure-repository.js';

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

async function audit(
  transaction: Transaction,
  input: {
    readonly institutionId: string;
    readonly actorUserId: string;
    readonly action: string;
    readonly targetType: 'faculty' | 'department' | 'academic_session';
    readonly targetId: string;
    readonly details: Record<string, unknown>;
  },
): Promise<void> {
  await transaction.insert(structureAuditEvents).values({
    institutionId: input.institutionId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    details: JSON.stringify(input.details),
  });
}

/** Only the fields that actually changed, as {field: [before, after]}. */
function changes(before: Record<string, unknown>, after: Record<string, unknown | undefined>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && before[key] !== value) result[key] = [before[key], value];
  }
  return result;
}

export class PostgresStructureRepository implements StructureRepository {
  constructor(private readonly database: DatabaseClient) {}

  async getStructure(institutionId: string): Promise<StructureSnapshot> {
    const [facultyRows, departmentRows, studentCounts, offeringCounts, sessionRows, semesterRows] = await Promise.all([
      this.database
        .select({ id: faculties.id, code: faculties.code, name: faculties.name, isActive: faculties.isActive })
        .from(faculties)
        .where(eq(faculties.institutionId, institutionId))
        .orderBy(asc(faculties.name))
        .limit(200),
      this.database
        .select({
          id: departments.id,
          facultyId: departments.facultyId,
          code: departments.code,
          name: departments.name,
          isActive: departments.isActive,
          programmeYears: departments.programmeYears,
        })
        .from(departments)
        .where(eq(departments.institutionId, institutionId))
        .orderBy(asc(departments.name))
        .limit(2000),
      this.database
        .select({ departmentId: studentProfiles.departmentId, value: count() })
        .from(studentProfiles)
        .where(eq(studentProfiles.institutionId, institutionId))
        .groupBy(studentProfiles.departmentId),
      this.database
        .select({ departmentId: courseOfferings.departmentId, value: count() })
        .from(courseOfferings)
        .where(eq(courseOfferings.institutionId, institutionId))
        .groupBy(courseOfferings.departmentId),
      this.database
        .select({
          id: academicSessions.id,
          code: academicSessions.code,
          startsAt: academicSessions.startsAt,
          endsAt: academicSessions.endsAt,
          isCurrent: academicSessions.isCurrent,
        })
        .from(academicSessions)
        .where(eq(academicSessions.institutionId, institutionId))
        .orderBy(sql`${academicSessions.startsAt} desc`)
        .limit(50),
      this.database
        .select({
          id: semesters.id,
          academicSessionId: semesters.academicSessionId,
          name: semesters.name,
          startsAt: semesters.startsAt,
          endsAt: semesters.endsAt,
        })
        .from(semesters)
        .where(eq(semesters.institutionId, institutionId))
        .orderBy(asc(semesters.startsAt))
        .limit(500),
    ]);
    const students = new Map(studentCounts.map((row) => [row.departmentId, Number(row.value)]));
    const offerings = new Map(offeringCounts.map((row) => [row.departmentId, Number(row.value)]));
    return {
      faculties: facultyRows,
      departments: departmentRows.map((row) => ({
        ...row,
        studentCount: students.get(row.id) ?? 0,
        courseOfferingCount: offerings.get(row.id) ?? 0,
      })),
      academicSessions: sessionRows.map((session) => ({
        ...session,
        semesters: semesterRows
          .filter((semester) => semester.academicSessionId === session.id)
          .map((semester) => ({ id: semester.id, name: semester.name, startsAt: semester.startsAt, endsAt: semester.endsAt })),
      })),
    };
  }

  async getDepartmentFaculty(institutionId: string, departmentId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ facultyId: departments.facultyId })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.institutionId, institutionId)))
      .limit(1);
    return row?.facultyId ?? null;
  }

  async createFaculty(input: { institutionId: string; actorUserId: string; code: string; name: string }): Promise<CreateResult> {
    return this.database.transaction(async (transaction) => {
      const [clash] = await transaction
        .select({ id: faculties.id })
        .from(faculties)
        .where(and(eq(faculties.institutionId, input.institutionId), sql`upper(${faculties.code}) = upper(${input.code})`))
        .limit(1);
      if (clash) return { kind: 'code_taken' } as const;
      const [created] = await transaction
        .insert(faculties)
        .values({ institutionId: input.institutionId, code: input.code, name: input.name })
        .onConflictDoNothing()
        .returning({ id: faculties.id });
      if (!created) return { kind: 'code_taken' } as const;
      await audit(transaction, {
        ...input,
        action: 'faculty_created',
        targetType: 'faculty',
        targetId: created.id,
        details: { code: input.code, name: input.name },
      });
      return { kind: 'created', id: created.id } as const;
    });
  }

  async updateFaculty(input: {
    institutionId: string;
    actorUserId: string;
    facultyId: string;
    name?: string | undefined;
    isActive?: boolean | undefined;
  }): Promise<'updated' | 'not_found' | 'has_active_departments'> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ name: faculties.name, isActive: faculties.isActive })
        .from(faculties)
        .where(and(eq(faculties.id, input.facultyId), eq(faculties.institutionId, input.institutionId)))
        .for('update')
        .limit(1);
      if (!current) return 'not_found';
      if (input.isActive === false && current.isActive) {
        const [active] = await transaction
          .select({ value: count() })
          .from(departments)
          .where(and(eq(departments.facultyId, input.facultyId), eq(departments.isActive, true)))
          .limit(1);
        if (Number(active?.value ?? 0) > 0) return 'has_active_departments';
      }
      const diff = changes(current, { name: input.name, isActive: input.isActive });
      if (!Object.keys(diff).length) return 'updated';
      await transaction
        .update(faculties)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(faculties.id, input.facultyId));
      await audit(transaction, {
        ...input,
        action: 'faculty_updated',
        targetType: 'faculty',
        targetId: input.facultyId,
        details: diff,
      });
      return 'updated';
    });
  }

  async createDepartment(input: {
    institutionId: string;
    actorUserId: string;
    facultyId: string;
    code: string;
    name: string;
    programmeYears: number;
  }): Promise<CreateResult | { readonly kind: 'faculty_unavailable' }> {
    return this.database.transaction(async (transaction) => {
      const [faculty] = await transaction
        .select({ id: faculties.id })
        .from(faculties)
        .where(and(
          eq(faculties.id, input.facultyId),
          eq(faculties.institutionId, input.institutionId),
          eq(faculties.isActive, true),
        ))
        .limit(1);
      if (!faculty) return { kind: 'faculty_unavailable' } as const;
      const [created] = await transaction
        .insert(departments)
        .values({
          institutionId: input.institutionId,
          facultyId: input.facultyId,
          code: input.code,
          name: input.name,
          programmeYears: input.programmeYears,
        })
        .onConflictDoNothing()
        .returning({ id: departments.id });
      if (!created) return { kind: 'code_taken' } as const;
      await audit(transaction, {
        ...input,
        action: 'department_created',
        targetType: 'department',
        targetId: created.id,
        details: { facultyId: input.facultyId, code: input.code, name: input.name, programmeYears: input.programmeYears },
      });
      return { kind: 'created', id: created.id } as const;
    });
  }

  async updateDepartment(input: {
    institutionId: string;
    actorUserId: string;
    departmentId: string;
    name?: string | undefined;
    programmeYears?: number | undefined;
    isActive?: boolean | undefined;
  }): Promise<'updated' | 'not_found' | 'faculty_inactive'> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          name: departments.name,
          programmeYears: departments.programmeYears,
          isActive: departments.isActive,
          facultyActive: faculties.isActive,
        })
        .from(departments)
        .innerJoin(faculties, and(
          eq(faculties.id, departments.facultyId),
          eq(faculties.institutionId, departments.institutionId),
        ))
        .where(and(eq(departments.id, input.departmentId), eq(departments.institutionId, input.institutionId)))
        .for('update', { of: departments })
        .limit(1);
      if (!current) return 'not_found';
      if (input.isActive === true && !current.isActive && !current.facultyActive) return 'faculty_inactive';
      const diff = changes(current, { name: input.name, programmeYears: input.programmeYears, isActive: input.isActive });
      if (!Object.keys(diff).length) return 'updated';
      await transaction
        .update(departments)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.programmeYears !== undefined ? { programmeYears: input.programmeYears } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(departments.id, input.departmentId));
      await audit(transaction, {
        ...input,
        action: 'department_updated',
        targetType: 'department',
        targetId: input.departmentId,
        details: diff,
      });
      return 'updated';
    });
  }

  async createAcademicSession(input: {
    institutionId: string;
    actorUserId: string;
    code: string;
    startsAt: Date;
    endsAt: Date;
    makeCurrent: boolean;
    semesters: readonly { name: string; startsAt: Date; endsAt: Date }[];
  }): Promise<CreateResult> {
    return this.database.transaction(async (transaction) => {
      const [clash] = await transaction
        .select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(eq(academicSessions.institutionId, input.institutionId), eq(academicSessions.code, input.code)))
        .limit(1);
      if (clash) return { kind: 'code_taken' } as const;
      if (input.makeCurrent) {
        await transaction
          .update(academicSessions)
          .set({ isCurrent: false, updatedAt: sql`now()` })
          .where(and(eq(academicSessions.institutionId, input.institutionId), eq(academicSessions.isCurrent, true)));
      }
      const [created] = await transaction
        .insert(academicSessions)
        .values({
          institutionId: input.institutionId,
          code: input.code,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          isCurrent: input.makeCurrent,
        })
        .onConflictDoNothing()
        .returning({ id: academicSessions.id });
      if (!created) return { kind: 'code_taken' } as const;
      await transaction.insert(semesters).values(input.semesters.map((semester) => ({
        institutionId: input.institutionId,
        academicSessionId: created.id,
        name: semester.name,
        startsAt: semester.startsAt,
        endsAt: semester.endsAt,
      })));
      await audit(transaction, {
        ...input,
        action: 'academic_session_created',
        targetType: 'academic_session',
        targetId: created.id,
        details: {
          code: input.code,
          makeCurrent: input.makeCurrent,
          semesters: input.semesters.map((semester) => semester.name),
        },
      });
      return { kind: 'created', id: created.id } as const;
    });
  }

  async setCurrentSession(input: { institutionId: string; actorUserId: string; sessionId: string }): Promise<'updated' | 'not_found'> {
    return this.database.transaction(async (transaction) => {
      const [target] = await transaction
        .select({ id: academicSessions.id, isCurrent: academicSessions.isCurrent })
        .from(academicSessions)
        .where(and(eq(academicSessions.id, input.sessionId), eq(academicSessions.institutionId, input.institutionId)))
        .limit(1);
      if (!target) return 'not_found';
      if (target.isCurrent) return 'updated';
      const previous = await transaction
        .update(academicSessions)
        .set({ isCurrent: false, updatedAt: sql`now()` })
        .where(and(
          eq(academicSessions.institutionId, input.institutionId),
          eq(academicSessions.isCurrent, true),
          ne(academicSessions.id, input.sessionId),
        ))
        .returning({ id: academicSessions.id });
      await transaction
        .update(academicSessions)
        .set({ isCurrent: true, updatedAt: sql`now()` })
        .where(inArray(academicSessions.id, [input.sessionId]));
      await audit(transaction, {
        ...input,
        action: 'academic_session_made_current',
        targetType: 'academic_session',
        targetId: input.sessionId,
        details: { previousCurrent: previous.map((row) => row.id) },
      });
      return 'updated';
    });
  }
}
