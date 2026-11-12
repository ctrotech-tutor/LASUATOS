import { and, asc, count, desc, eq, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  attendanceCorrections,
  attendanceDisputes,
  attendanceRecords,
  attendanceSessions,
  courseAssignments,
  courseEnrollments,
  courseOfferings,
  courses,
  departments,
  lecturerProfiles,
  studentProfiles,
  userRoleAssignments,
  users,
  venues,
  type DatabaseClient,
} from '@lasuatos/database';
import { earliestDisputableEnd } from './dispute-policy.js';
import type {
  AttendanceDisputeRepository,
  DisputeListStatus,
  DisputeNoticeContext,
  InsertDisputeResult,
  LecturerDisputeRecord,
  ResolveDisputeResult,
  StudentDisputeCandidate,
  StudentDisputeRecord,
  WithdrawDisputeResult,
} from './dispute-repository.js';
import {
  applyCorrectionInTransaction,
  assignedSessionQuery,
  lecturerScopeForAttendance,
  type AttendanceTransaction,
} from './postgres-repository.js';

type Executor = DatabaseClient | AttendanceTransaction;

const resolvers = alias(users, 'dispute_resolvers');
const disputeStudents = alias(users, 'dispute_students');

/** The moment check-ins stopped: the earlier of close time and scheduled end. */
const sessionEndedAtSql = sql<Date>`least(coalesce(${attendanceSessions.closedAt}, ${attendanceSessions.endsAt}), ${attendanceSessions.endsAt})`;

export class PostgresAttendanceDisputeRepository implements AttendanceDisputeRepository {
  constructor(private readonly database: DatabaseClient) {}

  async getDisputeFacts(input: {
    readonly studentUserId: string;
    readonly attendanceSessionId: string;
  }) {
    const [row] = await this.database
      .select({
        institutionId: attendanceSessions.institutionId,
        courseOfferingId: attendanceSessions.courseOfferingId,
        status: attendanceSessions.status,
        startsAt: attendanceSessions.startsAt,
        endsAt: attendanceSessions.endsAt,
        closedAt: attendanceSessions.closedAt,
        enrollmentStatus: courseEnrollments.status,
        enrolledAt: courseEnrollments.enrolledAt,
      })
      .from(attendanceSessions)
      .innerJoin(courseEnrollments, and(
        eq(courseEnrollments.courseOfferingId, attendanceSessions.courseOfferingId),
        eq(courseEnrollments.institutionId, attendanceSessions.institutionId),
        eq(courseEnrollments.studentUserId, input.studentUserId),
      ))
      .where(eq(attendanceSessions.id, input.attendanceSessionId))
      .limit(1);
    if (!row) return null;

    const [records, priorDisputes, [open]] = await Promise.all([
      this.database
        .select({ status: attendanceRecords.status })
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.institutionId, row.institutionId),
          eq(attendanceRecords.attendanceSessionId, input.attendanceSessionId),
          eq(attendanceRecords.studentUserId, input.studentUserId),
        ))
        .limit(1),
      this.database
        .select({ status: attendanceDisputes.status })
        .from(attendanceDisputes)
        .where(and(
          eq(attendanceDisputes.institutionId, row.institutionId),
          eq(attendanceDisputes.attendanceSessionId, input.attendanceSessionId),
          eq(attendanceDisputes.studentUserId, input.studentUserId),
        ))
        .limit(50),
      this.openCountQuery(row.institutionId, input.studentUserId),
    ]);

    return {
      institutionId: row.institutionId,
      courseOfferingId: row.courseOfferingId,
      facts: {
        session: { status: row.status, startsAt: row.startsAt, endsAt: row.endsAt, closedAt: row.closedAt },
        enrollment: { status: row.enrollmentStatus, enrolledAt: row.enrolledAt },
        recordStatus: records[0]?.status ?? null,
        priorDisputeStatuses: priorDisputes.map((dispute) => dispute.status),
        openDisputeCount: Number(open?.value ?? 0),
      },
    };
  }

  private openCountQuery(institutionId: string, studentUserId: string) {
    return this.database
      .select({ value: count() })
      .from(attendanceDisputes)
      .where(and(
        eq(attendanceDisputes.institutionId, institutionId),
        eq(attendanceDisputes.studentUserId, studentUserId),
        eq(attendanceDisputes.status, 'open'),
      ));
  }

  async insertDispute(input: Parameters<AttendanceDisputeRepository['insertDispute']>[0]): Promise<InsertDisputeResult> {
    // The partial unique index allows one open dispute per student/session;
    // a concurrent duplicate lands in the conflict branch and returns nothing.
    const [inserted] = await this.database
      .insert(attendanceDisputes)
      .values({
        institutionId: input.institutionId,
        courseOfferingId: input.courseOfferingId,
        attendanceSessionId: input.attendanceSessionId,
        studentUserId: input.studentUserId,
        kind: input.kind,
        status: 'open',
        statement: input.statement,
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: attendanceDisputes.id });
    if (!inserted) return { kind: 'already_open' };
    const [dispute] = await this.studentDisputeRows(this.database, eq(attendanceDisputes.id, inserted.id), 1);
    if (!dispute) throw new Error('The inserted dispute could not be read back.');
    return { kind: 'inserted', dispute };
  }

  private studentDisputeRows(executor: Executor, condition: SQL | undefined, limit: number): Promise<StudentDisputeRecord[]> {
    return executor
      .select({
        id: attendanceDisputes.id,
        attendanceSessionId: attendanceDisputes.attendanceSessionId,
        courseOfferingId: attendanceDisputes.courseOfferingId,
        courseCode: courses.code,
        courseTitle: courses.title,
        sessionTitle: attendanceSessions.title,
        sessionStartsAt: attendanceSessions.startsAt,
        kind: attendanceDisputes.kind,
        status: attendanceDisputes.status,
        statement: attendanceDisputes.statement,
        resolutionNote: attendanceDisputes.resolutionNote,
        resolvedByName: resolvers.displayName,
        resolvedAt: attendanceDisputes.resolvedAt,
        createdAt: attendanceDisputes.createdAt,
      })
      .from(attendanceDisputes)
      .innerJoin(attendanceSessions, and(
        eq(attendanceDisputes.attendanceSessionId, attendanceSessions.id),
        eq(attendanceDisputes.institutionId, attendanceSessions.institutionId),
      ))
      .innerJoin(courseOfferings, and(
        eq(attendanceDisputes.courseOfferingId, courseOfferings.id),
        eq(attendanceDisputes.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .leftJoin(resolvers, and(
        eq(attendanceDisputes.resolvedByUserId, resolvers.id),
        eq(attendanceDisputes.institutionId, resolvers.institutionId),
      ))
      .where(condition)
      .orderBy(desc(attendanceDisputes.createdAt), desc(attendanceDisputes.id))
      .limit(limit);
  }

  listStudentDisputes(input: { readonly studentUserId: string }) {
    return this.studentDisputeRows(this.database, eq(attendanceDisputes.studentUserId, input.studentUserId), 500);
  }

  async listStudentDisputeCandidates(input: {
    readonly studentUserId: string;
    readonly now: Date;
  }): Promise<{ readonly candidates: StudentDisputeCandidate[]; readonly openDisputeCount: number }> {
    const enrollments = await this.database
      .select({
        institutionId: courseEnrollments.institutionId,
        courseOfferingId: courseEnrollments.courseOfferingId,
        status: courseEnrollments.status,
        enrolledAt: courseEnrollments.enrolledAt,
        courseCode: courses.code,
        courseTitle: courses.title,
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
      .limit(200);
    if (!enrollments.length) return { candidates: [], openDisputeCount: 0 };
    const institutionId = enrollments[0]!.institutionId;
    const byOffering = new Map(enrollments.map((enrollment) => [enrollment.courseOfferingId, enrollment]));

    const sessions = await this.database
      .select({
        id: attendanceSessions.id,
        courseOfferingId: attendanceSessions.courseOfferingId,
        title: attendanceSessions.title,
        status: attendanceSessions.status,
        startsAt: attendanceSessions.startsAt,
        endsAt: attendanceSessions.endsAt,
        closedAt: attendanceSessions.closedAt,
      })
      .from(attendanceSessions)
      .where(and(
        eq(attendanceSessions.institutionId, institutionId),
        inArray(attendanceSessions.courseOfferingId, [...byOffering.keys()]),
        lte(attendanceSessions.startsAt, input.now),
        sql`${sessionEndedAtSql} >= ${earliestDisputableEnd(input.now).toISOString()}::timestamptz`,
      ))
      .orderBy(desc(attendanceSessions.startsAt), desc(attendanceSessions.id))
      .limit(500);

    const [[open], records, disputes, revocations] = await Promise.all([
      this.openCountQuery(institutionId, input.studentUserId),
      sessions.length
        ? this.database
          .select({ attendanceSessionId: attendanceRecords.attendanceSessionId, status: attendanceRecords.status })
          .from(attendanceRecords)
          .where(and(
            eq(attendanceRecords.institutionId, institutionId),
            eq(attendanceRecords.studentUserId, input.studentUserId),
            inArray(attendanceRecords.attendanceSessionId, sessions.map((session) => session.id)),
          ))
        : Promise.resolve([]),
      sessions.length
        ? this.database
          .select({ attendanceSessionId: attendanceDisputes.attendanceSessionId, status: attendanceDisputes.status })
          .from(attendanceDisputes)
          .where(and(
            eq(attendanceDisputes.institutionId, institutionId),
            eq(attendanceDisputes.studentUserId, input.studentUserId),
            inArray(attendanceDisputes.attendanceSessionId, sessions.map((session) => session.id)),
          ))
        : Promise.resolve([]),
      sessions.length
        ? this.database
          .select({
            attendanceSessionId: attendanceCorrections.attendanceSessionId,
            reason: attendanceCorrections.reason,
            createdAt: attendanceCorrections.createdAt,
          })
          .from(attendanceCorrections)
          .where(and(
            eq(attendanceCorrections.institutionId, institutionId),
            eq(attendanceCorrections.studentUserId, input.studentUserId),
            eq(attendanceCorrections.action, 'revoke'),
            inArray(attendanceCorrections.attendanceSessionId, sessions.map((session) => session.id)),
          ))
          .orderBy(desc(attendanceCorrections.createdAt))
        : Promise.resolve([]),
    ]);

    const recordBySession = new Map(records.map((record) => [record.attendanceSessionId, record.status]));
    const disputesBySession = new Map<string, Array<typeof disputes[number]['status']>>();
    for (const dispute of disputes) {
      disputesBySession.set(dispute.attendanceSessionId, [...(disputesBySession.get(dispute.attendanceSessionId) ?? []), dispute.status]);
    }
    const latestRevocation = new Map<string, { reason: string; revokedAt: Date }>();
    for (const revocation of revocations) {
      if (!latestRevocation.has(revocation.attendanceSessionId)) {
        latestRevocation.set(revocation.attendanceSessionId, { reason: revocation.reason, revokedAt: revocation.createdAt });
      }
    }

    const candidates = sessions.flatMap((session): StudentDisputeCandidate[] => {
      const enrollment = byOffering.get(session.courseOfferingId);
      if (!enrollment) return [];
      const recordStatus = recordBySession.get(session.id) ?? null;
      return [{
        attendanceSessionId: session.id,
        courseOfferingId: session.courseOfferingId,
        courseCode: enrollment.courseCode,
        courseTitle: enrollment.courseTitle,
        sessionTitle: session.title,
        facts: {
          session: { status: session.status, startsAt: session.startsAt, endsAt: session.endsAt, closedAt: session.closedAt },
          enrollment: { status: enrollment.status, enrolledAt: enrollment.enrolledAt },
          recordStatus,
          priorDisputeStatuses: disputesBySession.get(session.id) ?? [],
        },
        revocation: recordStatus === 'revoked' ? latestRevocation.get(session.id) ?? null : null,
      }];
    });
    return { candidates, openDisputeCount: Number(open?.value ?? 0) };
  }

  async withdrawDispute(input: {
    readonly studentUserId: string;
    readonly disputeId: string;
    readonly now: Date;
  }): Promise<WithdrawDisputeResult> {
    return this.database.transaction(async (transaction) => {
      const [dispute] = await transaction
        .select({ id: attendanceDisputes.id, status: attendanceDisputes.status })
        .from(attendanceDisputes)
        .where(and(
          eq(attendanceDisputes.id, input.disputeId),
          eq(attendanceDisputes.studentUserId, input.studentUserId),
        ))
        .for('update')
        .limit(1);
      if (!dispute) return { kind: 'not_found' };
      if (dispute.status !== 'open') return { kind: 'not_open' };
      await transaction
        .update(attendanceDisputes)
        .set({ status: 'withdrawn', resolvedAt: input.now })
        .where(eq(attendanceDisputes.id, dispute.id));
      const [updated] = await this.studentDisputeRows(transaction, eq(attendanceDisputes.id, dispute.id), 1);
      if (!updated) throw new Error('The withdrawn dispute could not be read back.');
      return { kind: 'withdrawn', dispute: updated };
    });
  }

  /**
   * Offerings the lecturer is currently assigned to, using the same validity
   * rules as attendance session access: an active, verified lecturer with a
   * lecturer role whose scope covers the offering's active department.
   */
  private assignedOfferings(lecturerUserId: string, courseOfferingId?: string) {
    return this.database
      .selectDistinct({ id: courseOfferings.id, institutionId: courseOfferings.institutionId })
      .from(courseAssignments)
      .innerJoin(courseOfferings, and(
        eq(courseAssignments.courseOfferingId, courseOfferings.id),
        eq(courseAssignments.institutionId, courseOfferings.institutionId),
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
        eq(courseAssignments.lecturerUserId, lecturerUserId),
        eq(courseAssignments.assignmentType, 'lecturer'),
        eq(users.status, 'active'),
        isNotNull(users.emailVerifiedAt),
        eq(departments.isActive, true),
        courseOfferingId ? eq(courseOfferings.id, courseOfferingId) : undefined,
      ))
      .limit(1000);
  }

  private async lecturerDisputeRows(
    executor: Executor,
    condition: SQL | undefined,
    order: 'oldest_first' | 'newest_resolved_first' | 'open_first',
    limit: number,
  ): Promise<LecturerDisputeRecord[]> {
    const rows = await executor
      .select({
        id: attendanceDisputes.id,
        institutionId: attendanceDisputes.institutionId,
        courseOfferingId: attendanceDisputes.courseOfferingId,
        courseCode: courses.code,
        courseTitle: courses.title,
        attendanceSessionId: attendanceDisputes.attendanceSessionId,
        sessionTitle: attendanceSessions.title,
        sessionStartsAt: attendanceSessions.startsAt,
        venueName: venues.name,
        studentId: attendanceDisputes.studentUserId,
        studentName: disputeStudents.displayName,
        studentNumber: studentProfiles.studentNumber,
        studentNumberVerifiedAt: studentProfiles.studentNumberVerifiedAt,
        enrollmentStatus: courseEnrollments.status,
        kind: attendanceDisputes.kind,
        status: attendanceDisputes.status,
        statement: attendanceDisputes.statement,
        recordStatus: attendanceRecords.status,
        recordMethod: attendanceRecords.method,
        recordVenueOutcome: attendanceRecords.venueOutcome,
        recordCheckedInAt: attendanceRecords.checkedInAt,
        recordRevokedAt: attendanceRecords.revokedAt,
        resolutionNote: attendanceDisputes.resolutionNote,
        resolvedByName: resolvers.displayName,
        resolvedAt: attendanceDisputes.resolvedAt,
        createdAt: attendanceDisputes.createdAt,
      })
      .from(attendanceDisputes)
      .innerJoin(attendanceSessions, and(
        eq(attendanceDisputes.attendanceSessionId, attendanceSessions.id),
        eq(attendanceDisputes.institutionId, attendanceSessions.institutionId),
      ))
      .innerJoin(courseOfferings, and(
        eq(attendanceDisputes.courseOfferingId, courseOfferings.id),
        eq(attendanceDisputes.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .innerJoin(studentProfiles, and(
        eq(attendanceDisputes.studentUserId, studentProfiles.userId),
        eq(attendanceDisputes.institutionId, studentProfiles.institutionId),
      ))
      .innerJoin(disputeStudents, and(
        eq(studentProfiles.userId, disputeStudents.id),
        eq(studentProfiles.institutionId, disputeStudents.institutionId),
      ))
      .leftJoin(venues, and(
        eq(attendanceSessions.venueId, venues.id),
        eq(attendanceSessions.institutionId, venues.institutionId),
      ))
      .leftJoin(courseEnrollments, and(
        eq(courseEnrollments.courseOfferingId, attendanceDisputes.courseOfferingId),
        eq(courseEnrollments.institutionId, attendanceDisputes.institutionId),
        eq(courseEnrollments.studentUserId, attendanceDisputes.studentUserId),
      ))
      .leftJoin(attendanceRecords, and(
        eq(attendanceRecords.attendanceSessionId, attendanceDisputes.attendanceSessionId),
        eq(attendanceRecords.institutionId, attendanceDisputes.institutionId),
        eq(attendanceRecords.studentUserId, attendanceDisputes.studentUserId),
      ))
      .leftJoin(resolvers, and(
        eq(attendanceDisputes.resolvedByUserId, resolvers.id),
        eq(attendanceDisputes.institutionId, resolvers.institutionId),
      ))
      .where(condition)
      .orderBy(
        ...(order === 'oldest_first'
          ? [asc(attendanceDisputes.createdAt), asc(attendanceDisputes.id)]
          : order === 'newest_resolved_first'
            ? [desc(attendanceDisputes.resolvedAt), desc(attendanceDisputes.id)]
            : [
                sql`case when ${attendanceDisputes.status} = 'open' then 0 else 1 end`,
                desc(attendanceDisputes.createdAt),
                desc(attendanceDisputes.id),
              ]),
      )
      .limit(limit);
    if (!rows.length) return [];

    // Latest correction per (session, student) for the disputes on this page.
    const actors = alias(users, 'dispute_correction_actors');
    const corrections = await executor
      .select({
        attendanceSessionId: attendanceCorrections.attendanceSessionId,
        studentUserId: attendanceCorrections.studentUserId,
        action: attendanceCorrections.action,
        reason: attendanceCorrections.reason,
        actorName: actors.displayName,
        createdAt: attendanceCorrections.createdAt,
      })
      .from(attendanceCorrections)
      .innerJoin(actors, and(
        eq(attendanceCorrections.actorUserId, actors.id),
        eq(attendanceCorrections.institutionId, actors.institutionId),
      ))
      .where(and(
        inArray(attendanceCorrections.attendanceSessionId, [...new Set(rows.map((row) => row.attendanceSessionId))]),
        inArray(attendanceCorrections.studentUserId, [...new Set(rows.map((row) => row.studentId))]),
      ))
      .orderBy(desc(attendanceCorrections.createdAt), desc(attendanceCorrections.id))
      .limit(5000);
    const latest = new Map<string, typeof corrections[number]>();
    for (const correction of corrections) {
      const key = `${correction.attendanceSessionId}:${correction.studentUserId}`;
      if (!latest.has(key)) latest.set(key, correction);
    }

    return rows.map((row) => {
      const correction = latest.get(`${row.attendanceSessionId}:${row.studentId}`);
      return {
        id: row.id,
        courseOfferingId: row.courseOfferingId,
        courseCode: row.courseCode,
        courseTitle: row.courseTitle,
        attendanceSessionId: row.attendanceSessionId,
        sessionTitle: row.sessionTitle,
        sessionStartsAt: row.sessionStartsAt,
        venueName: row.venueName,
        student: {
          id: row.studentId,
          displayName: row.studentName,
          studentNumber: row.studentNumber,
          studentNumberVerified: row.studentNumberVerifiedAt != null,
          enrollmentStatus: row.enrollmentStatus,
        },
        kind: row.kind,
        status: row.status,
        statement: row.statement,
        record: row.recordStatus && row.recordMethod && row.recordCheckedInAt
          ? {
              status: row.recordStatus,
              method: row.recordMethod,
              venueOutcome: row.recordVenueOutcome,
              checkedInAt: row.recordCheckedInAt,
              revokedAt: row.recordRevokedAt,
            }
          : null,
        lastCorrection: correction
          ? { action: correction.action, reason: correction.reason, actorName: correction.actorName, createdAt: correction.createdAt }
          : null,
        resolutionNote: row.resolutionNote,
        resolvedByName: row.resolvedByName,
        resolvedAt: row.resolvedAt,
        createdAt: row.createdAt,
      };
    });
  }

  async listLecturerDisputes(input: {
    readonly lecturerUserId: string;
    readonly status: DisputeListStatus;
    readonly courseOfferingId?: string;
  }) {
    const offerings = await this.assignedOfferings(input.lecturerUserId, input.courseOfferingId);
    if (!offerings.length) return { disputes: [], openCount: 0 };
    const institutionId = offerings[0]!.institutionId;
    const scope = and(
      eq(attendanceDisputes.institutionId, institutionId),
      inArray(attendanceDisputes.courseOfferingId, offerings.map((offering) => offering.id)),
    );
    const statusCondition = input.status === 'open'
      ? eq(attendanceDisputes.status, 'open')
      : input.status === 'resolved'
        ? inArray(attendanceDisputes.status, ['upheld', 'rejected', 'withdrawn'])
        : undefined;
    const [disputes, openCount] = await Promise.all([
      this.lecturerDisputeRows(
        this.database,
        and(scope, statusCondition),
        input.status === 'open' ? 'oldest_first' : input.status === 'resolved' ? 'newest_resolved_first' : 'open_first',
        500,
      ),
      this.countOpen(scope),
    ]);
    return { disputes, openCount };
  }

  async getDisputeNoticeContext(disputeId: string): Promise<DisputeNoticeContext | null> {
    const [row] = await this.database
      .select({
        institutionId: attendanceDisputes.institutionId,
        courseOfferingId: attendanceDisputes.courseOfferingId,
        attendanceSessionId: attendanceDisputes.attendanceSessionId,
        courseCode: courses.code,
        sessionTitle: attendanceSessions.title,
        sessionStartsAt: attendanceSessions.startsAt,
        studentEmail: disputeStudents.email,
        studentName: disputeStudents.displayName,
      })
      .from(attendanceDisputes)
      .innerJoin(attendanceSessions, and(
        eq(attendanceDisputes.attendanceSessionId, attendanceSessions.id),
        eq(attendanceDisputes.institutionId, attendanceSessions.institutionId),
      ))
      .innerJoin(courseOfferings, and(
        eq(attendanceDisputes.courseOfferingId, courseOfferings.id),
        eq(attendanceDisputes.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .innerJoin(disputeStudents, eq(attendanceDisputes.studentUserId, disputeStudents.id))
      .where(eq(attendanceDisputes.id, disputeId))
      .limit(1);
    if (!row) return null;

    const [assigned, openForSession] = await Promise.all([
      this.database
        .selectDistinct({ userId: users.id, email: users.email, displayName: users.displayName })
        .from(courseAssignments)
        .innerJoin(users, and(
          eq(courseAssignments.lecturerUserId, users.id),
          eq(courseAssignments.institutionId, users.institutionId),
        ))
        .where(and(
          eq(courseAssignments.courseOfferingId, row.courseOfferingId),
          eq(courseAssignments.institutionId, row.institutionId),
          eq(courseAssignments.assignmentType, 'lecturer'),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
        ))
        .limit(20),
      this.countOpen(eq(attendanceDisputes.attendanceSessionId, row.attendanceSessionId)),
    ]);
    // The per-lecturer count re-applies full access rules (role scope, active department),
    // so a lecturer who can no longer see the dispute counts zero and is not emailed.
    const lecturers = await Promise.all(assigned.map(async (lecturer) => ({
      ...lecturer,
      openDisputeCount: await this.countOpenLecturerDisputes(lecturer.userId),
    })));
    return {
      courseCode: row.courseCode,
      sessionTitle: row.sessionTitle,
      sessionStartsAt: row.sessionStartsAt,
      student: { email: row.studentEmail, displayName: row.studentName },
      lecturers,
      openForSession,
    };
  }

  async countOpenLecturerDisputes(lecturerUserId: string): Promise<number> {
    const offerings = await this.assignedOfferings(lecturerUserId);
    if (!offerings.length) return 0;
    return this.countOpen(and(
      eq(attendanceDisputes.institutionId, offerings[0]!.institutionId),
      inArray(attendanceDisputes.courseOfferingId, offerings.map((offering) => offering.id)),
    ));
  }

  private async countOpen(scope: SQL | undefined): Promise<number> {
    const [open] = await this.database
      .select({ value: count() })
      .from(attendanceDisputes)
      .where(and(scope, eq(attendanceDisputes.status, 'open')));
    return Number(open?.value ?? 0);
  }

  async resolveDispute(input: {
    readonly lecturerUserId: string;
    readonly disputeId: string;
    readonly decision: 'uphold' | 'reject';
    readonly note: string;
    readonly now: Date;
  }): Promise<ResolveDisputeResult> {
    const outcome = await this.database.transaction(async (transaction) => {
      const [target] = await transaction
        .select({ attendanceSessionId: attendanceDisputes.attendanceSessionId })
        .from(attendanceDisputes)
        .where(eq(attendanceDisputes.id, input.disputeId))
        .limit(1);
      if (!target) return { kind: 'not_found' as const };

      // Lock order matches corrections and check-ins: session row first, then
      // the dispute row. The assignment join hides other lecturers' disputes.
      const [session] = await assignedSessionQuery(transaction, input.lecturerUserId, target.attendanceSessionId)
        .for('update', { of: attendanceSessions })
        .limit(1);
      if (!session) return { kind: 'not_found' as const };

      const [dispute] = await transaction
        .select({
          id: attendanceDisputes.id,
          status: attendanceDisputes.status,
          studentUserId: attendanceDisputes.studentUserId,
        })
        .from(attendanceDisputes)
        .where(and(
          eq(attendanceDisputes.id, input.disputeId),
          eq(attendanceDisputes.institutionId, session.institutionId),
        ))
        .for('update')
        .limit(1);
      if (!dispute) return { kind: 'not_found' as const };
      if (dispute.status !== 'open') return { kind: 'not_open' as const };

      let correction: 'applied' | 'unchanged' | null = null;
      if (input.decision === 'uphold') {
        const result = await applyCorrectionInTransaction(transaction, session, {
          actorUserId: input.lecturerUserId,
          studentUserId: dispute.studentUserId,
          action: 'mark_present',
          reason: input.note,
          now: input.now,
          disputeId: dispute.id,
        });
        if (result.kind === 'not_enrolled') return { kind: 'not_enrolled' as const };
        if (result.kind !== 'applied' && result.kind !== 'unchanged') {
          // Unreachable for a started session with a lecturer lock; abort the transaction.
          throw new Error(`Unexpected correction outcome while upholding a dispute: ${result.kind}`);
        }
        correction = result.kind;
      }

      await transaction
        .update(attendanceDisputes)
        .set({
          status: input.decision === 'uphold' ? 'upheld' : 'rejected',
          resolutionNote: input.note,
          resolvedByUserId: input.lecturerUserId,
          resolvedAt: input.now,
        })
        .where(eq(attendanceDisputes.id, dispute.id));
      return { kind: 'resolved' as const, correction };
    });
    if (outcome.kind !== 'resolved') return outcome;
    const [dispute] = await this.lecturerDisputeRows(this.database, eq(attendanceDisputes.id, input.disputeId), 'oldest_first', 1);
    if (!dispute) throw new Error('The resolved dispute could not be read back.');
    return { kind: 'resolved', dispute, correction: outcome.correction };
  }
}
