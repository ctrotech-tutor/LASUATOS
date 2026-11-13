import type { ClassRepRole, LectureAttendanceMethod, LectureQrMode, LectureTakerRole, LectureVenueOutcome } from '@lasuatos/contracts';

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
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly radiusMeters: number | null;
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
  | { readonly type: 'department'; readonly institutionId: string; readonly departmentId: string };

export interface LectureAttendeeRecord {
  readonly id: string;
  readonly studentUserId: string | null;
  readonly fullName: string;
  readonly matricNumber: string;
  readonly method: LectureAttendanceMethod;
  readonly deviceHash: string | null;
  readonly distanceMeters: number | null;
  readonly venueOutcome: LectureVenueOutcome | null;
  readonly createdAt: Date;
  readonly removedAt: Date | null;
  readonly removedReason: string | null;
  readonly addedByName: string | null;
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

export interface LectureRepository {
  findActor(userId: string): Promise<LectureActorRecord | null>;

  createSession(input: CreateLectureSessionInput): Promise<{ readonly kind: 'created'; readonly id: string } | { readonly kind: 'code_taken' }>;
  findSession(sessionId: string): Promise<LectureSessionRecord | null>;
  findSessionByPublicCode(publicCode: string): Promise<LectureSessionRecord | null>;
  /** Open dynamic sessions, for matching a typed rotating code. */
  listOpenDynamicSessions(now: Date): Promise<LectureSessionRecord[]>;
  listSessions(userId: string, visibility: LectureSessionVisibility, limit: number): Promise<LectureSessionRecord[]>;
  /** Course codes this user can see, with how many sessions each has had (started sessions only). */
  listRegisterCourses(userId: string, visibility: LectureSessionVisibility, now: Date): Promise<RegisterCourseRecord[]>;
  /** Started sessions of one course code visible to this user, oldest first. */
  listCourseSessions(userId: string, visibility: LectureSessionVisibility, courseCode: string, now: Date, limit: number): Promise<LectureSessionRecord[]>;
  listAttendeesForSessions(sessionIds: readonly string[]): Promise<SessionAttendeeRecord[]>;
  updateSession(sessionId: string, changes: LectureSessionChanges): Promise<void>;

  listAttendees(sessionId: string): Promise<LectureAttendeeRecord[]>;
  findAttendanceByStudent(sessionId: string, studentUserId: string): Promise<LectureAttendeeRecord | null>;
  insertAttendance(input: InsertLectureAttendanceInput): Promise<InsertLectureAttendanceResult>;
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
