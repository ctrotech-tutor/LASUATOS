import { aliasedTable, and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  academicSessions,
  buildings,
  campuses,
  classRepresentatives,
  courseAssignments,
  courseEnrollments,
  courseOfferings,
  courses,
  departments,
  faculties,
  lectureAttendance,
  lectureSessions,
  lecturerProfiles,
  semesters,
  studentProfiles,
  users,
  venues,
  type DatabaseClient,
} from '@lasuatos/database';
import { courseCodeKey, type LectureAttendanceMethod, type LectureTakerRole, type LectureVenueOutcome } from '@lasuatos/contracts';
import type {
  AppointClassRepInput,
  ClassRepAppointment,
  ClassRepRecord,
  CreateLectureSessionInput,
  DepartmentOption,
  HeldSessionRecord,
  InsertLectureAttendanceInput,
  InsertLectureAttendanceResult,
  LectureActorRecord,
  LectureAttendeeRecord,
  LectureRepository,
  LectureSessionChanges,
  LectureSessionRecord,
  LectureSessionVisibility,
  LectureVenueRecord,
  RegisterCourseRecord,
  SemesterRecord,
  SessionAttendeeRecord,
  StructureOption,
  StudentIdentityRecord,
  StudentLectureHistoryRecord,
  SummaryEntryCounts,
  SummarySessionRecord,
  EnrolledCoursesSubject,
} from './repository.js';

/** Course code without spaces, upper case — "CSC301" and "csc 301" match. */
const compactCourseCode = sql<string>`upper(regexp_replace(${lectureSessions.courseCode}, '[[:space:]]+', '', 'g'))`;

/** Sessions a user may see: their own, plus their administrative scope. */
function visibleTo(userId: string, visibility: LectureSessionVisibility): SQL | undefined {
  let scope: SQL | undefined;
  if (visibility.type === 'institution') scope = eq(lectureSessions.institutionId, visibility.institutionId);
  if (visibility.type === 'faculty') {
    // Sessions opened by a department administrator carry only the department.
    scope = and(
      eq(lectureSessions.institutionId, visibility.institutionId),
      or(
        eq(lectureSessions.facultyId, visibility.facultyId),
        inArray(
          lectureSessions.departmentId,
          sql`(select ${departments.id} from ${departments} where ${departments.facultyId} = ${visibility.facultyId})`,
        ),
      ),
    );
  }
  if (visibility.type === 'department') {
    scope = and(eq(lectureSessions.institutionId, visibility.institutionId), eq(lectureSessions.departmentId, visibility.departmentId));
  }
  if (visibility.type === 'rep_department') {
    scope = and(
      eq(lectureSessions.institutionId, visibility.institutionId),
      or(
        eq(lectureSessions.departmentId, visibility.departmentId),
        and(
          isNull(lectureSessions.departmentId),
          eq(lectureSessions.facultyId, visibility.facultyId),
          eq(lectureSessions.entryYear, visibility.entryYear),
        ),
      ),
    );
  }
  return scope ? or(eq(lectureSessions.createdByUserId, userId), scope) : eq(lectureSessions.createdByUserId, userId);
}

const creator = aliasedTable(users, 'lecture_creator');
const appointer = aliasedTable(users, 'class_rep_appointer');
const repStudent = aliasedTable(users, 'class_rep_student');

function toNumber(value: string | number | null): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const presentCountSql = sql<number>`(
  select count(*)::int from ${lectureAttendance}
  where ${lectureAttendance.lectureSessionId} = ${lectureSessions.id}
    and ${lectureAttendance.removedAt} is null
)`;

function sessionFields() {
  return {
    id: lectureSessions.id,
    institutionId: lectureSessions.institutionId,
    createdByUserId: lectureSessions.createdByUserId,
    creatorName: creator.displayName,
    creatorRole: lectureSessions.creatorRole,
    courseCode: lectureSessions.courseCode,
    courseTitle: lectureSessions.courseTitle,
    lecturerName: lectureSessions.lecturerName,
    facultyId: lectureSessions.facultyId,
    departmentId: lectureSessions.departmentId,
    entryYear: lectureSessions.entryYear,
    requireVenue: lectureSessions.requireVenue,
    qrMode: lectureSessions.qrMode,
    secret: lectureSessions.secret,
    publicCode: lectureSessions.publicCode,
    startsAt: lectureSessions.startsAt,
    endsAt: lectureSessions.endsAt,
    closedAt: lectureSessions.closedAt,
    presentCount: presentCountSql,
    venueId: venues.id,
    venueCode: venues.code,
    venueName: venues.name,
    venueStatus: venues.status,
    campusName: campuses.name,
    buildingName: buildings.name,
    floorLabel: venues.floorLabel,
    sectionLabel: venues.sectionLabel,
    latitude: venues.latitude,
    longitude: venues.longitude,
    radiusMeters: venues.geofenceRadiusMeters,
  };
}

function sessionQuery(database: DatabaseClient) {
  return database
    .select(sessionFields())
    .from(lectureSessions)
    .innerJoin(creator, eq(creator.id, lectureSessions.createdByUserId))
    .leftJoin(venues, eq(venues.id, lectureSessions.venueId))
    .leftJoin(campuses, eq(campuses.id, venues.campusId))
    .leftJoin(buildings, eq(buildings.id, venues.buildingId));
}

type SessionRow = Awaited<ReturnType<typeof sessionQuery>>[number];

function toSession(row: SessionRow): LectureSessionRecord {
  const venue: LectureVenueRecord | null = row.venueId
    ? {
        id: row.venueId,
        code: row.venueCode ?? '',
        name: row.venueName ?? '',
        campusName: row.campusName ?? null,
        buildingName: row.buildingName ?? null,
        floorLabel: row.floorLabel ?? null,
        sectionLabel: row.sectionLabel ?? null,
        latitude: toNumber(row.latitude ?? null),
        longitude: toNumber(row.longitude ?? null),
        radiusMeters: row.radiusMeters ?? null,
        active: row.venueStatus === 'active',
      }
    : null;
  return {
    id: row.id,
    institutionId: row.institutionId,
    createdByUserId: row.createdByUserId,
    creatorName: row.creatorName,
    creatorRole: row.creatorRole as LectureTakerRole,
    courseCode: row.courseCode,
    courseTitle: row.courseTitle,
    lecturerName: row.lecturerName,
    facultyId: row.facultyId,
    departmentId: row.departmentId,
    entryYear: row.entryYear,
    venue,
    requireVenue: row.requireVenue,
    qrMode: row.qrMode,
    secret: row.secret,
    publicCode: row.publicCode,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    closedAt: row.closedAt,
    presentCount: Number(row.presentCount ?? 0),
  };
}

function attendeeFields() {
  return {
    id: lectureAttendance.id,
    studentUserId: lectureAttendance.studentUserId,
    fullName: lectureAttendance.fullName,
    matricNumber: lectureAttendance.matricNumber,
    method: lectureAttendance.method,
    deviceHash: lectureAttendance.deviceHash,
    distanceMeters: lectureAttendance.distanceMeters,
    venueOutcome: lectureAttendance.venueOutcome,
    createdAt: lectureAttendance.createdAt,
    removedAt: lectureAttendance.removedAt,
    removedReason: lectureAttendance.removedReason,
    addedByName: sql<string | null>`(select ${users.displayName} from ${users} where ${users.id} = ${lectureAttendance.addedByUserId})`,
  };
}

function toMethod(value: string): LectureAttendanceMethod {
  return value === 'code' || value === 'manual' ? value : 'qr';
}

function toAttendee(row: {
  id: string;
  studentUserId: string | null;
  fullName: string;
  matricNumber: string;
  method: string;
  deviceHash: string | null;
  distanceMeters: string | null;
  venueOutcome: string | null;
  createdAt: Date;
  removedAt: Date | null;
  removedReason: string | null;
  addedByName: string | null;
}): LectureAttendeeRecord {
  return {
    id: row.id,
    studentUserId: row.studentUserId,
    fullName: row.fullName,
    matricNumber: row.matricNumber,
    method: toMethod(row.method),
    deviceHash: row.deviceHash,
    distanceMeters: toNumber(row.distanceMeters),
    venueOutcome: (row.venueOutcome as LectureVenueOutcome | null) ?? null,
    createdAt: row.createdAt,
    removedAt: row.removedAt,
    removedReason: row.removedReason,
    addedByName: row.addedByName ?? null,
  };
}

function studentFields() {
  return {
    userId: users.id,
    fullName: users.displayName,
    email: users.email,
    matricNumber: studentProfiles.studentNumber,
    departmentId: studentProfiles.departmentId,
    departmentName: departments.name,
    facultyId: faculties.id,
    facultyName: faculties.name,
    entryYear: studentProfiles.entryYear,
  };
}

export class PostgresLectureRepository implements LectureRepository {
  constructor(private readonly database: DatabaseClient) {}

  #sessionQuery() {
    return sessionQuery(this.database);
  }

  #studentQuery() {
    return this.database
      .select(studentFields())
      .from(users)
      .innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .leftJoin(departments, eq(departments.id, studentProfiles.departmentId))
      .leftJoin(faculties, eq(faculties.id, departments.facultyId));
  }

  async #liveClassRep(userId: string): Promise<ClassRepAppointment | null> {
    const [row] = await this.database
      .select({
        id: classRepresentatives.id,
        role: classRepresentatives.role,
        studentUserId: classRepresentatives.studentUserId,
        facultyId: classRepresentatives.facultyId,
        facultyName: faculties.name,
        departmentId: classRepresentatives.departmentId,
        departmentName: departments.name,
        entryYear: classRepresentatives.entryYear,
      })
      .from(classRepresentatives)
      .innerJoin(faculties, eq(faculties.id, classRepresentatives.facultyId))
      .leftJoin(departments, eq(departments.id, classRepresentatives.departmentId))
      .where(and(eq(classRepresentatives.studentUserId, userId), isNull(classRepresentatives.revokedAt)))
      .limit(1);
    return row ?? null;
  }

  async listSemesters(institutionId: string): Promise<SemesterRecord[]> {
    const rows = await this.database
      .select({
        id: semesters.id,
        name: semesters.name,
        sessionCode: academicSessions.code,
        startsAt: semesters.startsAt,
        endsAt: semesters.endsAt,
      })
      .from(semesters)
      .innerJoin(academicSessions, eq(academicSessions.id, semesters.academicSessionId))
      .where(eq(semesters.institutionId, institutionId))
      .orderBy(desc(semesters.startsAt))
      .limit(200);
    return rows.map((row) => ({ id: row.id, label: `${row.sessionCode} · ${row.name}`, startsAt: row.startsAt, endsAt: row.endsAt }));
  }

  async findActor(userId: string): Promise<LectureActorRecord | null> {
    const [user] = await this.database
      .select({
        id: users.id,
        institutionId: users.institutionId,
        displayName: users.displayName,
        lecturerDepartmentId: lecturerProfiles.departmentId,
        lecturerFacultyId: departments.facultyId,
      })
      .from(users)
      .leftJoin(lecturerProfiles, eq(lecturerProfiles.userId, users.id))
      .leftJoin(departments, eq(departments.id, lecturerProfiles.departmentId))
      .where(and(eq(users.id, userId), eq(users.status, 'active')))
      .limit(1);
    if (!user?.institutionId) return null;
    const [student] = await this.#studentQuery().where(eq(users.id, userId)).limit(1);
    const classRep = student ? await this.#liveClassRep(userId) : null;
    return {
      userId: user.id,
      institutionId: user.institutionId,
      displayName: user.displayName,
      lecturerDepartmentId: user.lecturerDepartmentId ?? null,
      lecturerFacultyId: user.lecturerFacultyId ?? null,
      student: student ?? null,
      classRep,
    };
  }

  async createSession(input: CreateLectureSessionInput): Promise<{ kind: 'created'; id: string } | { kind: 'code_taken' }> {
    const [row] = await this.database
      .insert(lectureSessions)
      .values({
        institutionId: input.institutionId,
        createdByUserId: input.createdByUserId,
        creatorRole: input.creatorRole,
        courseCode: input.courseCode,
        courseTitle: input.courseTitle,
        lecturerName: input.lecturerName,
        facultyId: input.facultyId,
        departmentId: input.departmentId,
        entryYear: input.entryYear,
        venueId: input.venueId,
        requireVenue: input.requireVenue,
        qrMode: input.qrMode,
        secret: input.secret,
        publicCode: input.publicCode,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      })
      .onConflictDoNothing({ target: lectureSessions.publicCode })
      .returning({ id: lectureSessions.id });
    return row ? { kind: 'created', id: row.id } : { kind: 'code_taken' };
  }

  async usesEnrolledCourses(subject: EnrolledCoursesSubject): Promise<boolean> {
    const rows = subject.kind === 'lecturer'
      ? await this.database.select({ id: courseAssignments.id }).from(courseAssignments)
        .where(eq(courseAssignments.lecturerUserId, subject.userId)).limit(1)
      : subject.kind === 'student'
        ? await this.database.select({ id: courseEnrollments.id }).from(courseEnrollments)
          .where(and(eq(courseEnrollments.studentUserId, subject.userId), eq(courseEnrollments.status, 'active'))).limit(1)
        : await this.database.select({ id: courseOfferings.id }).from(courseOfferings)
          .where(eq(courseOfferings.institutionId, subject.institutionId)).limit(1);
    return rows.length > 0;
  }

  async findSession(sessionId: string): Promise<LectureSessionRecord | null> {
    const [row] = await this.#sessionQuery().where(eq(lectureSessions.id, sessionId)).limit(1);
    return row ? toSession(row) : null;
  }

  async findSessionByPublicCode(publicCode: string): Promise<LectureSessionRecord | null> {
    const [row] = await this.#sessionQuery().where(eq(lectureSessions.publicCode, publicCode)).limit(1);
    return row ? toSession(row) : null;
  }

  async listOpenDynamicSessions(now: Date): Promise<LectureSessionRecord[]> {
    const rows = await this.#sessionQuery()
      .where(and(
        eq(lectureSessions.qrMode, 'dynamic'),
        isNull(lectureSessions.closedAt),
        lte(lectureSessions.startsAt, now),
        gt(lectureSessions.endsAt, now),
      ))
      .limit(2000);
    return rows.map(toSession);
  }

  async listSessions(
    userId: string,
    visibility: LectureSessionVisibility,
    limit: number,
    options: { readonly before?: Date | undefined; readonly query?: string | undefined } = {},
  ): Promise<LectureSessionRecord[]> {
    const filters: (SQL | undefined)[] = [visibleTo(userId, visibility)];
    if (options.before) filters.push(lt(lectureSessions.startsAt, options.before));
    const query = options.query?.trim();
    if (query) {
      // "csc 301" matches "CSC 301" and "CSC301"; words also match the title.
      const compact = query.replace(/\s+/g, '').toUpperCase().replace(/[%_\\]/g, '');
      const words = query.replace(/[%_\\]/g, '');
      filters.push(or(
        sql`${compactCourseCode} like ${`%${compact}%`}`,
        ilike(lectureSessions.courseTitle, `%${words}%`),
      ));
    }
    const rows = await this.#sessionQuery()
      .where(and(...filters))
      .orderBy(desc(lectureSessions.startsAt), desc(lectureSessions.id))
      .limit(limit);
    return rows.map(toSession);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const rows = await this.database.delete(lectureSessions).where(eq(lectureSessions.id, sessionId)).returning({ id: lectureSessions.id });
    return rows.length > 0;
  }

  async listSummarySessions(userId: string, visibility: LectureSessionVisibility, since: Date, limit: number): Promise<SummarySessionRecord[]> {
    const rows = await this.database
      .select({
        id: lectureSessions.id,
        courseCode: lectureSessions.courseCode,
        courseTitle: lectureSessions.courseTitle,
        startsAt: lectureSessions.startsAt,
        endsAt: lectureSessions.endsAt,
        closedAt: lectureSessions.closedAt,
        creatorRole: lectureSessions.creatorRole,
        departmentId: lectureSessions.departmentId,
        departmentName: departments.name,
        facultyName: faculties.name,
        presentCount: presentCountSql,
      })
      .from(lectureSessions)
      .leftJoin(departments, eq(departments.id, lectureSessions.departmentId))
      .leftJoin(faculties, eq(faculties.id, lectureSessions.facultyId))
      .where(and(visibleTo(userId, visibility), gte(lectureSessions.startsAt, since)))
      .orderBy(desc(lectureSessions.startsAt))
      .limit(limit);
    return rows.map((row) => ({ ...row, creatorRole: row.creatorRole as LectureTakerRole, presentCount: Number(row.presentCount ?? 0) }));
  }

  async summariseEntries(userId: string, visibility: LectureSessionVisibility, since: Date): Promise<SummaryEntryCounts> {
    const present = isNull(lectureAttendance.removedAt);
    const [row] = await this.database
      .select({
        checkIns: sql<number>`count(*) filter (where ${present})::int`,
        uniqueStudents: sql<number>`count(distinct ${lectureAttendance.matricNumber}) filter (where ${present})::int`,
        guestCheckIns: sql<number>`count(*) filter (where ${present} and ${lectureAttendance.studentUserId} is null)::int`,
        manualCheckIns: sql<number>`count(*) filter (where ${present} and ${lectureAttendance.method} = 'manual')::int`,
        removedEntries: sql<number>`count(*) filter (where ${lectureAttendance.removedAt} is not null)::int`,
        sharedDeviceEntries: sql<number>`count(*) filter (where ${present} and ${lectureAttendance.deviceHash} is not null and exists (
          select 1 from lecture_attendance shared_device
          where shared_device.lecture_session_id = ${lectureAttendance.lectureSessionId}
            and shared_device.device_hash = ${lectureAttendance.deviceHash}
            and shared_device.id <> ${lectureAttendance.id}
        ))::int`,
      })
      .from(lectureAttendance)
      .innerJoin(lectureSessions, eq(lectureSessions.id, lectureAttendance.lectureSessionId))
      .where(and(visibleTo(userId, visibility), gte(lectureSessions.startsAt, since)));
    return {
      checkIns: Number(row?.checkIns ?? 0),
      uniqueStudents: Number(row?.uniqueStudents ?? 0),
      guestCheckIns: Number(row?.guestCheckIns ?? 0),
      manualCheckIns: Number(row?.manualCheckIns ?? 0),
      removedEntries: Number(row?.removedEntries ?? 0),
      sharedDeviceEntries: Number(row?.sharedDeviceEntries ?? 0),
    };
  }

  async isSessionVisible(sessionId: string, userId: string, visibility: LectureSessionVisibility): Promise<boolean> {
    const [row] = await this.database
      .select({ id: lectureSessions.id })
      .from(lectureSessions)
      .where(and(eq(lectureSessions.id, sessionId), visibleTo(userId, visibility)))
      .limit(1);
    return Boolean(row);
  }

  async listRegisterCourses(userId: string, visibility: LectureSessionVisibility, now: Date): Promise<RegisterCourseRecord[]> {
    const rows = await this.database
      .select({
        // Codes typed with and without spaces are one course; show the latest spelling.
        courseCode: sql<string>`(array_agg(${lectureSessions.courseCode} order by ${lectureSessions.startsAt} desc))[1]`,
        // The most recent title wins if it was typed differently over time.
        courseTitle: sql<string>`(array_agg(${lectureSessions.courseTitle} order by ${lectureSessions.startsAt} desc))[1]`,
        sessionCount: sql<number>`count(*)::int`,
        lastHeldAt: sql<Date>`max(${lectureSessions.startsAt})`,
      })
      .from(lectureSessions)
      .where(and(visibleTo(userId, visibility), lte(lectureSessions.startsAt, now)))
      .groupBy(compactCourseCode)
      .orderBy(sql`max(${lectureSessions.startsAt}) desc`)
      .limit(500);
    return rows.map((row) => ({
      courseCode: row.courseCode,
      courseTitle: row.courseTitle,
      sessionCount: Number(row.sessionCount),
      lastHeldAt: row.lastHeldAt instanceof Date ? row.lastHeldAt : new Date(row.lastHeldAt),
    }));
  }

  async listCourseSessions(
    userId: string,
    visibility: LectureSessionVisibility,
    courseCode: string,
    now: Date,
    limit: number,
  ): Promise<LectureSessionRecord[]> {
    const rows = await this.#sessionQuery()
      .where(and(visibleTo(userId, visibility), eq(compactCourseCode, courseCodeKey(courseCode)), lte(lectureSessions.startsAt, now)))
      .orderBy(asc(lectureSessions.startsAt))
      .limit(limit);
    return rows.map(toSession);
  }

  async listAttendeesForSessions(sessionIds: readonly string[]): Promise<SessionAttendeeRecord[]> {
    if (sessionIds.length === 0) return [];
    const rows = await this.database
      .select({ ...attendeeFields(), lectureSessionId: lectureAttendance.lectureSessionId })
      .from(lectureAttendance)
      .where(and(inArray(lectureAttendance.lectureSessionId, [...sessionIds]), isNull(lectureAttendance.removedAt)))
      .orderBy(asc(lectureAttendance.createdAt))
      .limit(100_000);
    return rows.map((row) => ({ ...toAttendee(row), lectureSessionId: row.lectureSessionId }));
  }

  async updateSession(sessionId: string, changes: LectureSessionChanges): Promise<void> {
    await this.database
      .update(lectureSessions)
      .set({
        ...(changes.qrMode ? { qrMode: changes.qrMode } : {}),
        ...(changes.endsAt ? { endsAt: changes.endsAt } : {}),
        ...(changes.closedAt !== undefined ? { closedAt: changes.closedAt } : {}),
        ...(changes.courseCode !== undefined ? { courseCode: changes.courseCode } : {}),
        ...(changes.courseTitle !== undefined ? { courseTitle: changes.courseTitle } : {}),
        ...(changes.lecturerName !== undefined ? { lecturerName: changes.lecturerName } : {}),
        ...(changes.venueId !== undefined ? { venueId: changes.venueId } : {}),
        ...(changes.requireVenue !== undefined ? { requireVenue: changes.requireVenue } : {}),
        updatedAt: changes.now,
      })
      .where(eq(lectureSessions.id, sessionId));
  }

  async listAttendees(sessionId: string): Promise<LectureAttendeeRecord[]> {
    const rows = await this.database
      .select(attendeeFields())
      .from(lectureAttendance)
      .where(eq(lectureAttendance.lectureSessionId, sessionId))
      .orderBy(asc(lectureAttendance.createdAt))
      .limit(5000);
    return rows.map(toAttendee);
  }

  async findAttendanceByStudent(sessionId: string, studentUserId: string): Promise<LectureAttendeeRecord | null> {
    const [row] = await this.database
      .select(attendeeFields())
      .from(lectureAttendance)
      .where(and(eq(lectureAttendance.lectureSessionId, sessionId), eq(lectureAttendance.studentUserId, studentUserId)))
      .limit(1);
    return row ? toAttendee(row) : null;
  }

  async insertAttendance(input: InsertLectureAttendanceInput): Promise<InsertLectureAttendanceResult> {
    const [inserted] = await this.database
      .insert(lectureAttendance)
      .values({
        institutionId: input.institutionId,
        lectureSessionId: input.lectureSessionId,
        studentUserId: input.studentUserId,
        fullName: input.fullName,
        matricNumber: input.matricNumber,
        method: input.method,
        deviceHash: input.deviceHash,
        latitude: input.latitude == null ? null : String(input.latitude),
        longitude: input.longitude == null ? null : String(input.longitude),
        accuracyMeters: input.accuracyMeters == null ? null : String(Math.min(input.accuracyMeters, 999_999)),
        distanceMeters: input.distanceMeters == null ? null : String(Math.min(input.distanceMeters, 99_999_999)),
        venueOutcome: input.venueOutcome,
        addedByUserId: input.addedByUserId ?? null,
        createdAt: input.now,
      })
      .onConflictDoNothing({ target: [lectureAttendance.lectureSessionId, lectureAttendance.matricNumber] })
      .returning(attendeeFields());
    if (inserted) return { kind: 'inserted', record: toAttendee(inserted) };

    const [existing] = await this.database
      .select(attendeeFields())
      .from(lectureAttendance)
      .where(and(
        eq(lectureAttendance.lectureSessionId, input.lectureSessionId),
        eq(lectureAttendance.matricNumber, input.matricNumber),
      ))
      .limit(1);
    if (!existing) throw new Error('Lecture attendance conflict without an existing row.');
    // A signed-in student claims the entry someone typed for their matric number earlier.
    if (input.studentUserId && !existing.studentUserId) {
      await this.database
        .update(lectureAttendance)
        .set({ studentUserId: input.studentUserId })
        .where(and(eq(lectureAttendance.id, existing.id), isNull(lectureAttendance.studentUserId)));
    }
    return { kind: 'duplicate', record: toAttendee(existing) };
  }

  async correctAttendee(input: {
    sessionId: string;
    attendeeId: string;
    fullName: string;
    matricNumber: string;
    studentUserId: string | null;
  }): Promise<'corrected' | 'not_found' | 'matric_taken'> {
    const [clash] = await this.database
      .select({ id: lectureAttendance.id })
      .from(lectureAttendance)
      .where(and(
        eq(lectureAttendance.lectureSessionId, input.sessionId),
        eq(lectureAttendance.matricNumber, input.matricNumber),
        sql`${lectureAttendance.id} <> ${input.attendeeId}`,
      ))
      .limit(1);
    if (clash) return 'matric_taken';
    try {
      const rows = await this.database
        .update(lectureAttendance)
        .set({ fullName: input.fullName, matricNumber: input.matricNumber, studentUserId: input.studentUserId })
        .where(and(
          eq(lectureAttendance.id, input.attendeeId),
          eq(lectureAttendance.lectureSessionId, input.sessionId),
          isNull(lectureAttendance.studentUserId),
        ))
        .returning({ id: lectureAttendance.id });
      return rows.length > 0 ? 'corrected' : 'not_found';
    } catch (error) {
      // Two corrections racing to the same matric number.
      if ((error as { code?: string; cause?: { code?: string } }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505') {
        return 'matric_taken';
      }
      throw error;
    }
  }

  async setAttendeeRemoved(input: {
    sessionId: string;
    attendeeId: string;
    removedByUserId: string | null;
    reason: string | null;
    removedAt: Date | null;
  }): Promise<boolean> {
    const rows = await this.database
      .update(lectureAttendance)
      .set({ removedAt: input.removedAt, removedByUserId: input.removedByUserId, removedReason: input.reason })
      .where(and(eq(lectureAttendance.id, input.attendeeId), eq(lectureAttendance.lectureSessionId, input.sessionId)))
      .returning({ id: lectureAttendance.id });
    return rows.length > 0;
  }

  async listStudentHistory(input: { institutionId: string; studentUserId: string; matricNumber: string }): Promise<StudentLectureHistoryRecord[]> {
    const rows = await this.database
      .select({
        id: lectureAttendance.id,
        courseCode: lectureSessions.courseCode,
        courseTitle: lectureSessions.courseTitle,
        createdAt: lectureAttendance.createdAt,
        method: lectureAttendance.method,
        venueName: venues.name,
        removedAt: lectureAttendance.removedAt,
        lectureSessionId: lectureAttendance.lectureSessionId,
        sessionCreatorUserId: lectureSessions.createdByUserId,
      })
      .from(lectureAttendance)
      .innerJoin(lectureSessions, eq(lectureSessions.id, lectureAttendance.lectureSessionId))
      .leftJoin(venues, eq(venues.id, lectureSessions.venueId))
      .where(and(
        eq(lectureAttendance.institutionId, input.institutionId),
        or(eq(lectureAttendance.studentUserId, input.studentUserId), eq(lectureAttendance.matricNumber, input.matricNumber)),
      ))
      .orderBy(desc(lectureAttendance.createdAt))
      .limit(500);
    return rows.map((row) => ({
      id: row.id,
      courseCode: row.courseCode,
      courseTitle: row.courseTitle,
      createdAt: row.createdAt,
      method: toMethod(row.method),
      venueName: row.venueName ?? null,
      removed: row.removedAt != null,
      lectureSessionId: row.lectureSessionId,
      sessionCreatorUserId: row.sessionCreatorUserId,
    }));
  }

  async listHeldSessions(institutionId: string, creatorUserIds: readonly string[], now: Date): Promise<HeldSessionRecord[]> {
    if (creatorUserIds.length === 0) return [];
    return this.database
      .select({ id: lectureSessions.id, courseCode: lectureSessions.courseCode, createdByUserId: lectureSessions.createdByUserId, startsAt: lectureSessions.startsAt })
      .from(lectureSessions)
      .where(and(
        eq(lectureSessions.institutionId, institutionId),
        inArray(lectureSessions.createdByUserId, [...creatorUserIds]),
        lte(lectureSessions.startsAt, now),
      ))
      .limit(20_000);
  }

  async listCourseSuggestions(institutionId: string, userId: string): Promise<Array<{ courseCode: string; courseTitle: string }>> {
    const recent = await this.database
      .select({ courseCode: lectureSessions.courseCode, courseTitle: lectureSessions.courseTitle, last: sql<Date>`max(${lectureSessions.startsAt})` })
      .from(lectureSessions)
      .where(eq(lectureSessions.createdByUserId, userId))
      .groupBy(lectureSessions.courseCode, lectureSessions.courseTitle)
      .orderBy(desc(sql`max(${lectureSessions.startsAt})`))
      .limit(50);
    const catalogue = await this.database
      .select({ courseCode: courses.code, courseTitle: courses.title })
      .from(courses)
      .where(eq(courses.institutionId, institutionId))
      .orderBy(asc(courses.code))
      .limit(400);
    const seen = new Set<string>();
    const out: Array<{ courseCode: string; courseTitle: string }> = [];
    for (const item of [...recent, ...catalogue]) {
      const key = item.courseCode.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ courseCode: item.courseCode, courseTitle: item.courseTitle });
      if (out.length >= 500) break;
    }
    return out;
  }

  async listVenues(institutionId: string): Promise<LectureVenueRecord[]> {
    const rows = await this.database
      .select({
        id: venues.id,
        code: venues.code,
        name: venues.name,
        campusName: campuses.name,
        buildingName: buildings.name,
        floorLabel: venues.floorLabel,
        sectionLabel: venues.sectionLabel,
        latitude: venues.latitude,
        longitude: venues.longitude,
        radiusMeters: venues.geofenceRadiusMeters,
        status: venues.status,
      })
      .from(venues)
      .innerJoin(campuses, eq(campuses.id, venues.campusId))
      .leftJoin(buildings, eq(buildings.id, venues.buildingId))
      .where(eq(venues.institutionId, institutionId))
      .orderBy(asc(campuses.name), asc(venues.code))
      .limit(1000);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      campusName: row.campusName,
      buildingName: row.buildingName ?? null,
      floorLabel: row.floorLabel,
      sectionLabel: row.sectionLabel,
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
      radiusMeters: row.radiusMeters,
      active: row.status === 'active',
    }));
  }

  async listFaculties(institutionId: string): Promise<StructureOption[]> {
    return this.database
      .select({ id: faculties.id, name: faculties.name })
      .from(faculties)
      .where(eq(faculties.institutionId, institutionId))
      .orderBy(asc(faculties.name))
      .limit(200);
  }

  async listDepartments(institutionId: string): Promise<DepartmentOption[]> {
    return this.database
      .select({ id: departments.id, name: departments.name, facultyId: faculties.id, facultyName: faculties.name })
      .from(departments)
      .innerJoin(faculties, eq(faculties.id, departments.facultyId))
      .where(eq(departments.institutionId, institutionId))
      .orderBy(asc(faculties.name), asc(departments.name))
      .limit(1000);
  }

  async findStudentForAppointment(institutionId: string, query: string): Promise<StudentIdentityRecord | null> {
    const email = query.toLowerCase();
    const matric = query.replace(/\s+/g, '').toUpperCase();
    const [row] = await this.#studentQuery()
      .where(and(
        eq(users.institutionId, institutionId),
        eq(users.status, 'active'),
        or(
          sql`lower(${users.email}) = ${email}`,
          sql`upper(replace(${studentProfiles.studentNumber}, ' ', '')) = ${matric}`,
        ),
      ))
      .limit(1);
    return row ?? null;
  }

  async findStudentByUserId(institutionId: string, userId: string): Promise<StudentIdentityRecord | null> {
    const [row] = await this.#studentQuery()
      .where(and(eq(users.institutionId, institutionId), eq(users.id, userId), eq(users.status, 'active')))
      .limit(1);
    return row ?? null;
  }

  #classRepQuery() {
    return this.database
      .select({
        id: classRepresentatives.id,
        role: classRepresentatives.role,
        studentUserId: classRepresentatives.studentUserId,
        facultyId: classRepresentatives.facultyId,
        facultyName: faculties.name,
        departmentId: classRepresentatives.departmentId,
        departmentName: departments.name,
        entryYear: classRepresentatives.entryYear,
        studentName: repStudent.displayName,
        email: repStudent.email,
        matricNumber: studentProfiles.studentNumber,
        appointedAt: classRepresentatives.createdAt,
        appointedByName: appointer.displayName,
      })
      .from(classRepresentatives)
      .innerJoin(repStudent, eq(repStudent.id, classRepresentatives.studentUserId))
      .innerJoin(appointer, eq(appointer.id, classRepresentatives.appointedByUserId))
      .innerJoin(faculties, eq(faculties.id, classRepresentatives.facultyId))
      .leftJoin(departments, eq(departments.id, classRepresentatives.departmentId))
      .leftJoin(studentProfiles, eq(studentProfiles.userId, classRepresentatives.studentUserId));
  }

  #toClassRep(row: Awaited<ReturnType<PostgresLectureRepository['listClassRepRows']>>[number]): ClassRepRecord {
    return { ...row, matricNumber: row.matricNumber ?? '' };
  }

  private listClassRepRows(institutionId: string) {
    return this.#classRepQuery()
      .where(and(eq(classRepresentatives.institutionId, institutionId), isNull(classRepresentatives.revokedAt)))
      .orderBy(asc(faculties.name), desc(classRepresentatives.entryYear), asc(classRepresentatives.role), asc(departments.name))
      .limit(2000);
  }

  async listClassReps(institutionId: string): Promise<ClassRepRecord[]> {
    const rows = await this.listClassRepRows(institutionId);
    return rows.map((row) => this.#toClassRep(row));
  }

  async findClassRep(institutionId: string, id: string): Promise<ClassRepRecord | null> {
    const [row] = await this.#classRepQuery()
      .where(and(
        eq(classRepresentatives.institutionId, institutionId),
        eq(classRepresentatives.id, id),
        isNull(classRepresentatives.revokedAt),
      ))
      .limit(1);
    return row ? this.#toClassRep(row) : null;
  }

  async appointClassRep(input: AppointClassRepInput): Promise<string> {
    return this.database.transaction(async (transaction) => {
      await transaction
        .update(classRepresentatives)
        .set({ revokedAt: input.now, revokedByUserId: input.appointedByUserId })
        .where(and(eq(classRepresentatives.studentUserId, input.studentUserId), isNull(classRepresentatives.revokedAt)));
      const [row] = await transaction
        .insert(classRepresentatives)
        .values({
          institutionId: input.institutionId,
          studentUserId: input.studentUserId,
          role: input.role,
          facultyId: input.facultyId,
          departmentId: input.departmentId,
          entryYear: input.entryYear,
          appointedByUserId: input.appointedByUserId,
          createdAt: input.now,
        })
        .returning({ id: classRepresentatives.id });
      if (!row) throw new Error('Class representative insert returned no row.');
      return row.id;
    });
  }

  async revokeClassRep(input: { id: string; revokedByUserId: string; now: Date }): Promise<boolean> {
    const rows = await this.database
      .update(classRepresentatives)
      .set({ revokedAt: input.now, revokedByUserId: input.revokedByUserId })
      .where(and(eq(classRepresentatives.id, input.id), isNull(classRepresentatives.revokedAt)))
      .returning({ id: classRepresentatives.id });
    return rows.length > 0;
  }
}

