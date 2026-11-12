import { z } from 'zod';

export const userRoles = [
  'student',
  'lecturer',
  'course_coordinator',
  'department_administrator',
  'faculty_administrator',
  'institution_administrator',
  'system_administrator',
] as const;

export const UserRoleSchema = z.enum(userRoles);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const ApiProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
});
export type ApiProblem = z.infer<typeof ApiProblemSchema>;

export const ApiHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('lasuatos-api'),
  timestamp: z.iso.datetime(),
});
export type ApiHealth = z.infer<typeof ApiHealthSchema>;

export const DatabaseReadinessSchema = z.enum(['up', 'down', 'not_configured']);
export type DatabaseReadiness = z.infer<typeof DatabaseReadinessSchema>;

export const ApiReadinessSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    checks: z.object({ database: z.literal('up') }),
  }),
  z.object({
    status: z.literal('not_ready'),
    checks: z.object({ database: z.enum(['down', 'not_configured']) }),
  }),
]);
export type ApiReadiness = z.infer<typeof ApiReadinessSchema>;

export const AuthStudentSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1).max(160),
  accountType: z.literal('student'),
  emailVerified: z.literal(true),
  matricNumber: z.string().min(1).max(64),
  matricNumberVerified: z.boolean(),
  sessionExpiresAt: z.iso.datetime(),
});
export type AuthStudent = z.infer<typeof AuthStudentSchema>;

export const AuthLecturerSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1).max(160),
  accountType: z.literal('lecturer'),
  emailVerified: z.literal(true),
  sessionExpiresAt: z.iso.datetime(),
});
export type AuthLecturer = z.infer<typeof AuthLecturerSchema>;

export const AdministratorRoleSchema = z.enum([
  'department_administrator',
  'faculty_administrator',
  'institution_administrator',
]);
export type AdministratorRole = z.infer<typeof AdministratorRoleSchema>;

const administratorIdentity = {
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1).max(160),
  accountType: z.literal('administrator'),
  emailVerified: z.literal(true),
  institutionName: z.string().min(1).max(200),
  institutionId: z.uuid(),
  sessionExpiresAt: z.iso.datetime(),
} as const;

export const AuthAdministratorSchema = z.discriminatedUnion('role', [
  z.object({
    ...administratorIdentity,
    role: z.literal('institution_administrator'),
    scope: z.object({ type: z.literal('institution'), id: z.uuid(), label: z.string().min(1).max(200) }),
  }),
  z.object({
    ...administratorIdentity,
    role: z.literal('faculty_administrator'),
    scope: z.object({ type: z.literal('faculty'), id: z.uuid(), label: z.string().min(1).max(160) }),
  }),
  z.object({
    ...administratorIdentity,
    role: z.literal('department_administrator'),
    scope: z.object({
      type: z.literal('department'),
      id: z.uuid(),
      label: z.string().min(1).max(160),
      facultyName: z.string().min(1).max(160),
    }),
  }),
]);
export type AuthAdministrator = z.infer<typeof AuthAdministratorSchema>;

export const AuthAccountSchema = z.union([
  AuthStudentSchema,
  AuthLecturerSchema,
  AuthAdministratorSchema,
]);
export type AuthAccount = z.infer<typeof AuthAccountSchema>;

export const AuthenticatedSessionSchema = z.object({
  status: z.literal('authenticated'),
  account: AuthAccountSchema,
});
export type AuthenticatedSession = z.infer<typeof AuthenticatedSessionSchema>;

export const RegistrationAcceptedSchema = z.object({
  status: z.literal('accepted'),
  message: z.string(),
});
export type RegistrationAccepted = z.infer<typeof RegistrationAcceptedSchema>;

export const EmailVerifiedSchema = z.object({
  status: z.literal('verified'),
  student: AuthStudentSchema,
});
export type EmailVerified = z.infer<typeof EmailVerifiedSchema>;

/** Password rule shared by registration, reset and change (length only; passphrases encouraged). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const NewPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Opaque emailed token: 32 random bytes, base64url without padding. */
export const OpaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const PasswordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
}).strict();
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetCompleteSchema = z.object({
  token: OpaqueTokenSchema,
  password: NewPasswordSchema,
}).strict();
export type PasswordResetComplete = z.infer<typeof PasswordResetCompleteSchema>;

export const PasswordResetCompletedSchema = z.object({
  status: z.literal('password_reset'),
  message: z.string(),
});
export type PasswordResetCompleted = z.infer<typeof PasswordResetCompletedSchema>;

export const PasswordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: NewPasswordSchema,
}).strict();
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequestSchema>;

export const PasswordChangedSchema = z.object({
  status: z.literal('password_changed'),
  /** Other sessions signed out as part of the change. */
  revokedSessions: z.number().int().nonnegative(),
});
export type PasswordChanged = z.infer<typeof PasswordChangedSchema>;

/** A sign-in session as shown to its owner. Session tokens are never returned. */
export const AccountSessionSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  current: z.boolean(),
});
export type AccountSession = z.infer<typeof AccountSessionSchema>;

export const AccountSessionsSchema = z.object({
  sessions: z.array(AccountSessionSchema).max(100),
});
export type AccountSessions = z.infer<typeof AccountSessionsSchema>;

export const SessionsRevokedSchema = z.object({
  revokedSessions: z.number().int().nonnegative(),
});
export type SessionsRevoked = z.infer<typeof SessionsRevokedSchema>;

export const CourseOfferingSummarySchema = z.object({
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  departmentName: z.string().min(1).max(160),
  semesterName: z.string().min(1).max(80),
  level: z.string().min(1).max(32),
  semesterEndsAt: z.iso.datetime(),
});
export type CourseOfferingSummary = z.infer<typeof CourseOfferingSummarySchema>;

export const StudentEnrollmentSchema = CourseOfferingSummarySchema.extend({
  enrolledAt: z.iso.datetime(),
});
export type StudentEnrollment = z.infer<typeof StudentEnrollmentSchema>;

export const StudentEnrollmentsSchema = z.object({
  enrollments: z.array(StudentEnrollmentSchema).max(500),
});
export type StudentEnrollments = z.infer<typeof StudentEnrollmentsSchema>;

export const LecturerCourseOfferingSchema = CourseOfferingSummarySchema.extend({
  joinCodeActive: z.boolean(),
});
export type LecturerCourseOffering = z.infer<typeof LecturerCourseOfferingSchema>;

export const LecturerCourseOfferingsSchema = z.object({
  offerings: z.array(LecturerCourseOfferingSchema).max(500),
});
export type LecturerCourseOfferings = z.infer<typeof LecturerCourseOfferingsSchema>;

export const LecturerSemesterSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
export type LecturerSemester = z.infer<typeof LecturerSemesterSchema>;

export const LecturerSemestersSchema = z.object({
  semesters: z.array(LecturerSemesterSchema).max(100),
});
export type LecturerSemesters = z.infer<typeof LecturerSemestersSchema>;

export const AdministratorOverviewSchema = z.object({
  metrics: z.object({
    departments: z.number().int().nonnegative(),
    activeStudents: z.number().int().nonnegative(),
    activeLecturers: z.number().int().nonnegative(),
    courseOfferings: z.number().int().nonnegative(),
    activeEnrollments: z.number().int().nonnegative(),
  }),
});
export type AdministratorOverview = z.infer<typeof AdministratorOverviewSchema>;

export const CreateCourseOfferingRequestSchema = z.object({
  courseCode: z.string().trim().toUpperCase().min(1).max(32).regex(/^[A-Z0-9][A-Z0-9._-]*$/),
  courseTitle: z.string().trim().min(1).max(200),
  creditUnits: z.number().int().min(1).max(30),
  semesterId: z.uuid(),
  level: z.string().trim().min(1).max(32),
}).strict();
export type CreateCourseOfferingRequest = z.infer<typeof CreateCourseOfferingRequestSchema>;

export const CreateCourseOfferingResponseSchema = z.object({
  status: z.enum(['created', 'already_assigned']),
  course: CourseOfferingSummarySchema,
});
export type CreateCourseOfferingResponse = z.infer<typeof CreateCourseOfferingResponseSchema>;

const joinCodePattern = /^[A-HJ-NP-Z2-9]{12}$/;

export const JoinCourseRequestSchema = z.object({
  code: z.string().trim()
    .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().regex(joinCodePattern)),
}).strict();
export type JoinCourseRequest = z.infer<typeof JoinCourseRequestSchema>;

export const JoinCourseResponseSchema = z.object({
  status: z.enum(['enrolled', 'already_enrolled']),
  course: CourseOfferingSummarySchema,
});
export type JoinCourseResponse = z.infer<typeof JoinCourseResponseSchema>;

export const IssueCourseJoinCodeResponseSchema = z.object({
  status: z.literal('issued'),
  code: z.string().regex(joinCodePattern),
  expiresAt: z.iso.datetime(),
  rotated: z.boolean(),
});
export type IssueCourseJoinCodeResponse = z.infer<typeof IssueCourseJoinCodeResponseSchema>;

/* Venue domain: administrator-managed buildings, venues and geofences. */

export const AdminCampusSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  address: z.string().nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  isActive: z.boolean(),
});
export type AdminCampus = z.infer<typeof AdminCampusSchema>;

export const AdminCampusesSchema = z.object({
  campuses: z.array(AdminCampusSchema).max(100),
});
export type AdminCampuses = z.infer<typeof AdminCampusesSchema>;

export const AdminBuildingSchema = z.object({
  id: z.uuid(),
  campusId: z.uuid(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  isActive: z.boolean(),
});
export type AdminBuilding = z.infer<typeof AdminBuildingSchema>;

export const AdminBuildingsSchema = z.object({
  buildings: z.array(AdminBuildingSchema).max(500),
});
export type AdminBuildings = z.infer<typeof AdminBuildingsSchema>;

export const CreateBuildingRequestSchema = z.object({
  campusId: z.uuid(),
  code: z.string().trim().toUpperCase().min(1).max(40).regex(/^[A-Z0-9][A-Z0-9._-]*$/),
  name: z.string().trim().min(1).max(160),
}).strict();
export type CreateBuildingRequest = z.infer<typeof CreateBuildingRequestSchema>;

export const VenueTypeSchema = z.enum([
  'lecture_theatre',
  'classroom',
  'laboratory',
  'hall',
  'seminar_room',
  'workshop',
  'outdoor',
  'other',
]);
export type VenueType = z.infer<typeof VenueTypeSchema>;

export const VenueStatusSchema = z.enum(['pending_review', 'active', 'inactive']);
export type VenueStatus = z.infer<typeof VenueStatusSchema>;

export const AdminVenueSchema = z.object({
  id: z.uuid(),
  campusId: z.uuid(),
  campusName: z.string().min(1).max(160),
  buildingId: z.uuid().nullable(),
  buildingName: z.string().min(1).max(160).nullable(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  venueType: VenueTypeSchema,
  floorLabel: z.string().max(40).nullable(),
  sectionLabel: z.string().max(80).nullable(),
  capacity: z.number().int().positive().nullable(),
  status: VenueStatusSchema,
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  geofenceKind: z.literal('circle'),
  geofenceRadiusMeters: z.number().int().min(5).max(2000).nullable(),
  locationRequired: z.boolean(),
  locationRegisteredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminVenue = z.infer<typeof AdminVenueSchema>;

export const AdminVenuesSchema = z.object({
  venues: z.array(AdminVenueSchema).max(500),
});
export type AdminVenues = z.infer<typeof AdminVenuesSchema>;

export const AdminVenueDetailSchema = z.object({
  venue: AdminVenueSchema,
});
export type AdminVenueDetail = z.infer<typeof AdminVenueDetailSchema>;

const optionalLabel = (max: number) => z.string().trim().max(max).nullable().optional();

export const CreateVenueRequestSchema = z.object({
  campusId: z.uuid(),
  buildingId: z.uuid().nullable().optional(),
  code: z.string().trim().toUpperCase().min(1).max(40).regex(/^[A-Z0-9][A-Z0-9._-]*$/),
  name: z.string().trim().min(1).max(160),
  venueType: VenueTypeSchema,
  floorLabel: optionalLabel(40),
  sectionLabel: optionalLabel(80),
  capacity: z.number().int().min(1).max(20_000).nullable().optional(),
  locationRequired: z.boolean().default(true),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict();
export type CreateVenueRequest = z.infer<typeof CreateVenueRequestSchema>;

export const CreateVenueResponseSchema = z.object({
  status: z.enum(['created', 'already_exists']),
  venue: AdminVenueSchema,
});
export type CreateVenueResponse = z.infer<typeof CreateVenueResponseSchema>;

export const RegisterVenueLocationRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofenceRadiusMeters: z.number().int().min(5).max(2000),
  reportedAccuracyMeters: z.number().min(0).max(10_000).nullable().optional(),
}).strict();
export type RegisterVenueLocationRequest = z.infer<typeof RegisterVenueLocationRequestSchema>;

export const SetVenueStatusRequestSchema = z.object({
  status: z.enum(['active', 'inactive']),
}).strict();
export type SetVenueStatusRequest = z.infer<typeof SetVenueStatusRequestSchema>;

const attendanceCodePattern = /^[A-HJ-NP-Z2-9]{12}$/;

export const CreateAttendanceSessionRequestSchema = z.object({
  courseOfferingId: z.uuid(),
  venueId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160),
  durationMinutes: z.number().int().min(5).max(240),
}).strict();
export type CreateAttendanceSessionRequest = z.infer<typeof CreateAttendanceSessionRequestSchema>;

export const AttendanceSessionsQuerySchema = z.object({
  courseOfferingId: z.uuid().optional(),
}).strict();
export type AttendanceSessionsQuery = z.infer<typeof AttendanceSessionsQuerySchema>;

/** A single browser Geolocation reading, submitted as check-in evidence. */
export const CheckInLocationSampleSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(2000).nullable().optional(),
  capturedAt: z.iso.datetime(),
}).strict();
export type CheckInLocationSample = z.infer<typeof CheckInLocationSampleSchema>;

/**
 * Check-in credential: either the session code typed from the lecturer
 * display, or the QR challenge string scanned from it. Location evidence is
 * optional in the request; the server decides from the session's venue
 * configuration whether it is required, and never trusts a client-supplied
 * distance or outcome.
 */
export const CheckInAttendanceRequestSchema = z.object({
  code: z.string().trim().min(1).max(24).optional(),
  challenge: z.string().trim().startsWith('lasu1.').min(12).max(128).optional(),
  location: CheckInLocationSampleSchema.optional(),
}).strict()
  .refine((value) => Boolean(value.code ?? value.challenge), {
    message: 'An attendance code or a scanned QR challenge is required.',
  });
export type CheckInAttendanceRequest = z.infer<typeof CheckInAttendanceRequestSchema>;

export const AttendanceVenueOutcomeSchema = z.enum(['within_boundary', 'inconclusive']);
export type AttendanceVenueOutcome = z.infer<typeof AttendanceVenueOutcomeSchema>;

/** How a record was created; `manual` records come from an audited lecturer correction. */
export const AttendanceRecordMethodSchema = z.enum(['code', 'qr_code', 'manual']);
export type AttendanceRecordMethod = z.infer<typeof AttendanceRecordMethodSchema>;

/** Whether a record currently counts; revoked records are kept, never deleted. */
export const AttendanceRecordStatusSchema = z.enum(['present', 'revoked']);
export type AttendanceRecordStatus = z.infer<typeof AttendanceRecordStatusSchema>;

export const AttendanceSessionStatusSchema = z.enum(['open', 'closed', 'expired']);
export type AttendanceSessionStatus = z.infer<typeof AttendanceSessionStatusSchema>;

export const AttendanceSessionSummarySchema = z.object({
  id: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  title: z.string().min(1).max(160),
  venueId: z.uuid().nullable(),
  venueCode: z.string().min(1).max(64).nullable(),
  venueName: z.string().min(1).max(160).nullable(),
  locationRequired: z.boolean(),
  status: AttendanceSessionStatusSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  attendanceCount: z.number().int().nonnegative(),
});
export type AttendanceSessionSummary = z.infer<typeof AttendanceSessionSummarySchema>;

export const AttendanceSessionsSchema = z.object({
  sessions: z.array(AttendanceSessionSummarySchema).max(500),
});
export type AttendanceSessions = z.infer<typeof AttendanceSessionsSchema>;

export const AttendanceSessionCreatedSchema = z.object({
  status: z.literal('created'),
  code: z.string().regex(attendanceCodePattern),
  session: AttendanceSessionSummarySchema,
});
export type AttendanceSessionCreated = z.infer<typeof AttendanceSessionCreatedSchema>;

export const AttendanceSessionDetailSchema = z.object({
  session: AttendanceSessionSummarySchema,
  attendees: z.array(z.object({
    studentId: z.uuid(),
    displayName: z.string().min(1).max(160),
    checkedInAt: z.iso.datetime(),
    method: AttendanceRecordMethodSchema,
    venueOutcome: AttendanceVenueOutcomeSchema.nullable(),
    status: AttendanceRecordStatusSchema,
    revokedAt: z.iso.datetime().nullable(),
  })).max(5000),
});
export type AttendanceSessionDetail = z.infer<typeof AttendanceSessionDetailSchema>;

/** Rotating QR challenge for one open session; safe to project publicly. */
export const AttendanceSessionQrChallengeSchema = z.object({
  status: z.literal('ok'),
  challenge: z.string().startsWith('lasu1.').min(12).max(128),
  validUntil: z.iso.datetime(),
  sessionEndsAt: z.iso.datetime(),
});
export type AttendanceSessionQrChallenge = z.infer<typeof AttendanceSessionQrChallengeSchema>;

/** Minimal active venue record for the lecturer session-setup picklist. */
export const LecturerActiveVenueSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  campusName: z.string().min(1).max(120),
  buildingName: z.string().min(1).max(160).nullable(),
  venueType: VenueTypeSchema,
  geofenceRadiusMeters: z.number().int().nullable(),
});
export type LecturerActiveVenue = z.infer<typeof LecturerActiveVenueSchema>;

export const LecturerActiveVenuesSchema = z.object({
  venues: z.array(LecturerActiveVenueSchema).max(500),
});
export type LecturerActiveVenues = z.infer<typeof LecturerActiveVenuesSchema>;

export const AttendanceCodeRotationSchema = z.object({
  status: z.literal('rotated'),
  code: z.string().regex(attendanceCodePattern),
  expiresAt: z.iso.datetime(),
});
export type AttendanceCodeRotation = z.infer<typeof AttendanceCodeRotationSchema>;

export const CloseAttendanceSessionResponseSchema = z.object({
  status: z.enum(['closed', 'already_closed']),
});
export type CloseAttendanceSessionResponse = z.infer<typeof CloseAttendanceSessionResponseSchema>;

export const CheckInAttendanceResponseSchema = z.object({
  status: z.enum(['checked_in', 'already_checked_in']),
  attendance: z.object({
    attendanceSessionId: z.uuid(),
    courseCode: z.string().min(1).max(32),
    courseTitle: z.string().min(1).max(200),
    sessionTitle: z.string().min(1).max(160),
    venueName: z.string().min(1).max(160).nullable(),
    venueOutcome: AttendanceVenueOutcomeSchema.nullable(),
    checkedInAt: z.iso.datetime(),
  }),
});
export type CheckInAttendanceResponse = z.infer<typeof CheckInAttendanceResponseSchema>;

export const StudentAttendanceHistoryEntrySchema = z.object({
  attendanceSessionId: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  sessionTitle: z.string().min(1).max(160),
  venueName: z.string().min(1).max(160).nullable(),
  venueOutcome: AttendanceVenueOutcomeSchema.nullable(),
  method: AttendanceRecordMethodSchema,
  status: AttendanceRecordStatusSchema,
  startsAt: z.iso.datetime(),
  checkedInAt: z.iso.datetime(),
});
export type StudentAttendanceHistoryEntry = z.infer<typeof StudentAttendanceHistoryEntrySchema>;

export const StudentOpenAttendanceSessionSchema = z.object({
  attendanceSessionId: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  sessionTitle: z.string().min(1).max(160),
  venueCode: z.string().min(1).max(64).nullable(),
  venueName: z.string().min(1).max(160).nullable(),
  locationRequired: z.boolean(),
  endsAt: z.iso.datetime(),
});
export type StudentOpenAttendanceSession = z.infer<typeof StudentOpenAttendanceSessionSchema>;

export const StudentOpenAttendanceSessionsSchema = z.object({
  sessions: z.array(StudentOpenAttendanceSessionSchema).max(100),
});
export type StudentOpenAttendanceSessions = z.infer<typeof StudentOpenAttendanceSessionsSchema>;

export const StudentAttendanceHistorySchema = z.object({
  records: z.array(StudentAttendanceHistoryEntrySchema).max(500),
});
export type StudentAttendanceHistory = z.infer<typeof StudentAttendanceHistorySchema>;

/* ------------------------------------------------------------------------ */
/* Attendance corrections, reports and summaries                             */
/* ------------------------------------------------------------------------ */

export const AttendanceCorrectionActionSchema = z.enum(['mark_present', 'revoke']);
export type AttendanceCorrectionAction = z.infer<typeof AttendanceCorrectionActionSchema>;

/**
 * Lecturer correction of one student's record in one session. The reason is
 * mandatory and stored verbatim in the append-only audit trail.
 */
export const AttendanceCorrectionRequestSchema = z.object({
  studentId: z.uuid(),
  action: AttendanceCorrectionActionSchema,
  reason: z.string().trim().min(10).max(500),
}).strict();
export type AttendanceCorrectionRequest = z.infer<typeof AttendanceCorrectionRequestSchema>;

export const AttendanceCorrectionResponseSchema = z.object({
  status: z.enum(['applied', 'unchanged']),
  record: z.object({
    studentId: z.uuid(),
    status: AttendanceRecordStatusSchema,
    method: AttendanceRecordMethodSchema,
    venueOutcome: AttendanceVenueOutcomeSchema.nullable(),
    checkedInAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
  }),
});
export type AttendanceCorrectionResponse = z.infer<typeof AttendanceCorrectionResponseSchema>;

export const AttendanceCorrectionEntrySchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string().min(1).max(160),
  actorName: z.string().min(1).max(160),
  action: AttendanceCorrectionActionSchema,
  previousStatus: AttendanceRecordStatusSchema.nullable(),
  resultingStatus: AttendanceRecordStatusSchema,
  reason: z.string().min(1).max(500),
  /** True when the correction was applied by upholding a student dispute. */
  viaDispute: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AttendanceCorrectionEntry = z.infer<typeof AttendanceCorrectionEntrySchema>;

export const AttendanceCorrectionsSchema = z.object({
  corrections: z.array(AttendanceCorrectionEntrySchema).max(2000),
});
export type AttendanceCorrections = z.infer<typeof AttendanceCorrectionsSchema>;

export const AttendanceReportQuerySchema = z.object({
  /** Attendance-rate threshold (percent) used to flag students. A planning aid, not an official rule. */
  threshold: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type AttendanceReportQuery = z.infer<typeof AttendanceReportQuerySchema>;

/**
 * One student x session cell. The first four values count as attended:
 * `within_boundary` (venue evidence inside the boundary), `inconclusive`
 * (venue evidence uncertain), `unlocated` (no venue boundary applied) and
 * `manual` (recorded by a lecturer correction).
 */
export const AttendanceReportCellSchema = z.enum([
  'within_boundary',
  'inconclusive',
  'unlocated',
  'manual',
  'revoked',
  'absent',
  'not_enrolled',
]);
export type AttendanceReportCell = z.infer<typeof AttendanceReportCellSchema>;

const rateSchema = z.number().min(0).max(100).nullable();

export const AttendanceReportSessionSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  startsAt: z.iso.datetime(),
  status: AttendanceSessionStatusSchema,
  venueName: z.string().min(1).max(160).nullable(),
  expectedCount: z.number().int().nonnegative(),
  presentCount: z.number().int().nonnegative(),
  withinBoundaryCount: z.number().int().nonnegative(),
  inconclusiveCount: z.number().int().nonnegative(),
  unlocatedCount: z.number().int().nonnegative(),
  manualCount: z.number().int().nonnegative(),
  revokedCount: z.number().int().nonnegative(),
  rate: rateSchema,
});
export type AttendanceReportSession = z.infer<typeof AttendanceReportSessionSchema>;

export const AttendanceReportStudentSchema = z.object({
  studentId: z.uuid(),
  displayName: z.string().min(1).max(160),
  /** Self-reported unless `studentNumberVerified` is true. */
  studentNumber: z.string().min(1).max(64),
  studentNumberVerified: z.boolean(),
  enrollmentStatus: z.enum(['active', 'withdrawn', 'completed']),
  enrolledAt: z.iso.datetime(),
  eligibleSessions: z.number().int().nonnegative(),
  attendedSessions: z.number().int().nonnegative(),
  rate: rateSchema,
  belowThreshold: z.boolean(),
  cells: z.array(AttendanceReportCellSchema).max(400),
});
export type AttendanceReportStudent = z.infer<typeof AttendanceReportStudentSchema>;

export const AttendanceReportSchema = z.object({
  offering: z.object({
    id: z.uuid(),
    courseCode: z.string().min(1).max(32),
    courseTitle: z.string().min(1).max(200),
    departmentName: z.string().min(1).max(200),
    semesterLabel: z.string().min(1).max(120),
  }),
  generatedAt: z.iso.datetime(),
  threshold: z.number().int().min(1).max(100),
  totals: z.object({
    sessionsHeld: z.number().int().nonnegative(),
    activeStudents: z.number().int().nonnegative(),
    averageRate: rateSchema,
    studentsBelowThreshold: z.number().int().nonnegative(),
    presentRecords: z.number().int().nonnegative(),
    inconclusiveRecords: z.number().int().nonnegative(),
    manualRecords: z.number().int().nonnegative(),
    revokedRecords: z.number().int().nonnegative(),
    /** Student disputes for this offering awaiting a lecturer decision. */
    openDisputes: z.number().int().nonnegative(),
  }),
  sessions: z.array(AttendanceReportSessionSchema).max(400),
  students: z.array(AttendanceReportStudentSchema).max(5000),
});
export type AttendanceReport = z.infer<typeof AttendanceReportSchema>;

export const StudentAttendanceCourseSummarySchema = z.object({
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  sessionsHeld: z.number().int().nonnegative(),
  attended: z.number().int().nonnegative(),
  revoked: z.number().int().nonnegative(),
  rate: rateSchema,
  lastSessionAt: z.iso.datetime().nullable(),
});
export type StudentAttendanceCourseSummary = z.infer<typeof StudentAttendanceCourseSummarySchema>;

export const StudentAttendanceSummarySchema = z.object({
  courses: z.array(StudentAttendanceCourseSummarySchema).max(200),
});
export type StudentAttendanceSummary = z.infer<typeof StudentAttendanceSummarySchema>;

export const AdministratorAttendanceOfferingSchema = z.object({
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  departmentName: z.string().min(1).max(200),
  semesterLabel: z.string().min(1).max(120),
  sessionsHeld: z.number().int().nonnegative(),
  activeEnrollments: z.number().int().nonnegative(),
  expectedCheckIns: z.number().int().nonnegative(),
  presentCheckIns: z.number().int().nonnegative(),
  inconclusiveCheckIns: z.number().int().nonnegative(),
  manualCheckIns: z.number().int().nonnegative(),
  revokedCheckIns: z.number().int().nonnegative(),
  rate: rateSchema,
  lastSessionAt: z.iso.datetime().nullable(),
  openDisputes: z.number().int().nonnegative(),
  /** Submission time of the oldest dispute still awaiting a decision. */
  oldestOpenDisputeAt: z.iso.datetime().nullable(),
});
export type AdministratorAttendanceOffering = z.infer<typeof AdministratorAttendanceOfferingSchema>;

export const AdministratorAttendanceOverviewSchema = z.object({
  generatedAt: z.iso.datetime(),
  totals: z.object({
    offeringsWithSessions: z.number().int().nonnegative(),
    sessionsHeld: z.number().int().nonnegative(),
    expectedCheckIns: z.number().int().nonnegative(),
    presentCheckIns: z.number().int().nonnegative(),
    inconclusiveCheckIns: z.number().int().nonnegative(),
    manualCheckIns: z.number().int().nonnegative(),
    revokedCheckIns: z.number().int().nonnegative(),
    rate: rateSchema,
    openDisputes: z.number().int().nonnegative(),
    oldestOpenDisputeAt: z.iso.datetime().nullable(),
  }),
  offerings: z.array(AdministratorAttendanceOfferingSchema).max(1000),
});
export type AdministratorAttendanceOverview = z.infer<typeof AdministratorAttendanceOverviewSchema>;

/* ------------------------------------------------------------------------ */
/* Attendance disputes                                                       */
/* ------------------------------------------------------------------------ */

/** Days after a session ends (or is closed) during which a student may dispute it. */
export const ATTENDANCE_DISPUTE_WINDOW_DAYS = 14;
/** Maximum disputes one student may have awaiting a decision at the same time. */
export const MAX_OPEN_ATTENDANCE_DISPUTES = 10;

export const AttendanceDisputeStatusSchema = z.enum(['open', 'upheld', 'rejected', 'withdrawn']);
export type AttendanceDisputeStatus = z.infer<typeof AttendanceDisputeStatusSchema>;

/** Derived by the server: no record at all, or a check-in a lecturer revoked. */
export const AttendanceDisputeKindSchema = z.enum(['missing_check_in', 'revoked_check_in']);
export type AttendanceDisputeKind = z.infer<typeof AttendanceDisputeKindSchema>;

/**
 * A student's account of why they should be credited for a session. It is a
 * request for human review, not evidence in itself.
 */
export const AttendanceDisputeRequestSchema = z.object({
  attendanceSessionId: z.uuid(),
  statement: z.string().trim().min(20).max(1000),
}).strict();
export type AttendanceDisputeRequest = z.infer<typeof AttendanceDisputeRequestSchema>;

export const AttendanceDisputeResolutionRequestSchema = z.object({
  decision: z.enum(['uphold', 'reject']),
  /** Shown to the student and kept with the dispute. */
  note: z.string().trim().min(10).max(500),
}).strict();
export type AttendanceDisputeResolutionRequest = z.infer<typeof AttendanceDisputeResolutionRequestSchema>;

/** The lecturer's most recent revocation, shown so the student can respond to it. */
export const AttendanceRevocationNoticeSchema = z.object({
  reason: z.string().min(1).max(500),
  revokedAt: z.iso.datetime(),
});
export type AttendanceRevocationNotice = z.infer<typeof AttendanceRevocationNoticeSchema>;

export const StudentAttendanceDisputeSchema = z.object({
  id: z.uuid(),
  attendanceSessionId: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  sessionTitle: z.string().min(1).max(160),
  sessionStartsAt: z.iso.datetime(),
  kind: AttendanceDisputeKindSchema,
  status: AttendanceDisputeStatusSchema,
  statement: z.string().min(1).max(1000),
  resolutionNote: z.string().min(1).max(500).nullable(),
  resolvedByName: z.string().min(1).max(160).nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type StudentAttendanceDispute = z.infer<typeof StudentAttendanceDisputeSchema>;

export const StudentDisputableSessionSchema = z.object({
  attendanceSessionId: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  sessionTitle: z.string().min(1).max(160),
  startsAt: z.iso.datetime(),
  kind: AttendanceDisputeKindSchema,
  revocation: AttendanceRevocationNoticeSchema.nullable(),
  /** Last moment a dispute can be submitted. */
  disputeDeadline: z.iso.datetime(),
});
export type StudentDisputableSession = z.infer<typeof StudentDisputableSessionSchema>;

export const StudentAttendanceDisputesSchema = z.object({
  disputes: z.array(StudentAttendanceDisputeSchema).max(500),
  disputableSessions: z.array(StudentDisputableSessionSchema).max(500),
  windowDays: z.number().int().positive(),
  openLimit: z.number().int().positive(),
});
export type StudentAttendanceDisputes = z.infer<typeof StudentAttendanceDisputesSchema>;

export const StudentAttendanceDisputeResponseSchema = z.object({
  dispute: StudentAttendanceDisputeSchema,
});
export type StudentAttendanceDisputeResponse = z.infer<typeof StudentAttendanceDisputeResponseSchema>;

export const LecturerAttendanceDisputesQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'all']).optional(),
  courseOfferingId: z.uuid().optional(),
}).strict();
export type LecturerAttendanceDisputesQuery = z.infer<typeof LecturerAttendanceDisputesQuerySchema>;

export const LecturerAttendanceDisputeSchema = z.object({
  id: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  attendanceSessionId: z.uuid(),
  sessionTitle: z.string().min(1).max(160),
  sessionStartsAt: z.iso.datetime(),
  venueName: z.string().min(1).max(160).nullable(),
  student: z.object({
    id: z.uuid(),
    displayName: z.string().min(1).max(160),
    /** Self-reported unless `studentNumberVerified` is true. */
    studentNumber: z.string().min(1).max(64),
    studentNumberVerified: z.boolean(),
    /** Null when the student no longer has any enrollment row for the offering. */
    enrollmentStatus: z.enum(['active', 'withdrawn', 'completed']).nullable(),
  }),
  kind: AttendanceDisputeKindSchema,
  status: AttendanceDisputeStatusSchema,
  statement: z.string().min(1).max(1000),
  /** The student's current record for the session, if any. */
  record: z.object({
    status: AttendanceRecordStatusSchema,
    method: AttendanceRecordMethodSchema,
    venueOutcome: AttendanceVenueOutcomeSchema.nullable(),
    checkedInAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
  }).nullable(),
  /** The most recent correction to the student's record for this session. */
  lastCorrection: z.object({
    action: AttendanceCorrectionActionSchema,
    reason: z.string().min(1).max(500),
    actorName: z.string().min(1).max(160),
    createdAt: z.iso.datetime(),
  }).nullable(),
  resolutionNote: z.string().min(1).max(500).nullable(),
  resolvedByName: z.string().min(1).max(160).nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type LecturerAttendanceDispute = z.infer<typeof LecturerAttendanceDisputeSchema>;

export const LecturerAttendanceDisputesSchema = z.object({
  disputes: z.array(LecturerAttendanceDisputeSchema).max(500),
  openCount: z.number().int().nonnegative(),
});
export type LecturerAttendanceDisputes = z.infer<typeof LecturerAttendanceDisputesSchema>;

export const LecturerAttendanceDisputeCountSchema = z.object({
  openCount: z.number().int().nonnegative(),
});
export type LecturerAttendanceDisputeCount = z.infer<typeof LecturerAttendanceDisputeCountSchema>;

export const LecturerAttendanceDisputeResolutionResponseSchema = z.object({
  dispute: LecturerAttendanceDisputeSchema,
  /** Outcome of the attendance correction applied when upholding; null when rejected. */
  correction: z.enum(['applied', 'unchanged']).nullable(),
});
export type LecturerAttendanceDisputeResolutionResponse = z.infer<typeof LecturerAttendanceDisputeResolutionResponseSchema>;

/* ---------------------------------------------------------------------------
 * Staff provisioning (Phase 11): invitations, directory and status changes.
 * ------------------------------------------------------------------------- */

export const StaffRoleSchema = z.enum([
  'lecturer',
  'department_administrator',
  'faculty_administrator',
  'institution_administrator',
]);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

export const STAFF_ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  lecturer: 'Lecturer',
  department_administrator: 'Department administrator',
  faculty_administrator: 'Faculty administrator',
  institution_administrator: 'Institution administrator',
};

export const StaffInvitationCreateSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  displayName: z.string().trim().min(1).max(160),
  role: StaffRoleSchema,
  facultyId: z.uuid().nullable().optional(),
  departmentId: z.uuid().nullable().optional(),
  staffNumber: z.string().trim().min(1).max(64).nullable().optional(),
}).strict().superRefine((value, context) => {
  const needsDepartment = value.role === 'lecturer' || value.role === 'department_administrator';
  if (needsDepartment && !value.departmentId) {
    context.addIssue({ code: 'custom', path: ['departmentId'], message: 'Choose a department.' });
  }
  if (value.role === 'faculty_administrator' && !value.facultyId) {
    context.addIssue({ code: 'custom', path: ['facultyId'], message: 'Choose a faculty.' });
  }
  if (value.role === 'lecturer' && !value.staffNumber) {
    context.addIssue({ code: 'custom', path: ['staffNumber'], message: 'Enter the staff number.' });
  }
});
export type StaffInvitationCreate = z.infer<typeof StaffInvitationCreateSchema>;

export const StaffInvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  role: StaffRoleSchema,
  scopeLabel: z.string(),
  staffNumber: z.string().nullable(),
  invitedByName: z.string().nullable(),
  sentAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  expired: z.boolean(),
});
export type StaffInvitation = z.infer<typeof StaffInvitationSchema>;

export const StaffMemberSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  role: StaffRoleSchema,
  scopeLabel: z.string(),
  staffNumber: z.string().nullable(),
  status: z.enum(['active', 'suspended']),
  joinedAt: z.iso.datetime(),
  /** True when the signed-in administrator may suspend or reactivate this person. */
  manageable: z.boolean(),
  isSelf: z.boolean(),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

export const StaffDirectorySchema = z.object({
  members: z.array(StaffMemberSchema),
  invitations: z.array(StaffInvitationSchema),
});
export type StaffDirectory = z.infer<typeof StaffDirectorySchema>;

export const StaffScopeOptionsSchema = z.object({
  allowedRoles: z.array(StaffRoleSchema),
  faculties: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
  departments: z.array(z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    facultyId: z.uuid(),
    facultyName: z.string(),
  })),
});
export type StaffScopeOptions = z.infer<typeof StaffScopeOptionsSchema>;

export const StaffStatusChangeSchema = z.object({
  reason: z.string().trim().min(10).max(500),
}).strict();
export type StaffStatusChange = z.infer<typeof StaffStatusChangeSchema>;

export const StaffInvitationTokenSchema = z.object({ token: OpaqueTokenSchema }).strict();

export const StaffInvitationPreviewSchema = z.object({
  displayName: z.string(),
  email: z.string(),
  role: StaffRoleSchema,
  scopeLabel: z.string(),
  institutionName: z.string(),
  invitedByName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type StaffInvitationPreview = z.infer<typeof StaffInvitationPreviewSchema>;

export const StaffInvitationAcceptSchema = z.object({
  token: OpaqueTokenSchema,
  password: NewPasswordSchema,
}).strict();
export type StaffInvitationAccept = z.infer<typeof StaffInvitationAcceptSchema>;
