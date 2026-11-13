import type { ClassRepRole, LectureAttendanceMethod, LectureQrMode, LectureTakerRole, LectureVenueOutcome } from '@lasuatos/contracts';

export interface InstitutionCourseRecord {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly units: number;
  readonly addedByUserId: string | null;
  readonly addedByName: string | null;
  /** The built-in course this row takes the place of, as a key ("GET201"); null for departmental courses. */
  readonly standardCode: string | null;
  /** Set while the course is hidden from the picker. */
  readonly hiddenAt: Date | null;
}

/** One change to the institution's course list, saved together with others. */
export type CourseListWrite =
  | {
    readonly kind: 'update';
    readonly id: string;
    readonly code?: string | undefined;
    readonly title?: string | undefined;
    readonly units?: number | undefined;
    readonly hiddenAt?: Date | null | undefined;
  }
  | {
    readonly kind: 'insert';
    readonly code: string;
    readonly title: string;
    readonly units: number;
    readonly addedByUserId: string;
    readonly standardCode: string | null;
    readonly hiddenAt: Date | null;
  };

/** Sessions already taken under `fromKey` take the new code and title. */
export interface CourseSessionMove {
  readonly fromKey: string;
  readonly toCode: string;
  readonly toTitle: string;
}

export interface ClassRepAppointment {
  readonly id: string;
  readonly role: ClassRepRole;
  readonly studentUserId: string;
  readonly facultyId: string;
  readonly facultyName: string;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly entryYear: number;
}

export interface ClassRepRecord extends ClassRepAppointment {
  readonly studentName: string;
  readonly matricNumber: string;
  readonly email: string;
  readonly appointedAt: Date;
  readonly appointedByName: string;
}

/** Who is acting, with what they need for lecture-session decisions. */
export interface LectureActorRecord {
  readonly userId: string;
  readonly institutionId: string;
  readonly displayName: string;
  /** Lecturer's department and faculty, when the account has a lecturer profile. */
  readonly lecturerDepartmentId: string | null;
  readonly lecturerFacultyId: string | null;
  readonly student: StudentIdentityRecord | null;
  readonly classRep: ClassRepAppointment | null;
}

export interface SemesterRecord {
  readonly id: string;
  /** For example "2025/2026 · First Semester". */
  readonly label: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface StudentIdentityRecord {
  readonly userId: string;
  readonly fullName: string;
  readonly matricNumber: string;
  readonly email: string;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly facultyId: string | null;
  readonly facultyName: string | null;
  readonly entryYear: number | null;
}

export interface LectureVenueRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly campusName: string | null;
  readonly buildingName: string | null;
  readonly floorLabel: string | null;
  readonly sectionLabel: string | null;
  /** Circle centre, or the outline's centre of area. */
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Circle radius, or centre to furthest outline corner. */
  readonly radiusMeters: number | null;
  /** The building's footprint; null for circle venues. */
  readonly outline: readonly { readonly latitude: number; readonly longitude: number }[] | null;
  /** How far outside the shape a reading may land and still count. */
  readonly allowanceMeters: number;
  readonly active: boolean;
}

export interface LectureSessionRecord {
  readonly id: string;
  readonly institutionId: string;
  readonly createdByUserId: string;
  readonly creatorName: string;
  readonly creatorRole: LectureTakerRole;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly lecturerName: string | null;
  readonly facultyId: string | null;
  readonly departmentId: string | null;
  readonly entryYear: number | null;
  readonly venue: LectureVenueRecord | null;
  readonly requireVenue: boolean;
  readonly qrMode: LectureQrMode;
  readonly secret: string;
  readonly publicCode: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly closedAt: Date | null;
  readonly presentCount: number;
}

/** Fields a session taker may change after opening a session; undefined leaves a field as it is. */
export interface LectureSessionChanges {
  qrMode?: LectureQrMode;
  endsAt?: Date;
  closedAt?: Date | null;
  courseCode?: string;
  courseTitle?: string;
  lecturerName?: string | null;
  venueId?: string | null;
  requireVenue?: boolean;
  now: Date;
}

export interface CreateLectureSessionInput {
  readonly institutionId: string;
  readonly createdByUserId: string;
  readonly creatorRole: LectureTakerRole;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly lecturerName: string | null;
  readonly facultyId: string | null;
  readonly departmentId: string | null;
  readonly entryYear: number | null;
  readonly venueId: string | null;
  readonly requireVenue: boolean;
  readonly qrMode: LectureQrMode;
  readonly secret: string;
  readonly publicCode: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Which sessions a list may include, besides the caller's own. */
export type LectureSessionVisibility =
  | { readonly type: 'own' }
  | { readonly type: 'institution'; readonly institutionId: string }
  | { readonly type: 'faculty'; readonly institutionId: string; readonly facultyId: string }
  | { readonly type: 'department'; readonly institutionId: string; readonly departmentId: string }
  /**
   * A HOC: every session of their department, plus the faculty-wide sessions
   * their GHOC takes for the same academic set. View only.
   */
  | {
      readonly type: 'rep_department';
      readonly institutionId: string;
      readonly facultyId: string;
      readonly departmentId: string;
      readonly entryYear: number;
    };

export interface LectureAttendeeRecord {
  readonly id: string;
  readonly studentUserId: string | null;
  readonly fullName: string;
  readonly matricNumber: string;
  readonly method: LectureAttendanceMethod;
  readonly deviceHash: string | null;
  readonly distanceMeters: number | null;
  /** Distance outside the venue's shape (0 = inside), before the allowance. */
  readonly outsideMeters?: number | null | undefined;
  readonly accuracyMeters?: number | null | undefined;
  readonly venueOutcome: LectureVenueOutcome | null;
  readonly createdAt: Date;
  readonly removedAt: Date | null;
  readonly removedReason: string | null;
  readonly addedByName: string | null;
  /** Who added the entry by hand, when it was added by hand. */
  readonly addedByUserId?: string | null | undefined;
}

export interface SummarySessionRecord {
  readonly id: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly closedAt: Date | null;
  readonly creatorRole: LectureTakerRole;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly facultyName: string | null;
  readonly presentCount: number;
}

export interface SummaryEntryCounts {
  readonly checkIns: number;
  readonly uniqueStudents: number;
  readonly guestCheckIns: number;
  readonly manualCheckIns: number;
  readonly removedEntries: number;
  readonly sharedDeviceEntries: number;
}

export interface SessionAttendeeRecord extends LectureAttendeeRecord {
  readonly lectureSessionId: string;
}

export interface RegisterCourseRecord {
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionCount: number;
  readonly lastHeldAt: Date;
}

export interface InsertLectureAttendanceInput {
  readonly institutionId: string;
  readonly lectureSessionId: string;
  readonly studentUserId: string | null;
  readonly fullName: string;
  readonly matricNumber: string;
  readonly method: LectureAttendanceMethod;
  readonly deviceHash: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyMeters: number | null;
  readonly distanceMeters: number | null;
  readonly outsideMeters?: number | null | undefined;
  readonly locationSamples?: number | null | undefined;
  readonly venueOutcome: LectureVenueOutcome | null;
  /** Set for students the session taker added by hand. */
  readonly addedByUserId?: string | null | undefined;
  readonly now: Date;
}

export type InsertLectureAttendanceResult =
  | { readonly kind: 'inserted'; readonly record: LectureAttendeeRecord }
  | { readonly kind: 'duplicate'; readonly record: LectureAttendeeRecord };

export interface StudentLectureHistoryRecord {
  readonly id: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly createdAt: Date;
  readonly method: LectureAttendanceMethod;
  readonly venueName: string | null;
  readonly removed: boolean;
  readonly lectureSessionId: string;
  readonly sessionCreatorUserId: string;
}

/** A started session, used to count how many lectures of a course were held. */
export interface HeldSessionRecord {
  readonly id: string;
  readonly courseCode: string;
  readonly createdByUserId: string;
  readonly startsAt: Date;
}

export interface StructureOption {
  readonly id: string;
  readonly name: string;
}

export interface DepartmentOption extends StructureOption {
  readonly facultyId: string;
  readonly facultyName: string;
}

export interface AppointClassRepInput {
  readonly institutionId: string;
  readonly studentUserId: string;
  readonly role: ClassRepRole;
  readonly facultyId: string;
  readonly departmentId: string | null;
  readonly entryYear: number;
  readonly appointedByUserId: string;
  readonly now: Date;
}

export type EnrolledCoursesSubject =
  | { readonly kind: 'lecturer'; readonly userId: string }
  | { readonly kind: 'student'; readonly userId: string }
  | { readonly kind: 'institution'; readonly institutionId: string };

export interface LectureRepository {
  findActor(userId: string): Promise<LectureActorRecord | null>;
  /** The institution's semesters with their academic session's name, newest first. */
  listSemesters(institutionId: string): Promise<SemesterRecord[]>;
  /** Whether the enrolled-course tools are in use (an assignment, enrollment or offering exists). */
  usesEnrolledCourses(subject: EnrolledCoursesSubject): Promise<boolean>;

  createSession(input: CreateLectureSessionInput): Promise<{ readonly kind: 'created'; readonly id: string } | { readonly kind: 'code_taken' }>;
  findSession(sessionId: string): Promise<LectureSessionRecord | null>;
  findSessionByPublicCode(publicCode: string): Promise<LectureSessionRecord | null>;
  /** Open dynamic sessions, for matching a typed rotating code. */
  listOpenDynamicSessions(now: Date): Promise<LectureSessionRecord[]>;
  listSessions(
    userId: string,
    visibility: LectureSessionVisibility,
    limit: number,
    options?: { readonly before?: Date | undefined; readonly query?: string | undefined },
  ): Promise<LectureSessionRecord[]>;
  /** Removes a session and, with it, its attendance list. */
  deleteSession(sessionId: string): Promise<boolean>;
  /** Sessions started since `since` that the user can see, with what the summary needs. */
  listSummarySessions(userId: string, visibility: LectureSessionVisibility, since: Date, limit: number): Promise<SummarySessionRecord[]>;
  /** Attendance-entry counts over the same sessions. */
  summariseEntries(userId: string, visibility: LectureSessionVisibility, since: Date): Promise<SummaryEntryCounts>;
  /** True when the session is among those `listSessions` would show this user. */
  isSessionVisible(sessionId: string, userId: string, visibility: LectureSessionVisibility): Promise<boolean>;
  /** Course codes this user can see, with how many sessions each has had (started sessions only). */
  listRegisterCourses(userId: string, visibility: LectureSessionVisibility, now: Date): Promise<RegisterCourseRecord[]>;
  /** Started sessions of one course code visible to this user, oldest first. */
  listCourseSessions(userId: string, visibility: LectureSessionVisibility, courseCode: string, now: Date, limit: number): Promise<LectureSessionRecord[]>;
  listAttendeesForSessions(sessionIds: readonly string[]): Promise<SessionAttendeeRecord[]>;
  updateSession(sessionId: string, changes: LectureSessionChanges): Promise<void>;

  listAttendees(sessionId: string): Promise<LectureAttendeeRecord[]>;
  findAttendanceByStudent(sessionId: string, studentUserId: string): Promise<LectureAttendeeRecord | null>;
  /** The entries (not removed) this browser already made in the session, oldest first. */
  listActiveAttendanceByDevice(sessionId: string, deviceHash: string): Promise<LectureAttendeeRecord[]>;
  insertAttendance(input: InsertLectureAttendanceInput): Promise<InsertLectureAttendanceResult>;
  /** Rewrites a guest entry; 'matric_taken' when the session already lists that matric number. */
  correctAttendee(input: {
    readonly sessionId: string;
    readonly attendeeId: string;
    readonly fullName: string;
    readonly matricNumber: string;
    readonly studentUserId: string | null;
  }): Promise<'corrected' | 'not_found' | 'matric_taken'>;
  setAttendeeRemoved(input: {
    readonly sessionId: string;
    readonly attendeeId: string;
    readonly removedByUserId: string | null;
    readonly reason: string | null;
    readonly removedAt: Date | null;
  }): Promise<boolean>;
  listStudentHistory(input: { readonly institutionId: string; readonly studentUserId: string; readonly matricNumber: string }): Promise<StudentLectureHistoryRecord[]>;
  /** Started sessions created by any of these people (to count lectures held per course). */
  listHeldSessions(institutionId: string, creatorUserIds: readonly string[], now: Date): Promise<HeldSessionRecord[]>;

  listCourseSuggestions(institutionId: string, userId: string): Promise<Array<{ readonly courseCode: string; readonly courseTitle: string }>>;
  /** Course codes this person opened sessions for, newest first, with the lecturer named on the latest one. */
  listRecentCourseUse(userId: string, limit: number): Promise<Array<{ readonly courseCode: string; readonly lecturerName: string | null }>>;
  /** The institution's own courses (added from the picker or with the course tools). */
  listInstitutionCourses(institutionId: string): Promise<InstitutionCourseRecord[]>;
  insertInstitutionCourse(input: {
    readonly institutionId: string;
    readonly code: string;
    readonly title: string;
    readonly units: number;
    readonly addedByUserId: string;
    readonly now: Date;
  }): Promise<{ readonly kind: 'created'; readonly id: string } | { readonly kind: 'duplicate' }>;
  /**
   * Applies course-list changes and session moves in one transaction. 'code_taken'
   * when a new code clashes with another course (nothing is saved then).
   */
  saveInstitutionCourses(input: {
    readonly institutionId: string;
    readonly writes: readonly CourseListWrite[];
    readonly sessionMoves: readonly CourseSessionMove[];
    readonly now: Date;
  }): Promise<{ readonly kind: 'saved'; readonly ids: readonly string[]; readonly sessionsMoved: number } | { readonly kind: 'code_taken' }>;
  /** Sessions taken per course code (key form, e.g. "GET201"), with how many this user took. */
  countCourseSessions(institutionId: string, userId: string): Promise<Array<{ readonly key: string; readonly total: number; readonly mine: number }>>;
  /** 'in_use' when the older course tools still offer it (offerings keep a reference). */
  deleteInstitutionCourse(institutionId: string, id: string): Promise<'deleted' | 'not_found' | 'in_use'>;
  listVenues(institutionId: string): Promise<LectureVenueRecord[]>;

  listFaculties(institutionId: string): Promise<StructureOption[]>;
  listDepartments(institutionId: string): Promise<DepartmentOption[]>;
  findStudentForAppointment(institutionId: string, query: string): Promise<StudentIdentityRecord | null>;
  findStudentByUserId(institutionId: string, userId: string): Promise<StudentIdentityRecord | null>;
  listClassReps(institutionId: string): Promise<ClassRepRecord[]>;
  findClassRep(institutionId: string, id: string): Promise<ClassRepRecord | null>;
  /** Replaces any live appointment the student already holds. */
  appointClassRep(input: AppointClassRepInput): Promise<string>;
  revokeClassRep(input: { readonly id: string; readonly revokedByUserId: string; readonly now: Date }): Promise<boolean>;
}
