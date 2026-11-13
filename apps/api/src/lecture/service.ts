import { createHash } from 'node:crypto';
import {
  academicSetLabel,
  courseCodeKey,
  entryYearFromMatric,
  type AppointClassRepRequest,
  type ClassRep,
  type ClassRepList,
  type ClassRepStudent,
  type CreateLectureSessionRequestSchema,
  type LectureAttendee,
  type LectureCapabilities,
  type LectureCheckInResult,
  type LectureCourseSuggestions,
  type LectureQrFrame,
  type LectureRegister,
  type LectureRegisterCourses,
  type LectureRegisterTerm,
  type LectureSessionDetail,
  type LectureAttendanceSummary,
  type LectureSessionList,
  type LectureSessionSummary,
  type LectureTakerRole,
  type LectureVenueOptions,
  type LectureVenueOutcome,
  type ResolvedLecture,
  type StudentLectureHistory,
  type UpdateLectureSessionRequestSchema,
  type CheckInLocationSample,
} from '@lasuatos/contracts';
import {
  CHECK_IN_TICKET_SECONDS,
  PUBLIC_CODE_LENGTH,
  ROTATING_CODE_LENGTH,
  createCheckInTicket,
  createLectureQrFrame,
  generatePublicCode,
  generateSessionSecret,
  matchRotatingCode,
  normalizeAttendanceCode,
  parseCheckInTicket,
  parseLectureChallenge,
  verifyCheckInTicket,
  verifyLectureChallenge,
} from '@lasuatos/verification';
import {
  evaluatePresence,
  formatAccuracy,
  formatMeters,
  type PresenceEvaluation,
  type VenueArea,
} from '@lasuatos/verification/venue-area';
import type { z } from 'zod';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type {
  LectureSessionChanges,
  ClassRepAppointment,
  ClassRepRecord,
  LectureActorRecord,
  LectureAttendeeRecord,
  LectureRepository,
  LectureSessionRecord,
  SemesterRecord,
  LectureSessionVisibility,
  LectureVenueRecord,
  StudentIdentityRecord,
  StudentLectureHistoryRecord,
} from './repository.js';

/** A failure whose message is written for the person in front of the screen. */
export class LectureError extends Error {
  readonly exposeDetail = true;
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'LectureError';
  }
}

const notFound = () => new LectureError(404, 'That attendance session was not found.');
const cannotTake = () => new LectureError(403, 'Only lecturers, administrators and class representatives (HOC or GHOC) can take attendance.');
const cannotManageReps = () => new LectureError(403, 'Only administrators and GHOCs can appoint class representatives.');

type CreateInput = z.output<typeof CreateLectureSessionRequestSchema>;
type UpdateInput = z.output<typeof UpdateLectureSessionRequestSchema>;

export interface LectureCheckInInput {
  readonly ticket: string;
  readonly fullName?: string | undefined;
  readonly matricNumber?: string | undefined;
  readonly deviceToken?: string | undefined;
  readonly location?: CheckInLocationSample | undefined;
}

interface RepScope {
  readonly institutionId: string;
  readonly facultyIds: ReadonlySet<string> | null;
  readonly departmentIds: ReadonlySet<string> | null;
  readonly canAppointGhoc: boolean;
  readonly fixedEntryYear: number | null;
  readonly onlyHoc: boolean;
}

interface Taker {
  readonly role: LectureTakerRole;
  readonly actor: LectureActorRecord;
  readonly account: AuthenticatedAccount;
}

function repLabel(rep: ClassRepAppointment): string {
  return rep.role === 'ghoc'
    ? `GHOC · ${rep.facultyName} · ${academicSetLabel(rep.entryYear)}`
    : `HOC · ${rep.departmentName ?? rep.facultyName} · ${academicSetLabel(rep.entryYear)}`;
}

function deviceHash(sessionId: string, token: string | undefined): string | null {
  return token ? createHash('sha256').update(`${sessionId.toLowerCase()}:${token}`).digest('hex') : null;
}

function matricKey(matric: string): string {
  return matric.replace(/\s+/g, '').toUpperCase();
}

/** Whether an existing entry is the same student as the one checking in now. */
function samePerson(record: LectureAttendeeRecord, identity: { readonly studentUserId: string | null; readonly matricNumber: string }): boolean {
  if (record.studentUserId && identity.studentUserId) return record.studentUserId === identity.studentUserId;
  return matricKey(record.matricNumber) === matricKey(identity.matricNumber);
}

type BoundedVenue = LectureVenueRecord & { latitude: number; longitude: number; radiusMeters: number };

function hasBoundary(venue: LectureVenueRecord | null): venue is BoundedVenue {
  return Boolean(venue && venue.latitude != null && venue.longitude != null && venue.radiusMeters != null);
}

/** The venue's shape (its outline, or else its circle) and allowance. */
function venueArea(venue: BoundedVenue): VenueArea {
  return {
    shape: venue.outline
      ? { kind: 'outline', points: venue.outline }
      : { kind: 'circle', center: { latitude: venue.latitude, longitude: venue.longitude }, radiusMeters: venue.radiusMeters },
    allowanceMeters: venue.allowanceMeters,
  };
}

export class LectureService {
  readonly #repository: LectureRepository;
  readonly #now: () => Date;

  constructor(options: { readonly repository: LectureRepository; readonly now?: () => Date }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  /* ---------------- who may do what ---------------- */

  async #actor(account: AuthenticatedAccount): Promise<LectureActorRecord> {
    const actor = await this.#repository.findActor(account.id);
    if (!actor) throw new LectureError(403, 'This account cannot be used here.');
    return actor;
  }

  async #taker(account: AuthenticatedAccount): Promise<Taker> {
    const actor = await this.#actor(account);
    if (account.accountType === 'administrator') return { role: 'administrator', actor, account };
    if (account.accountType === 'lecturer') return { role: 'lecturer', actor, account };
    if (actor.classRep) return { role: actor.classRep.role, actor, account };
    throw cannotTake();
  }

  async capabilities(account: AuthenticatedAccount): Promise<LectureCapabilities> {
    if (account.accountType === 'administrator') {
      return {
        canTakeAttendance: true,
        role: 'administrator',
        roleLabel: `Administrator · ${account.scope.label}`,
        canManageClassReps: true,
        attendanceScopeLabel: account.scope.label,
        usesEnrolledCourses: await this.#repository.usesEnrolledCourses({ kind: 'institution', institutionId: account.institutionId }),
      };
    }
    if (account.accountType === 'lecturer') {
      return {
        canTakeAttendance: true,
        role: 'lecturer',
        roleLabel: 'Lecturer',
        canManageClassReps: false,
        attendanceScopeLabel: null,
        usesEnrolledCourses: await this.#repository.usesEnrolledCourses({ kind: 'lecturer', userId: account.id }),
      };
    }
    // Students need "My courses" once they are enrolled, or once any lecturer has
    // created a course offering they might be given an enrollment code for.
    const [actor, enrolled] = await Promise.all([
      this.#repository.findActor(account.id),
      this.#repository.usesEnrolledCourses({ kind: 'student', userId: account.id }),
    ]);
    const usesEnrolledCourses = enrolled
      || (actor != null && await this.#repository.usesEnrolledCourses({ kind: 'institution', institutionId: actor.institutionId }));
    const rep = actor?.classRep ?? null;
    if (!rep) return { canTakeAttendance: false, role: null, roleLabel: null, canManageClassReps: false, attendanceScopeLabel: null, usesEnrolledCourses };
    return {
      canTakeAttendance: true,
      role: rep.role,
      roleLabel: repLabel(rep),
      canManageClassReps: rep.role === 'ghoc',
      attendanceScopeLabel: rep.role === 'ghoc' ? rep.facultyName : (rep.departmentName ?? rep.facultyName),
      usesEnrolledCourses,
    };
  }

  #visibility(account: AuthenticatedAccount): LectureSessionVisibility {
    if (account.accountType !== 'administrator') return { type: 'own' };
    const scope = account.scope;
    if (scope.type === 'institution') return { type: 'institution', institutionId: account.institutionId };
    if (scope.type === 'faculty') return { type: 'faculty', institutionId: account.institutionId, facultyId: scope.id };
    return { type: 'department', institutionId: account.institutionId, departmentId: scope.id };
  }

  /**
   * Sessions a person can see. Administrators see their scope; a HOC sees
   * their department (and their GHOC's sessions for the same set); a GHOC sees
   * their faculty. Class representatives can only change sessions they took.
   */
  #viewVisibility(account: AuthenticatedAccount, actor: LectureActorRecord): LectureSessionVisibility {
    const rep = actor.classRep;
    if (account.accountType === 'student' && rep) {
      if (rep.role === 'ghoc') return { type: 'faculty', institutionId: actor.institutionId, facultyId: rep.facultyId };
      if (rep.departmentId) {
        return {
          type: 'rep_department',
          institutionId: actor.institutionId,
          facultyId: rep.facultyId,
          departmentId: rep.departmentId,
          entryYear: rep.entryYear,
        };
      }
    }
    return this.#visibility(account);
  }

  #canManage(account: AuthenticatedAccount, session: LectureSessionRecord): boolean {
    if (session.createdByUserId === account.id) return true;
    const visibility = this.#visibility(account);
    switch (visibility.type) {
      case 'institution':
        return session.institutionId === visibility.institutionId;
      case 'faculty':
        return session.institutionId === visibility.institutionId && session.facultyId === visibility.facultyId;
      case 'department':
        return session.institutionId === visibility.institutionId && session.departmentId === visibility.departmentId;
      default:
        return false;
    }
  }

  async #managedSession(account: AuthenticatedAccount, sessionId: string): Promise<LectureSessionRecord> {
    const session = await this.#repository.findSession(sessionId);
    if (!session || !this.#canManage(account, session)) throw notFound();
    return session;
  }

  /* ---------------- sessions ---------------- */

  #status(session: LectureSessionRecord, now: Date): 'open' | 'closed' {
    if (session.closedAt && session.closedAt <= now) return 'closed';
    return now >= session.startsAt && now < session.endsAt ? 'open' : 'closed';
  }

  #summary(session: LectureSessionRecord, now: Date, canManage = true): LectureSessionSummary {
    return {
      id: session.id,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      lecturerName: session.lecturerName,
      creatorName: session.creatorName,
      creatorRole: session.creatorRole,
      venueId: session.venue?.id ?? null,
      venueName: session.venue?.name ?? null,
      requireVenue: session.requireVenue,
      qrMode: session.qrMode,
      publicCode: session.publicCode,
      startsAt: session.startsAt.toISOString(),
      endsAt: (session.closedAt && session.closedAt < session.endsAt ? session.closedAt : session.endsAt).toISOString(),
      status: this.#status(session, now),
      presentCount: session.presentCount,
      canManage,
    };
  }

  async createSession(account: AuthenticatedAccount, input: CreateInput): Promise<LectureSessionSummary> {
    const taker = await this.#taker(account);
    const { actor } = taker;
    const now = this.#now();

    let venueId: string | null = null;
    let requireVenue = false;
    if (input.venueId) {
      const venue = (await this.#repository.listVenues(actor.institutionId)).find((item) => item.id === input.venueId && item.active);
      if (!venue) throw new LectureError(422, 'That venue is not available. Pick another venue or leave it empty.');
      venueId = venue.id;
      if (input.requireVenue) {
        if (!hasBoundary(venue)) throw new LectureError(422, `The location of ${venue.name} has not been registered yet, so it cannot be checked. Turn off "Students must be in the venue".`);
        requireVenue = true;
      }
    } else if (input.requireVenue) {
      throw new LectureError(422, 'Pick a venue to check that students are in the room.');
    }

    let facultyId: string | null = null;
    let departmentId: string | null = null;
    let entryYear: number | null = null;
    if (taker.role === 'ghoc' || taker.role === 'hoc') {
      facultyId = actor.classRep?.facultyId ?? null;
      departmentId = actor.classRep?.departmentId ?? null;
      entryYear = actor.classRep?.entryYear ?? null;
    } else if (taker.role === 'lecturer') {
      facultyId = actor.lecturerFacultyId;
      departmentId = actor.lecturerDepartmentId;
    } else if (account.accountType === 'administrator') {
      if (account.scope.type === 'faculty') facultyId = account.scope.id;
      if (account.scope.type === 'department') departmentId = account.scope.id;
    }

    const lecturerName = input.lecturerName ?? (taker.role === 'lecturer' ? actor.displayName : null);
    const endsAt = new Date(now.getTime() + input.durationMinutes * 60_000);
    const secret = generateSessionSecret();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await this.#repository.createSession({
        institutionId: actor.institutionId,
        createdByUserId: account.id,
        creatorRole: taker.role,
        courseCode: input.courseCode,
        courseTitle: input.courseTitle,
        lecturerName,
        facultyId,
        departmentId,
        entryYear,
        venueId,
        requireVenue,
        qrMode: input.qrMode,
        secret,
        publicCode: generatePublicCode(),
        startsAt: now,
        endsAt,
      });
      if (result.kind === 'created') {
        const session = await this.#repository.findSession(result.id);
        if (!session) throw notFound();
        return this.#summary(session, now);
      }
    }
    throw new LectureError(503, 'Could not create the session. Try again.');
  }

  async listSessions(
    account: AuthenticatedAccount,
    query: { readonly before?: string | undefined; readonly q?: string | undefined } = {},
  ): Promise<LectureSessionList> {
    const { actor } = await this.#taker(account);
    const now = this.#now();
    const pageSize = 60;
    const sessions = await this.#repository.listSessions(account.id, this.#viewVisibility(account, actor), pageSize + 1, {
      before: query.before ? new Date(query.before) : undefined,
      query: query.q,
    });
    return {
      sessions: sessions.slice(0, pageSize).map((session) => this.#summary(session, now, this.#canManage(account, session))),
      hasMore: sessions.length > pageSize,
    };
  }

  /**
   * Deletes a session opened by mistake, with its attendance list. When anyone
   * is on the list the course code must be typed back, so a real class is not
   * wiped by a slip.
   */
  async deleteSession(account: AuthenticatedAccount, sessionId: string, input: { readonly confirmCourseCode?: string | undefined }): Promise<void> {
    const session = await this.#managedSession(account, sessionId);
    if (session.presentCount > 0) {
      const typed = (input.confirmCourseCode ?? '').replace(/\s+/g, '').toUpperCase();
      if (typed !== session.courseCode.replace(/\s+/g, '').toUpperCase()) {
        throw new LectureError(422, `Type ${session.courseCode} to confirm. ${session.presentCount} student${session.presentCount === 1 ? '' : 's'} will be taken off the register.`);
      }
    }
    if (!(await this.#repository.deleteSession(session.id))) throw notFound();
  }

  /** Attendance across every session the person can see, for dashboards. */
  async summary(account: AuthenticatedAccount, days: number): Promise<LectureAttendanceSummary> {
    const { actor } = await this.#taker(account);
    const visibility = this.#viewVisibility(account, actor);
    const now = this.#now();
    const lagos = (date: Date) => new Date(date.getTime() + 3_600_000).toISOString().slice(0, 10);
    // Midnight in Lagos (UTC+1, no daylight saving), `days - 1` days ago.
    const today = lagos(now);
    const since = new Date(Date.parse(`${today}T00:00:00+01:00`) - (days - 1) * 86_400_000);
    const [sessions, entries] = await Promise.all([
      this.#repository.listSummarySessions(account.id, visibility, since, 20_000),
      this.#repository.summariseEntries(account.id, visibility, since),
    ]);

    const daily = new Map<string, { sessions: number; checkIns: number }>();
    for (let index = 0; index < days; index += 1) daily.set(lagos(new Date(since.getTime() + index * 86_400_000 + 3_600_000)), { sessions: 0, checkIns: 0 });
    const departments = new Map<string, { id: string | null; name: string; sessions: number; checkIns: number }>();
    const courses = new Map<string, { courseCode: string; courseTitle: string; sessions: number; checkIns: number; lastHeldAt: Date }>();
    const takers = { lecturer: 0, ghoc: 0, hoc: 0, administrator: 0 };
    let openNow = 0;
    for (const session of sessions) {
      const day = daily.get(lagos(session.startsAt));
      if (day) { day.sessions += 1; day.checkIns += session.presentCount; }
      const departmentKey = session.departmentId ?? `faculty:${session.facultyName ?? ''}`;
      const department = departments.get(departmentKey) ?? {
        id: session.departmentId,
        name: session.departmentName ?? (session.facultyName ? `${session.facultyName} (whole faculty)` : 'No department'),
        sessions: 0,
        checkIns: 0,
      };
      department.sessions += 1;
      department.checkIns += session.presentCount;
      departments.set(departmentKey, department);
      const courseKey = session.courseCode.replace(/\s+/g, '').toUpperCase();
      const course = courses.get(courseKey) ?? { courseCode: session.courseCode, courseTitle: session.courseTitle, sessions: 0, checkIns: 0, lastHeldAt: session.startsAt };
      course.sessions += 1;
      course.checkIns += session.presentCount;
      if (session.startsAt >= course.lastHeldAt) { course.lastHeldAt = session.startsAt; course.courseTitle = session.courseTitle; }
      courses.set(courseKey, course);
      takers[session.creatorRole] += 1;
      if (session.startsAt <= now && session.endsAt > now && !(session.closedAt && session.closedAt <= now)) openNow += 1;
    }
    return {
      days,
      from: lagos(new Date(since.getTime() + 3_600_000)),
      to: today,
      totals: { sessions: sessions.length, openNow, courses: courses.size, ...entries },
      daily: [...daily.entries()].map(([date, value]) => ({ date, ...value })),
      departments: [...departments.values()].sort((a, b) => b.checkIns - a.checkIns || b.sessions - a.sessions).slice(0, 40),
      courses: [...courses.values()]
        .sort((a, b) => b.sessions - a.sessions || b.checkIns - a.checkIns)
        .slice(0, 20)
        .map((course) => ({
          courseCode: course.courseCode,
          courseTitle: course.courseTitle,
          sessions: course.sessions,
          checkIns: course.checkIns,
          averagePresent: Math.round((course.checkIns / course.sessions) * 10) / 10,
          lastHeldAt: course.lastHeldAt.toISOString(),
        })),
      takers,
    };
  }

  /* ---------------- course registers ---------------- */

  async registerCourses(account: AuthenticatedAccount): Promise<LectureRegisterCourses> {
    const { actor } = await this.#taker(account);
    const courses = await this.#repository.listRegisterCourses(account.id, this.#viewVisibility(account, actor), this.#now());
    return {
      courses: courses.map((course) => ({
        courseCode: course.courseCode,
        courseTitle: course.courseTitle,
        sessionCount: course.sessionCount,
        lastHeldAt: course.lastHeldAt.toISOString(),
      })),
    };
  }

  /**
   * Every student who attended any session of a course, against every session
   * held: the register lecturers keep for exam eligibility. Removed entries do
   * not count. Students are matched by matric number, so a guest check-in and
   * a signed-in check-in by the same student count once.
   */
  async register(account: AuthenticatedAccount, courseCode: string, termId?: string): Promise<LectureRegister> {
    const { actor } = await this.#taker(account);
    const now = this.#now();
    const history = await this.#repository.listCourseSessions(account.id, this.#viewVisibility(account, actor), courseCode, now, REGISTER_HISTORY_LIMIT);
    if (history.length === 0) throw new LectureError(404, `No sessions for ${courseCode} yet.`);

    // A course runs again next year under the same code, so a register counts one
    // semester (by the dates the administrator set) unless asked for more.
    const { sessions: termSessions, term, terms } = pickTerm(history, await this.#repository.listSemesters(actor.institutionId), termId);
    if (termSessions.length === 0) throw new LectureError(404, `No sessions for ${courseCode} in that semester.`);
    // Keep the most recent sessions if a long span holds more than a register shows.
    const sessions = termSessions.slice(-REGISTER_SESSION_LIMIT);
    const index = new Map(sessions.map((session, position) => [session.id, position]));
    const attendees = await this.#repository.listAttendeesForSessions(sessions.map((session) => session.id));

    const counts = new Array<number>(sessions.length).fill(0);
    const students = new Map<string, { fullName: string; hasAccount: boolean; present: boolean[]; lastSeen: number }>();
    for (const attendee of attendees) {
      const position = index.get(attendee.lectureSessionId);
      if (position === undefined) continue;
      const key = attendee.matricNumber.replace(/[\s/-]+/g, '').toUpperCase();
      let row = students.get(key);
      if (!row) {
        row = { fullName: attendee.fullName, hasAccount: false, present: new Array<boolean>(sessions.length).fill(false), lastSeen: -1 };
        students.set(key, row);
      }
      if (!row.present[position]) counts[position] = (counts[position] ?? 0) + 1;
      row.present[position] = true;
      if (attendee.studentUserId) row.hasAccount = true;
      // Show the most recently used spelling of the name (or the account name).
      const seen = attendee.createdAt.getTime();
      if (seen >= row.lastSeen) {
        row.lastSeen = seen;
        row.fullName = attendee.fullName;
      }
    }

    const held = sessions.length;
    const rows = [...students.entries()].map(([matricNumber, row]) => {
      const attended = row.present.filter(Boolean).length;
      return {
        matricNumber,
        fullName: row.fullName,
        hasAccount: row.hasAccount,
        present: row.present,
        attended,
        rate: Math.round((attended / held) * 1000) / 10,
      };
    }).sort((a, b) => a.fullName.localeCompare(b.fullName, 'en', { sensitivity: 'base' }) || a.matricNumber.localeCompare(b.matricNumber));

    const latest = sessions[sessions.length - 1]!;
    return {
      courseCode: latest.courseCode,
      courseTitle: latest.courseTitle,
      term,
      terms,
      sessions: sessions.map((session, position) => ({
        id: session.id,
        startsAt: session.startsAt.toISOString(),
        takenBy: session.lecturerName ?? session.creatorName,
        presentCount: counts[position] ?? 0,
      })),
      students: rows,
      generatedAt: now.toISOString(),
    };
  }

  async getSession(account: AuthenticatedAccount, sessionId: string): Promise<LectureSessionDetail> {
    const session = await this.#repository.findSession(sessionId);
    if (!session) throw notFound();
    let canManage = this.#canManage(account, session);
    if (!canManage) {
      // Class representatives can view (not change) sessions in their department or faculty.
      const actor = await this.#repository.findActor(account.id);
      const visibility = actor ? this.#viewVisibility(account, actor) : null;
      if (!actor || !visibility || visibility.type === 'own' || !(await this.#repository.isSessionVisible(session.id, account.id, visibility))) {
        throw notFound();
      }
      canManage = false;
    }
    const attendees = await this.#repository.listAttendees(session.id);
    const deviceCounts = new Map<string, number>();
    for (const attendee of attendees) {
      if (attendee.deviceHash && !attendee.removedAt) deviceCounts.set(attendee.deviceHash, (deviceCounts.get(attendee.deviceHash) ?? 0) + 1);
    }
    const toAttendee = (record: LectureAttendeeRecord): LectureAttendee => ({
      id: record.id,
      fullName: record.fullName,
      matricNumber: record.matricNumber,
      hasAccount: record.studentUserId != null,
      method: record.method,
      addedByName: record.addedByName,
      checkedInAt: record.createdAt.toISOString(),
      venueOutcome: record.venueOutcome,
      distanceMeters: record.distanceMeters,
      outsideMeters: record.outsideMeters ?? null,
      accuracyMeters: record.accuracyMeters ?? null,
      sharedDeviceCount: record.deviceHash ? Math.max(0, (deviceCounts.get(record.deviceHash) ?? 1) - 1) : 0,
      removed: record.removedAt != null,
      removedReason: record.removedReason,
    });
    return { session: this.#summary(session, this.#now(), canManage), attendees: attendees.map(toAttendee), canManage };
  }

  async currentFrame(account: AuthenticatedAccount, sessionId: string): Promise<LectureQrFrame> {
    const session = await this.#managedSession(account, sessionId);
    const now = this.#now();
    const status = this.#status(session, now);
    const summary = this.#summary(session, now);
    if (session.qrMode === 'static') {
      return {
        mode: 'static',
        path: `/a/${session.publicCode}`,
        code: session.publicCode,
        rotatesAt: null,
        status,
        endsAt: summary.endsAt,
        presentCount: session.presentCount,
      };
    }
    const frame = createLectureQrFrame({ secret: session.secret, sessionId: session.id, now });
    return {
      mode: 'dynamic',
      path: `/a#${frame.challenge}`,
      code: frame.code,
      rotatesAt: frame.rotatesAt.toISOString(),
      status,
      endsAt: summary.endsAt,
      presentCount: session.presentCount,
    };
  }

  async updateSession(account: AuthenticatedAccount, sessionId: string, input: UpdateInput): Promise<LectureSessionSummary> {
    const session = await this.#managedSession(account, sessionId);
    const now = this.#now();
    const changes: LectureSessionChanges = { now };
    if (input.qrMode) changes.qrMode = input.qrMode;
    if (input.courseCode !== undefined) changes.courseCode = input.courseCode;
    if (input.courseTitle !== undefined) changes.courseTitle = input.courseTitle;
    if (input.lecturerName !== undefined) changes.lecturerName = input.lecturerName;
    if (input.venueId !== undefined || input.requireVenue !== undefined) {
      let venue = session.venue;
      if (input.venueId === null) {
        venue = null;
      } else if (input.venueId !== undefined && input.venueId !== session.venue?.id) {
        const found = (await this.#repository.listVenues(session.institutionId)).find((item) => item.id === input.venueId && item.active);
        if (!found) throw new LectureError(422, 'That venue is not available. Pick another venue or leave it empty.');
        venue = found;
      }
      // Without an explicit choice, the in-venue check stays on only while the venue can be checked.
      const requireVenue = input.requireVenue ?? (session.requireVenue && hasBoundary(venue));
      if (requireVenue && !venue) throw new LectureError(422, 'Pick a venue to check that students are in the room.');
      if (requireVenue && !hasBoundary(venue)) {
        throw new LectureError(422, `The location of ${venue?.name ?? 'this venue'} has not been registered yet, so it cannot be checked. Turn off "Students must be in the venue".`);
      }
      changes.venueId = venue?.id ?? null;
      changes.requireVenue = requireVenue;
    }
    if (input.extendMinutes) {
      const currentEnd = session.closedAt && session.closedAt < session.endsAt ? session.closedAt : session.endsAt;
      const base = currentEnd > now ? currentEnd : now;
      changes.endsAt = new Date(base.getTime() + input.extendMinutes * 60_000);
      changes.closedAt = null;
    }
    if (input.close) {
      changes.closedAt = now;
      if (session.endsAt > now) changes.endsAt = now;
      // Guard the ends > starts check when closing in the first second.
      if (changes.endsAt && changes.endsAt <= session.startsAt) changes.endsAt = new Date(session.startsAt.getTime() + 1000);
    }
    await this.#repository.updateSession(session.id, changes);
    const updated = await this.#repository.findSession(session.id);
    if (!updated) throw notFound();
    return this.#summary(updated, now);
  }

  async setAttendeeRemoved(
    account: AuthenticatedAccount,
    sessionId: string,
    attendeeId: string,
    input: { readonly reason?: string | undefined; readonly restore?: boolean | undefined },
  ): Promise<void> {
    const session = await this.#managedSession(account, sessionId);
    const restore = input.restore === true;
    const changed = await this.#repository.setAttendeeRemoved({
      sessionId: session.id,
      attendeeId,
      removedByUserId: restore ? null : account.id,
      reason: restore ? null : (input.reason?.trim() || null),
      removedAt: restore ? null : this.#now(),
    });
    if (!changed) throw new LectureError(404, 'That student is not on this list.');
  }

  /**
   * The session taker adds a student by hand — a dead phone, no smartphone, or a
   * student the scan missed. Recorded as method 'manual' with who added it, so it
   * stays visible and accountable on the list and in exports.
   */
  async addAttendee(
    account: AuthenticatedAccount,
    sessionId: string,
    input: { readonly fullName: string; readonly matricNumber: string },
  ): Promise<{ readonly status: 'added' | 'restored'; readonly fullName: string; readonly matricNumber: string }> {
    const session = await this.#managedSession(account, sessionId);
    const now = this.#now();
    if (now < session.startsAt) throw new LectureError(409, 'This session has not started yet.');
    if (!/\d{3}/.test(input.matricNumber)) throw new LectureError(422, 'Check the matric number. It should be the number on the student’s ID card.');
    const matricNumber = input.matricNumber.replace(/\s+/g, '').toUpperCase();
    // Link the entry to the student's account when they have one, so it shows in their history.
    const student = await this.#repository.findStudentForAppointment(session.institutionId, matricNumber);
    const linked = student && student.matricNumber.replace(/\s+/g, '').toUpperCase() === matricNumber ? student : null;
    const result = await this.#repository.insertAttendance({
      institutionId: session.institutionId,
      lectureSessionId: session.id,
      studentUserId: linked?.userId ?? null,
      fullName: linked?.fullName ?? input.fullName,
      matricNumber,
      method: 'manual',
      deviceHash: null,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      distanceMeters: null,
      venueOutcome: null,
      addedByUserId: account.id,
      now,
    });
    if (result.kind === 'inserted') return { status: 'added', fullName: result.record.fullName, matricNumber };
    if (result.record.removedAt) {
      await this.#repository.setAttendeeRemoved({ sessionId: session.id, attendeeId: result.record.id, removedByUserId: null, reason: null, removedAt: null });
      return { status: 'restored', fullName: result.record.fullName, matricNumber };
    }
    throw new LectureError(409, `${result.record.fullName} (${matricNumber}) is already on the list.`);
  }

  async correctAttendee(
    account: AuthenticatedAccount,
    sessionId: string,
    attendeeId: string,
    input: { readonly fullName?: string | undefined; readonly matricNumber?: string | undefined },
  ): Promise<{ readonly status: 'corrected'; readonly fullName: string; readonly matricNumber: string; readonly linked: boolean }> {
    const session = await this.#managedSession(account, sessionId);
    const attendee = (await this.#repository.listAttendees(session.id)).find((item) => item.id === attendeeId);
    if (!attendee) throw new LectureError(404, 'That student is not on this list.');
    if (attendee.studentUserId) {
      throw new LectureError(409, `${attendee.fullName} marked attendance with their account, so the name and matric number come from it. They can correct them in their own profile.`);
    }
    let fullName = input.fullName ?? attendee.fullName;
    let matricNumber = attendee.matricNumber;
    let studentUserId: string | null = null;
    if (input.matricNumber !== undefined) {
      if (!/\d{3}/.test(input.matricNumber)) throw new LectureError(422, 'Check the matric number. It should be the number on the student’s ID card.');
      matricNumber = input.matricNumber.replace(/\s+/g, '').toUpperCase();
      if (matricNumber !== attendee.matricNumber) {
        // The corrected number may belong to a student account: link it so it shows in their history.
        const student = await this.#repository.findStudentForAppointment(session.institutionId, matricNumber);
        if (student && student.matricNumber.replace(/\s+/g, '').toUpperCase() === matricNumber) {
          studentUserId = student.userId;
          fullName = student.fullName;
        }
      }
    }
    const result = await this.#repository.correctAttendee({ sessionId: session.id, attendeeId, fullName, matricNumber, studentUserId });
    if (result === 'matric_taken') throw new LectureError(409, `${matricNumber} is already on this list. Remove one of the two entries instead.`);
    if (result === 'not_found') throw new LectureError(404, 'That student is not on this list.');
    return { status: 'corrected', fullName, matricNumber, linked: studentUserId !== null };
  }

  async courseSuggestions(account: AuthenticatedAccount): Promise<LectureCourseSuggestions> {
    const { actor } = await this.#taker(account);
    return { courses: await this.#repository.listCourseSuggestions(actor.institutionId, account.id) };
  }

  async venueOptions(account: AuthenticatedAccount): Promise<LectureVenueOptions> {
    const { actor } = await this.#taker(account);
    const venues = await this.#repository.listVenues(actor.institutionId);
    return {
      venues: venues.filter((venue) => venue.active).map((venue) => ({
        id: venue.id,
        code: venue.code,
        name: venue.name,
        campusName: venue.campusName,
        hasBoundary: hasBoundary(venue),
      })),
    };
  }

  /* ---------------- public check-in ---------------- */

  #assertOpen(session: LectureSessionRecord, now: Date): void {
    if (session.closedAt && session.closedAt <= now) throw new LectureError(410, `Attendance for ${session.courseCode} has been closed.`);
    if (now < session.startsAt) throw new LectureError(409, `Attendance for ${session.courseCode} has not started yet.`);
    if (now >= session.endsAt) throw new LectureError(410, `Attendance for ${session.courseCode} has ended.`);
  }

  async resolve(
    account: AuthenticatedAccount | null,
    input: { readonly challenge?: string | undefined; readonly code?: string | undefined; readonly scanned?: boolean | undefined },
  ): Promise<ResolvedLecture> {
    const now = this.#now();
    let session: LectureSessionRecord | null = null;
    let method: 'qr' | 'code' = 'code';

    if (input.challenge) {
      method = 'qr';
      const parsed = parseLectureChallenge(input.challenge);
      session = parsed ? await this.#repository.findSession(parsed.sessionId) : null;
      if (!session) throw new LectureError(404, 'This QR code is not recognised. Scan the code on the screen again.');
      this.#assertOpen(session, now);
      if (session.qrMode !== 'dynamic' || !verifyLectureChallenge(input.challenge, { secret: session.secret, now })) {
        throw new LectureError(410, 'This QR code has changed. Scan the one on the screen now.');
      }
    } else if (input.code) {
      const code = normalizeAttendanceCode(input.code);
      if (code.length === PUBLIC_CODE_LENGTH) {
        session = await this.#repository.findSessionByPublicCode(code);
        if (session) this.#assertOpen(session, now);
        if (session && session.qrMode !== 'static') {
          throw new LectureError(409, 'This class is using a changing code now. Scan the QR code on the screen or type the 6-letter code under it.');
        }
        method = input.scanned ? 'qr' : 'code';
      } else if (code.length === ROTATING_CODE_LENGTH) {
        const open = await this.#repository.listOpenDynamicSessions(now);
        session = open.find((candidate) => matchRotatingCode(code, { secret: candidate.secret, sessionId: candidate.id, now })) ?? null;
      }
      if (!session) throw new LectureError(404, 'That code is not right or has expired. Check the code and try again.');
      this.#assertOpen(session, now);
    } else {
      throw new LectureError(400, 'Scan the QR code or type the code.');
    }

    const { ticket, expiresAt } = createCheckInTicket({ secret: session.secret, sessionId: session.id, method, now });
    let student: ResolvedLecture['student'] = null;
    let alreadyCheckedInAt: string | null = null;
    if (account?.accountType === 'student') {
      const actor = await this.#repository.findActor(account.id);
      if (actor?.student) {
        student = { fullName: actor.student.fullName, matricNumber: actor.student.matricNumber };
        const existing = await this.#repository.findAttendanceByStudent(session.id, account.id);
        if (existing && !existing.removedAt) alreadyCheckedInAt = existing.createdAt.toISOString();
      }
    }
    const venue = session.venue;
    return {
      ticket,
      ticketExpiresAt: expiresAt.toISOString(),
      session: {
        id: session.id,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        lecturerName: session.lecturerName,
        takenBy: session.creatorName,
        endsAt: this.#summary(session, now).endsAt,
        venueName: venue?.name ?? null,
        venueGuide: venue
          ? {
              campusName: venue.campusName,
              buildingName: venue.buildingName,
              floorLabel: venue.floorLabel,
              sectionLabel: venue.sectionLabel,
              latitude: venue.latitude,
              longitude: venue.longitude,
              radiusMeters: venue.radiusMeters,
              outline: venue.outline && venue.latitude != null ? venue.outline.map(({ latitude, longitude }) => ({ latitude, longitude })) : null,
              allowanceMeters: venue.allowanceMeters,
            }
          : null,
        requireVenue: session.requireVenue && hasBoundary(venue),
      },
      student,
      alreadyCheckedInAt,
    };
  }

  /**
   * Checks the phone's position against the session's venue (see
   * evaluatePresence). Where the venue is required, only a confirmed position
   * gets through, and every refusal says what to do about it.
   */
  #venueEvidence(session: LectureSessionRecord, location: CheckInLocationSample | undefined, now: Date): {
    outcome: LectureVenueOutcome | null;
    distanceMeters: number | null;
    outsideMeters: number | null;
    accuracyMeters: number | null;
  } {
    const venue = session.venue;
    const none = { distanceMeters: null, outsideMeters: null, accuracyMeters: null };
    if (!hasBoundary(venue)) return { outcome: null, ...none };
    const required = session.requireVenue;
    if (!location) {
      if (required) throw new LectureError(422, `Turn on location so we can confirm you are in ${venue.name}, then try again.`);
      return { outcome: 'unavailable', ...none };
    }
    const capturedAt = Date.parse(location.capturedAt);
    const ageMilliseconds = location.ageMilliseconds ?? (Number.isFinite(capturedAt) ? now.getTime() - capturedAt : Number.NaN);
    let evaluation: PresenceEvaluation;
    try {
      evaluation = evaluatePresence(venueArea(venue), {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters ?? null,
        ageMilliseconds,
      });
    } catch {
      if (required) throw new LectureError(422, 'Your phone sent a location we could not read. Try again.');
      return { outcome: 'unavailable', ...none };
    }
    const accuracy = evaluation.accuracyMeters;
    if (required && evaluation.outcome !== 'within') {
      const help = `If it keeps happening, ask ${session.creatorName} to add you to the list.`;
      const precision = accuracy != null ? ` (accuracy ${formatAccuracy(accuracy)})` : '';
      switch (evaluation.reason) {
        case 'stale':
          throw new LectureError(422, 'Your phone gave an old location reading. Tap the button again to take a fresh one.');
        case 'approximate':
          throw new LectureError(422, `Your phone is sharing only an approximate location${precision}, which cannot confirm you are in ${venue.name}. Turn on Precise Location for your browser, then try again.`);
        case 'coarse':
          throw new LectureError(422, `Your phone could not pin down your position${precision}. Make sure Location is on, move near a window or the door for a few seconds, then try again. ${help}`);
        case 'outside_uncertain':
          throw new LectureError(422, `Your phone places you about ${formatMeters(evaluation.outsideMeters)} outside ${venue.name}${precision}. If you are inside, wait a few seconds for a better reading and try again. ${help}`);
        default:
          throw new LectureError(422, `You are about ${formatMeters(evaluation.outsideMeters)} from ${venue.name}. Go into the venue and try again.`);
      }
    }
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      outcome: evaluation.outcome,
      distanceMeters: round(evaluation.fromCenterMeters),
      outsideMeters: round(evaluation.outsideMeters),
      accuracyMeters: accuracy,
    };
  }

  async checkIn(account: AuthenticatedAccount | null, input: LectureCheckInInput): Promise<LectureCheckInResult> {
    const now = this.#now();
    const parsed = parseCheckInTicket(input.ticket);
    const session = parsed ? await this.#repository.findSession(parsed.sessionId) : null;
    if (!parsed || !session || !verifyCheckInTicket(input.ticket, { secret: session.secret, now })) {
      throw new LectureError(410, 'This check-in page expired. Scan the QR code or type the code again.');
    }
    const issuedAt = new Date((parsed.expires - CHECK_IN_TICKET_SECONDS) * 1000);
    if (session.closedAt && session.closedAt <= now) throw new LectureError(410, `Attendance for ${session.courseCode} has been closed.`);
    // A ticket issued while attendance was open may finish after the end time: typing a name takes a moment.
    if (issuedAt >= session.endsAt) throw new LectureError(410, `Attendance for ${session.courseCode} has ended.`);

    let identity: { studentUserId: string | null; fullName: string; matricNumber: string };
    let student: StudentIdentityRecord | null = null;
    if (account?.accountType === 'student') {
      student = (await this.#repository.findActor(account.id))?.student ?? null;
    }
    if (student) {
      identity = { studentUserId: student.userId, fullName: student.fullName, matricNumber: student.matricNumber.replace(/\s+/g, '').toUpperCase() };
    } else {
      if (!input.fullName || !input.matricNumber) throw new LectureError(422, 'Enter your full name and matric number.');
      if (!/\d{3}/.test(input.matricNumber)) throw new LectureError(422, 'Check your matric number. It should be the number on your school ID card.');
      identity = { studentUserId: null, fullName: input.fullName, matricNumber: input.matricNumber };
    }

    // One phone, one student per class. Otherwise a student sitting in the
    // hall can mark absent friends present from their own phone, and the
    // location check (which sees a phone in the room) cannot tell.
    const device = deviceHash(session.id, input.deviceToken);
    if (device) {
      const earlier = await this.#repository.findActiveAttendanceByDevice(session.id, device);
      if (earlier && !samePerson(earlier, identity)) {
        throw new LectureError(
          409,
          `This phone has already been used to mark someone else present for ${session.courseCode}. Each student marks attendance on their own phone. If yours is not with you, ask ${session.creatorName} to add you to the list.`,
        );
      }
    }

    const evidence = this.#venueEvidence(session, input.location, now);
    const result = await this.#repository.insertAttendance({
      institutionId: session.institutionId,
      lectureSessionId: session.id,
      studentUserId: identity.studentUserId,
      fullName: identity.fullName,
      matricNumber: identity.matricNumber,
      method: parsed.method,
      deviceHash: device,
      latitude: evidence.outcome && evidence.outcome !== 'unavailable' ? input.location?.latitude ?? null : null,
      longitude: evidence.outcome && evidence.outcome !== 'unavailable' ? input.location?.longitude ?? null : null,
      accuracyMeters: evidence.accuracyMeters,
      distanceMeters: evidence.distanceMeters,
      outsideMeters: evidence.outsideMeters,
      locationSamples: evidence.outcome && evidence.outcome !== 'unavailable' ? input.location?.sampleCount ?? 1 : null,
      venueOutcome: evidence.outcome,
      now,
    });
    if (result.kind === 'duplicate' && result.record.removedAt) {
      throw new LectureError(409, 'Your attendance for this class was removed by the person taking attendance. Speak to them if this is a mistake.');
    }
    return {
      status: result.kind === 'inserted' ? 'checked_in' : 'already_checked_in',
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      fullName: identity.fullName,
      matricNumber: identity.matricNumber,
      checkedInAt: result.record.createdAt.toISOString(),
      venueOutcome: result.kind === 'inserted' ? evidence.outcome : result.record.venueOutcome,
      locationAccuracyMeters: result.kind === 'inserted' ? evidence.accuracyMeters : result.record.accuracyMeters ?? null,
    };
  }

  async studentHistory(account: AuthenticatedAccount): Promise<StudentLectureHistory> {
    if (account.accountType !== 'student') throw new LectureError(403, 'Only students have a lecture attendance history.');
    const actor = await this.#actor(account);
    if (!actor.student) return { entries: [], courses: [] };
    const entries = await this.#repository.listStudentHistory({
      institutionId: actor.institutionId,
      studentUserId: account.id,
      matricNumber: actor.student.matricNumber.replace(/\s+/g, '').toUpperCase(),
    });
    return {
      entries: entries.map((entry) => ({
        id: entry.id,
        courseCode: entry.courseCode,
        courseTitle: entry.courseTitle,
        checkedInAt: entry.createdAt.toISOString(),
        method: entry.method,
        venueName: entry.venueName,
        removed: entry.removed,
      })),
      courses: await this.#courseRates(actor.institutionId, entries),
    };
  }

  /**
   * Attendance rate per course, counted the way the register counts it: every started
   * session of that course run by the lecturers or reps whose sessions the student attended,
   * in the semesters the student attended it (so last year's run of the same course code
   * does not lower this year's rate).
   */
  async #courseRates(institutionId: string, entries: readonly StudentLectureHistoryRecord[]): Promise<StudentLectureHistory['courses']> {
    const present = entries.filter((entry) => !entry.removed);
    if (present.length === 0) return [];
    const takersByCourse = new Map<string, Set<string>>();
    const attendedByCourse = new Map<string, Set<string>>();
    const titles = new Map<string, { code: string; title: string }>();
    for (const entry of present) {
      const key = courseCodeKey(entry.courseCode);
      if (!takersByCourse.has(key)) takersByCourse.set(key, new Set());
      if (!attendedByCourse.has(key)) attendedByCourse.set(key, new Set());
      takersByCourse.get(key)!.add(entry.sessionCreatorUserId);
      attendedByCourse.get(key)!.add(entry.lectureSessionId);
      if (!titles.has(key)) titles.set(key, { code: entry.courseCode, title: entry.courseTitle }); // newest first
    }
    const creators = [...new Set(present.map((entry) => entry.sessionCreatorUserId))];
    const [held, semesters] = await Promise.all([
      this.#repository.listHeldSessions(institutionId, creators, this.#now()),
      this.#repository.listSemesters(institutionId),
    ]);
    const termOf = (at: Date): string => {
      const time = at.getTime();
      return semesters.find((semester) => time >= semester.startsAt.getTime() && time < semester.endsAt.getTime())?.id ?? 'other';
    };
    const termsByCourse = new Map<string, Set<string>>();
    for (const entry of present) {
      const key = courseCodeKey(entry.courseCode);
      if (!termsByCourse.has(key)) termsByCourse.set(key, new Set());
      termsByCourse.get(key)!.add(termOf(entry.createdAt));
    }
    const heldByCourse = new Map<string, Set<string>>();
    for (const session of held) {
      const key = courseCodeKey(session.courseCode);
      if (!takersByCourse.get(key)?.has(session.createdByUserId)) continue;
      if (semesters.length > 0 && !termsByCourse.get(key)?.has(termOf(session.startsAt))) continue;
      if (!heldByCourse.has(key)) heldByCourse.set(key, new Set());
      heldByCourse.get(key)!.add(session.id);
    }
    return [...titles.entries()].map(([key, { code, title }]) => {
      const attendedSessions = attendedByCourse.get(key)!;
      const heldSessions = heldByCourse.get(key) ?? new Set<string>();
      for (const id of attendedSessions) heldSessions.add(id);
      const heldCount = heldSessions.size;
      const attended = attendedSessions.size;
      return { courseCode: code, courseTitle: title, held: heldCount, attended, rate: heldCount ? Math.round((attended / heldCount) * 1000) / 10 : 0 };
    }).sort((a, b) => a.courseCode.localeCompare(b.courseCode)).slice(0, 200);
  }

  /* ---------------- class representatives ---------------- */

  async #repScope(account: AuthenticatedAccount): Promise<RepScope> {
    const actor = await this.#actor(account);
    if (account.accountType === 'administrator') {
      const scope = account.scope;
      if (scope.type === 'institution') {
        return { institutionId: actor.institutionId, facultyIds: null, departmentIds: null, canAppointGhoc: true, fixedEntryYear: null, onlyHoc: false };
      }
      if (scope.type === 'faculty') {
        return { institutionId: actor.institutionId, facultyIds: new Set([scope.id]), departmentIds: null, canAppointGhoc: true, fixedEntryYear: null, onlyHoc: false };
      }
      return { institutionId: actor.institutionId, facultyIds: null, departmentIds: new Set([scope.id]), canAppointGhoc: false, fixedEntryYear: null, onlyHoc: true };
    }
    if (actor.classRep?.role === 'ghoc') {
      return {
        institutionId: actor.institutionId,
        facultyIds: new Set([actor.classRep.facultyId]),
        departmentIds: null,
        canAppointGhoc: false,
        fixedEntryYear: actor.classRep.entryYear,
        onlyHoc: true,
      };
    }
    throw cannotManageReps();
  }

  #repInScope(rep: { role: string; facultyId: string; departmentId: string | null; entryYear: number }, scope: RepScope): boolean {
    if (scope.onlyHoc && rep.role !== 'hoc') return false;
    if (scope.fixedEntryYear != null && rep.entryYear !== scope.fixedEntryYear) return false;
    if (scope.facultyIds && !scope.facultyIds.has(rep.facultyId)) return false;
    if (scope.departmentIds && (!rep.departmentId || !scope.departmentIds.has(rep.departmentId))) return false;
    return true;
  }

  #toClassRep(record: ClassRepRecord): ClassRep {
    return {
      id: record.id,
      role: record.role,
      studentName: record.studentName,
      matricNumber: record.matricNumber,
      email: record.email,
      facultyName: record.facultyName,
      departmentName: record.departmentName,
      entryYear: record.entryYear,
      setLabel: academicSetLabel(record.entryYear),
      appointedAt: record.appointedAt.toISOString(),
      appointedByName: record.appointedByName,
    };
  }

  async listClassReps(account: AuthenticatedAccount): Promise<ClassRepList> {
    const scope = await this.#repScope(account);
    const [reps, departments, faculties] = await Promise.all([
      this.#repository.listClassReps(scope.institutionId),
      this.#repository.listDepartments(scope.institutionId),
      this.#repository.listFaculties(scope.institutionId),
    ]);
    return {
      reps: reps.filter((rep) => this.#repInScope(rep, scope)).map((rep) => this.#toClassRep(rep)),
      departments: departments.filter((department) =>
        (!scope.facultyIds || scope.facultyIds.has(department.facultyId)) &&
        (!scope.departmentIds || scope.departmentIds.has(department.id))),
      faculties: scope.canAppointGhoc ? faculties.filter((faculty) => !scope.facultyIds || scope.facultyIds.has(faculty.id)) : [],
      fixedEntryYear: scope.fixedEntryYear,
    };
  }

  #entryYear(student: StudentIdentityRecord): number | null {
    return student.entryYear ?? entryYearFromMatric(student.matricNumber, this.#now().getUTCFullYear());
  }

  async findStudent(account: AuthenticatedAccount, query: string): Promise<ClassRepStudent> {
    const scope = await this.#repScope(account);
    const student = await this.#repository.findStudentForAppointment(scope.institutionId, query.trim());
    if (!student) throw new LectureError(404, 'No student account matches that matric number or email. The student must sign up first.');
    const actor = await this.#repository.findActor(student.userId);
    return {
      userId: student.userId,
      fullName: student.fullName,
      matricNumber: student.matricNumber,
      email: student.email,
      departmentId: student.departmentId,
      departmentName: student.departmentName,
      facultyId: student.facultyId,
      facultyName: student.facultyName,
      entryYear: this.#entryYear(student),
      currentRole: actor?.classRep ? repLabel(actor.classRep) : null,
    };
  }

  async appointClassRep(account: AuthenticatedAccount, input: AppointClassRepRequest): Promise<ClassRep> {
    const scope = await this.#repScope(account);
    if (input.studentUserId === account.id) throw new LectureError(422, 'You cannot appoint yourself.');
    const student = await this.#repository.findStudentByUserId(scope.institutionId, input.studentUserId);
    if (!student) throw new LectureError(404, 'That student account was not found.');
    const entryYear = scope.fixedEntryYear ?? input.entryYear;

    let facultyId: string;
    let departmentId: string | null = null;
    if (input.role === 'hoc') {
      if (!input.departmentId) throw new LectureError(422, 'Choose the department for this HOC.');
      const department = (await this.#repository.listDepartments(scope.institutionId)).find((item) => item.id === input.departmentId);
      if (!department) throw new LectureError(422, 'That department was not found.');
      facultyId = department.facultyId;
      departmentId = department.id;
    } else {
      if (!scope.canAppointGhoc) throw new LectureError(403, 'Only administrators can appoint a GHOC.');
      if (!input.facultyId) throw new LectureError(422, 'Choose the faculty for this GHOC.');
      const faculty = (await this.#repository.listFaculties(scope.institutionId)).find((item) => item.id === input.facultyId);
      if (!faculty) throw new LectureError(422, 'That faculty was not found.');
      facultyId = faculty.id;
    }
    if (!this.#repInScope({ role: input.role, facultyId, departmentId, entryYear }, scope)) {
      throw new LectureError(403, scope.fixedEntryYear != null
        ? `As GHOC you can appoint HOCs for departments in your faculty and the ${academicSetLabel(scope.fixedEntryYear)}.`
        : 'That appointment is outside the part of the school you manage.');
    }

    const id = await this.#repository.appointClassRep({
      institutionId: scope.institutionId,
      studentUserId: student.userId,
      role: input.role,
      facultyId,
      departmentId,
      entryYear,
      appointedByUserId: account.id,
      now: this.#now(),
    });
    const record = await this.#repository.findClassRep(scope.institutionId, id);
    if (!record) throw new LectureError(503, 'The appointment was saved but could not be read back. Refresh the page.');
    return this.#toClassRep(record);
  }

  async revokeClassRep(account: AuthenticatedAccount, id: string): Promise<void> {
    const scope = await this.#repScope(account);
    const record = await this.#repository.findClassRep(scope.institutionId, id);
    if (!record || !this.#repInScope(record, scope)) throw new LectureError(404, 'That class representative was not found.');
    await this.#repository.revokeClassRep({ id, revokedByUserId: account.id, now: this.#now() });
  }
}

/** Sessions of one course read when building a register (every semester). */
const REGISTER_HISTORY_LIMIT = 2_000;
/** Sessions shown in one register: about four a week across a long semester. */
const REGISTER_SESSION_LIMIT = 400;

interface TermPick {
  readonly sessions: readonly LectureSessionRecord[];
  readonly term: LectureRegisterTerm | null;
  readonly terms: LectureRegisterTerm[];
}

/**
 * Splits a course's sessions (oldest first) into the institution's semesters and
 * picks the requested one: a semester id, `other` (outside every semester's
 * dates), `all`, or by default the semester of the most recent session.
 * Without semester dates every session counts, as before semesters existed.
 */
export function pickTerm(
  sessions: readonly LectureSessionRecord[],
  semesters: readonly SemesterRecord[],
  requested: string | undefined,
): TermPick {
  if (semesters.length === 0) return { sessions, term: null, terms: [] };
  const bucketOf = (session: LectureSessionRecord): string => {
    const at = session.startsAt.getTime();
    return semesters.find((semester) => at >= semester.startsAt.getTime() && at < semester.endsAt.getTime())?.id ?? 'other';
  };
  const buckets = new Map<string, LectureSessionRecord[]>();
  for (const session of sessions) {
    const key = bucketOf(session);
    const list = buckets.get(key);
    if (list) list.push(session);
    else buckets.set(key, [session]);
  }
  // Newest semester first (semesters arrive newest first), then the catch-alls.
  const terms: LectureRegisterTerm[] = semesters
    .filter((semester) => buckets.has(semester.id))
    .map((semester) => ({ id: semester.id, label: semester.label, sessionCount: buckets.get(semester.id)!.length }));
  const other = buckets.get('other');
  if (other) terms.push({ id: 'other', label: 'Outside the semester dates', sessionCount: other.length });
  const all: LectureRegisterTerm = { id: 'all', label: 'Every session', sessionCount: sessions.length };
  if (terms.length > 1) terms.push(all);

  const latest = sessions[sessions.length - 1];
  const wanted = requested ?? (latest ? bucketOf(latest) : 'all');
  if (wanted === 'all') return { sessions, term: all, terms };
  const chosen = terms.find((term) => term.id === wanted);
  if (!chosen) return { sessions: [], term: null, terms };
  return { sessions: buckets.get(wanted) ?? [], term: chosen, terms };
}
