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
    checks: z.object({ database: z.literal('up'), schema: z.enum(['current', 'unknown']).optional() }),
  }),
  z.object({
    status: z.literal('not_ready'),
    checks: z.object({ database: z.enum(['up', 'down', 'not_configured']), schema: z.literal('behind').optional() }),
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
  /** The university-issued staff number, if recorded. */
  staffNumber: z.string().nullable().optional(),
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
export const PASSWORD_MIN_LENGTH = 8;
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

export const EntryLevelSchema = z.union([z.literal(100), z.literal(200), z.literal(300)]);

/**
 * The signed-in student's academic profile. The level is derived from the
 * entry year in the self-reported matric number (see `deriveStudentLevel`)
 * and is informational only.
 */
export const StudentAcademicProfileSchema = z.object({
  matricNumber: z.string().min(1).max(64),
  matricNumberVerified: z.boolean(),
  /** True when the matric number has the LASU shape the level can be read from. */
  matricRecognized: z.boolean(),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().min(1).max(160).nullable(),
  programmeYears: z.number().int().min(1).max(8),
  entryYear: z.number().int().nullable(),
  entryLevel: EntryLevelSchema,
  sessionLabel: z.string().min(1).max(32),
  yearOfStudy: z.number().int().nullable(),
  level: z.number().int().nullable(),
  levelStatus: z.enum(['derived', 'extra_year', 'not_started', 'unknown']),
  levelLabel: z.string().min(1).max(64),
});
export type StudentAcademicProfile = z.infer<typeof StudentAcademicProfileSchema>;

export const UpdateStudentEntryLevelRequestSchema = z.object({ entryLevel: EntryLevelSchema }).strict();
export type UpdateStudentEntryLevelRequest = z.infer<typeof UpdateStudentEntryLevelRequestSchema>;

/** Active departments a student can pick as their own (sets the programme length used for the level). */
export const StudentDepartmentOptionsSchema = z.object({
  departments: z.array(z.object({
    id: z.uuid(),
    name: z.string().min(1).max(160),
    facultyName: z.string().min(1).max(160),
    programmeYears: z.number().int().min(1).max(8),
  })).max(500),
});
export type StudentDepartmentOptions = z.infer<typeof StudentDepartmentOptionsSchema>;

export const UpdateStudentDepartmentRequestSchema = z.object({ departmentId: z.uuid() }).strict();
export type UpdateStudentDepartmentRequest = z.infer<typeof UpdateStudentDepartmentRequestSchema>;

export const LecturerCourseOfferingSchema = CourseOfferingSummarySchema.extend({
  joinCodeActive: z.boolean(),
  creditUnits: z.number().int().min(0).max(30),
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
  /**
   * Active students grouped by the level derived from their matric numbers
   * (informational; matric numbers are self-reported). Ordered by level,
   * with unknown/not-yet-started groups last.
   */
  studentLevels: z.array(z.object({
    label: z.string().min(1).max(64),
    level: z.number().int().nullable(),
    count: z.number().int().nonnegative(),
  })).max(32),
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

/**
 * Corrects a course offering. The title and credit units belong to the course
 * itself, so a change shows on every offering of that course code.
 */
export const UpdateCourseOfferingRequestSchema = z.object({
  courseTitle: z.string().trim().min(1).max(200).optional(),
  creditUnits: z.number().int().min(1).max(30).optional(),
  level: z.string().trim().min(1).max(32).optional(),
}).strict().refine(
  (value) => value.courseTitle !== undefined || value.creditUnits !== undefined || value.level !== undefined,
  'Change at least one field.',
);
export type UpdateCourseOfferingRequest = z.input<typeof UpdateCourseOfferingRequestSchema>;

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

/** A point on the map, WGS84 degrees. */
export const VenueCoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();
export type VenueCoordinate = z.infer<typeof VenueCoordinateSchema>;

/** A building footprint: corners in order around it (3–24). */
export const VenueOutlineSchema = z.array(VenueCoordinateSchema).min(3).max(24);

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
  /** 'outline': the building's footprint; 'circle': a radius around the centre point. */
  geofenceKind: z.enum(['circle', 'outline']),
  /** Circle: its radius. Outline: centre to furthest corner. */
  geofenceRadiusMeters: z.number().int().min(5).max(2000).nullable(),
  geofenceOutline: VenueOutlineSchema.nullable(),
  /** How far outside the shape a reading may land and still count. */
  geofenceAllowanceMeters: z.number().int().min(0).max(100),
  /** Accuracy of the GPS measurement taken at the venue, when one was used. */
  locationAccuracyMeters: z.number().nonnegative().nullable(),
  locationSampleCount: z.number().int().positive().nullable(),
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

/**
 * Registers or updates where a venue is. Either an outline (the building's
 * corners; the centre and reach are worked out on the server) or a circle
 * (centre and radius), plus the allowance beyond the shape.
 */
export const RegisterVenueLocationRequestSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  geofenceRadiusMeters: z.number().int().min(5).max(2000).optional(),
  outline: VenueOutlineSchema.optional(),
  allowanceMeters: z.number().int().min(0).max(100).optional(),
  /** Accuracy of the GPS measurement taken at the venue (if one was used). */
  reportedAccuracyMeters: z.number().min(0).max(10_000).nullable().optional(),
  sampleCount: z.number().int().min(1).max(10_000).nullable().optional(),
}).strict().refine(
  (value) => value.outline !== undefined
    ? value.latitude === undefined && value.longitude === undefined && value.geofenceRadiusMeters === undefined
    : value.latitude !== undefined && value.longitude !== undefined && value.geofenceRadiusMeters !== undefined,
  'Give either an outline, or a centre (latitude and longitude) and a radius.',
);
export type RegisterVenueLocationRequest = z.infer<typeof RegisterVenueLocationRequestSchema>;

/** A building footprint from OpenStreetMap, offered as a venue outline. */
export const BuildingOutlineSchema = z.object({
  name: z.string().max(160).nullable(),
  osmUrl: z.url(),
  outline: VenueOutlineSchema,
  /** Whether the tapped point is inside the building. */
  containsPoint: z.boolean(),
  /** Distance from the tapped point to the building's walls (0 inside), metres. */
  distanceMeters: z.number().nonnegative(),
  areaSquareMeters: z.number().nonnegative(),
});
export type BuildingOutline = z.infer<typeof BuildingOutlineSchema>;

export const BuildingOutlinesResponseSchema = z.object({
  /** 'unavailable': OpenStreetMap could not be reached. */
  status: z.enum(['ok', 'unavailable']),
  buildings: z.array(BuildingOutlineSchema).max(5),
});
export type BuildingOutlinesResponse = z.infer<typeof BuildingOutlinesResponseSchema>;

export const BuildingOutlinesQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
}).strict();

export const UpdateVenueRequestSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(40).regex(/^[A-Z0-9][A-Z0-9._-]*$/).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  venueType: VenueTypeSchema.optional(),
  buildingId: z.uuid().nullable().optional(),
  floorLabel: optionalLabel(40),
  sectionLabel: optionalLabel(80),
  capacity: z.number().int().min(1).max(20_000).nullable().optional(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined), 'Change at least one field.');
export type UpdateVenueRequest = z.input<typeof UpdateVenueRequestSchema>;

export const UpdateBuildingRequestSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(40).regex(/^[A-Z0-9][A-Z0-9._-]*$/).optional(),
  name: z.string().trim().min(1).max(160).optional(),
}).strict().refine((value) => value.code !== undefined || value.name !== undefined, 'Change at least one field.');
export type UpdateBuildingRequest = z.input<typeof UpdateBuildingRequestSchema>;

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
  /** Refuse typed codes; students must scan the rotating QR shown in the room. */
  qrOnly: z.boolean().optional(),
}).strict();
export type CreateAttendanceSessionRequest = z.infer<typeof CreateAttendanceSessionRequestSchema>;

/** Settings a lecturer may change while a session is open. */
export const UpdateAttendanceSessionSettingsRequestSchema = z.object({
  qrOnly: z.boolean(),
}).strict();
export type UpdateAttendanceSessionSettingsRequest = z.infer<typeof UpdateAttendanceSessionSettingsRequestSchema>;

export const AttendanceSessionsQuerySchema = z.object({
  courseOfferingId: z.uuid().optional(),
}).strict();
export type AttendanceSessionsQuery = z.infer<typeof AttendanceSessionsQuerySchema>;

/**
 * The phone's position, submitted as check-in evidence: usually several
 * browser Geolocation readings combined on the phone (see combineFixes).
 */
export const CheckInLocationSampleSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Up to 100 km, so an approximate (privacy-blurred) position gets a clear answer instead of a validation error. */
  accuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
  capturedAt: z.iso.datetime(),
  /**
   * How old the position was when it was sent, measured on the phone. Used in
   * preference to capturedAt, which depends on the phone's clock being right.
   */
  ageMilliseconds: z.number().int().min(-60_000).max(3_600_000).optional(),
  /** Readings combined into this position. */
  sampleCount: z.number().int().min(1).max(500).optional(),
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
  /**
   * Random browser-local token (not a fingerprint) for the device consistency
   * signal. The server stores only a per-session hash of it.
   */
  deviceToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
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
  qrOnly: z.boolean(),
  status: AttendanceSessionStatusSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  attendanceCount: z.number().int().nonnegative(),
  /** Students whose check-in came from a browser that also checked in someone else this session. */
  sharedDeviceCount: z.number().int().nonnegative().optional(),
});
export type AttendanceSessionSummary = z.infer<typeof AttendanceSessionSummarySchema>;

export const AttendanceSessionsSchema = z.object({
  sessions: z.array(AttendanceSessionSummarySchema).max(500),
});
export type AttendanceSessions = z.infer<typeof AttendanceSessionsSchema>;

export const UpdateAttendanceSessionSettingsResponseSchema = z.object({
  status: z.literal('updated'),
  session: AttendanceSessionSummarySchema,
});
export type UpdateAttendanceSessionSettingsResponse = z.infer<typeof UpdateAttendanceSessionSettingsResponseSchema>;

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
    /**
     * Device consistency signal: the same browser checked in another student
     * in this session. A prompt to look, never proof — classmates do lend
     * phones when a battery dies.
     */
    sharedDevice: z.boolean(),
    studentNumber: z.string().min(1).max(64),
    levelLabel: z.string().min(1).max(64),
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

export const VenueGuideSchema = z.object({
  campusName: z.string().min(1).max(160).nullable(),
  buildingName: z.string().min(1).max(160).nullable(),
  floorLabel: z.string().min(1).max(40).nullable(),
  sectionLabel: z.string().min(1).max(80).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  /** Circle venues: radius around the centre. Outline venues: centre to furthest corner. */
  radiusMeters: z.number().int().positive().nullable(),
  /** The building's footprint, when the venue was registered as an outline. */
  outline: VenueOutlineSchema.nullable().default(null),
  /** How far outside the shape a reading may land and still count. */
  allowanceMeters: z.number().int().min(0).max(100).default(0),
});
export type VenueGuide = z.infer<typeof VenueGuideSchema>;

export const StudentOpenAttendanceSessionSchema = z.object({
  attendanceSessionId: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  sessionTitle: z.string().min(1).max(160),
  venueCode: z.string().min(1).max(64).nullable(),
  venueName: z.string().min(1).max(160).nullable(),
  locationRequired: z.boolean(),
  qrOnly: z.boolean(),
  endsAt: z.iso.datetime(),
  /** How to find the venue on foot. Coordinates only for active venues with a registered location. */
  venueGuide: VenueGuideSchema.nullable().default(null),
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
  /** Derived from the matric number; informational only. */
  levelLabel: z.string().min(1).max(64),
  levelDiffers: z.boolean(),
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

/**
 * A staff number as the university issued it (e.g. LASU's own personnel number).
 * Optional everywhere: the account's email identifies staff here, and this app never
 * makes numbers up. Stored upper case with single spaces.
 */
export const StaffNumberSchema = z.string().trim().min(1).max(64)
  .transform((value) => value.replace(/\s+/g, ' ').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9 ./-]*$/, 'Use letters, digits, spaces, / . or - only.'));

export const StaffInvitationCreateSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  displayName: z.string().trim().min(1).max(160),
  role: StaffRoleSchema,
  facultyId: z.uuid().nullable().optional(),
  departmentId: z.uuid().nullable().optional(),
  /** Optional: the lecturer can add or correct it when they accept the invitation. */
  staffNumber: StaffNumberSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  const needsDepartment = value.role === 'lecturer' || value.role === 'department_administrator';
  if (needsDepartment && !value.departmentId) {
    context.addIssue({ code: 'custom', path: ['departmentId'], message: 'Choose a department.' });
  }
  if (value.role === 'faculty_administrator' && !value.facultyId) {
    context.addIssue({ code: 'custom', path: ['facultyId'], message: 'Choose a faculty.' });
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

/** Corrects a staff member's name or (for lecturers) staff number. */
export const UpdateStaffMemberRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(160).transform((value) => value.replace(/\s+/g, ' ')).optional(),
  /** null removes it. */
  staffNumber: StaffNumberSchema.nullable().optional(),
}).strict().refine((value) => value.displayName !== undefined || value.staffNumber !== undefined, 'Change at least one field.');
export type UpdateStaffMemberRequest = z.input<typeof UpdateStaffMemberRequestSchema>;

export const StaffInvitationTokenSchema = z.object({ token: OpaqueTokenSchema }).strict();

export const StaffInvitationPreviewSchema = z.object({
  displayName: z.string(),
  email: z.string(),
  role: StaffRoleSchema,
  scopeLabel: z.string(),
  institutionName: z.string(),
  invitedByName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  /** What the administrator entered, if anything; a lecturer can correct it on accepting. */
  staffNumber: z.string().nullable(),
});
export type StaffInvitationPreview = z.infer<typeof StaffInvitationPreviewSchema>;

export const StaffInvitationAcceptSchema = z.object({
  token: OpaqueTokenSchema,
  password: NewPasswordSchema,
  /** Lecturers only: their staff number (null = none yet; left out = keep the invitation's). */
  staffNumber: StaffNumberSchema.nullable().optional(),
}).strict();
export type StaffInvitationAccept = z.infer<typeof StaffInvitationAcceptSchema>;

// ---------------------------------------------------------------------------
/**
 * QR check-in links.
 *
 * The lecturer display encodes `https://<site>/check-in#<challenge>` rather
 * than the bare challenge, so any phone camera app opens the check-in page
 * directly. The challenge rides in the URL fragment, which browsers never
 * send to the server, so it does not appear in access logs, proxies or the
 * Referer header.
 *
 * The in-app scanner accepts either form (a full link or a bare challenge)
 * and only ever submits the extracted challenge to this site's own API, so a
 * QR pointing at another origin cannot redirect a student anywhere.
 */

export const CHECK_IN_PATH = '/check-in';

/** `lasu1.<uuid>.<window>.<22-char base64url signature>`, checked loosely here; the server verifies. */
const CHALLENGE_PATTERN = /^lasu1\.[0-9a-fA-F-]{36}\.\d{1,15}\.[A-Za-z0-9_-]{22}$/;

export function isCheckInChallenge(value: string): boolean {
  return CHALLENGE_PATTERN.test(value);
}

/** Builds the link encoded into the projected QR code. */
export function buildCheckInLink(origin: string, challenge: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${CHECK_IN_PATH}#${challenge}`;
}

/**
 * Extracts a challenge from scanned or pasted text: a bare challenge, a
 * check-in link with the challenge in the fragment, or (for robustness) a
 * `?c=` query parameter. Returns null for anything else.
 */
export function extractCheckInChallenge(scanned: string): string | null {
  const text = scanned.trim();
  if (!text || text.length > 512) return null;
  if (isCheckInChallenge(text)) return text;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const candidates: string[] = [];
  if (url.hash.length > 1) candidates.push(url.hash.slice(1));
  const query = url.searchParams.get('c');
  if (query) candidates.push(query);
  for (const candidate of candidates) {
    let decoded = candidate;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      continue;
    }
    if (isCheckInChallenge(decoded)) return decoded;
  }
  return null;
}

// ---------------------------------------------------------------------------
/**
 * Student level derived from the matric number.
 *
 * LASU matriculation numbers are nine (newer sets: up to ten) digits laid out
 * as `YY FF DD SSS`: the two-digit year of the session the student was
 * admitted in, a faculty code, a department code and a serial number — for
 * example `130591039` is a 2013/2014 entrant. Only the entry year is used
 * here. The matric number itself is self-reported at sign-up and is NOT
 * checked against university records, so the derived level is an
 * informational label for students and lecturers, never an authorization
 * input.
 *
 *   year of study = current session start year − entry year + 1
 *   level         = (entry level / 100 + year of study − 1) × 100
 *
 * Direct Entry students declare an entry level of 200 (or 300). The level is
 * capped at the department's programme length (4 years by default, 5 for
 * engineering and law, 6 for medicine); a student past the final year is
 * reported as an extra year at the final level.
 */

export type EntryLevel = 100 | 200 | 300;
export const ENTRY_LEVELS: readonly EntryLevel[] = [100, 200, 300];
export const DEFAULT_PROGRAMME_YEARS = 4;

const MATRIC_PATTERN = /^(\d{2})\d{7,8}$/;

/** Removes spaces, slashes and dashes that students sometimes type into matric numbers. */
export function normalizeMatricNumber(raw: string): string {
  return raw.trim().replace(/[\s/-]+/g, '').toUpperCase();
}

/** True when the value has the LASU matric shape (digits only, 9–10 long). */
export function isLasuMatricNumber(raw: string): boolean {
  return MATRIC_PATTERN.test(normalizeMatricNumber(raw));
}

/**
 * Class lists (and so new student accounts) take LASU matric numbers in
 * today's format only: exactly this many digits, YY + 4-digit programme code
 * + 3-digit serial, e.g. 250211184. Older 10-digit numbers are still read for
 * levels (`isLasuMatricNumber`) but cannot be put on a class list.
 */
export const MATRIC_NUMBER_DIGITS = 9;

export type MatricCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

/**
 * Checks a matric number typed or pasted into a class list (or the sign-up
 * page) and says what is wrong in words. Accepted after tidying: spaces,
 * dashes and slashes between digits, an Excel text marker (') at the start,
 * and a trailing ".0" from a spreadsheet number. Everything else must be digits.
 */
export function checkMatricNumber(raw: string | number | null | undefined): MatricCheck {
  let value = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : '') : String(raw ?? '');
  // Invisible characters copied from web pages and PDFs.
  value = value.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  if (!value) return { ok: false, message: 'Add the matric number.' };
  if (/^\d(\.\d+)?e\+?\d+$/i.test(value)) {
    return { ok: false, message: `The matric number was shortened by the spreadsheet (${value}). Format the column as Text, type the full number, and upload again.` };
  }
  value = value.replace(/^'/, '').replace(/^(\d+)\.0+$/, '$1').replace(/[\s/-]+/g, '');
  const letters = value.match(/[^\d]/g);
  if (letters) {
    const shown = [...new Set(letters)].slice(0, 3).map((character) => `“${character}”`).join(', ');
    const lookalike = /[oOiIlL]/.test(letters.join('')) ? ' (the letter O looks like 0, and I or l like 1)' : '';
    return { ok: false, message: `Matric numbers are digits only: remove ${shown}${lookalike}.` };
  }
  if (value.length !== MATRIC_NUMBER_DIGITS) {
    return {
      ok: false,
      message: `The matric number has ${value.length} digit${value.length === 1 ? '' : 's'}; LASU matric numbers have ${MATRIC_NUMBER_DIGITS} (e.g. 250211184).`,
    };
  }
  return { ok: true, value };
}

export type PersonNameCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

const NAME_WORD = /^[\p{L}][\p{L}\p{M}]*(?:['’-][\p{L}][\p{L}\p{M}]*)*$/u;

/**
 * Names on class lists are letters only (any alphabet, with accents such as
 * Ọlámídé). The one exception is a hyphen or apostrophe joining letters
 * inside a name (Ade-Bello, O’Neil), which is part of the name itself.
 * Digits, dots, initials and other symbols are refused. `words`: 'one' for a
 * surname or first name, 'several' for middle names (separated by spaces).
 */
export function checkPersonName(raw: string | null | undefined, label: string, words: 'one' | 'several' = 'one'): PersonNameCheck {
  const value = String(raw ?? '').normalize('NFC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, message: `Enter the ${label}.` };
  if (value.length > (words === 'one' ? 80 : 120)) return { ok: false, message: `The ${label} is too long.` };
  const bad = value.match(/[^\p{L}\p{M}'’\- ]/gu);
  if (bad) {
    const shown = [...new Set(bad)].slice(0, 3).map((character) => `“${character}”`).join(', ');
    return { ok: false, message: `Use letters only in the ${label}: remove ${shown}.` };
  }
  const parts = value.split(' ');
  if (words === 'one' && parts.length > 1) {
    return { ok: false, message: `The ${label} has ${parts.length} words (“${value}”). Put one name here and the others in the middle name, or join a double name with a hyphen.` };
  }
  for (const part of parts) {
    if (!NAME_WORD.test(part)) {
      return { ok: false, message: `Check the ${label} “${value}”: a hyphen or apostrophe can only join letters.` };
    }
    if ([...part.replace(/[\p{M}'’-]/gu, '')].length < 2) {
      return { ok: false, message: `Write the full ${label}, not an initial (“${part}”).` };
    }
  }
  return { ok: true, value };
}

/**
 * Entry year encoded in a matric number, or null when the format is not
 * recognised. Two-digit years resolve to the latest century that does not
 * place the year more than one year after `referenceYear`.
 */
export function entryYearFromMatric(raw: string, referenceYear: number): number | null {
  const match = MATRIC_PATTERN.exec(normalizeMatricNumber(raw));
  if (!match?.[1]) return null;
  const twoDigit = Number(match[1]);
  const century = Math.floor(referenceYear / 100) * 100;
  let year = century + twoDigit;
  if (year > referenceYear + 1) year -= 100;
  return year;
}

/**
 * First calendar year of an academic session. LASU sessions sometimes start
 * months late (a "2024/2025" session opening in January 2025), so the session
 * code wins over the start date; without either, September is the cut-over.
 */
export function academicSessionStartYear(input: {
  readonly code?: string | null;
  readonly startsAt?: Date | string | null;
  readonly now?: Date;
}): number {
  const fromCode = input.code ? /^(\d{4})\s*[/-]\s*\d{2,4}$/.exec(input.code.trim()) : null;
  if (fromCode?.[1]) return Number(fromCode[1]);
  if (input.startsAt) {
    const date = typeof input.startsAt === 'string' ? new Date(input.startsAt) : input.startsAt;
    if (!Number.isNaN(date.getTime())) return date.getUTCFullYear();
  }
  const now = input.now ?? new Date();
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export type StudentLevelStatus =
  /** Level is within the programme. */
  | 'derived'
  /** The student is past the programme's final year (spill-over / extra year). */
  | 'extra_year'
  /** The entry year is after the current session (typo or future set). */
  | 'not_started'
  /** The matric number format was not recognised. */
  | 'unknown';

export interface StudentLevel {
  readonly status: StudentLevelStatus;
  /** 100, 200, …; null when unknown or not started. */
  readonly level: number | null;
  readonly entryYear: number | null;
  /** 1-based year of study since entry; null when unknown. */
  readonly yearOfStudy: number | null;
  /** Short human label, e.g. "300 Level", "500 Level · extra year", "Level unknown". */
  readonly label: string;
}

export function deriveStudentLevel(input: {
  readonly matricNumber: string;
  /** Overrides the year parsed from the matric number (administrator-corrected). */
  readonly entryYear?: number | null;
  readonly entryLevel?: number | null;
  readonly programmeYears?: number | null;
  readonly sessionStartYear: number;
}): StudentLevel {
  const entryYear = input.entryYear ?? entryYearFromMatric(input.matricNumber, input.sessionStartYear);
  if (entryYear == null) {
    return { status: 'unknown', level: null, entryYear: null, yearOfStudy: null, label: 'Level unknown' };
  }
  const yearOfStudy = input.sessionStartYear - entryYear + 1;
  if (yearOfStudy < 1) {
    return {
      status: 'not_started',
      level: null,
      entryYear,
      yearOfStudy: null,
      label: `Entry ${entryYear}/${entryYear + 1}`,
    };
  }
  const entryLevel = input.entryLevel === 200 || input.entryLevel === 300 ? input.entryLevel : 100;
  const programmeYears = input.programmeYears && input.programmeYears >= 1 && input.programmeYears <= 8
    ? Math.floor(input.programmeYears)
    : DEFAULT_PROGRAMME_YEARS;
  const levelIndex = entryLevel / 100 + yearOfStudy - 1;
  if (levelIndex > programmeYears) {
    const level = programmeYears * 100;
    return { status: 'extra_year', level, entryYear, yearOfStudy, label: `${level} Level · extra year` };
  }
  const level = levelIndex * 100;
  return { status: 'derived', level, entryYear, yearOfStudy, label: `${level} Level` };
}

/** Reads a course-offering level label such as "300", "300L" or "300 Level"; null otherwise. */
export function parseCourseLevel(label: string): number | null {
  const match = /^\s*([1-9]00)\s*(?:l|level|lvl)?\s*$/i.exec(label);
  return match?.[1] ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Academic structure editing (administrators)

const structureCode = (max: number) => z.string().trim().min(1).max(max)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Use letters, digits, dots, dashes, underscores or slashes.')
  .transform((value) => value.toUpperCase());
const structureName = (max: number) => z.string().trim().min(2).max(max);
const programmeYearsSchema = z.number().int().min(1).max(8);

export const InstitutionStructureSchema = z.object({
  permissions: z.object({
    /** Institution administrators add and rename faculties and manage academic sessions. */
    manageFaculties: z.boolean(),
    manageSessions: z.boolean(),
  }),
  faculties: z.array(z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    isActive: z.boolean(),
    canAddDepartment: z.boolean(),
    departments: z.array(z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      isActive: z.boolean(),
      programmeYears: programmeYearsSchema,
      /** Students who selected this department as their own. */
      studentCount: z.number().int().nonnegative(),
      courseOfferingCount: z.number().int().nonnegative(),
      editable: z.boolean(),
      /** Deactivation is for faculty/institution administrators only. */
      canDeactivate: z.boolean(),
    })),
  })),
  academicSessions: z.array(z.object({
    id: z.uuid(),
    code: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    isCurrent: z.boolean(),
    semesters: z.array(z.object({
      id: z.uuid(),
      name: z.string(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
    })),
  })),
});
export type InstitutionStructure = z.infer<typeof InstitutionStructureSchema>;

export const CreateFacultyRequestSchema = z.object({
  code: structureCode(40),
  name: structureName(160),
}).strict();

export const UpdateFacultyRequestSchema = z.object({
  name: structureName(160).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.isActive !== undefined, 'Change at least one field.');

export const CreateDepartmentRequestSchema = z.object({
  facultyId: z.uuid(),
  code: structureCode(40),
  name: structureName(160),
  programmeYears: programmeYearsSchema.default(4),
}).strict();

export const UpdateDepartmentRequestSchema = z.object({
  name: structureName(160).optional(),
  programmeYears: programmeYearsSchema.optional(),
  isActive: z.boolean().optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.programmeYears !== undefined || value.isActive !== undefined,
  'Change at least one field.',
);

const sessionInstant = z.iso.datetime({ offset: true });

interface SessionCalendarInput {
  readonly code: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly semesters: readonly { readonly name: string; readonly startsAt: string; readonly endsAt: string }[];
}

/** Calendar rules shared by creating and editing an academic session. */
function checkSessionCalendar(value: SessionCalendarInput, context: z.RefinementCtx): void {
  const [first, second] = value.code.split('/').map(Number);
  if (first === undefined || second !== first + 1) {
    context.addIssue({ code: 'custom', path: ['code'], message: 'The second year must follow the first, e.g. 2027/2028.' });
  }
  const start = Date.parse(value.startsAt);
  const end = Date.parse(value.endsAt);
  if (!(end > start)) context.addIssue({ code: 'custom', path: ['endsAt'], message: 'The session must end after it starts.' });
  const names = new Set<string>();
  value.semesters.forEach((semester, index) => {
    const semesterStart = Date.parse(semester.startsAt);
    const semesterEnd = Date.parse(semester.endsAt);
    if (!(semesterEnd > semesterStart)) {
      context.addIssue({ code: 'custom', path: ['semesters', index, 'endsAt'], message: 'A semester must end after it starts.' });
    }
    if (semesterStart < start || semesterEnd > end) {
      context.addIssue({ code: 'custom', path: ['semesters', index], message: 'Semesters must fall inside the session.' });
    }
    const key = semester.name.toLowerCase();
    if (names.has(key)) context.addIssue({ code: 'custom', path: ['semesters', index, 'name'], message: 'Semester names must differ.' });
    names.add(key);
  });
  const ordered = value.semesters
    .map((semester, index) => ({ index, start: Date.parse(semester.startsAt), end: Date.parse(semester.endsAt) }))
    .sort((left, right) => left.start - right.start);
  for (let position = 1; position < ordered.length; position += 1) {
    const previous = ordered[position - 1]!;
    const current = ordered[position]!;
    if (current.start < previous.end) {
      context.addIssue({ code: 'custom', path: ['semesters', current.index, 'startsAt'], message: 'Semesters must not overlap.' });
    }
  }
}

const sessionCode = z.string().trim().regex(/^\d{4}\/\d{4}$/, 'Use the form 2027/2028.');

export const CreateAcademicSessionRequestSchema = z.object({
  code: sessionCode,
  startsAt: sessionInstant,
  endsAt: sessionInstant,
  makeCurrent: z.boolean().default(false),
  semesters: z.array(z.object({
    name: structureName(80),
    startsAt: sessionInstant,
    endsAt: sessionInstant,
  }).strict()).min(1).max(3),
}).strict().superRefine(checkSessionCalendar);

/**
 * Corrects an academic session: its code, dates and semesters. Existing
 * semesters are sent back with their id (they cannot be removed, because
 * course offerings point at them); a semester without an id is added.
 */
export const UpdateAcademicSessionRequestSchema = z.object({
  code: sessionCode,
  startsAt: sessionInstant,
  endsAt: sessionInstant,
  semesters: z.array(z.object({
    id: z.uuid().optional(),
    name: structureName(80),
    startsAt: sessionInstant,
    endsAt: sessionInstant,
  }).strict()).min(1).max(3),
}).strict().superRefine(checkSessionCalendar);
export type UpdateAcademicSessionRequest = z.input<typeof UpdateAcademicSessionRequestSchema>;

export const StructureChangeResponseSchema = z.object({ status: z.literal('saved'), id: z.uuid() });
export type StructureChangeResponse = z.infer<typeof StructureChangeResponseSchema>;

/* ------------------------------------------------------------------
 * Lecture sessions: quick attendance opened by a lecturer, an
 * administrator or a class representative (HOC / GHOC) with just a
 * course code and title. Students mark attendance by scanning the QR
 * code or typing the code, with or without an account.
 * ------------------------------------------------------------------ */

export const LECTURE_PATH = '/a';

export const LectureQrModeSchema = z.enum(['dynamic', 'static']);
export type LectureQrMode = z.infer<typeof LectureQrModeSchema>;

export const ClassRepRoleSchema = z.enum(['ghoc', 'hoc']);
export type ClassRepRole = z.infer<typeof ClassRepRoleSchema>;

export const LectureTakerRoleSchema = z.enum(['lecturer', 'administrator', 'ghoc', 'hoc']);
export type LectureTakerRole = z.infer<typeof LectureTakerRoleSchema>;

/**
 * Canonical course code: upper case, single spaces, and a space between the
 * subject letters and the number ("csc301" and "CSC  301" both become "CSC 301"),
 * so one course never splits into two registers.
 */
export function canonicalCourseCode(value: string): string {
  const spaced = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return spaced.replace(/^([A-Z]{2,5})[ ./-]?(\d{3,4}[A-Z]?)$/, '$1 $2');
}

/** Key used to match course codes typed with or without spaces. */
export function courseCodeKey(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

const courseCodeInput = z.string().trim().min(2).max(32).transform(canonicalCourseCode);
const courseTitleInput = z.string().trim().min(2).max(200).transform((value) => value.replace(/\s+/g, ' '));
const personNameInput = z.string().trim().min(3).max(160).transform((value) => value.replace(/\s+/g, ' '));
/** Matric numbers are compared upper case without spaces. */
export const MatricNumberInputSchema = z.string().trim().min(5).max(32)
  .regex(/^[A-Za-z0-9/ -]+$/, 'Use letters, digits, / or - only.')
  .transform((value) => value.replace(/\s+/g, '').toUpperCase());

/**
 * The signed-in person corrects their own details. Any account can fix its
 * name; a student can also correct a mistyped matric number (it sets their
 * level), which needs the current password.
 */
export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(160).transform((value) => value.replace(/\s+/g, ' ')).optional(),
  matricNumber: MatricNumberInputSchema.optional(),
  /** Lecturers: add the staff number once (an administrator corrects it afterwards). */
  staffNumber: StaffNumberSchema.optional(),
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional(),
}).strict().refine((value) => value.displayName !== undefined || value.matricNumber !== undefined || value.staffNumber !== undefined, 'Change at least one field.');
export type UpdateProfileRequest = z.input<typeof UpdateProfileRequestSchema>;

export const ProfileUpdatedSchema = z.object({
  status: z.literal('profile_updated'),
  displayName: z.string(),
  matricNumber: z.string().nullable(),
  staffNumber: z.string().nullable().optional(),
});
export type ProfileUpdated = z.infer<typeof ProfileUpdatedSchema>;

/** What the signed-in account may do with lecture sessions and class reps. */
export const LectureCapabilitiesSchema = z.object({
  canTakeAttendance: z.boolean(),
  role: LectureTakerRoleSchema.nullable(),
  /** e.g. "GHOC · Faculty of Engineering · 2022/2023 set". */
  roleLabel: z.string().max(240).nullable(),
  /** Administrators and GHOCs can appoint class representatives. */
  canManageClassReps: z.boolean(),
  /**
   * Whose attendance they can see besides their own sessions, e.g. "Computer
   * Engineering" for a HOC or "Faculty of Engineering" for a GHOC. Null when
   * they only see sessions they took themselves.
   */
  attendanceScopeLabel: z.string().max(240).nullable(),
  /**
   * Whether the older enrolled-course tools are in use here: the lecturer has a
   * course offering, the student is enrolled in one, or the administrator's
   * institution has offerings. The web app shows those pages only when true.
   */
  usesEnrolledCourses: z.boolean(),
});
export type LectureCapabilities = z.infer<typeof LectureCapabilitiesSchema>;

export const CreateLectureSessionRequestSchema = z.object({
  /** Must be in the course catalog (GET /api/v1/lecture/course-catalog). */
  courseCode: courseCodeInput,
  /** Ignored: the title always comes from the catalog. Accepted so older clients keep working. */
  courseTitle: courseTitleInput.optional(),
  lecturerName: z.string().trim().max(160).optional().transform((value) => (value ? value.replace(/\s+/g, ' ') : undefined)),
  /** Attendance stays open for this long from now. */
  durationMinutes: z.number().int().min(5).max(360),
  qrMode: LectureQrModeSchema,
  venueId: z.uuid().optional(),
  requireVenue: z.boolean().optional(),
}).strict();
export type CreateLectureSessionRequest = z.input<typeof CreateLectureSessionRequestSchema>;

export const UpdateLectureSessionRequestSchema = z.object({
  qrMode: LectureQrModeSchema.optional(),
  /** Adds minutes to the end time (reopens a session that closed on time). */
  extendMinutes: z.number().int().min(5).max(240).optional(),
  close: z.literal(true).optional(),
  /** Corrections to the details typed when the session was opened. */
  courseCode: courseCodeInput.optional(),
  courseTitle: courseTitleInput.optional(),
  /** Empty or null clears the lecturer name. */
  lecturerName: z.string().trim().max(160).nullable().optional()
    .transform((value) => (value === undefined ? undefined : value ? value.replace(/\s+/g, ' ') : null)),
  /** Null removes the venue (and the in-venue check). */
  venueId: z.uuid().nullable().optional(),
  requireVenue: z.boolean().optional(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined), {
  message: 'Nothing to change.',
});
export type UpdateLectureSessionRequest = z.input<typeof UpdateLectureSessionRequestSchema>;

export const LectureSessionStatusSchema = z.enum(['open', 'closed']);

export const LectureSessionSummarySchema = z.object({
  id: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  lecturerName: z.string().max(160).nullable(),
  creatorName: z.string().max(160),
  creatorRole: LectureTakerRoleSchema,
  venueId: z.uuid().nullable(),
  venueName: z.string().max(160).nullable(),
  requireVenue: z.boolean(),
  qrMode: LectureQrModeSchema,
  publicCode: z.string().min(4).max(16),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: LectureSessionStatusSchema,
  presentCount: z.number().int().nonnegative(),
  /**
   * False when the person may only view it: a class representative looking at
   * a session someone else took in their department or faculty.
   */
  canManage: z.boolean(),
});
export type LectureSessionSummary = z.infer<typeof LectureSessionSummarySchema>;

export const LectureSessionListSchema = z.object({
  sessions: z.array(LectureSessionSummarySchema).max(200),
  /** More, older sessions exist: ask again with `before` = the last session's start. */
  hasMore: z.boolean(),
});
export type LectureSessionList = z.infer<typeof LectureSessionListSchema>;

/** `GET /api/v1/lecture/sessions?before=…&q=…` */
export const LectureSessionListQuerySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  /** Course code or title, e.g. "csc 301" or "operating". */
  q: z.string().trim().max(80).optional(),
}).strict();
export type LectureSessionListQuery = z.input<typeof LectureSessionListQuerySchema>;

/** `GET /api/v1/lecture/summary?days=…`: attendance across the sessions the caller can see. */
export const LectureSummaryQuerySchema = z.object({
  days: z.coerce.number().int().refine((value) => [7, 30, 90].includes(value), 'Use 7, 30 or 90 days.').default(30),
}).strict();

export const LectureAttendanceSummarySchema = z.object({
  days: z.number().int(),
  /** Inclusive local (Africa/Lagos) dates of the period, YYYY-MM-DD. */
  from: z.string(),
  to: z.string(),
  totals: z.object({
    sessions: z.number().int().nonnegative(),
    openNow: z.number().int().nonnegative(),
    checkIns: z.number().int().nonnegative(),
    uniqueStudents: z.number().int().nonnegative(),
    /** Entries from students who checked in without an account. */
    guestCheckIns: z.number().int().nonnegative(),
    /** Entries added by hand by the session taker. */
    manualCheckIns: z.number().int().nonnegative(),
    removedEntries: z.number().int().nonnegative(),
    /** Entries from a phone that also marked someone else in the same session. */
    sharedDeviceEntries: z.number().int().nonnegative(),
    courses: z.number().int().nonnegative(),
  }),
  /** One entry per day of the period, oldest first. */
  daily: z.array(z.object({ date: z.string(), sessions: z.number().int(), checkIns: z.number().int() })).max(92),
  departments: z.array(z.object({
    id: z.uuid().nullable(),
    name: z.string(),
    sessions: z.number().int(),
    checkIns: z.number().int(),
  })).max(40),
  courses: z.array(z.object({
    courseCode: z.string(),
    courseTitle: z.string(),
    sessions: z.number().int(),
    checkIns: z.number().int(),
    averagePresent: z.number(),
    lastHeldAt: z.iso.datetime({ offset: true }),
  })).max(20),
  takers: z.object({
    lecturer: z.number().int(),
    ghoc: z.number().int(),
    hoc: z.number().int(),
    administrator: z.number().int(),
  }),
});
export type LectureAttendanceSummary = z.infer<typeof LectureAttendanceSummarySchema>;

/** Deleting a session opened by mistake removes its attendance; confirm with the course code when anyone is on it. */
export const DeleteLectureSessionRequestSchema = z.object({
  confirmCourseCode: z.string().trim().max(40).optional(),
}).strict();

export const LectureVenueOutcomeSchema = z.enum(['within', 'outside', 'inconclusive', 'unavailable']);
export type LectureVenueOutcome = z.infer<typeof LectureVenueOutcomeSchema>;

/** How a student got on the list: scanned the QR, typed the code, or was added by the session taker. */
export const LectureAttendanceMethodSchema = z.enum(['qr', 'code', 'manual']);
export type LectureAttendanceMethod = z.infer<typeof LectureAttendanceMethodSchema>;

export const LectureAttendeeSchema = z.object({
  id: z.uuid(),
  fullName: z.string().min(1).max(160),
  matricNumber: z.string().min(1).max(32),
  /** True when the student was signed in; false for a typed name and matric number. */
  hasAccount: z.boolean(),
  method: LectureAttendanceMethodSchema,
  /** Who added the student by hand (method 'manual'). */
  addedByName: z.string().max(160).nullable(),
  /** Added by hand after attendance had closed (only lecturers and administrators can). */
  addedAfterClose: z.boolean().default(false),
  checkedInAt: z.iso.datetime(),
  venueOutcome: LectureVenueOutcomeSchema.nullable(),
  /** Distance from the venue's centre. */
  distanceMeters: z.number().nonnegative().nullable(),
  /** Distance outside the venue's walls (0 = inside), before the allowance. */
  outsideMeters: z.number().nonnegative().nullable().default(null),
  /** The phone's accuracy radius for that position. */
  accuracyMeters: z.number().nonnegative().nullable().default(null),
  /** How many other entries in this session came from the same phone. */
  sharedDeviceCount: z.number().int().nonnegative(),
  removed: z.boolean(),
  removedReason: z.string().max(300).nullable(),
  /** Face match score of the check-in (0–1); null when no face check applied. */
  faceScore: z.number().min(-1).max(1).nullable().default(null),
  /** True when the face matched but not clearly: a photo is kept to compare with the registered face. */
  faceNeedsReview: z.boolean().default(false),
  /** A reviewer's decision on a close face match. */
  faceReview: z.enum(['approved', 'rejected']).nullable().default(null),
});
export type LectureAttendee = z.infer<typeof LectureAttendeeSchema>;

/**
 * A student whose face check kept failing asks the session taker to add
 * them by hand. The taker sees it on the live session with the student's
 * registered portrait, and adds or declines.
 */
export const LectureHelpRequestSchema = z.object({
  id: z.uuid(),
  fullName: z.string().max(160),
  matricNumber: z.string().max(32),
  /** The last face-check failure, in words (e.g. "Face did not match"). */
  reasonLabel: z.string().max(120),
  failures: z.number().int().nonnegative(),
  venueOutcome: z.enum(['within', 'outside', 'inconclusive', 'unavailable']).nullable(),
  accuracyMeters: z.number().nonnegative().nullable(),
  status: z.enum(['pending', 'added', 'declined']),
  createdAt: z.iso.datetime(),
  /** True when the student has a registered portrait to compare with. */
  hasPhoto: z.boolean(),
});
export type LectureHelpRequest = z.infer<typeof LectureHelpRequestSchema>;

export const LectureSessionDetailSchema = z.object({
  session: LectureSessionSummarySchema,
  attendees: z.array(LectureAttendeeSchema).max(5000),
  canManage: z.boolean(),
  /** Requests to be added by hand (newest first); only for people who can manage the session. */
  helpRequests: z.array(LectureHelpRequestSchema).max(500).default([]),
});
export type LectureSessionDetail = z.infer<typeof LectureSessionDetailSchema>;

/** What the screen or poster shows right now. */
export const LectureQrFrameSchema = z.object({
  mode: LectureQrModeSchema,
  /** Path (from the site origin) encoded in the QR code: `/a#lasu2…` or `/a/CODE`. */
  path: z.string().min(1).max(256),
  /** The code students can type instead: 6 characters (dynamic) or 8 (static). */
  code: z.string().min(4).max(16),
  /** Dynamic only: when to fetch the next frame. */
  rotatesAt: z.iso.datetime().nullable(),
  status: LectureSessionStatusSchema,
  endsAt: z.iso.datetime(),
  presentCount: z.number().int().nonnegative(),
});
export type LectureQrFrame = z.infer<typeof LectureQrFrameSchema>;

export const LectureVenueOptionSchema = z.object({
  id: z.uuid(),
  code: z.string().max(40),
  name: z.string().max(160),
  campusName: z.string().max(160).nullable(),
  /** Location can be checked only when the venue boundary has been registered. */
  hasBoundary: z.boolean(),
});
export const LectureVenueOptionsSchema = z.object({ venues: z.array(LectureVenueOptionSchema).max(1000) });
export type LectureVenueOptions = z.infer<typeof LectureVenueOptionsSchema>;

export const LectureCourseSuggestionsSchema = z.object({
  courses: z.array(z.object({ courseCode: z.string().max(32), courseTitle: z.string().max(200) })).max(500),
});
export type LectureCourseSuggestions = z.infer<typeof LectureCourseSuggestionsSchema>;

/* Course catalog: sessions are opened by picking a course, not typing one. */

/** A course code as the catalog stores it: "GET 201", "ECE 305", "MEE 512L". */
export const CATALOG_COURSE_CODE_PATTERN = /^[A-Z]{2,5} \d{3}[A-Z]?$/;

/** The level a course is taught at, read from its code: GET 201 → 200. Null for codes like ECE 011. */
export function courseLevelFromCode(code: string): number | null {
  const match = /(\d)\d{2}[A-Z]?$/.exec(code.trim().toUpperCase());
  const first = match ? Number(match[1]) : 0;
  return first >= 1 && first <= 8 ? first * 100 : null;
}

export const LectureCourseSourceSchema = z.enum(['standard', 'institution']);
export type LectureCourseSource = z.infer<typeof LectureCourseSourceSchema>;

export const LectureCatalogCourseSchema = z.object({
  /** Set for courses added here; null for the built-in (standard) list. */
  id: z.uuid().nullable(),
  code: z.string().min(2).max(32),
  title: z.string().min(1).max(200),
  units: z.number().int().min(0).max(30).nullable(),
  level: z.number().int().nullable(),
  /** 1 = first (harmattan) semester, 2 = second (rain) semester. */
  semester: z.union([z.literal(1), z.literal(2)]).nullable(),
  /** e.g. "General engineering (GET)" or "Added at LASU". */
  group: z.string().max(80),
  source: LectureCourseSourceSchema,
  addedByName: z.string().max(160).nullable(),
  /** The person who added it, and administrators, can correct or remove it. */
  canEdit: z.boolean(),
  /** The built-in course this is, or takes the place of ("GET 201"); null for departmental courses. */
  builtInCode: z.string().max(32).nullable(),
  /** Hidden from the picker (only administrators see hidden courses). */
  hidden: z.boolean(),
  /** Sessions taken under this code at the institution. */
  sessionCount: z.number().int().min(0),
});
export type LectureCatalogCourse = z.infer<typeof LectureCatalogCourseSchema>;

export const LectureCourseCatalogSchema = z.object({
  courses: z.array(LectureCatalogCourseSchema).max(5000),
  /** Courses this person opened sessions for, newest first, with the lecturer named last time. */
  recent: z.array(z.object({ code: z.string().max(32), lecturerName: z.string().max(160).nullable() })).max(50),
  /** Where the built-in list comes from, shown under the picker. */
  standardSource: z.string().max(300),
  /** Institution and faculty administrators can change built-in courses and rename prefixes. */
  canManage: z.boolean(),
});
export type LectureCourseCatalog = z.infer<typeof LectureCourseCatalogSchema>;

const catalogCodeInput = courseCodeInput.refine((value) => CATALOG_COURSE_CODE_PATTERN.test(value), {
  message: 'Write the course code as letters then numbers, e.g. ECE 305.',
});

/** Adds a departmental course that is not in the catalog yet. */
export const CreateLectureCourseRequestSchema = z.object({
  code: catalogCodeInput,
  title: courseTitleInput,
  units: z.number().int().min(0).max(30),
}).strict();
export type CreateLectureCourseRequest = z.input<typeof CreateLectureCourseRequestSchema>;

/**
 * Corrects a course: its code (courses get recoded, e.g. GET 201 → MEE 201), title,
 * units, or whether the picker shows it. `moveSessions` also renames the sessions
 * already taken under the old code, so their register carries on under the new one.
 */
export const UpdateLectureCourseRequestSchema = z.object({
  code: catalogCodeInput.optional(),
  title: courseTitleInput.optional(),
  units: z.number().int().min(0).max(30).optional(),
  hidden: z.boolean().optional(),
  moveSessions: z.boolean().optional(),
}).strict().refine(
  (value) => value.code !== undefined || value.title !== undefined || value.units !== undefined || value.hidden !== undefined,
  { message: 'Nothing to change.' },
);
export type UpdateLectureCourseRequest = z.input<typeof UpdateLectureCourseRequestSchema>;

export const LectureCourseChangeResultSchema = z.object({
  course: LectureCatalogCourseSchema,
  sessionsMoved: z.number().int().min(0),
});
export type LectureCourseChangeResult = z.infer<typeof LectureCourseChangeResultSchema>;

const coursePrefixInput = z.string().trim().regex(/^[A-Za-z]{2,5}$/, 'Use 2 to 5 letters, e.g. MEE.').transform((value) => value.toUpperCase());

/** Renames every course whose code starts with `from` (GET 201 → MEE 201). `apply: false` previews. */
export const RenameCoursePrefixRequestSchema = z.object({
  from: coursePrefixInput,
  to: coursePrefixInput,
  moveSessions: z.boolean(),
  apply: z.boolean(),
}).strict();
export type RenameCoursePrefixRequest = z.input<typeof RenameCoursePrefixRequestSchema>;

export const RenameCoursePrefixResultSchema = z.object({
  changes: z.array(z.object({
    fromCode: z.string().max(32),
    toCode: z.string().max(32),
    title: z.string().max(200),
    sessionCount: z.number().int().min(0),
  })).max(5000),
  conflicts: z.array(z.object({ fromCode: z.string().max(32), toCode: z.string().max(32), reason: z.string().max(300) })).max(5000),
  applied: z.boolean(),
  sessionsMoved: z.number().int().min(0),
});
export type RenameCoursePrefixResult = z.infer<typeof RenameCoursePrefixResultSchema>;

export const RemoveLectureAttendeeRequestSchema = z.object({
  reason: z.string().trim().max(300).optional(),
  restore: z.boolean().optional(),
}).strict();
export type RemoveLectureAttendeeRequest = z.input<typeof RemoveLectureAttendeeRequestSchema>;

/* Public check-in */

export const ResolveLectureRequestSchema = z.object({
  /** A scanned QR challenge (`lasu2.…`) or a typed code. */
  challenge: z.string().trim().startsWith('lasu2.').max(128).optional(),
  code: z.string().trim().min(4).max(24).optional(),
  /** True when the code came from scanning a printed QR poster rather than typing. */
  scanned: z.boolean().optional(),
}).strict().refine((value) => Boolean(value.challenge ?? value.code), { message: 'Scan the QR code or type the code.' });
export type ResolveLectureRequest = z.input<typeof ResolveLectureRequestSchema>;

/** The way a student turns their head, from their own point of view. */
export const FaceTurnSchema = z.enum(['left', 'right']);
export type FaceTurn = z.infer<typeof FaceTurnSchema>;

export const ResolvedLectureSchema = z.object({
  /** Proof of a valid scan or code, used to submit within ten minutes. */
  ticket: z.string().min(10).max(200),
  ticketExpiresAt: z.iso.datetime(),
  session: z.object({
    id: z.uuid(),
    courseCode: z.string().max(32),
    courseTitle: z.string().max(200),
    lecturerName: z.string().max(160).nullable(),
    takenBy: z.string().max(160),
    endsAt: z.iso.datetime(),
    venueName: z.string().max(160).nullable(),
    venueGuide: VenueGuideSchema.nullable(),
    requireVenue: z.boolean(),
  }),
  /** Present when a student is signed in: they are marked with their account. */
  student: z.object({ fullName: z.string().max(160), matricNumber: z.string().max(32) }).nullable(),
  /** Set when this student (by account) is already marked present. */
  alreadyCheckedInAt: z.iso.datetime().nullable(),
  /**
   * The face check this check-in needs: look at the camera, then turn the head
   * the way `turn` says (chosen per scan, so an old video does not pass).
   */
  face: z.object({
    required: z.boolean(),
    turn: FaceTurnSchema,
    /** For the signed-in student: whether they have registered their face. Null when nobody is signed in. */
    registered: z.boolean().nullable(),
  }).default({ required: false, turn: 'left', registered: null }),
});
export type ResolvedLecture = z.infer<typeof ResolvedLectureSchema>;

/**
 * A student signing in for this one check-in on a classmate's phone. The
 * phone's own session (if any) is left alone and nothing is remembered.
 */
export const OneTimeSignInSchema = z.object({
  /** Email address or matric number. */
  identifier: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
}).strict();
export type OneTimeSignIn = z.infer<typeof OneTimeSignInSchema>;

export const LectureCheckInRequestSchema = z.object({
  ticket: z.string().trim().min(10).max(200),
  /**
   * Marks the student who signs in here instead of the phone's signed-in
   * account. Without it, the signed-in student account is marked.
   */
  signIn: OneTimeSignInSchema.optional(),
  /** No longer used: students mark attendance with their own account. Ignored. */
  fullName: personNameInput.optional(),
  /** No longer used. Ignored. */
  matricNumber: MatricNumberInputSchema.optional(),
  deviceToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  location: CheckInLocationSampleSchema.optional(),
  /** Camera photos for the face check: facing the camera, then turned as the resolve step asked. */
  face: z.object({ frames: z.array(z.lazy(() => FaceFrameSchema)).min(2).max(3) }).strict().optional(),
}).strict();
export type LectureCheckInRequest = z.input<typeof LectureCheckInRequestSchema>;

/**
 * The session taker adds a student by hand (phone dead, no smartphone, etc.).
 * A class rep can do this only while attendance is open and, when the session
 * checks the venue, only from inside it: `location` is their own position.
 */
export const AddLectureAttendeeRequestSchema = z.object({
  fullName: personNameInput,
  matricNumber: MatricNumberInputSchema,
  location: CheckInLocationSampleSchema.optional(),
}).strict();
export type AddLectureAttendeeRequest = z.input<typeof AddLectureAttendeeRequestSchema>;

/**
 * Fixes a typo in the name or matric number a student typed when checking in
 * without an account. Entries linked to an account take both from the account.
 */
export const CorrectLectureAttendeeRequestSchema = z.object({
  fullName: personNameInput.optional(),
  matricNumber: MatricNumberInputSchema.optional(),
}).strict().refine((value) => value.fullName !== undefined || value.matricNumber !== undefined, 'Change the name or the matric number.');
export type CorrectLectureAttendeeRequest = z.input<typeof CorrectLectureAttendeeRequestSchema>;

/** The signed-in student asks to be added by hand after repeated face-check failures. */
export const LectureHelpRequestCreateSchema = z.object({
  ticket: z.string().trim().min(10).max(200),
  location: CheckInLocationSampleSchema.optional(),
}).strict();
export type LectureHelpRequestCreate = z.input<typeof LectureHelpRequestCreateSchema>;

/** What the student's phone shows while waiting for the session taker. */
export const LectureHelpRequestStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['pending', 'added', 'declined']),
  takerName: z.string().max(160),
  courseCode: z.string().max(32),
  fullName: z.string().max(160),
  matricNumber: z.string().max(32),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type LectureHelpRequestStatus = z.infer<typeof LectureHelpRequestStatusSchema>;

/** The session taker adds (or declines) a student who asked for help. `location`: a class rep's own position. */
export const LectureHelpDecisionSchema = z.object({
  decision: z.enum(['add', 'decline']),
  location: CheckInLocationSampleSchema.optional(),
}).strict();
export type LectureHelpDecision = z.input<typeof LectureHelpDecisionSchema>;

/* ---------------- face reviews ---------------- */

/** A check-in whose face matched, but not clearly, waiting for (or after) a person's look. */
export const FaceReviewItemSchema = z.object({
  /** The face check's id. */
  id: z.uuid(),
  sessionId: z.uuid(),
  attendeeId: z.uuid().nullable(),
  courseCode: z.string().max(32),
  courseTitle: z.string().max(200),
  sessionStartsAt: z.iso.datetime(),
  takenBy: z.string().max(160),
  studentName: z.string().max(160),
  matricNumber: z.string().max(32),
  score: z.number().min(-1).max(1),
  checkedInAt: z.iso.datetime(),
  /** pending: not looked at; removed: the check-in was removed some other way. */
  status: z.enum(['pending', 'approved', 'rejected', 'removed']),
  reviewedByName: z.string().max(160).nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  reviewNote: z.string().max(300).nullable(),
  /** The check-in photo is still kept (photos are deleted after the retention period). */
  hasCheckPhoto: z.boolean(),
  hasRegisteredPhoto: z.boolean(),
});
export type FaceReviewItem = z.infer<typeof FaceReviewItemSchema>;

export const FaceReviewListSchema = z.object({
  items: z.array(FaceReviewItemSchema).max(100),
  nextCursor: z.string().max(200).nullable(),
  pendingCount: z.number().int().nonnegative(),
});
export type FaceReviewList = z.infer<typeof FaceReviewListSchema>;

export const FaceReviewDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  /** Required to reject: it is shown on the attendance list as the reason for removal. */
  note: z.string().trim().max(300).optional(),
}).strict().refine((value) => value.decision === 'approve' || (value.note?.length ?? 0) >= 3, {
  message: 'Say why you are rejecting it (it is recorded with the removal).',
  path: ['note'],
});
export type FaceReviewDecision = z.input<typeof FaceReviewDecisionSchema>;

export const CorrectLectureAttendeeResultSchema = z.object({
  status: z.literal('corrected'),
  fullName: z.string(),
  matricNumber: z.string(),
  /** True when the new matric number belongs to a student account, which now owns the entry. */
  linked: z.boolean(),
});
export type CorrectLectureAttendeeResult = z.infer<typeof CorrectLectureAttendeeResultSchema>;

export const LectureCheckInResultSchema = z.object({
  status: z.enum(['checked_in', 'already_checked_in']),
  courseCode: z.string().max(32),
  courseTitle: z.string().max(200),
  fullName: z.string().max(160),
  matricNumber: z.string().max(32),
  checkedInAt: z.iso.datetime(),
  venueOutcome: LectureVenueOutcomeSchema.nullable(),
  /** When the venue was checked: the accuracy of the position it was confirmed with. */
  locationAccuracyMeters: z.number().nonnegative().nullable().default(null),
  /** Face match score when the face was checked. */
  faceScore: z.number().min(-1).max(1).nullable().default(null),
});
export type LectureCheckInResult = z.infer<typeof LectureCheckInResultSchema>;

/** A signed-in student's own lecture check-ins (matched by account or matric number). */
export const StudentLectureHistorySchema = z.object({
  entries: z.array(z.object({
    id: z.uuid(),
    courseCode: z.string().max(32),
    courseTitle: z.string().max(200),
    checkedInAt: z.iso.datetime(),
    method: LectureAttendanceMethodSchema,
    venueName: z.string().max(160).nullable(),
    removed: z.boolean(),
  })).max(500),
  /**
   * Per course: sessions held by the people whose sessions this student attended,
   * and how many of those the student attended — the same numbers as their register.
   */
  courses: z.array(z.object({
    courseCode: z.string().max(32),
    courseTitle: z.string().max(200),
    held: z.number().int().nonnegative(),
    attended: z.number().int().nonnegative(),
    rate: z.number().min(0).max(100),
  })).max(200),
});
export type StudentLectureHistory = z.infer<typeof StudentLectureHistorySchema>;

/* Class representatives */

export const ClassRepSchema = z.object({
  id: z.uuid(),
  role: ClassRepRoleSchema,
  studentName: z.string().max(160),
  matricNumber: z.string().max(64),
  email: z.string().max(320),
  facultyName: z.string().max(160),
  departmentName: z.string().max(160).nullable(),
  entryYear: z.number().int(),
  /** e.g. "2022/2023 set". */
  setLabel: z.string().max(40),
  appointedAt: z.iso.datetime(),
  appointedByName: z.string().max(160),
});
export type ClassRep = z.infer<typeof ClassRepSchema>;

export const ClassRepListSchema = z.object({
  reps: z.array(ClassRepSchema).max(2000),
  /** Departments the caller may appoint a HOC for. */
  departments: z.array(z.object({ id: z.uuid(), name: z.string().max(160), facultyId: z.uuid(), facultyName: z.string().max(160) })).max(1000),
  /** Faculties the caller may appoint a GHOC for (empty for a GHOC). */
  faculties: z.array(z.object({ id: z.uuid(), name: z.string().max(160) })).max(200),
  /** A GHOC can appoint HOCs only for their own set. */
  fixedEntryYear: z.number().int().nullable(),
});
export type ClassRepList = z.infer<typeof ClassRepListSchema>;

export const ClassRepStudentLookupRequestSchema = z.object({ query: z.string().trim().min(3).max(320) }).strict();
export const ClassRepStudentSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().max(160),
  matricNumber: z.string().max(64),
  email: z.string().max(320),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().max(160).nullable(),
  facultyId: z.uuid().nullable(),
  facultyName: z.string().max(160).nullable(),
  /** From the matric number when it can be read. */
  entryYear: z.number().int().nullable(),
  currentRole: z.string().max(240).nullable(),
});
export type ClassRepStudent = z.infer<typeof ClassRepStudentSchema>;

export const AppointClassRepRequestSchema = z.object({
  studentUserId: z.uuid(),
  role: ClassRepRoleSchema,
  /** HOC: the department. GHOC: omit and give facultyId. */
  departmentId: z.uuid().optional(),
  facultyId: z.uuid().optional(),
  entryYear: z.number().int().min(1950).max(2200),
}).strict();
export type AppointClassRepRequest = z.infer<typeof AppointClassRepRequestSchema>;

/** "2022/2023 set" for entry year 2022. */
export function academicSetLabel(entryYear: number): string {
  return `${entryYear}/${entryYear + 1} set`;
}

/**
 * Reads what a scanned QR code or typed text points at: a lecture QR
 * challenge, a course session challenge (`/check-in`), or a typed code.
 */
export function readAttendanceScan(scanned: string):
  | { readonly kind: 'lecture'; readonly challenge: string }
  | { readonly kind: 'lecture_code'; readonly code: string }
  | { readonly kind: 'course'; readonly challenge: string }
  | null {
  const text = scanned.trim();
  if (!text || text.length > 512) return null;
  if (/^lasu2\.[0-9a-fA-F-]{36}\.\d{1,15}\.[A-Za-z0-9_-]{22}$/.test(text)) return { kind: 'lecture', challenge: text };
  const course = extractCheckInChallenge(text);
  if (course) return { kind: 'course', challenge: course };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return code.length >= 6 && code.length <= 10 ? { kind: 'lecture_code', code } : null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  let fragment = url.hash.slice(1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    fragment = '';
  }
  if (/^lasu2\.[0-9a-fA-F-]{36}\.\d{1,15}\.[A-Za-z0-9_-]{22}$/.test(fragment)) return { kind: 'lecture', challenge: fragment };
  const match = /^\/a\/([A-Za-z0-9-]{6,12})\/?$/.exec(url.pathname);
  if (match?.[1]) return { kind: 'lecture_code', code: match[1].toUpperCase().replace(/[^A-Z0-9]/g, '') };
  return null;
}

/* Course registers: attendance across every session of one course code */

/** The minimum attendance commonly required to sit the examination. */
export const DEFAULT_ATTENDANCE_THRESHOLD = 75;

export const LectureRegisterCoursesSchema = z.object({
  courses: z.array(z.object({
    courseCode: z.string().max(32),
    courseTitle: z.string().max(200),
    sessionCount: z.number().int().nonnegative(),
    lastHeldAt: z.iso.datetime(),
  })).max(500),
});
export type LectureRegisterCourses = z.infer<typeof LectureRegisterCoursesSchema>;

export const LectureRegisterQuerySchema = z.object({
  course: courseCodeInput,
  /**
   * Which semester's sessions to count: a semester id, `other` (sessions outside
   * every semester's dates) or `all`. Omitted: the semester of the latest session.
   */
  term: z.union([z.uuid(), z.literal('other'), z.literal('all')]).optional(),
}).strict();

/** A semester (or the catch-all buckets) a course register can be limited to. */
export const LectureRegisterTermSchema = z.object({
  id: z.union([z.uuid(), z.literal('other'), z.literal('all')]),
  label: z.string().max(200),
  sessionCount: z.number().int().nonnegative(),
});
export type LectureRegisterTerm = z.infer<typeof LectureRegisterTermSchema>;

export const LectureRegisterSchema = z.object({
  courseCode: z.string().max(32),
  courseTitle: z.string().max(200),
  /**
   * The semester this register counts. Null when the institution has not set
   * semester dates, in which case every session of the course is counted.
   */
  term: LectureRegisterTermSchema.nullable(),
  /** Semesters with sessions of this course, newest first, then `other` and `all`. Empty without semester dates. */
  terms: z.array(LectureRegisterTermSchema).max(200),
  /** Sessions that have started, oldest first. */
  sessions: z.array(z.object({
    id: z.uuid(),
    startsAt: z.iso.datetime(),
    takenBy: z.string().max(160),
    presentCount: z.number().int().nonnegative(),
  })).max(400),
  students: z.array(z.object({
    matricNumber: z.string().max(32),
    fullName: z.string().max(160),
    hasAccount: z.boolean(),
    /** One entry per session, in the same order as `sessions`. */
    present: z.array(z.boolean()),
    attended: z.number().int().nonnegative(),
    /** Percentage 0–100, one decimal place. */
    rate: z.number().min(0).max(100),
  })).max(5000),
  generatedAt: z.iso.datetime(),
});
export type LectureRegister = z.infer<typeof LectureRegisterSchema>;


/* ------------------------------------------------------------------ */
/* Students: class lists, LASU email, starting password, face           */
/* ------------------------------------------------------------------ */

/** Every LASU student has a Google Workspace address on this domain. */
export const LASU_STUDENT_EMAIL_DOMAIN = 'st.lasu.edu.ng';

export function isLasuStudentEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  return at > 0 && email.slice(at + 1) === LASU_STUDENT_EMAIL_DOMAIN && /^[a-z0-9._%+-]+$/.test(email.slice(0, at));
}

export const LasuStudentEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(320))
  .refine(isLasuStudentEmail, { message: `Use your LASU student email (…@${LASU_STUDENT_EMAIL_DOMAIN}).` });

/** Upper case letters and digits only, accents removed: how starting passwords are compared. */
export function normalizeStartingPassword(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The starting password, in LASU's portal style: LASU + matric number +
 * SURNAME, e.g. LASU250211184ODEJOBI. Compared without regard to case,
 * spaces or hyphens, so "lasu 250211184 Odejobi" also works.
 */
export function startingPassword(matricNumber: string, surname: string): string {
  return `LASU${normalizeMatricNumber(matricNumber)}${normalizeStartingPassword(surname)}`;
}

/** "ODEJOBI" / "ade-bello" / "o'neil" → "Odejobi" / "Ade-Bello" / "O'Neil". Spaces collapsed. */
export function tidyPersonName(value: string): string {
  const collapsed = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  return collapsed.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

/** "First Middle Surname", the name shown on registers and greetings. */
export function studentDisplayName(parts: { readonly firstName: string; readonly middleName?: string | null; readonly surname: string }): string {
  return [parts.firstName, parts.middleName ?? '', parts.surname].map((part) => part.trim()).filter(Boolean).join(' ');
}

/** "ODEJOBI A. O." for showing a list entry to someone who has only typed a matric number. */
export function maskedStudentName(parts: { readonly firstName: string; readonly middleName?: string | null; readonly surname: string }): string {
  const initials = [parts.firstName, ...(parts.middleName ?? '').split(/\s+/)]
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}.`);
  return [parts.surname.toUpperCase(), ...initials].join(' ');
}

/** "od•••••@st.lasu.edu.ng" */
export function maskedEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const shown = local.slice(0, Math.min(2, local.length));
  return `${shown}${'•'.repeat(Math.max(3, Math.min(8, local.length - shown.length)))}${email.slice(at)}`;
}

/** A surname or first name: letters only, one word (see checkPersonName). */
const nameField = (label: string) => z
  .string()
  .max(200)
  .superRefine((value, context) => {
    const check = checkPersonName(value, label, 'one');
    if (!check.ok) context.addIssue({ code: 'custom', message: check.message });
  })
  .transform((value) => value.normalize('NFC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim());

/** Optional middle names: letters only, several words allowed; empty means none. */
const middleNameField = z
  .string()
  .max(240)
  .superRefine((value, context) => {
    if (!value.trim()) return;
    const check = checkPersonName(value, 'middle name', 'several');
    if (!check.ok) context.addIssue({ code: 'custom', message: check.message });
  })
  .transform((value) => value.normalize('NFC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim())
  .nullable()
  .optional();

/** A class-list matric number: digits only, MATRIC_NUMBER_DIGITS long (see checkMatricNumber). */
const classListMatricField = z
  .union([z.string().max(64), z.number()])
  .transform((value, context) => {
    const check = checkMatricNumber(value);
    if (!check.ok) {
      context.addIssue({ code: 'custom', message: check.message });
      return z.NEVER;
    }
    return check.value;
  });

export const StudentSetupSchema = z.object({
  /** The student's entry on their class list, when there is one. */
  classList: z.object({
    surname: z.string(),
    firstName: z.string(),
    middleName: z.string().nullable(),
    departmentName: z.string(),
    facultyName: z.string(),
    levelLabel: z.string(),
    setLabel: z.string(),
    /** The LASU email on the list, masked; null when the HOC did not give one. */
    listedEmail: z.string().nullable(),
  }).nullable(),
  /** True once a code sent to their LASU address was entered. */
  emailVerified: z.boolean(),
  /** The account's LASU address once verified. */
  lasuEmail: z.string().nullable(),
  faceRequired: z.boolean(),
  faceRegistered: z.boolean(),
  /** True while the LASU-style starting password is still in use. */
  defaultPassword: z.boolean(),
  /** When the registered face was taken; null when none is registered. */
  faceEnrolledAt: z.iso.datetime().nullable().default(null),
  /** Set while the student may take new face photos (after confirming with password and email code). */
  faceReplaceAllowedUntil: z.iso.datetime().nullable().default(null),
  /** On the class list, email verified and (when required) face registered: ready to mark attendance. */
  complete: z.boolean(),
});
export type StudentSetup = z.infer<typeof StudentSetupSchema>;

export const ClassListLookupRequestSchema = z.object({ matricNumber: MatricNumberInputSchema }).strict();
export type ClassListLookupRequest = z.input<typeof ClassListLookupRequestSchema>;

export const ClassListLookupResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    matricNumber: z.string(),
    /** "ODEJOBI A. O." */
    maskedName: z.string(),
    departmentName: z.string(),
    levelLabel: z.string(),
    /** True when an account already exists: sign in instead of starting. */
    hasAccount: z.boolean(),
    // Whether the account still uses the starting password is never said here:
    // anyone can type a matric number, and it would point at guessable accounts.
    /** True when the class list has their LASU email (the code goes there); false: the student types it. */
    emailOnList: z.boolean(),
  }),
  z.object({ status: z.literal('not_found'), matricNumber: z.string() }),
]);
export type ClassListLookupResult = z.infer<typeof ClassListLookupResultSchema>;

/** Opening an account: send a code to the LASU address (the listed one unless the list has none). */
export const OpenAccountCodeRequestSchema = z.object({
  matricNumber: MatricNumberInputSchema,
  email: LasuStudentEmailSchema.optional(),
}).strict();
export type OpenAccountCodeRequest = z.input<typeof OpenAccountCodeRequestSchema>;

export const OpenAccountRequestSchema = z.object({
  matricNumber: MatricNumberInputSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
}).strict();
export type OpenAccountRequest = z.input<typeof OpenAccountRequestSchema>;

export const OpenAccountResultSchema = z.object({
  status: z.literal('opened'),
  student: AuthStudentSchema,
  /** The LASU-style starting password, shown once so the student can note it. */
  startingPassword: z.string(),
});
export type OpenAccountResult = z.infer<typeof OpenAccountResultSchema>;

/** A signed-in student confirming their LASU address (the listed one unless the list has none). */
export const StudentEmailCodeRequestSchema = z.object({ email: LasuStudentEmailSchema.optional() }).strict();
export type StudentEmailCodeRequest = z.input<typeof StudentEmailCodeRequestSchema>;

export const StudentEmailCodeSentSchema = z.object({
  status: z.literal('sent'),
  email: z.string(),
  expiresInSeconds: z.number().int().positive(),
  resendInSeconds: z.number().int().nonnegative(),
});
export type StudentEmailCodeSent = z.infer<typeof StudentEmailCodeSentSchema>;

export const StudentEmailVerifyRequestSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
}).strict();
export type StudentEmailVerifyRequest = z.input<typeof StudentEmailVerifyRequestSchema>;

export const StudentEmailVerifiedSchema = z.object({ status: z.literal('verified'), email: z.string() });
export type StudentEmailVerified = z.infer<typeof StudentEmailVerifiedSchema>;

/* ---------------- class list management ---------------- */

export const ClassListEntryStageSchema = z.enum([
  /** No account yet: the student has not signed in. */
  'not_joined',
  /** Signed in, LASU email not confirmed. */
  'joined',
  /** LASU email confirmed, face not registered. */
  'email_confirmed',
  /** Face registered: ready to mark attendance. */
  'ready',
]);
export type ClassListEntryStage = z.infer<typeof ClassListEntryStageSchema>;

export const ClassListEntrySchema = z.object({
  id: z.uuid(),
  matricNumber: z.string(),
  surname: z.string(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lasuEmail: z.string().nullable(),
  entryYear: z.number().int(),
  entryLevel: z.union([z.literal(100), z.literal(200), z.literal(300)]),
  levelLabel: z.string(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  stage: ClassListEntryStageSchema,
  userId: z.uuid().nullable(),
  /** True when the student is a HOC or GHOC. */
  isRep: z.boolean(),
  addedByName: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ClassListEntry = z.infer<typeof ClassListEntrySchema>;

export const ClassListSchema = z.object({
  departments: z.array(z.object({ id: z.uuid(), name: z.string(), facultyName: z.string() })).max(500),
  /** Set when the viewer may only manage one department (a HOC, a department administrator). */
  fixedDepartmentId: z.uuid().nullable(),
  /** Set when the viewer may only manage one set (a HOC or GHOC). */
  fixedEntryYear: z.number().int().nullable(),
  departmentId: z.uuid().nullable(),
  entryYear: z.number().int().nullable(),
  setLabel: z.string().nullable(),
  entries: z.array(ClassListEntrySchema).max(3000),
  counts: z.object({
    total: z.number().int().nonnegative(),
    joined: z.number().int().nonnegative(),
    emailConfirmed: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
  }),
  faceRequired: z.boolean(),
  /** True when the viewer may reset registered faces (administrators). */
  canResetFaces: z.boolean(),
  /** Recent changes to this list, newest first. */
  history: z.array(z.object({
    id: z.uuid(),
    action: z.string(),
    summary: z.string(),
    actorName: z.string().nullable(),
    matricNumber: z.string().nullable(),
    at: z.iso.datetime(),
  })).max(100),
});
export type ClassList = z.infer<typeof ClassListSchema>;

/**
 * One row of an uploaded class list, as the browser read it. Rows are not
 * validated here: the server checks each one with checkMatricNumber and
 * checkPersonName and reports every problem by row number, so one bad row
 * never hides the others. (Single-entry edits, below, are validated strictly.)
 */
export const ClassListRowInputSchema = z.object({
  matricNumber: z.union([z.string().max(64), z.number()]).transform((value) => String(value)),
  surname: z.string().max(200),
  firstName: z.string().max(200),
  middleName: z.string().max(240).nullable().optional(),
  lasuEmail: z.string().trim().max(320).nullable().optional(),
  entryLevel: z.union([z.literal(100), z.literal(200), z.literal(300)]).optional(),
}).strict();
export type ClassListRowInput = z.input<typeof ClassListRowInputSchema>;

export const ClassListImportRequestSchema = z.object({
  departmentId: z.uuid(),
  entryYear: z.number().int().min(1950).max(2200),
  rows: z.array(ClassListRowInputSchema).min(1).max(1500),
  /** False: check only and report what would change. */
  apply: z.boolean(),
}).strict();
export type ClassListImportRequest = z.input<typeof ClassListImportRequestSchema>;

export const ClassListImportProblemSchema = z.object({
  /** 1-based row in the request. */
  row: z.number().int().positive(),
  matricNumber: z.string(),
  kind: z.enum(['error', 'warning']),
  message: z.string(),
});
export type ClassListImportProblem = z.infer<typeof ClassListImportProblemSchema>;

export const ClassListImportResultSchema = z.object({
  applied: z.boolean(),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  /** Entries matched to a student account that already existed. */
  linked: z.number().int().nonnegative(),
  problems: z.array(ClassListImportProblemSchema).max(3000),
});
export type ClassListImportResult = z.infer<typeof ClassListImportResultSchema>;

export const ClassListEntryUpdateSchema = z.object({
  matricNumber: classListMatricField.optional(),
  surname: nameField('surname').optional(),
  firstName: nameField('first name').optional(),
  middleName: middleNameField,
  lasuEmail: z.string().trim().max(320).nullable().optional(),
  entryLevel: z.union([z.literal(100), z.literal(200), z.literal(300)]).optional(),
}).strict();
export type ClassListEntryUpdate = z.input<typeof ClassListEntryUpdateSchema>;

/* ---------------- faces ---------------- */

export const FacePoseSchema = z.enum(['front', 'left', 'right']);
export type FacePose = z.infer<typeof FacePoseSchema>;

/** One camera frame: a JPEG, base64 without the data: prefix, at most about 500 KB. */
export const FaceFrameSchema = z.object({
  pose: FacePoseSchema,
  image: z.string().min(1000).max(700_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type FaceFrame = z.infer<typeof FaceFrameSchema>;

export const FaceEnrollRequestSchema = z.object({
  /** The student agreed to the face notice shown before the camera opened. */
  consent: z.literal(true),
  frames: z.array(FaceFrameSchema).min(3).max(6),
}).strict();
export type FaceEnrollRequest = z.infer<typeof FaceEnrollRequestSchema>;

export const FaceEnrollResultSchema = z.object({ status: z.literal('registered'), enrolledAt: z.iso.datetime() });
export type FaceEnrollResult = z.infer<typeof FaceEnrollResultSchema>;

/** Students take new face photos: confirm with the current password, then an emailed code. */
export const FaceReplaceCodeRequestSchema = z.object({
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
}).strict();
export type FaceReplaceCodeRequest = z.input<typeof FaceReplaceCodeRequestSchema>;

export const FaceReplaceConfirmedSchema = z.object({
  status: z.literal('confirmed'),
  allowedUntil: z.iso.datetime(),
});
export type FaceReplaceConfirmed = z.infer<typeof FaceReplaceConfirmedSchema>;

export const FaceReplacedSchema = z.object({ status: z.literal('replaced'), enrolledAt: z.iso.datetime() });
export type FaceReplaced = z.infer<typeof FaceReplacedSchema>;

/* ---------------- audit log (administrators) ---------------- */

export const AuditCategorySchema = z.enum(['students', 'faces', 'attendance', 'staff', 'structure', 'venues', 'retention']);
export type AuditCategory = z.infer<typeof AuditCategorySchema>;

export const AuditLogQuerySchema = z.object({
  category: AuditCategorySchema.optional(),
  /** Matric number, name or email of the person acted on or acting. */
  q: z.string().trim().max(120).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().max(200).optional(),
}).strict();
export type AuditLogQuery = z.input<typeof AuditLogQuerySchema>;

export const AuditLogEntrySchema = z.object({
  /** Unique across sources: "<source>:<uuid>". */
  id: z.string().max(80),
  category: AuditCategorySchema,
  action: z.string().max(64),
  summary: z.string().max(200),
  actorName: z.string().max(160).nullable(),
  /** Who or what was acted on (a student's name and matric, a venue, a department…). */
  subject: z.string().max(240).nullable(),
  /** Field names, counts and scores: never photos or face signatures. */
  details: z.string().max(2000),
  at: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AuditLogPageSchema = z.object({
  entries: z.array(AuditLogEntrySchema).max(100),
  nextCursor: z.string().max(200).nullable(),
  scopeLabel: z.string().max(200),
  /** Department and faculty administrators see student events of their area only, and staff and structure events they made. */
  limitedToScope: z.boolean(),
});
export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;

/* ---------------- data retention (administrators) ---------------- */

export const RetentionPolicySchema = z.object({
  /** Months after a set's final session ends before its face data is deleted. */
  graceMonths: z.number().int().min(0).max(120),
  /** A student who checked in to a lecture this recently keeps their face (still studying). */
  activeWithinDays: z.number().int().min(0).max(3650),
  /** Check-in photos kept for review are deleted after this many days. */
  checkPhotoDays: z.number().int().min(1).max(3650),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

export const RetentionSetSchema = z.object({
  departmentName: z.string().max(160),
  entryYear: z.number().int(),
  setLabel: z.string().max(40),
  programmeYears: z.number().int(),
  /** When the set's final session ended (1 September after it). */
  finishedOn: z.iso.date(),
  /** When its face data becomes due for deletion. */
  dueOn: z.iso.date(),
  students: z.number().int().nonnegative(),
  faces: z.number().int().nonnegative(),
  /** Faces deleted at the next run (due, and not active recently). */
  dueFaces: z.number().int().nonnegative(),
  /** Faces kept because the student checked in recently. */
  keptActive: z.number().int().nonnegative(),
});
export type RetentionSet = z.infer<typeof RetentionSetSchema>;

export const RetentionRunSummarySchema = z.object({
  at: z.iso.datetime(),
  actorName: z.string().max(160).nullable(),
  scheduled: z.boolean(),
  facesDeleted: z.number().int().nonnegative(),
  checkPhotosDeleted: z.number().int().nonnegative(),
});
export type RetentionRunSummary = z.infer<typeof RetentionRunSummarySchema>;

export const RetentionPreviewSchema = z.object({
  policy: RetentionPolicySchema,
  generatedAt: z.iso.datetime(),
  /** Sets that have finished their programme, oldest first. */
  sets: z.array(RetentionSetSchema).max(2000),
  due: z.object({
    faces: z.number().int().nonnegative(),
    checkPhotos: z.number().int().nonnegative(),
  }),
  lastRun: RetentionRunSummarySchema.nullable(),
  /** True when the daily scheduled run is configured (CRON_SECRET set). */
  scheduled: z.boolean(),
  /** Only institution administrators can run it; others see the preview. */
  canRun: z.boolean(),
});
export type RetentionPreview = z.infer<typeof RetentionPreviewSchema>;

export const RetentionRunRequestSchema = z.object({ confirm: z.literal(true) }).strict();
export type RetentionRunRequest = z.input<typeof RetentionRunRequestSchema>;

export const RetentionRunResultSchema = z.object({
  facesDeleted: z.number().int().nonnegative(),
  checkPhotosDeleted: z.number().int().nonnegative(),
  ranAt: z.iso.datetime(),
});
export type RetentionRunResult = z.infer<typeof RetentionRunResultSchema>;
