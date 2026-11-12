import { and, asc, count, countDistinct, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
  academicSessions,
  attendanceRecords,
  attendanceSessions,
  courseEnrollments,
  courseOfferings,
  courses,
  departments,
  semesters,
  lecturerProfiles,
  studentProfiles,
  userRoleAssignments,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { openDisputeStats } from '../attendance/dispute-stats.js';
import { currentSessionStartYear, studentLevelFor } from '../academic/student-level.js';
import type { AdministratorAttendanceOfferingRow, AdministratorOverviewRepository } from './repository.js';

function departmentScope(account: AdministratorSessionAccount) {
  if (account.scope.type === 'department') return eq(departments.id, account.scope.id);
  if (account.scope.type === 'faculty') return eq(departments.facultyId, account.scope.id);
  return undefined;
}

function accountRoleScope(account: AdministratorSessionAccount, role: 'student' | 'lecturer') {
  return and(
    eq(userRoleAssignments.role, role),
    eq(userRoleAssignments.institutionId, account.institutionId),
  );
}

export class PostgresAdministratorOverviewRepository implements AdministratorOverviewRepository {
  constructor(private readonly database: DatabaseClient) {}

  async getOverview(account: AdministratorSessionAccount, now: Date) {
    const scope = departmentScope(account);
    // Students are grouped in SQL by the inputs of the level rule (the
    // two-digit entry year from a LASU-shaped matric number, any stored
    // override, entry level and programme length), so the database returns a
    // handful of rows however many students there are.
    const normalizedMatric = sql`regexp_replace(upper(trim(${studentProfiles.studentNumber})), '[[:space:]/-]+', '', 'g')`;
    const matricPrefix = sql<string>`case when ${normalizedMatric} ~ '^[0-9]{9,10}$' then left(${normalizedMatric}, 2) || '0000000' else 'unknown' end`;
    const [departmentCount, studentCount, lecturerCount, offeringCount, enrollmentCount, levelGroups, sessionStartYear] = await Promise.all([
      this.database
        .select({ value: count() })
        .from(departments)
        .where(and(
          eq(departments.institutionId, account.institutionId),
          eq(departments.isActive, true),
          scope,
        )),
      this.database
        .select({ value: countDistinct(studentProfiles.userId) })
        .from(studentProfiles)
        .innerJoin(users, eq(users.id, studentProfiles.userId))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          accountRoleScope(account, 'student'),
        ))
        .leftJoin(departments, and(
          eq(departments.id, studentProfiles.departmentId),
          eq(departments.institutionId, studentProfiles.institutionId),
        ))
        .where(and(
          eq(studentProfiles.institutionId, account.institutionId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
          scope,
        )),
      this.database
        .select({ value: countDistinct(lecturerProfiles.userId) })
        .from(lecturerProfiles)
        .innerJoin(users, eq(users.id, lecturerProfiles.userId))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          accountRoleScope(account, 'lecturer'),
        ))
        .innerJoin(departments, and(
          eq(departments.id, lecturerProfiles.departmentId),
          eq(departments.institutionId, lecturerProfiles.institutionId),
        ))
        .where(and(
          eq(lecturerProfiles.institutionId, account.institutionId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
          scope,
        )),
      this.database
        .select({ value: count() })
        .from(courseOfferings)
        .innerJoin(departments, and(
          eq(departments.id, courseOfferings.departmentId),
          eq(departments.institutionId, courseOfferings.institutionId),
        ))
        .where(and(
          eq(courseOfferings.institutionId, account.institutionId),
          scope,
        )),
      this.database
        .select({ value: count() })
        .from(courseEnrollments)
        .innerJoin(courseOfferings, and(
          eq(courseOfferings.id, courseEnrollments.courseOfferingId),
          eq(courseOfferings.institutionId, courseEnrollments.institutionId),
        ))
        .innerJoin(departments, and(
          eq(departments.id, courseOfferings.departmentId),
          eq(departments.institutionId, courseOfferings.institutionId),
        ))
        .where(and(
          eq(courseEnrollments.institutionId, account.institutionId),
          eq(courseEnrollments.status, 'active'),
          scope,
        )),
      this.database
        .select({
          matricPrefix,
          entryYear: studentProfiles.entryYear,
          entryLevel: studentProfiles.entryLevel,
          programmeYears: departments.programmeYears,
          value: countDistinct(studentProfiles.userId),
        })
        .from(studentProfiles)
        .innerJoin(users, eq(users.id, studentProfiles.userId))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          accountRoleScope(account, 'student'),
        ))
        .leftJoin(departments, and(
          eq(departments.id, studentProfiles.departmentId),
          eq(departments.institutionId, studentProfiles.institutionId),
        ))
        .where(and(
          eq(studentProfiles.institutionId, account.institutionId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
          scope,
        ))
        .groupBy(matricPrefix, studentProfiles.entryYear, studentProfiles.entryLevel, departments.programmeYears)
        .limit(2000),
      currentSessionStartYear(this.database, account.institutionId, now),
    ]);

    const levels = new Map<string, { label: string; level: number | null; count: number }>();
    for (const group of levelGroups) {
      const derived = studentLevelFor({
        studentNumber: group.matricPrefix === 'unknown' ? '' : group.matricPrefix,
        entryYear: group.entryYear,
        entryLevel: group.entryLevel,
        programmeYears: group.programmeYears,
      }, sessionStartYear);
      const label = derived.status === 'not_started' ? 'Entry year not started' : derived.label;
      const existing = levels.get(label);
      if (existing) existing.count += Number(group.value);
      else levels.set(label, { label, level: derived.status === 'derived' || derived.status === 'extra_year' ? derived.level : null, count: Number(group.value) });
    }
    const studentLevels = [...levels.values()]
      .sort((left, right) => {
        if (left.level === null || right.level === null) return left.level === null ? (right.level === null ? left.label.localeCompare(right.label) : 1) : -1;
        return left.level - right.level || left.label.localeCompare(right.label);
      })
      .slice(0, 32);

    return {
      metrics: {
        departments: departmentCount[0]?.value ?? 0,
        activeStudents: studentCount[0]?.value ?? 0,
        activeLecturers: lecturerCount[0]?.value ?? 0,
        courseOfferings: offeringCount[0]?.value ?? 0,
        activeEnrollments: enrollmentCount[0]?.value ?? 0,
      },
      studentLevels,
    };
  }

  async getAttendanceOfferings(account: AdministratorSessionAccount, now: Date): Promise<AdministratorAttendanceOfferingRow[]> {
    const scope = departmentScope(account);
    const offerings = await this.database
      .select({
        courseOfferingId: courseOfferings.id,
        courseCode: courses.code,
        courseTitle: courses.title,
        departmentName: departments.name,
        semesterName: semesters.name,
        academicSessionCode: academicSessions.code,
      })
      .from(courseOfferings)
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .innerJoin(departments, and(
        eq(departments.id, courseOfferings.departmentId),
        eq(departments.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(semesters, and(
        eq(courseOfferings.semesterId, semesters.id),
        eq(courseOfferings.institutionId, semesters.institutionId),
      ))
      .innerJoin(academicSessions, and(
        eq(semesters.academicSessionId, academicSessions.id),
        eq(semesters.institutionId, academicSessions.institutionId),
      ))
      .where(and(eq(courseOfferings.institutionId, account.institutionId), scope))
      .orderBy(asc(courses.code), asc(courseOfferings.id))
      .limit(1000);
    if (!offerings.length) return [];
    const offeringIds = offerings.map((offering) => offering.courseOfferingId);
    const inScope = and(
      eq(attendanceSessions.institutionId, account.institutionId),
      inArray(attendanceSessions.courseOfferingId, offeringIds),
      lte(attendanceSessions.startsAt, now),
    );

    const [sessionRows, enrollmentRows, expectedRows, recordRows, disputeStats] = await Promise.all([
      this.database
        .select({
          courseOfferingId: attendanceSessions.courseOfferingId,
          sessionsHeld: sql<number>`count(*)::int`,
          lastSessionAt: sql<Date | string | null>`max(${attendanceSessions.startsAt})`,
        })
        .from(attendanceSessions)
        .where(inScope)
        .groupBy(attendanceSessions.courseOfferingId),
      this.database
        .select({ courseOfferingId: courseEnrollments.courseOfferingId, value: count() })
        .from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.institutionId, account.institutionId),
          inArray(courseEnrollments.courseOfferingId, offeringIds),
          eq(courseEnrollments.status, 'active'),
        ))
        .groupBy(courseEnrollments.courseOfferingId),
      this.database
        .select({ courseOfferingId: attendanceSessions.courseOfferingId, value: count() })
        .from(attendanceSessions)
        .innerJoin(courseEnrollments, and(
          eq(courseEnrollments.courseOfferingId, attendanceSessions.courseOfferingId),
          eq(courseEnrollments.institutionId, attendanceSessions.institutionId),
        ))
        .where(and(
          inScope,
          eq(courseEnrollments.status, 'active'),
          lte(courseEnrollments.enrolledAt, attendanceSessions.startsAt),
        ))
        .groupBy(attendanceSessions.courseOfferingId),
      this.database
        .select({
          courseOfferingId: attendanceSessions.courseOfferingId,
          presentActive: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'present' and ${courseEnrollments.status} = 'active')::int`,
          latePresentActive: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'present' and ${courseEnrollments.status} = 'active' and ${courseEnrollments.enrolledAt} > ${attendanceSessions.startsAt})::int`,
          presentAll: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'present')::int`,
          inconclusive: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'present' and ${attendanceRecords.venueOutcome} = 'inconclusive')::int`,
          manual: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'present' and ${attendanceRecords.method} = 'manual')::int`,
          revoked: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'revoked')::int`,
        })
        .from(attendanceRecords)
        .innerJoin(attendanceSessions, and(
          eq(attendanceRecords.attendanceSessionId, attendanceSessions.id),
          eq(attendanceRecords.institutionId, attendanceSessions.institutionId),
        ))
        .leftJoin(courseEnrollments, and(
          eq(courseEnrollments.courseOfferingId, attendanceSessions.courseOfferingId),
          eq(courseEnrollments.institutionId, attendanceSessions.institutionId),
          eq(courseEnrollments.studentUserId, attendanceRecords.studentUserId),
        ))
        .where(inScope)
        .groupBy(attendanceSessions.courseOfferingId),
      openDisputeStats(this.database, account.institutionId, offeringIds),
    ]);

    const byOffering = <T extends { courseOfferingId: string }>(rows: T[]) =>
      new Map(rows.map((row) => [row.courseOfferingId, row]));
    const sessions = byOffering(sessionRows);
    const enrollments = byOffering(enrollmentRows);
    const expected = byOffering(expectedRows);
    const records = byOffering(recordRows);

    return offerings.map((offering) => {
      const session = sessions.get(offering.courseOfferingId);
      const record = records.get(offering.courseOfferingId);
      const last = session?.lastSessionAt;
      return {
        courseOfferingId: offering.courseOfferingId,
        courseCode: offering.courseCode,
        courseTitle: offering.courseTitle,
        departmentName: offering.departmentName,
        semesterLabel: `${offering.academicSessionCode} ${offering.semesterName}`,
        sessionsHeld: Number(session?.sessionsHeld ?? 0),
        lastSessionAt: last == null ? null : new Date(last),
        activeEnrollments: Number(enrollments.get(offering.courseOfferingId)?.value ?? 0),
        expectedPairs: Number(expected.get(offering.courseOfferingId)?.value ?? 0),
        presentActive: Number(record?.presentActive ?? 0),
        latePresentActive: Number(record?.latePresentActive ?? 0),
        presentAll: Number(record?.presentAll ?? 0),
        inconclusive: Number(record?.inconclusive ?? 0),
        manual: Number(record?.manual ?? 0),
        revoked: Number(record?.revoked ?? 0),
        openDisputes: disputeStats.get(offering.courseOfferingId)?.open ?? 0,
        oldestOpenDisputeAt: disputeStats.get(offering.courseOfferingId)?.oldest ?? null,
      };
    });
  }
}
