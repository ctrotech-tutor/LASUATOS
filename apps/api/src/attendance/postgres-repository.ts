import { and, asc, desc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  academicSessions,
  attendanceCheckInEvidence,
  attendanceCorrections,
  attendanceRecords,
  attendanceSessions,
  buildings,
  campuses,
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
  venues,
  type DatabaseClient,
} from '@lasuatos/database';
import type {
  ApplyCorrectionResult,
  AttendanceCorrectionRecord,
  AttendanceRepository,
  OfferingReportSource,
  StudentSummarySource,
  AttendanceSessionRecord,
  CheckInCommitResult,
  CheckInPrepareResult,
  CheckInSessionContext,
  CheckInVenueSnapshot,
  CreateAttendanceSessionInput,
  CreateAttendanceSessionResult,
  LecturerAttendanceSessionDetailRecord,
  SessionQrMaterial,
  StudentOpenAttendanceSessionRecord,
  UpdateAttendanceSessionSettingsResult,
} from './repository.js';
import { venueSnapshotSignature } from './repository.js';
import { openDisputeStats } from './dispute-stats.js';
import { currentSessionStartYear } from '../academic/student-level.js';
import { academicSessionStartYear } from '@lasuatos/contracts';

/** The student's own department (distinct from the offering's department in joins). */
const studentDepartments = alias(departments, 'student_departments');

export type AttendanceTransaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/** Role-scope condition for a lecturer acting on an offering; shared by every attendance query. */
export function lecturerScopeForAttendance() {
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
    venueId: attendanceSessions.venueId,
    venueCode: venues.code,
    venueName: venues.name,
    venueLocationRequired: venues.locationRequired,
    qrOnly: attendanceSessions.qrOnly,
    status: attendanceSessions.status,
    startsAt: attendanceSessions.startsAt,
    endsAt: attendanceSessions.endsAt,
    closedAt: attendanceSessions.closedAt,
  };
}

function makeSessionRecord(
  row: Omit<AttendanceSessionRecord, 'attendanceCount' | 'locationRequired'> & {
    readonly venueLocationRequired: boolean | null;
    readonly attendanceCount?: number;
  },
): AttendanceSessionRecord {
  const { venueLocationRequired, ...rest } = row;
  return {
    ...rest,
    locationRequired: row.venueId != null && (venueLocationRequired ?? false),
    attendanceCount: row.attendanceCount ?? 0,
  };
}

function readNumber(value: string | number | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function venueSnapshot(row: {
  venueId: string | null;
  code?: string | null;
  name?: string | null;
  status: 'pending_review' | 'active' | 'inactive' | null;
  locationRequired: boolean | null;
  latitude: string | number | null;
  longitude: string | number | null;
  radiusMeters: number | null;
}): CheckInVenueSnapshot | null {
  if (!row.venueId || !row.status) return null;
  return {
    venueId: row.venueId,
    venueCode: row.code ?? '',
    venueName: row.name ?? '',
    venueStatus: row.status,
    locationRequired: row.locationRequired ?? true,
    latitude: readNumber(row.latitude),
    longitude: readNumber(row.longitude),
    radiusMeters: row.radiusMeters,
  };
}

/** Assignment-, scope- and account-state-guarded lecturer session lookup. */
function guardedLecturerSessionQuery(
  executor: DatabaseClient | AttendanceTransaction,
  selection: Record<string, unknown>,
) {
  return executor
    .select(selection as never)
    .from(attendanceSessions)
    .innerJoin(courseAssignments, and(
      eq(courseAssignments.courseOfferingId, attendanceSessions.courseOfferingId),
      eq(courseAssignments.institutionId, attendanceSessions.institutionId),
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
      eq(userRoleAssignments.userId, lecturerProfiles.userId),
      lecturerScopeForAttendance(),
    ))
    .$dynamic();
}

export function assignedSessionQuery(
  executor: DatabaseClient | AttendanceTransaction,
  lecturerUserId: string,
  attendanceSessionId: string,
) {
  return executor
    .select({
      id: attendanceSessions.id,
      institutionId: attendanceSessions.institutionId,
      courseOfferingId: attendanceSessions.courseOfferingId,
      startsAt: attendanceSessions.startsAt,
    })
    .from(attendanceSessions)
    .innerJoin(courseAssignments, and(
      eq(courseAssignments.courseOfferingId, attendanceSessions.courseOfferingId),
      eq(courseAssignments.institutionId, attendanceSessions.institutionId),
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
      eq(courseAssignments.lecturerUserId, lecturerProfiles.userId),
      eq(courseAssignments.institutionId, lecturerProfiles.institutionId),
    ))
    .innerJoin(users, and(
      eq(lecturerProfiles.userId, users.id),
      eq(lecturerProfiles.institutionId, users.institutionId),
    ))
    .innerJoin(userRoleAssignments, and(
      eq(userRoleAssignments.userId, lecturerProfiles.userId),
      lecturerScopeForAttendance(),
    ))
    .where(and(
      eq(attendanceSessions.id, attendanceSessionId),
      eq(courseAssignments.lecturerUserId, lecturerUserId),
      eq(courseAssignments.assignmentType, 'lecturer'),
      eq(users.status, 'active'),
      eq(departments.isActive, true),
    ))
    .$dynamic();
}

export interface LockedCorrectionSession {
  readonly id: string;
  readonly institutionId: string;
  readonly courseOfferingId: string;
  readonly startsAt: Date;
}

/**
 * Applies a correction to one student's record inside a caller-owned
 * transaction. The caller must already hold the session row lock (which
 * serializes corrections with check-in commits) and must have verified that
 * the actor is assigned to the session's offering and that it has started.
 */
export async function applyCorrectionInTransaction(
  transaction: AttendanceTransaction,
  session: LockedCorrectionSession,
  input: {
    readonly actorUserId: string;
    readonly studentUserId: string;
    readonly action: 'mark_present' | 'revoke';
    readonly reason: string;
    readonly now: Date;
    readonly disputeId?: string | null;
  },
): Promise<ApplyCorrectionResult> {
  const recordFields = {
    id: attendanceRecords.id,
    studentUserId: attendanceRecords.studentUserId,
    status: attendanceRecords.status,
    method: attendanceRecords.method,
    venueOutcome: attendanceRecords.venueOutcome,
    checkedInAt: attendanceRecords.checkedInAt,
    revokedAt: attendanceRecords.revokedAt,
  };
  const [record] = await transaction
    .select(recordFields)
    .from(attendanceRecords)
    .where(and(
      eq(attendanceRecords.institutionId, session.institutionId),
      eq(attendanceRecords.attendanceSessionId, session.id),
      eq(attendanceRecords.studentUserId, input.studentUserId),
    ))
    .for('update')
    .limit(1);

  const reason = input.reason.trim();
  const shape = (row: typeof record & object) => ({
    studentUserId: row.studentUserId,
    status: row.status,
    method: row.method,
    venueOutcome: row.venueOutcome,
    checkedInAt: row.checkedInAt,
    revokedAt: row.revokedAt,
  });
  const audit = (attendanceRecordId: string, previousStatus: 'present' | 'revoked' | null, resultingStatus: 'present' | 'revoked') =>
    transaction.insert(attendanceCorrections).values({
      institutionId: session.institutionId,
      attendanceSessionId: session.id,
      attendanceRecordId,
      studentUserId: input.studentUserId,
      actorUserId: input.actorUserId,
      action: input.action,
      previousStatus,
      resultingStatus,
      reason,
      disputeId: input.disputeId ?? null,
      createdAt: input.now,
    });

  if (input.action === 'revoke') {
    if (!record) return { kind: 'no_record' };
    if (record.status === 'revoked') return { kind: 'unchanged', record: shape(record) };
    const [updated] = await transaction
      .update(attendanceRecords)
      .set({ status: 'revoked', revokedAt: input.now })
      .where(eq(attendanceRecords.id, record.id))
      .returning(recordFields);
    if (!updated) return { kind: 'no_record' };
    await audit(record.id, 'present', 'revoked');
    return { kind: 'applied', record: shape(updated) };
  }

  if (record?.status === 'present') return { kind: 'unchanged', record: shape(record) };

  const [enrollment] = await transaction
    .select({ id: courseEnrollments.id })
    .from(courseEnrollments)
    .where(and(
      eq(courseEnrollments.institutionId, session.institutionId),
      eq(courseEnrollments.courseOfferingId, session.courseOfferingId),
      eq(courseEnrollments.studentUserId, input.studentUserId),
      eq(courseEnrollments.status, 'active'),
    ))
    .limit(1);
  if (!enrollment) return { kind: 'not_enrolled' };

  if (record) {
    const [restored] = await transaction
      .update(attendanceRecords)
      .set({ status: 'present', revokedAt: null })
      .where(eq(attendanceRecords.id, record.id))
      .returning(recordFields);
    if (!restored) return { kind: 'no_record' };
    await audit(record.id, 'revoked', 'present');
    return { kind: 'applied', record: shape(restored) };
  }

  const [inserted] = await transaction
    .insert(attendanceRecords)
    .values({
      institutionId: session.institutionId,
      attendanceSessionId: session.id,
      studentUserId: input.studentUserId,
      method: 'manual',
      venueOutcome: null,
      status: 'present',
      checkedInAt: input.now,
    })
    .onConflictDoNothing()
    .returning(recordFields);
  if (!inserted) return { kind: 'no_record' };
  await audit(inserted.id, null, 'present');
  return { kind: 'applied', record: shape(inserted) };
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
          eq(departments.isActive, true),
          lte(semesters.startsAt, input.startsAt),
          gt(semesters.endsAt, input.startsAt),
        ))
        .for('update', { of: courseOfferings })
        .limit(1);
      if (!offering) return { kind: 'not_assigned' };

      if (input.venueId) {
        const [venue] = await transaction
          .select({ id: venues.id, status: venues.status })
          .from(venues)
          .where(and(
            eq(venues.id, input.venueId),
            eq(venues.institutionId, offering.institutionId),
          ))
          .for('update', { of: venues })
          .limit(1);
        if (!venue || venue.status !== 'active') return { kind: 'venue_unavailable' };
      }

      const endsAt = input.endsAt > offering.semesterEndsAt ? offering.semesterEndsAt : input.endsAt;
      if (endsAt <= input.startsAt) return { kind: 'semester_unavailable' };

      const [created] = await transaction
        .insert(attendanceSessions)
        .values({
          institutionId: offering.institutionId,
          courseOfferingId: input.courseOfferingId,
          lecturerUserId: input.lecturerUserId,
          venueId: input.venueId,
          qrSecret: input.qrSecret,
          title: input.title,
          status: 'open',
          codeHash: input.codeHash,
          qrOnly: input.qrOnly,
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
        .leftJoin(venues, and(
          eq(attendanceSessions.venueId, venues.id),
          eq(attendanceSessions.institutionId, venues.institutionId),
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
      eq(departments.isActive, true),
    ];
    if (input.courseOfferingId) filters.push(eq(courseOfferings.id, input.courseOfferingId));
    const rows = await guardedLecturerSessionQuery(this.database, {
      ...sessionFields(),
      attendanceCount: sql<number>`(
        select count(*)::int from attendance_records
        where attendance_records.attendance_session_id = ${attendanceSessions.id}
          and attendance_records.status = 'present'
      )`,
    })
      .leftJoin(venues, and(
        eq(attendanceSessions.venueId, venues.id),
        eq(attendanceSessions.institutionId, venues.institutionId),
      ))
      .where(and(...filters))
      .orderBy(desc(attendanceSessions.startsAt), desc(attendanceSessions.createdAt))
      .limit(500);
    return (rows as Array<Record<string, unknown>>).map((row) =>
      makeSessionRecord(row as Parameters<typeof makeSessionRecord>[0]));
  }

  async getLecturerSession(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
  }): Promise<LecturerAttendanceSessionDetailRecord | null> {
    const [row] = await guardedLecturerSessionQuery(this.database, {
      ...sessionFields(),
      institutionId: attendanceSessions.institutionId,
      attendanceCount: sql<number>`(
        select count(*)::int from attendance_records
        where attendance_records.attendance_session_id = ${attendanceSessions.id}
          and attendance_records.status = 'present'
      )`,
    })
      .leftJoin(venues, and(
        eq(attendanceSessions.venueId, venues.id),
        eq(attendanceSessions.institutionId, venues.institutionId),
      ))
      .where(and(
        eq(attendanceSessions.id, input.attendanceSessionId),
        eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
      ))
      .limit(1);
    if (!row) return null;
    const { institutionId, ...sessionRow } = row as Parameters<typeof makeSessionRecord>[0] & { institutionId: string };

    const attendees = await this.database
      .select({
        studentUserId: attendanceRecords.studentUserId,
        displayName: users.displayName,
        checkedInAt: attendanceRecords.checkedInAt,
        method: attendanceRecords.method,
        venueOutcome: attendanceRecords.venueOutcome,
        status: attendanceRecords.status,
        revokedAt: attendanceRecords.revokedAt,
        sharedDevice: sql<boolean>`(${attendanceRecords.deviceHash} is not null and exists (
          select 1 from attendance_records other_records
          where other_records.attendance_session_id = ${attendanceRecords.attendanceSessionId}
            and other_records.device_hash = ${attendanceRecords.deviceHash}
            and other_records.student_user_id <> ${attendanceRecords.studentUserId}
        ))`,
        studentNumber: studentProfiles.studentNumber,
        entryYear: studentProfiles.entryYear,
        entryLevel: studentProfiles.entryLevel,
        programmeYears: studentDepartments.programmeYears,
      })
      .from(attendanceRecords)
      .innerJoin(users, and(
        eq(attendanceRecords.studentUserId, users.id),
        eq(attendanceRecords.institutionId, users.institutionId),
      ))
      .innerJoin(studentProfiles, and(
        eq(attendanceRecords.studentUserId, studentProfiles.userId),
        eq(attendanceRecords.institutionId, studentProfiles.institutionId),
      ))
      .leftJoin(studentDepartments, and(
        eq(studentProfiles.departmentId, studentDepartments.id),
        eq(studentProfiles.institutionId, studentDepartments.institutionId),
      ))
      .where(eq(attendanceRecords.attendanceSessionId, input.attendanceSessionId))
      .orderBy(attendanceRecords.checkedInAt, users.displayName)
      .limit(5000);
    return {
      session: makeSessionRecord(sessionRow),
      attendees: attendees.map((attendee) => ({ ...attendee, sharedDevice: Boolean(attendee.sharedDevice) })),
      sessionStartYear: await currentSessionStartYear(this.database, institutionId, new Date()),
    };
  }

  async closeSession(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly now: Date;
  }): Promise<'closed' | 'already_closed' | 'not_assigned'> {
    return this.database.transaction(async (transaction) => {
      const [session] = await guardedLecturerSessionQuery(transaction, {
        id: attendanceSessions.id,
        status: attendanceSessions.status,
      })
        .where(and(
          eq(attendanceSessions.id, input.attendanceSessionId),
          eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
          eq(users.status, 'active'),
          eq(departments.isActive, true),
        ))
        .for('update', { of: attendanceSessions })
        .limit(1);
      if (!session) return 'not_assigned';
      if ((session as { status: string }).status === 'closed') return 'already_closed';
      await transaction
        .update(attendanceSessions)
        .set({ status: 'closed', closedAt: input.now, updatedAt: input.now })
        .where(eq(attendanceSessions.id, (session as { id: string }).id));
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
      const [session] = await guardedLecturerSessionQuery(transaction, {
        id: attendanceSessions.id,
        status: attendanceSessions.status,
        endsAt: attendanceSessions.endsAt,
      })
        .where(and(
          eq(attendanceSessions.id, input.attendanceSessionId),
          eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
          eq(users.status, 'active'),
          eq(departments.isActive, true),
        ))
        .for('update', { of: attendanceSessions })
        .limit(1);
      if (!session) return { kind: 'not_assigned' };
      const current = session as { id: string; status: string; endsAt: Date };
      if (current.status === 'closed' || current.endsAt <= input.now) return { kind: 'session_closed' };
      await transaction
        .update(attendanceSessions)
        .set({ codeHash: input.codeHash, updatedAt: input.now })
        .where(eq(attendanceSessions.id, current.id));
      return { kind: 'rotated', expiresAt: current.endsAt };
    });
  }

  async updateSessionSettings(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly qrOnly: boolean;
    readonly now: Date;
  }): Promise<UpdateAttendanceSessionSettingsResult> {
    return this.database.transaction(async (transaction) => {
      const [session] = await guardedLecturerSessionQuery(transaction, {
        id: attendanceSessions.id,
        status: attendanceSessions.status,
        endsAt: attendanceSessions.endsAt,
      })
        .where(and(
          eq(attendanceSessions.id, input.attendanceSessionId),
          eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
          eq(users.status, 'active'),
          eq(departments.isActive, true),
        ))
        .for('update', { of: attendanceSessions })
        .limit(1);
      if (!session) return { kind: 'not_assigned' };
      const current = session as { id: string; status: string; endsAt: Date };
      if (current.status === 'closed' || current.endsAt <= input.now) return { kind: 'session_closed' };
      await transaction
        .update(attendanceSessions)
        .set({ qrOnly: input.qrOnly, updatedAt: input.now })
        .where(eq(attendanceSessions.id, current.id));
      const [updated] = await transaction
        .select({
          ...sessionFields(),
          attendanceCount: sql<number>`(
            select count(*)::int from attendance_records
            where attendance_records.attendance_session_id = ${attendanceSessions.id}
              and attendance_records.status = 'present'
          )`,
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
        .leftJoin(venues, and(
          eq(attendanceSessions.venueId, venues.id),
          eq(attendanceSessions.institutionId, venues.institutionId),
        ))
        .where(eq(attendanceSessions.id, current.id))
        .limit(1);
      if (!updated) return { kind: 'not_assigned' };
      return { kind: 'updated', session: makeSessionRecord(updated) };
    });
  }

  async resolveSessionIdByCodeHash(codeHash: string): Promise<string | null> {
    const [row] = await this.database
      .select({ id: attendanceSessions.id })
      .from(attendanceSessions)
      .where(eq(attendanceSessions.codeHash, codeHash))
      .limit(1);
    return row?.id ?? null;
  }

  async getSessionQrSecretForCheckIn(sessionId: string): Promise<{ readonly qrSecret: string | null } | null> {
    const [row] = await this.database
      .select({ qrSecret: attendanceSessions.qrSecret })
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId))
      .limit(1);
    return row ? { qrSecret: row.qrSecret } : null;
  }

  async getSessionQrMaterial(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
  }): Promise<SessionQrMaterial | null> {
    const rows = await guardedLecturerSessionQuery(this.database, {
      sessionId: attendanceSessions.id,
      qrSecret: attendanceSessions.qrSecret,
      status: attendanceSessions.status,
      endsAt: attendanceSessions.endsAt,
    })
      .where(and(
        eq(attendanceSessions.id, input.attendanceSessionId),
        eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
        eq(courseAssignments.lecturerUserId, input.lecturerUserId),
        eq(courseAssignments.assignmentType, 'lecturer'),
        eq(users.status, 'active'),
        eq(departments.isActive, true),
      ))
      .limit(1);
    const row = rows[0] as SessionQrMaterial | undefined;
    return row ?? null;
  }

  async setSessionQrSecret(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly qrSecret: string;
  }): Promise<boolean> {
    const updated = await this.database
      .update(attendanceSessions)
      .set({ qrSecret: input.qrSecret, updatedAt: new Date() })
      .where(and(
        eq(attendanceSessions.id, input.attendanceSessionId),
        eq(attendanceSessions.lecturerUserId, input.lecturerUserId),
        sql`${attendanceSessions.qrSecret} is null`,
      ))
      .returning({ id: attendanceSessions.id });
    return updated.length > 0;
  }

  async prepareCheckIn(input: {
    readonly studentUserId: string;
    readonly sessionId: string;
    readonly now: Date;
  }): Promise<CheckInPrepareResult> {
    const [session] = await this.database
      .select({
        sessionId: attendanceSessions.id,
        institutionId: attendanceSessions.institutionId,
        courseOfferingId: attendanceSessions.courseOfferingId,
        sessionTitle: attendanceSessions.title,
        status: attendanceSessions.status,
        startsAt: attendanceSessions.startsAt,
        endsAt: attendanceSessions.endsAt,
        qrOnly: attendanceSessions.qrOnly,
        courseCode: courses.code,
        courseTitle: courses.title,
        venueId: venues.id,
        venueCode: venues.code,
        venueName: venues.name,
        venueStatus: venues.status,
        venueLocationRequired: venues.locationRequired,
        venueLatitude: venues.latitude,
        venueLongitude: venues.longitude,
        venueRadiusMeters: venues.geofenceRadiusMeters,
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
      .leftJoin(venues, and(
        eq(attendanceSessions.venueId, venues.id),
        eq(attendanceSessions.institutionId, venues.institutionId),
      ))
      .where(eq(attendanceSessions.id, input.sessionId))
      .limit(1);
    if (!session) return { kind: 'invalid_credential' };

    const [existing] = await this.database
      .select({ checkedInAt: attendanceRecords.checkedInAt, status: attendanceRecords.status })
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.attendanceSessionId, session.sessionId),
        eq(attendanceRecords.studentUserId, input.studentUserId),
      ))
      .limit(1);

    const [student] = await this.database
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
      ))
      .limit(1);

    let enrolled = false;
    if (student) {
      const [enrollment] = await this.database
        .select({ id: courseEnrollments.id })
        .from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.institutionId, session.institutionId),
          eq(courseEnrollments.courseOfferingId, session.courseOfferingId),
          eq(courseEnrollments.studentUserId, student.userId),
          eq(courseEnrollments.status, 'active'),
        ))
        .limit(1);
      enrolled = Boolean(enrollment);
    }

    const context: CheckInSessionContext = {
      sessionId: session.sessionId,
      institutionId: session.institutionId,
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionTitle: session.sessionTitle,
      status: session.status,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      qrOnly: session.qrOnly,
      venue: venueSnapshot({
        venueId: session.venueId,
        code: session.venueCode,
        name: session.venueName,
        status: session.venueStatus,
        locationRequired: session.venueLocationRequired,
        latitude: session.venueLatitude,
        longitude: session.venueLongitude,
        radiusMeters: session.venueRadiusMeters,
      }),
      existingCheckedInAt: existing?.checkedInAt ?? null,
      existingStatus: existing?.status ?? null,
      enrolled,
    };
    return { kind: 'prepared', context };
  }

  async commitCheckIn(input: {
    readonly studentUserId: string;
    readonly sessionId: string;
    readonly method: 'code' | 'qr_code';
    readonly venueSignature: string | null;
    readonly evidence: import('./repository.js').CheckInLocationEvidence | null;
    readonly venueOutcome: 'within_boundary' | 'inconclusive' | null;
    readonly deviceHash: string | null;
    readonly now: Date;
  }): Promise<CheckInCommitResult> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select({
          sessionId: attendanceSessions.id,
          institutionId: attendanceSessions.institutionId,
          sessionTitle: attendanceSessions.title,
          status: attendanceSessions.status,
          startsAt: attendanceSessions.startsAt,
          endsAt: attendanceSessions.endsAt,
          qrOnly: attendanceSessions.qrOnly,
          venueId: attendanceSessions.venueId,
          courseCode: courses.code,
          courseTitle: courses.title,
          venueName: venues.name,
          venueStatus: venues.status,
          venueLocationRequired: venues.locationRequired,
          venueLatitude: venues.latitude,
          venueLongitude: venues.longitude,
          venueRadiusMeters: venues.geofenceRadiusMeters,
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
        .leftJoin(venues, and(
          eq(attendanceSessions.venueId, venues.id),
          eq(attendanceSessions.institutionId, venues.institutionId),
        ))
        .where(eq(attendanceSessions.id, input.sessionId))
        .for('update', { of: attendanceSessions })
        .limit(1);
      if (!session) return { kind: 'session_closed' };

      if (input.venueSignature != null) {
        const fresh = venueSnapshot({
          venueId: session.venueId,
          status: session.venueStatus,
          locationRequired: session.venueLocationRequired,
          latitude: session.venueLatitude,
          longitude: session.venueLongitude,
          radiusMeters: session.venueRadiusMeters,
        });
        if (!fresh || venueSnapshotSignature(fresh) !== input.venueSignature) {
          return { kind: 'venue_changed' };
        }
      }

      if (
        session.status !== 'open' ||
        session.startsAt > input.now ||
        session.endsAt <= input.now
      ) {
        return { kind: 'session_closed' };
      }
      if (input.method === 'code' && session.qrOnly) return { kind: 'qr_required' };

      const [student] = await transaction
        .select({ userId: studentProfiles.userId })
        .from(studentProfiles)
        .where(and(
          eq(studentProfiles.userId, input.studentUserId),
          eq(studentProfiles.institutionId, session.institutionId),
        ))
        .limit(1);
      if (!student) return { kind: 'session_closed' };

      const sessionSummary = {
        attendanceSessionId: session.sessionId,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionTitle: session.sessionTitle,
        venueName: session.venueName ?? null,
      } as const;

      const [inserted] = await transaction
        .insert(attendanceRecords)
        .values({
          institutionId: session.institutionId,
          attendanceSessionId: session.sessionId,
          studentUserId: student.userId,
          method: input.method,
          venueOutcome: input.venueOutcome,
          deviceHash: input.deviceHash,
          checkedInAt: input.now,
        })
        .onConflictDoNothing()
        .returning({ id: attendanceRecords.id, checkedInAt: attendanceRecords.checkedInAt });

      if (inserted) {
        if (input.evidence && input.venueOutcome) {
          await transaction
            .insert(attendanceCheckInEvidence)
            .values({
              institutionId: session.institutionId,
              attendanceRecordId: inserted.id,
              studentUserId: student.userId,
              latitude: String(input.evidence.latitude),
              longitude: String(input.evidence.longitude),
              accuracyMeters: input.evidence.accuracyMeters == null ? null : String(input.evidence.accuracyMeters),
              capturedAt: input.evidence.capturedAt,
              distanceMeters: String(input.evidence.distanceMeters),
              radiusMeters: input.evidence.radiusMeters,
              outcome: input.venueOutcome,
            });
        }
        return {
          kind: 'checked_in',
          attendance: { ...sessionSummary, venueOutcome: input.venueOutcome, checkedInAt: inserted.checkedInAt },
        };
      }

      const [concurrentRecord] = await transaction
        .select({
          checkedInAt: attendanceRecords.checkedInAt,
          venueOutcome: attendanceRecords.venueOutcome,
          status: attendanceRecords.status,
        })
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.attendanceSessionId, session.sessionId),
          eq(attendanceRecords.studentUserId, student.userId),
        ))
        .limit(1);
      if (!concurrentRecord) return { kind: 'session_closed' };
      if (concurrentRecord.status === 'revoked') return { kind: 'revoked' };
      return {
        kind: 'already_checked_in',
        attendance: {
          ...sessionSummary,
          venueOutcome: concurrentRecord.venueOutcome,
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
        venueName: venues.name,
        venueOutcome: attendanceRecords.venueOutcome,
        method: attendanceRecords.method,
        status: attendanceRecords.status,
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
      .leftJoin(venues, and(
        eq(attendanceSessions.venueId, venues.id),
        eq(attendanceSessions.institutionId, venues.institutionId),
      ))
      .where(eq(attendanceRecords.studentUserId, studentUserId))
      .orderBy(desc(attendanceSessions.startsAt))
      .limit(500);
  }

  async listStudentOpenSessions(input: {
    readonly studentUserId: string;
    readonly now: Date;
  }): Promise<StudentOpenAttendanceSessionRecord[]> {
    const rows = await this.database
      .select({
        attendanceSessionId: attendanceSessions.id,
        courseOfferingId: courseOfferings.id,
        courseCode: courses.code,
        courseTitle: courses.title,
        sessionTitle: attendanceSessions.title,
        venueCode: venues.code,
        venueName: venues.name,
        venueLocationRequired: venues.locationRequired,
        venueStatus: venues.status,
        venueFloor: venues.floorLabel,
        venueSection: venues.sectionLabel,
        venueLatitude: venues.latitude,
        venueLongitude: venues.longitude,
        venueRadius: venues.geofenceRadiusMeters,
        buildingName: buildings.name,
        campusName: campuses.name,
        qrOnly: attendanceSessions.qrOnly,
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
      .leftJoin(venues, and(
        eq(attendanceSessions.venueId, venues.id),
        eq(attendanceSessions.institutionId, venues.institutionId),
      ))
      .leftJoin(buildings, and(eq(venues.buildingId, buildings.id), eq(venues.institutionId, buildings.institutionId)))
      .leftJoin(campuses, and(eq(venues.campusId, campuses.id), eq(venues.institutionId, campuses.institutionId)))
      .where(and(
        eq(courseEnrollments.studentUserId, input.studentUserId),
        eq(courseEnrollments.status, 'active'),
        eq(attendanceSessions.status, 'open'),
        lte(attendanceSessions.startsAt, input.now),
        gt(attendanceSessions.endsAt, input.now),
      ))
      .orderBy(attendanceSessions.endsAt)
      .limit(100);
    return rows.map((row) => {
      const located = row.venueStatus === 'active' && row.venueLatitude != null && row.venueLongitude != null;
      return {
        attendanceSessionId: row.attendanceSessionId,
        courseOfferingId: row.courseOfferingId,
        courseCode: row.courseCode,
        courseTitle: row.courseTitle,
        sessionTitle: row.sessionTitle,
        venueCode: row.venueCode,
        venueName: row.venueName,
        qrOnly: row.qrOnly,
        endsAt: row.endsAt,
        locationRequired: row.venueCode != null && (row.venueLocationRequired ?? false),
        venueGuide: row.venueCode == null ? null : {
          campusName: row.campusName,
          buildingName: row.buildingName,
          floorLabel: row.venueFloor,
          sectionLabel: row.venueSection,
          latitude: located ? Number(row.venueLatitude) : null,
          longitude: located ? Number(row.venueLongitude) : null,
          radiusMeters: located ? row.venueRadius : null,
        },
      };
    });
  }

  /**
   * Assignment-guarded session lookup for corrections and audit reads: any
   * lecturer with an active `lecturer` assignment to the session's offering
   * (not only the session owner) qualifies.
   */
  private assignedSessionQuery(
    executor: DatabaseClient | AttendanceTransaction,
    lecturerUserId: string,
    attendanceSessionId: string,
  ) {
    return assignedSessionQuery(executor, lecturerUserId, attendanceSessionId);
  }

  async getOfferingReportSource(input: {
    readonly lecturerUserId: string;
    readonly courseOfferingId: string;
    readonly now: Date;
  }): Promise<OfferingReportSource | null> {
    const [offering] = await this.database
      .select({
        id: courseOfferings.id,
        institutionId: courseOfferings.institutionId,
        courseCode: courses.code,
        courseTitle: courses.title,
        departmentName: departments.name,
        semesterName: semesters.name,
        academicSessionCode: academicSessions.code,
        academicSessionStartsAt: academicSessions.startsAt,
        level: courseOfferings.level,
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
      .innerJoin(academicSessions, and(
        eq(semesters.academicSessionId, academicSessions.id),
        eq(semesters.institutionId, academicSessions.institutionId),
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
        eq(userRoleAssignments.userId, lecturerProfiles.userId),
        lecturerScopeForAttendance(),
      ))
      .where(and(
        eq(courseAssignments.lecturerUserId, input.lecturerUserId),
        eq(courseAssignments.assignmentType, 'lecturer'),
        eq(courseOfferings.id, input.courseOfferingId),
        eq(users.status, 'active'),
        eq(departments.isActive, true),
      ))
      .limit(1);
    if (!offering) return null;

    const [sessionRows, studentRows] = await Promise.all([
      this.database
        .select({
          id: attendanceSessions.id,
          title: attendanceSessions.title,
          startsAt: attendanceSessions.startsAt,
          endsAt: attendanceSessions.endsAt,
          status: attendanceSessions.status,
          venueName: venues.name,
        })
        .from(attendanceSessions)
        .leftJoin(venues, and(
          eq(attendanceSessions.venueId, venues.id),
          eq(attendanceSessions.institutionId, venues.institutionId),
        ))
        .where(and(
          eq(attendanceSessions.institutionId, offering.institutionId),
          eq(attendanceSessions.courseOfferingId, offering.id),
          lte(attendanceSessions.startsAt, input.now),
        ))
        .orderBy(desc(attendanceSessions.startsAt), desc(attendanceSessions.id))
        .limit(400),
      this.database
        .select({
          studentUserId: courseEnrollments.studentUserId,
          displayName: users.displayName,
          studentNumber: studentProfiles.studentNumber,
          studentNumberVerifiedAt: studentProfiles.studentNumberVerifiedAt,
          entryYear: studentProfiles.entryYear,
          entryLevel: studentProfiles.entryLevel,
          programmeYears: studentDepartments.programmeYears,
          enrollmentStatus: courseEnrollments.status,
          enrolledAt: courseEnrollments.enrolledAt,
        })
        .from(courseEnrollments)
        .innerJoin(studentProfiles, and(
          eq(courseEnrollments.studentUserId, studentProfiles.userId),
          eq(courseEnrollments.institutionId, studentProfiles.institutionId),
        ))
        .leftJoin(studentDepartments, and(
          eq(studentProfiles.departmentId, studentDepartments.id),
          eq(studentProfiles.institutionId, studentDepartments.institutionId),
        ))
        .innerJoin(users, and(
          eq(studentProfiles.userId, users.id),
          eq(studentProfiles.institutionId, users.institutionId),
        ))
        .where(and(
          eq(courseEnrollments.institutionId, offering.institutionId),
          eq(courseEnrollments.courseOfferingId, offering.id),
        ))
        .orderBy(asc(users.displayName), asc(studentProfiles.studentNumber))
        .limit(5000),
    ]);

    const sessions = [...sessionRows].reverse();
    const records = sessions.length
      ? await this.database
        .select({
          attendanceSessionId: attendanceRecords.attendanceSessionId,
          studentUserId: attendanceRecords.studentUserId,
          status: attendanceRecords.status,
          method: attendanceRecords.method,
          venueOutcome: attendanceRecords.venueOutcome,
        })
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.institutionId, offering.institutionId),
          inArray(attendanceRecords.attendanceSessionId, sessions.map((session) => session.id)),
        ))
      : [];

    return {
      offering: {
        id: offering.id,
        courseCode: offering.courseCode,
        courseTitle: offering.courseTitle,
        departmentName: offering.departmentName,
        semesterLabel: `${offering.academicSessionCode} ${offering.semesterName}`,
        level: offering.level,
        sessionStartYear: academicSessionStartYear({
          code: offering.academicSessionCode,
          startsAt: offering.academicSessionStartsAt,
        }),
      },
      sessions,
      students: studentRows.map(({ studentNumberVerifiedAt, ...student }) => ({
        ...student,
        studentNumberVerified: studentNumberVerifiedAt != null,
      })),
      records,
      openDisputes: (await openDisputeStats(this.database, offering.institutionId, [offering.id])).get(offering.id)?.open ?? 0,
    };
  }

  async getStudentSummarySource(input: {
    readonly studentUserId: string;
    readonly now: Date;
  }): Promise<StudentSummarySource> {
    const enrollments = await this.database
      .select({
        courseOfferingId: courseEnrollments.courseOfferingId,
        courseCode: courses.code,
        courseTitle: courses.title,
        enrolledAt: courseEnrollments.enrolledAt,
      })
      .from(courseEnrollments)
      .innerJoin(courseOfferings, and(
        eq(courseEnrollments.courseOfferingId, courseOfferings.id),
        eq(courseEnrollments.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .where(and(
        eq(courseEnrollments.studentUserId, input.studentUserId),
        eq(courseEnrollments.status, 'active'),
      ))
      .orderBy(asc(courses.code))
      .limit(200);
    if (!enrollments.length) return { enrollments: [], sessions: [], records: [] };

    const offeringIds = enrollments.map((enrollment) => enrollment.courseOfferingId);
    const sessions = await this.database
      .select({
        id: attendanceSessions.id,
        courseOfferingId: attendanceSessions.courseOfferingId,
        startsAt: attendanceSessions.startsAt,
      })
      .from(attendanceSessions)
      .where(and(
        inArray(attendanceSessions.courseOfferingId, offeringIds),
        lte(attendanceSessions.startsAt, input.now),
      ))
      .orderBy(asc(attendanceSessions.startsAt))
      .limit(10_000);
    const records = sessions.length
      ? await this.database
        .select({
          attendanceSessionId: attendanceRecords.attendanceSessionId,
          status: attendanceRecords.status,
        })
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.studentUserId, input.studentUserId),
          inArray(attendanceRecords.attendanceSessionId, sessions.map((session) => session.id)),
        ))
      : [];

    return {
      enrollments,
      sessions,
      records,
    };
  }

  async applyCorrection(input: {
    readonly actorUserId: string;
    readonly attendanceSessionId: string;
    readonly studentUserId: string;
    readonly action: 'mark_present' | 'revoke';
    readonly reason: string;
    readonly now: Date;
  }): Promise<ApplyCorrectionResult> {
    return this.database.transaction(async (transaction) => {
      // Locking the session row serializes corrections with check-in commits,
      // which take the same lock.
      const [session] = await this.assignedSessionQuery(transaction, input.actorUserId, input.attendanceSessionId)
        .for('update', { of: attendanceSessions })
        .limit(1);
      if (!session) return { kind: 'not_assigned' };
      if (session.startsAt > input.now) return { kind: 'session_not_started' };

      return applyCorrectionInTransaction(transaction, session, input);
    });
  }

  async listCorrections(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
  }): Promise<AttendanceCorrectionRecord[] | null> {
    const [session] = await this.assignedSessionQuery(this.database, input.lecturerUserId, input.attendanceSessionId)
      .limit(1);
    if (!session) return null;
    const students = alias(users, 'correction_students');
    const actors = alias(users, 'correction_actors');
    return this.database
      .select({
        id: attendanceCorrections.id,
        studentUserId: attendanceCorrections.studentUserId,
        studentName: students.displayName,
        actorName: actors.displayName,
        action: attendanceCorrections.action,
        previousStatus: attendanceCorrections.previousStatus,
        resultingStatus: attendanceCorrections.resultingStatus,
        reason: attendanceCorrections.reason,
        viaDispute: sql<boolean>`${attendanceCorrections.disputeId} is not null`.mapWith(Boolean),
        createdAt: attendanceCorrections.createdAt,
      })
      .from(attendanceCorrections)
      .innerJoin(students, and(
        eq(attendanceCorrections.studentUserId, students.id),
        eq(attendanceCorrections.institutionId, students.institutionId),
      ))
      .innerJoin(actors, and(
        eq(attendanceCorrections.actorUserId, actors.id),
        eq(attendanceCorrections.institutionId, actors.institutionId),
      ))
      .where(and(
        eq(attendanceCorrections.institutionId, session.institutionId),
        eq(attendanceCorrections.attendanceSessionId, session.id),
      ))
      .orderBy(desc(attendanceCorrections.createdAt), desc(attendanceCorrections.id))
      .limit(2000);
  }
}
