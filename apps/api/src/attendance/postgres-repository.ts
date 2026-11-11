import { and, desc, eq, gt, isNotNull, lte, or, sql } from 'drizzle-orm';
import {
  attendanceRecords,
  attendanceSessions,
  courseAssignments,
  courseEnrollments,
  courseOfferings,
  courses,
  departments,
  lecturerProfiles,
  semesters,
  studentProfiles,
  userRoleAssignments,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import type {
  AttendanceRepository,
  AttendanceSessionRecord,
  CheckInAttendanceResult,
  CreateAttendanceSessionInput,
  CreateAttendanceSessionResult,
  LecturerAttendanceSessionDetailRecord,
  StudentOpenAttendanceSessionRecord,
} from './repository.js';

function lecturerScopeForAttendance() {
  return and(
    eq(userRoleAssignments.role, 'lecturer'),
    eq(userRoleAssignments.institutionId, courseOfferings.institutionId),
    or(
      eq(userRoleAssignments.scopeType, 'institution'),
      and(
        eq(userRoleAssignments.scopeType, 'faculty'),
        eq(userRoleAssignments.facultyId, departments.facultyId),
      ),
      and(
        eq(userRoleAssignments.scopeType, 'department'),
        eq(userRoleAssignments.departmentId, courseOfferings.departmentId),
      ),
    ),
  );
}

function sessionFields() {
  return {
    id: attendanceSessions.id,
    courseOfferingId: courseOfferings.id,
    courseCode: courses.code,
    courseTitle: courses.title,
    title: attendanceSessions.title,
    status: attendanceSessions.status,
    startsAt: attendanceSessions.startsAt,
    endsAt: attendanceSessions.endsAt,
    closedAt: attendanceSessions.closedAt,
  };
}

function makeSessionRecord(
  row: Omit<AttendanceSessionRecord, 'attendanceCount'> & { readonly attendanceCount?: number },
): AttendanceSessionRecord {
  return { ...row, attendanceCount: row.attendanceCount ?? 0 };
}

export class PostgresAttendanceRepository implements AttendanceRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createSession(input: CreateAttendanceSessionInput): Promise<CreateAttendanceSessionResult> {
    return this.database.transaction(async (transaction) => {
      const [offering] = await transaction
        .select({
          institutionId: courseOfferings.institutionId,
          semesterStartsAt: semesters.startsAt,
          semesterEndsAt: semesters.endsAt,
        })
        .from(courseAssignments)
        .innerJoin(courseOfferings, and(
          eq(courseAssignments.courseOfferingId, courseOfferings.id),
          eq(courseAssignments.institutionId, courseOfferings.institutionId),
        ))
        .innerJoin(courses, and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ))
        .innerJoin(departments, and(
          eq(courseOfferings.departmentId, departments.id),
          eq(courseOfferings.institutionId, departments.institutionId),
        ))
        .innerJoin(semesters, and(
          eq(courseOfferings.semesterId, semesters.id),
          eq(courseOfferings.institutionId, semesters.institutionId),
        ))
        .innerJoin(lecturerProfiles, and(
          eq(courseAssignments.lecturerUserId, lecturerProfiles.userId),
          eq(courseAssignments.institutionId, lecturerProfiles.institutionId),
        ))
        .innerJoin(users, and(
          eq(lecturerProfiles.userId, users.id),
          eq(lecturerProfiles.institutionId, users.institutionId),
        ))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, input.lecturerUserId),
          lecturerScopeForAttendance(),
        ))
        .where(and(
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
          eq(courseOfferings.id, input.courseOfferingId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
          eq(departments.isActive, true),
          lte(semesters.startsAt, input.startsAt),
          gt(semesters.endsAt, input.startsAt),
        ))
        .for('update', { of: courseOfferings })
        .limit(1);
      if (!offering) return { kind: 'not_assigned' };

      const endsAt = input.endsAt > offering.semesterEndsAt ? offering.semesterEndsAt : input.endsAt;
      if (endsAt <= input.startsAt) return { kind: 'semester_unavailable' };

      const [created] = await transaction
        .insert(attendanceSessions)
        .values({
          institutionId: offering.institutionId,
          courseOfferingId: input.courseOfferingId,
          lecturerUserId: input.lecturerUserId,
          title: input.title,
          status: 'open',
          codeHash: input.codeHash,
          startsAt: input.startsAt,
          endsAt,
          createdAt: input.startsAt,
          updatedAt: input.startsAt,
        })
        .returning({ id: attendanceSessions.id });
      if (!created) return { kind: 'semester_unavailable' };

      const [session] = await transaction
        .select({ ...sessionFields(), attendanceCount: sql<number>`0` })
        .from(attendanceSessions)
        .innerJoin(courseOfferings, and(
          eq(attendanceSessions.courseOfferingId, courseOfferings.id),
          eq(attendanceSessions.institutionId, courseOfferings.institutionId),
        ))
        .innerJoin(courses, and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ))
        .where(eq(attendanceSessions.id, created.id))
        .limit(1);
      if (!session) return { kind: 'semester_unavailable' };
      return { kind: 'created', session: makeSessionRecord(session) };
    });
  }

  async listLecturerSessions(input: {
    readonly lecturerUserId: string;
    readonly courseOfferingId?: string;
    readonly now: Date;
  }): Promise<AttendanceSessionRecord[]> {
    const filters = [
      eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
      eq(courseAssignments.lecturerUserId, input.lecturerUserId),
      eq(courseAssignments.assignmentType, 'lecturer' as const),
      eq(users.status, 'active' as const),
      isNotNull(users.emailVerifiedAt),
      eq(departments.isActive, true),
    ];
    if (input.courseOfferingId) filters.push(eq(courseOfferings.id, input.courseOfferingId));
    const rows = await this.database
      .select({
        ...sessionFields(),
        attendanceCount: sql<number>`(
          select count(*)::int from attendance_records
          where attendance_records.attendance_session_id = ${attendanceSessions.id}
        )`,
      })
      .from(attendanceSessions)
      .innerJoin(courseAssignments, and(
        eq(courseAssignments.courseOfferingId, attendanceSessions.courseOfferingId),
        eq(courseAssignments.institutionId, attendanceSessions.institutionId),
        eq(courseAssignments.lecturerUserId, input.lecturerUserId),
        eq(courseAssignments.assignmentType, 'lecturer'),
      ))
      .innerJoin(courseOfferings, and(
        eq(attendanceSessions.courseOfferingId, courseOfferings.id),
        eq(attendanceSessions.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .innerJoin(departments, and(
        eq(courseOfferings.departmentId, departments.id),
        eq(courseOfferings.institutionId, departments.institutionId),
      ))
      .innerJoin(lecturerProfiles, and(
        eq(attendanceSessions.lecturerUserId, lecturerProfiles.userId),
        eq(attendanceSessions.institutionId, lecturerProfiles.institutionId),
      ))
      .innerJoin(users, and(
        eq(lecturerProfiles.userId, users.id),
        eq(lecturerProfiles.institutionId, users.institutionId),
      ))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, input.lecturerUserId),
        lecturerScopeForAttendance(),
      ))
      .where(and(...filters))
      .orderBy(desc(attendanceSessions.startsAt), desc(attendanceSessions.createdAt))
      .limit(500);
    return rows.map(makeSessionRecord);
  }

  async getLecturerSession(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
  }): Promise<LecturerAttendanceSessionDetailRecord | null> {
    const [row] = await this.database
      .select({
        ...sessionFields(),
        attendanceCount: sql<number>`(
          select count(*)::int from attendance_records
          where attendance_records.attendance_session_id = ${attendanceSessions.id}
        )`,
      })
      .from(attendanceSessions)
      .innerJoin(courseAssignments, and(
        eq(courseAssignments.courseOfferingId, attendanceSessions.courseOfferingId),
        eq(courseAssignments.institutionId, attendanceSessions.institutionId),
        eq(courseAssignments.lecturerUserId, input.lecturerUserId),
        eq(courseAssignments.assignmentType, 'lecturer'),
      ))
      .innerJoin(courseOfferings, and(
        eq(attendanceSessions.courseOfferingId, courseOfferings.id),
        eq(attendanceSessions.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .innerJoin(departments, and(
        eq(courseOfferings.departmentId, departments.id),
        eq(courseOfferings.institutionId, departments.institutionId),
      ))
      .innerJoin(lecturerProfiles, and(
        eq(attendanceSessions.lecturerUserId, lecturerProfiles.userId),
        eq(attendanceSessions.institutionId, lecturerProfiles.institutionId),
      ))
      .innerJoin(users, and(
        eq(lecturerProfiles.userId, users.id),
        eq(lecturerProfiles.institutionId, users.institutionId),
      ))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, input.lecturerUserId),
        lecturerScopeForAttendance(),
      ))
      .where(and(
        eq(attendanceSessions.id, input.attendanceSessionId),
        eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
        eq(users.status, 'active'),
        isNotNull(users.emailVerifiedAt),
        eq(departments.isActive, true),
      ))
      .limit(1);
    if (!row) return null;

    const attendees = await this.database
      .select({ displayName: users.displayName, checkedInAt: attendanceRecords.checkedInAt })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, and(
        eq(attendanceRecords.attendanceSessionId, attendanceSessions.id),
        eq(attendanceRecords.institutionId, attendanceSessions.institutionId),
      ))
      .innerJoin(users, and(
        eq(attendanceRecords.studentUserId, users.id),
        eq(attendanceRecords.institutionId, users.institutionId),
      ))
      .where(eq(attendanceSessions.id, input.attendanceSessionId))
      .orderBy(attendanceRecords.checkedInAt)
      .limit(5000);
    return { session: makeSessionRecord(row), attendees };
  }

  async closeSession(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly now: Date;
  }): Promise<'closed' | 'already_closed' | 'not_assigned'> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select({ id: attendanceSessions.id, status: attendanceSessions.status })
        .from(attendanceSessions)
        .innerJoin(courseAssignments, and(
          eq(courseAssignments.courseOfferingId, attendanceSessions.courseOfferingId),
          eq(courseAssignments.institutionId, attendanceSessions.institutionId),
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
        ))
        .innerJoin(courseOfferings, and(
          eq(attendanceSessions.courseOfferingId, courseOfferings.id),
          eq(attendanceSessions.institutionId, courseOfferings.institutionId),
        ))
        .innerJoin(departments, and(
          eq(courseOfferings.departmentId, departments.id),
          eq(courseOfferings.institutionId, departments.institutionId),
        ))
        .innerJoin(lecturerProfiles, and(
          eq(attendanceSessions.lecturerUserId, lecturerProfiles.userId),
          eq(attendanceSessions.institutionId, lecturerProfiles.institutionId),
        ))
        .innerJoin(users, and(
          eq(lecturerProfiles.userId, users.id),
          eq(lecturerProfiles.institutionId, users.institutionId),
        ))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, input.lecturerUserId),
          lecturerScopeForAttendance(),
        ))
        .where(and(
          eq(attendanceSessions.id, input.attendanceSessionId),
          eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
          eq(departments.isActive, true),
        ))
        .for('update', { of: attendanceSessions })
        .limit(1);
      if (!session) return 'not_assigned';
      if (session.status === 'closed') return 'already_closed';
      await transaction
        .update(attendanceSessions)
        .set({ status: 'closed', closedAt: input.now, updatedAt: input.now })
        .where(eq(attendanceSessions.id, session.id));
      return 'closed';
    });
  }

  async rotateSessionCode(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly codeHash: string;
    readonly now: Date;
  }): Promise<{ readonly kind: 'rotated'; readonly expiresAt: Date } | { readonly kind: 'not_assigned' | 'session_closed' }> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select({ id: attendanceSessions.id, status: attendanceSessions.status, endsAt: attendanceSessions.endsAt })
        .from(attendanceSessions)
        .innerJoin(courseAssignments, and(
          eq(courseAssignments.courseOfferingId, attendanceSessions.courseOfferingId),
          eq(courseAssignments.institutionId, attendanceSessions.institutionId),
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
        ))
        .innerJoin(courseOfferings, and(
          eq(attendanceSessions.courseOfferingId, courseOfferings.id),
          eq(attendanceSessions.institutionId, courseOfferings.institutionId),
        ))
        .innerJoin(departments, and(
          eq(courseOfferings.departmentId, departments.id),
          eq(courseOfferings.institutionId, departments.institutionId),
        ))
        .innerJoin(lecturerProfiles, and(
          eq(attendanceSessions.lecturerUserId, lecturerProfiles.userId),
          eq(attendanceSessions.institutionId, lecturerProfiles.institutionId),
        ))
        .innerJoin(users, and(
          eq(lecturerProfiles.userId, users.id),
          eq(lecturerProfiles.institutionId, users.institutionId),
        ))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, input.lecturerUserId),
          lecturerScopeForAttendance(),
        ))
        .where(and(
          eq(attendanceSessions.id, input.attendanceSessionId),
          eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
          eq(departments.isActive, true),
        ))
        .for('update', { of: attendanceSessions })
        .limit(1);
      if (!session) return { kind: 'not_assigned' };
      if (session.status === 'closed' || session.endsAt <= input.now) return { kind: 'session_closed' };
      await transaction
        .update(attendanceSessions)
        .set({ codeHash: input.codeHash, updatedAt: input.now })
        .where(eq(attendanceSessions.id, session.id));
      return { kind: 'rotated', expiresAt: session.endsAt };
    });
  }

  async checkIn(input: {
    readonly studentUserId: string;
    readonly codeHash: string;
    readonly now: Date;
  }): Promise<CheckInAttendanceResult> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select({
          id: attendanceSessions.id,
          institutionId: attendanceSessions.institutionId,
          courseOfferingId: attendanceSessions.courseOfferingId,
          title: attendanceSessions.title,
          status: attendanceSessions.status,
          startsAt: attendanceSessions.startsAt,
          endsAt: attendanceSessions.endsAt,
          courseCode: courses.code,
          courseTitle: courses.title,
        })
        .from(attendanceSessions)
        .innerJoin(courseOfferings, and(
          eq(attendanceSessions.courseOfferingId, courseOfferings.id),
          eq(attendanceSessions.institutionId, courseOfferings.institutionId),
        ))
        .innerJoin(courses, and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ))
        .where(eq(attendanceSessions.codeHash, input.codeHash))
        .for('share', { of: attendanceSessions })
        .limit(1);
      if (!session) return { kind: 'invalid_code' };

      const [existing] = await transaction
        .select({ checkedInAt: attendanceRecords.checkedInAt })
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.attendanceSessionId, session.id),
          eq(attendanceRecords.studentUserId, input.studentUserId),
        ))
        .limit(1);
      if (existing) {
        return {
          kind: 'already_checked_in',
          attendance: {
            attendanceSessionId: session.id,
            courseCode: session.courseCode,
            courseTitle: session.courseTitle,
            sessionTitle: session.title,
            checkedInAt: existing.checkedInAt,
          },
        };
      }
      if (session.status !== 'open' || session.startsAt > input.now || session.endsAt <= input.now) {
        return { kind: 'session_closed' };
      }

      const [student] = await transaction
        .select({ userId: studentProfiles.userId })
        .from(studentProfiles)
        .innerJoin(users, and(
          eq(studentProfiles.userId, users.id),
          eq(studentProfiles.institutionId, users.institutionId),
        ))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          eq(userRoleAssignments.institutionId, session.institutionId),
          eq(userRoleAssignments.role, 'student'),
        ))
        .where(and(
          eq(studentProfiles.userId, input.studentUserId),
          eq(studentProfiles.institutionId, session.institutionId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
        ))
        .limit(1);
      if (!student) return { kind: 'not_enrolled' };

      const [enrollment] = await transaction
        .select({ id: courseEnrollments.id })
        .from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.institutionId, session.institutionId),
          eq(courseEnrollments.courseOfferingId, session.courseOfferingId),
          eq(courseEnrollments.studentUserId, student.userId),
          eq(courseEnrollments.status, 'active'),
        ))
        .limit(1);
      if (!enrollment) return { kind: 'not_enrolled' };

      const [inserted] = await transaction
        .insert(attendanceRecords)
        .values({
          institutionId: session.institutionId,
          attendanceSessionId: session.id,
          studentUserId: student.userId,
          checkedInAt: input.now,
        })
        .onConflictDoNothing()
        .returning({ checkedInAt: attendanceRecords.checkedInAt });
      if (inserted) {
        return {
          kind: 'checked_in',
          attendance: {
            attendanceSessionId: session.id,
            courseCode: session.courseCode,
            courseTitle: session.courseTitle,
            sessionTitle: session.title,
            checkedInAt: inserted.checkedInAt,
          },
        };
      }

      const [concurrentRecord] = await transaction
        .select({ checkedInAt: attendanceRecords.checkedInAt })
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.attendanceSessionId, session.id),
          eq(attendanceRecords.studentUserId, student.userId),
        ))
        .limit(1);
      if (!concurrentRecord) return { kind: 'invalid_code' };
      return {
        kind: 'already_checked_in',
        attendance: {
          attendanceSessionId: session.id,
          courseCode: session.courseCode,
          courseTitle: session.courseTitle,
          sessionTitle: session.title,
          checkedInAt: concurrentRecord.checkedInAt,
        },
      };
    });
  }

  async listStudentHistory(studentUserId: string) {
    return this.database
      .select({
        attendanceSessionId: attendanceSessions.id,
        courseOfferingId: courseOfferings.id,
        courseCode: courses.code,
        courseTitle: courses.title,
        sessionTitle: attendanceSessions.title,
        startsAt: attendanceSessions.startsAt,
        checkedInAt: attendanceRecords.checkedInAt,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, and(
        eq(attendanceRecords.attendanceSessionId, attendanceSessions.id),
        eq(attendanceRecords.institutionId, attendanceSessions.institutionId),
      ))
      .innerJoin(courseOfferings, and(
        eq(attendanceSessions.courseOfferingId, courseOfferings.id),
        eq(attendanceSessions.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .where(eq(attendanceRecords.studentUserId, studentUserId))
      .orderBy(desc(attendanceSessions.startsAt))
      .limit(500);
  }

  async listStudentOpenSessions(input: {
    readonly studentUserId: string;
    readonly now: Date;
  }): Promise<StudentOpenAttendanceSessionRecord[]> {
    return this.database
      .select({
        attendanceSessionId: attendanceSessions.id,
        courseOfferingId: courseOfferings.id,
        courseCode: courses.code,
        courseTitle: courses.title,
        sessionTitle: attendanceSessions.title,
        endsAt: attendanceSessions.endsAt,
      })
      .from(courseEnrollments)
      .innerJoin(attendanceSessions, and(
        eq(attendanceSessions.courseOfferingId, courseEnrollments.courseOfferingId),
        eq(attendanceSessions.institutionId, courseEnrollments.institutionId),
      ))
      .innerJoin(courseOfferings, and(
        eq(attendanceSessions.courseOfferingId, courseOfferings.id),
        eq(attendanceSessions.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .where(and(
        eq(courseEnrollments.studentUserId, input.studentUserId),
        eq(courseEnrollments.status, 'active'),
        eq(attendanceSessions.status, 'open'),
        lte(attendanceSessions.startsAt, input.now),
        gt(attendanceSessions.endsAt, input.now),
      ))
      .orderBy(attendanceSessions.endsAt)
      .limit(100);
  }
}
