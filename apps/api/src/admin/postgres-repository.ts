import { and, asc, count, type AnyColumn, countDistinct, eq, inArray, isNull, lte, ne, notExists, sql } from 'drizzle-orm';
import {
  academicSessions,
  attendanceRecords,
  attendanceSessions,
  classListEntries,
  classRepresentatives,
  courseEnrollments,
  courseOfferings,
  courses,
  departments,
  semesters,
  lecturerProfiles,
  lectureSessions,
  studentProfiles,
  userRoleAssignments,
  users,
  venues,
  type DatabaseClient,
} from '@lasuatos/database';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { openDisputeStats } from '../attendance/dispute-stats.js';
import { currentSessionStartYear, studentLevelFor } from '../academic/student-level.js';
import { admissionYear } from '../students/postgres-repository.js';
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

/** The same scope for tables that carry their own faculty and department columns. */
function ownScope(account: AdministratorSessionAccount, columns: { facultyId: AnyColumn; departmentId: AnyColumn }) {
  if (account.scope.type === 'department') return eq(columns.departmentId, account.scope.id);
  if (account.scope.type === 'faculty') return eq(columns.facultyId, account.scope.id);
  return undefined;
}

export class PostgresAdministratorOverviewRepository implements AdministratorOverviewRepository {
  constructor(private readonly database: DatabaseClient) {}

  async getOverview(account: AdministratorSessionAccount, now: Date) {
    const scope = departmentScope(account);
    // Students on class lists are grouped in SQL by the inputs of the level rule (the two-digit
    // entry year from a LASU-shaped matric number, the set, entry level and programme length),
    // so the database returns a handful of rows however many students there are.
    const normalizedMatric = sql`regexp_replace(upper(trim(${classListEntries.matricNumber})), '[[:space:]/-]+', '', 'g')`;
    const matricPrefix = sql<string>`case when ${normalizedMatric} ~ '^[0-9]{9,10}$' then left(${normalizedMatric}, 2) || '0000000' else 'unknown' end`;
    const listedInScope = and(eq(classListEntries.institutionId, account.institutionId), scope);
    const onSomeList = this.database
      .select({ one: sql`1` })
      .from(classListEntries)
      .where(eq(classListEntries.studentUserId, studentProfiles.userId));
    // Runs alongside the counts below.
    const setupPending = this.setupCounts(account);
    const listsPending = Promise.all([
      this.database
        .select({
          total: sql<number>`count(*)`.mapWith(Number),
          opened: sql<number>`count(${classListEntries.studentUserId})`.mapWith(Number),
        })
        .from(classListEntries)
        .innerJoin(departments, and(
          eq(departments.id, classListEntries.departmentId),
          eq(departments.institutionId, classListEntries.institutionId),
        ))
        .where(listedInScope),
      this.database
        .select({
          active: sql<number>`count(distinct ${studentProfiles.userId}) filter (where ${users.status} = 'active')`.mapWith(Number),
          suspended: sql<number>`count(distinct ${studentProfiles.userId}) filter (where ${users.status} = 'suspended')`.mapWith(Number),
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
          inArray(users.status, ['active', 'suspended']),
          scope,
          notExists(onSomeList),
        )),
    ]);
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
          setYear: classListEntries.entryYear,
          entryLevel: classListEntries.entryLevel,
          programmeYears: departments.programmeYears,
          value: count(),
        })
        .from(classListEntries)
        .innerJoin(departments, and(
          eq(departments.id, classListEntries.departmentId),
          eq(departments.institutionId, classListEntries.institutionId),
        ))
        .where(listedInScope)
        .groupBy(matricPrefix, classListEntries.entryYear, classListEntries.entryLevel, departments.programmeYears)
        .limit(2000),
      currentSessionStartYear(this.database, account.institutionId, now),
    ]);

    const setup = await setupPending;
    const [[lists], [unlisted]] = await listsPending;

    const levels = new Map<string, { label: string; level: number | null; count: number }>();
    for (const group of levelGroups) {
      const derived = studentLevelFor({
        studentNumber: group.matricPrefix === 'unknown' ? '' : group.matricPrefix,
        // The set, moved on a year or two for direct entry: the year they were admitted.
        entryYear: admissionYear(group.setYear, group.entryLevel),
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
        onClassLists: lists?.total ?? 0,
        openedAccounts: lists?.opened ?? 0,
        unlistedStudents: unlisted?.active ?? 0,
        unlistedSuspended: unlisted?.suspended ?? 0,
      },
      studentLevels,
      setup,
    };
  }

  /** Small counts for the overview's setup checklist and attention list. */
  private async setupCounts(account: AdministratorSessionAccount) {
    const liveVenue = and(eq(venues.institutionId, account.institutionId), ne(venues.status, 'inactive'));
    const [venueRows, classRepRows, sessionRows, academicRows] = await Promise.all([
      this.database
        .select({
          total: count(),
          withoutLocation: sql<number>`count(*) filter (where ${venues.locationRequired} and ${venues.latitude} is null)`.mapWith(Number),
        })
        .from(venues)
        .where(liveVenue),
      this.database
        .select({ value: count() })
        .from(classRepresentatives)
        .where(and(
          eq(classRepresentatives.institutionId, account.institutionId),
          isNull(classRepresentatives.revokedAt),
          ownScope(account, classRepresentatives),
        )),
      this.database
        .select({ id: lectureSessions.id })
        .from(lectureSessions)
        .where(and(eq(lectureSessions.institutionId, account.institutionId), ownScope(account, lectureSessions)))
        .limit(1),
      this.database
        .select({ code: academicSessions.code, startsAt: academicSessions.startsAt, endsAt: academicSessions.endsAt })
        .from(academicSessions)
        .where(and(eq(academicSessions.institutionId, account.institutionId), eq(academicSessions.isCurrent, true)))
        .limit(1),
    ]);
    const academic = academicRows[0];
    return {
      venues: venueRows[0]?.total ?? 0,
      venuesWithoutLocation: venueRows[0]?.withoutLocation ?? 0,
      classReps: classRepRows[0]?.value ?? 0,
      hasTakenAttendance: sessionRows.length > 0,
      academicSession: academic
        ? { code: academic.code, startsAt: academic.startsAt.toISOString(), endsAt: academic.endsAt.toISOString() }
        : null,
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

    // Counted students, as in the lecturer's course report: still on the course, or finished it
    // when its semester ended. Students who left are listed there but never counted.
    const counted = inArray(courseEnrollments.status, ['active', 'completed']);
    const counts = sql`${courseEnrollments.status} in ('active', 'completed')`;
    const [sessionRows, enrollmentRows, absentRows, recordRows, disputeStats] = await Promise.all([
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
        .select({
          courseOfferingId: courseEnrollments.courseOfferingId,
          active: sql<number>`count(*) filter (where ${courseEnrollments.status} = 'active')::int`,
          completed: sql<number>`count(*) filter (where ${courseEnrollments.status} = 'completed')::int`,
        })
        .from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.institutionId, account.institutionId),
          inArray(courseEnrollments.courseOfferingId, offeringIds),
        ))
        .groupBy(courseEnrollments.courseOfferingId),
      // Classes a counted student missed: on the course when it started, no record, and over.
      // A class still taking attendance is not a miss until it ends.
      this.database
        .select({ courseOfferingId: attendanceSessions.courseOfferingId, value: count() })
        .from(attendanceSessions)
        .innerJoin(courseEnrollments, and(
          eq(courseEnrollments.courseOfferingId, attendanceSessions.courseOfferingId),
          eq(courseEnrollments.institutionId, attendanceSessions.institutionId),
        ))
        .where(and(
          inScope,
          counted,
          lte(courseEnrollments.enrolledAt, attendanceSessions.startsAt),
          sql`(${attendanceSessions.status} = 'closed' or ${attendanceSessions.endsAt} <= ${now})`,
          sql`not exists (select 1 from ${attendanceRecords} where ${attendanceRecords.attendanceSessionId} = ${attendanceSessions.id} and ${attendanceRecords.studentUserId} = ${courseEnrollments.studentUserId})`,
        ))
        .groupBy(attendanceSessions.courseOfferingId),
      this.database
        .select({
          courseOfferingId: attendanceSessions.courseOfferingId,
          // Every record of a counted student counts as expected: present ones attended, removed ones not.
          countedRecords: sql<number>`count(*) filter (where ${counts})::int`,
          presentCounted: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'present' and ${counts})::int`,
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
    const absent = byOffering(absentRows);
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
        activeEnrollments: Number(enrollments.get(offering.courseOfferingId)?.active ?? 0),
        completedEnrollments: Number(enrollments.get(offering.courseOfferingId)?.completed ?? 0),
        absentPairs: Number(absent.get(offering.courseOfferingId)?.value ?? 0),
        countedRecords: Number(record?.countedRecords ?? 0),
        presentCounted: Number(record?.presentCounted ?? 0),
        inconclusive: Number(record?.inconclusive ?? 0),
        manual: Number(record?.manual ?? 0),
        revoked: Number(record?.revoked ?? 0),
        openDisputes: disputeStats.get(offering.courseOfferingId)?.open ?? 0,
        oldestOpenDisputeAt: disputeStats.get(offering.courseOfferingId)?.oldest ?? null,
      };
    });
  }
}
