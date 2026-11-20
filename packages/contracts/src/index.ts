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

/** GET /api/v1/auth/session/status: the session, or signed out (200 either way). */
export const SessionStatusSchema = z.discriminatedUnion('status', [
  AuthenticatedSessionSchema,
  z.object({ status: z.literal('signed_out') }),
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

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

/**
 * Forgot password: the email address the account signs in with or, for
 * students, their matric number (the link goes to the account's email). The
 * field keeps its old name so older pages keep working.
 */
export const PasswordResetRequestSchema = z.object({
  email: z.string().trim().min(3).max(320)
    .refine((value) => (value.includes('@') ? z.email().safeParse(value.toLowerCase()).success : /^[A-Za-z0-9/ -]{5,32}$/.test(value) && value.replace(/\D/g, '').length >= 4), 'Enter your email address or matric number.')
    // Emails compare in lower case; a matric number is passed on as typed.
    .transform((value) => (value.includes('@') ? value.toLowerCase() : value)),
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

/*
 * Passkeys for staff sign-in (ADR 037). The credential bodies are the JSON a
 * browser's WebAuthn call returns (as @simplewebauthn/browser hands it over);
 * the server checks every signature, so these only bound sizes and shapes.
 */
export const PASSKEY_LIMIT = 10;
/**
 * The problem `type` (RFC 9457) of a passkey sign-in with a passkey LASUATOS no longer has, so the
 * browser can tell the password manager to stop offering it.
 */
export const PASSKEY_UNKNOWN_PROBLEM = 'urn:lasuatos:problem:passkey-unknown';
export const PasskeyNameSchema = z.string().trim().min(1).max(60);
const Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const CredentialIdSchema = Base64UrlSchema.min(16).max(1_400);
const ClientExtensionResultsSchema = z.record(z.string(), z.unknown());

export const PasskeyRegistrationCredentialSchema = z.object({
  id: CredentialIdSchema,
  rawId: CredentialIdSchema,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: ClientExtensionResultsSchema,
  response: z.object({
    clientDataJSON: Base64UrlSchema.max(4_000),
    attestationObject: Base64UrlSchema.max(24_000),
    authenticatorData: Base64UrlSchema.max(4_000).optional(),
    transports: z.array(z.string().max(16)).max(8).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: Base64UrlSchema.max(4_000).optional(),
  }),
});

export const PasskeyAuthenticationCredentialSchema = z.object({
  id: CredentialIdSchema,
  rawId: CredentialIdSchema,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: ClientExtensionResultsSchema,
  response: z.object({
    clientDataJSON: Base64UrlSchema.max(4_000),
    authenticatorData: Base64UrlSchema.max(4_000),
    signature: Base64UrlSchema.max(2_000),
    userHandle: Base64UrlSchema.max(128).optional(),
  }),
});

export const PasskeySchema = z.object({
  id: z.uuid(),
  /** The WebAuthn credential id (public), so the browser can be told which passkeys still work. */
  credentialId: CredentialIdSchema,
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Kept in a password manager that syncs it to the person's other devices. */
  synced: z.boolean(),
}).strict();
export type Passkey = z.infer<typeof PasskeySchema>;

export const PasskeyListSchema = z.object({
  passkeys: z.array(PasskeySchema),
  limit: z.number().int(),
  /**
   * For the WebAuthn Signal API: the site the passkeys belong to and this account's (random)
   * user handle, base64url. With these the browser can hide removed passkeys in the password manager.
   */
  relyingPartyId: z.string().min(1),
  userHandle: Base64UrlSchema,
}).strict();
export type PasskeyList = z.infer<typeof PasskeyListSchema>;

/** Adding a passkey asks for the password again, so a borrowed signed-in browser cannot add one. */
export const PasskeyRegistrationOptionsRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
}).strict();

/** WebAuthn options for the browser, passed through to @simplewebauthn/browser as they are. */
export const PasskeyOptionsSchema = z.object({
  challengeId: z.uuid(),
  options: z.object({ challenge: z.string() }).loose(),
}).strict();
export type PasskeyOptions = z.infer<typeof PasskeyOptionsSchema>;

export const PasskeyRegistrationRequestSchema = z.object({
  challengeId: z.uuid(),
  credential: PasskeyRegistrationCredentialSchema,
  name: PasskeyNameSchema.optional(),
}).strict();

export const PasskeyRenameRequestSchema = z.object({ name: PasskeyNameSchema }).strict();

export const PasskeySignInRequestSchema = z.object({
  challengeId: z.uuid(),
  credential: PasskeyAuthenticationCredentialSchema,
}).strict();

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
  /**
   * Whether the student is on a class list. The department and the entry route come
   * from it: the HOC corrects them there, never the student.
   */
  onClassList: z.boolean().default(false),
  /** The class list's set, e.g. "2024/2025 set". */
  setLabel: z.string().max(40).nullable().default(null),
  /** Who keeps the student's class list (their HOC, assistants and GHOC), to ask for corrections. */
  classReps: z.array(z.object({
    name: z.string().max(160),
    role: z.enum(['hoc', 'ahoc', 'ghoc', 'aghoc']),
  })).max(12).default([]),
});
export type StudentAcademicProfile = z.infer<typeof StudentAcademicProfileSchema>;

export const LecturerCourseOfferingSchema = CourseOfferingSummarySchema.extend({
  joinCodeActive: z.boolean(),
  /** When the code students can use now was issued; null when no code works. */
  joinCodeIssuedAt: z.iso.datetime().nullable(),
  creditUnits: z.number().int().min(0).max(30),
  semesterStartsAt: z.iso.datetime(),
  /** Students on the course now. */
  students: z.number().int().nonnegative(),
  /** Attendance sessions of the course that have started. */
  sessions: z.number().int().nonnegative(),
  /** Student disputes waiting for a decision. */
  openDisputes: z.number().int().nonnegative(),
  /**
   * The title and units belong to the course on the institution's course list. Only the person
   * who added a course there (or an administrator, from Course list) may correct them.
   */
  canEditCourse: z.boolean(),
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
    /** Active student accounts, listed or not. */
    activeStudents: z.number().int().nonnegative(),
    activeLecturers: z.number().int().nonnegative(),
    courseOfferings: z.number().int().nonnegative(),
    activeEnrollments: z.number().int().nonnegative(),
    /**
     * Students on class lists: every name a HOC or administrator listed, account or not. The
     * same figure the Class lists and Academic structure pages show.
     */
    onClassLists: z.number().int().nonnegative(),
    /** Of those, names with an account linked (opened). The rest have not opened one yet. */
    openedAccounts: z.number().int().nonnegative(),
    /**
     * Active student accounts linked to no class-list name: a second account for one number, a
     * test account, or one opened before lists existed. Shown so they can be found and sorted out.
     */
    unlistedStudents: z.number().int().nonnegative(),
    /** Unlisted student accounts an administrator suspended; they can be reactivated. */
    unlistedSuspended: z.number().int().nonnegative(),
  }),
  /**
   * Students on class lists grouped by the level derived from the list (matric number, set and
   * entry level), so it adds up to `metrics.onClassLists`. Ordered by level, with
   * unknown/not-yet-started groups last.
   */
  studentLevels: z.array(z.object({
    label: z.string().min(1).max(64),
    level: z.number().int().nullable(),
    count: z.number().int().nonnegative(),
  })).max(32),
  /**
   * What the overview needs for its setup checklist and "needs attention" list.
   * Venues are institution-wide; class reps and sessions follow the account's scope.
   */
  setup: z.object({
    /** Venues not marked inactive. */
    venues: z.number().int().nonnegative(),
    /** Of those, venues that need a location for verification and have none yet. */
    venuesWithoutLocation: z.number().int().nonnegative(),
    /** Class reps (HOCs and GHOCs) currently appointed. */
    classReps: z.number().int().nonnegative(),
    /** Whether any attendance has ever been taken with a QR code. */
    hasTakenAttendance: z.boolean(),
    /** The academic session marked current, if any. */
    academicSession: z.object({
      code: z.string().min(1).max(32),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
    }).nullable(),
  }),
});
export type AdministratorOverview = z.infer<typeof AdministratorOverviewSchema>;

export const CreateCourseOfferingRequestSchema = z.object({
  /** From the course list, so it is spelt as sessions and registers spell it: "ece305" → "ECE 305". */
  courseCode: z.string().trim().min(2).max(32).transform((value) => canonicalCourseCode(value))
    .refine((value) => CATALOG_COURSE_CODE_PATTERN.test(value), { message: 'Write the course code as letters then numbers, e.g. ECE 305.' }),
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
  /** Who registered the current location, when known. */
  locationRegisteredByName: z.string().max(160).nullable().default(null),
  /** Free notes for administrators (access route, renovation, …). */
  notes: z.string().max(500).nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type AdminVenue = z.infer<typeof AdminVenueSchema>;

/** How far back venue usage and check-in evidence look. */
export const VENUE_USAGE_DAYS = 30;

/**
 * How a venue was used in the last VENUE_USAGE_DAYS: sessions held there and how the check-ins
 * at them went. Refused check-ins are never stored, so these are the accepted ones; students
 * added by hand are the ones who could not check in themselves.
 */
export const VenueUsageSchema = z.object({
  venueId: z.uuid(),
  sessions: z.number().int().nonnegative(),
  /** Sessions open right now. */
  openSessions: z.number().int().nonnegative(),
  lastSessionAt: z.iso.datetime().nullable(),
  /** Students who checked in themselves (QR or code). */
  checkIns: z.number().int().nonnegative(),
  /** Of those: the phone placed them inside the boundary (with its allowance). */
  inside: z.number().int().nonnegative(),
  /** Accepted though outside (sessions that did not require the venue). */
  outside: z.number().int().nonnegative(),
  /** The reading was too rough to tell. */
  unclear: z.number().int().nonnegative(),
  /** No location reading came with the check-in. */
  noReading: z.number().int().nonnegative(),
  /** Added by the session taker by hand. */
  handAdded: z.number().int().nonnegative(),
});
export type VenueUsage = z.infer<typeof VenueUsageSchema>;

export const AdminVenuesSchema = z.object({
  venues: z.array(AdminVenueSchema).max(500),
  /** One entry per venue used in the last VENUE_USAGE_DAYS; venues without sessions are left out. */
  usage: z.array(VenueUsageSchema).max(500).default([]),
});

/** A check-in position at a venue (no name or matric: just where the phone was). */
export const VenueCheckInPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().nullable(),
  outcome: z.enum(['within', 'outside', 'inconclusive']),
});
export type VenueCheckInPoint = z.infer<typeof VenueCheckInPointSchema>;

/** A change to a venue's location, newest first. */
export const VenueLocationChangeSchema = z.object({
  kind: z.enum(['registered', 'updated', 'cleared']),
  at: z.iso.datetime(),
  actorName: z.string().max(160).nullable(),
  shape: z.enum(['circle', 'outline']).nullable(),
  radiusMeters: z.number().int().nullable(),
  corners: z.number().int().nullable(),
  allowanceMeters: z.number().int().nullable(),
  accuracyMeters: z.number().nonnegative().nullable(),
});
export type VenueLocationChange = z.infer<typeof VenueLocationChangeSchema>;

/** GET /api/v1/admin/venues/:venueId/evidence: what happened at a venue lately. */
export const VenueEvidenceSchema = z.object({
  days: z.number().int().positive(),
  /**
   * Accepted check-in positions in the period, for drawing on the map. Only institution
   * administrators (who change boundaries) get them; empty for everyone else.
   */
  points: z.array(VenueCheckInPointSchema).max(600),
  pointsShown: z.boolean(),
  /** Courses that held sessions here in the period, busiest first. */
  courses: z.array(z.object({
    courseCode: z.string().max(32),
    courseTitle: z.string().max(200),
    sessions: z.number().int().positive(),
    lastAt: z.iso.datetime(),
  })).max(12),
  history: z.array(VenueLocationChangeSchema).max(20),
});
export type VenueEvidence = z.infer<typeof VenueEvidenceSchema>;
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
  notes: z.string().trim().max(500).nullable().optional(),
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

/** The longest a course session can stay open, counting any extra time added. */
export const ATTENDANCE_SESSION_MAX_MINUTES = 240;

/** Settings a lecturer may change while a session is open: QR-only, and more time. */
export const UpdateAttendanceSessionSettingsRequestSchema = z.object({
  qrOnly: z.boolean().optional(),
  /** Minutes added to the end, up to ATTENDANCE_SESSION_MAX_MINUTES from the start. */
  extendMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]).optional(),
}).strict().refine((value) => value.qrOnly !== undefined || value.extendMinutes !== undefined, 'Change at least one setting.');
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
  /**
   * The face-check ticket from a `face_required` answer, in place of the code
   * or QR challenge (which may expire while the camera is open). Bound to the
   * signed-in student; valid for 10 minutes.
   */
  ticket: z.string().trim().min(10).max(200).optional(),
  /** Camera photos for the face check: facing the camera, then turned as the `face_required` answer asked. */
  face: z.object({ frames: z.array(z.lazy(() => FaceFrameSchema)).min(2).max(3) }).strict().optional(),
}).strict()
  .refine((value) => Boolean(value.code ?? value.challenge ?? value.ticket), {
    message: 'An attendance code or a scanned QR challenge is required.',
  });
export type CheckInAttendanceRequest = z.input<typeof CheckInAttendanceRequestSchema>;

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
  /** Students enrolled on the course with no check-in in this session (present or revoked). */
  notCheckedIn: z.array(z.object({
    studentId: z.uuid(),
    displayName: z.string().min(1).max(160),
    studentNumber: z.string().min(1).max(64),
    levelLabel: z.string().min(1).max(64),
  })).max(5000).default([]),
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

export const CheckedInAttendanceResponseSchema = z.object({
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
export type CheckedInAttendanceResponse = z.infer<typeof CheckedInAttendanceResponseSchema>;

/**
 * Everything else passed; the face check is next (ADR 033). The client opens
 * the camera (front, then turned to `face.turn`) and sends the photos with
 * `face.ticket` in place of the code. `registered: false`: the student has to
 * register their face first.
 */
export const CourseFaceRequiredResponseSchema = z.object({
  status: z.literal('face_required'),
  session: z.object({
    attendanceSessionId: z.uuid(),
    courseCode: z.string().min(1).max(32),
    courseTitle: z.string().min(1).max(200),
    sessionTitle: z.string().min(1).max(160),
    venueName: z.string().min(1).max(160).nullable(),
  }),
  face: z.object({
    ticket: z.string().min(10).max(200),
    turn: z.enum(['left', 'right']),
    registered: z.boolean(),
  }),
});
export type CourseFaceRequiredResponse = z.infer<typeof CourseFaceRequiredResponseSchema>;

export const CheckInAttendanceResponseSchema = z.union([CheckedInAttendanceResponseSchema, CourseFaceRequiredResponseSchema]);
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
  /** Why it was removed (the latest removal), for removed check-ins. */
  removedReason: z.string().min(1).max(500).nullable(),
});
export type StudentAttendanceHistoryEntry = z.infer<typeof StudentAttendanceHistoryEntrySchema>;

/**
 * A class of the student's course held while they were on it, now over, with no check-in: the
 * "missed" in their summary, one by one.
 */
export const StudentMissedClassSchema = z.object({
  attendanceSessionId: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  sessionTitle: z.string().min(1).max(160),
  venueName: z.string().min(1).max(160).nullable(),
  startsAt: z.iso.datetime(),
});
export type StudentMissedClass = z.infer<typeof StudentMissedClassSchema>;

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
  /** When this student is already marked present in the session (a revoked check-in is not). */
  checkedInAt: z.iso.datetime().nullable().default(null),
});
export type StudentOpenAttendanceSession = z.infer<typeof StudentOpenAttendanceSessionSchema>;

export const StudentOpenAttendanceSessionsSchema = z.object({
  sessions: z.array(StudentOpenAttendanceSessionSchema).max(100),
});
export type StudentOpenAttendanceSessions = z.infer<typeof StudentOpenAttendanceSessionsSchema>;

export const StudentAttendanceHistorySchema = z.object({
  records: z.array(StudentAttendanceHistoryEntrySchema).max(500),
  /** Newest first, at most 500. */
  missed: z.array(StudentMissedClassSchema).max(500),
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

/** Where each of a lecturer's courses stands, for the reports list (same figures as the report). */
export const AttendanceReportOverviewSchema = z.object({
  threshold: z.number().int().min(1).max(100),
  courses: z.array(z.object({
    courseOfferingId: z.uuid(),
    sessionsHeld: z.number().int().nonnegative(),
    activeStudents: z.number().int().nonnegative(),
    averageRate: rateSchema,
    studentsBelowThreshold: z.number().int().nonnegative(),
    lastSessionAt: z.iso.datetime().nullable(),
  })).max(60),
});
export type AttendanceReportOverview = z.infer<typeof AttendanceReportOverviewSchema>;

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
  /** Students who finished the course when its semester ended; they still count in the rate. */
  completedEnrollments: z.number().int().nonnegative(),
  expectedCheckIns: z.number().int().nonnegative(),
  /** Present check-ins of counted students: the rate's numerator. */
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

/**
 * Days after a lecturer rejects a dispute during which the student may take it to the
 * department ("appeal"). One appeal per dispute; the department's decision is final.
 */
export const ATTENDANCE_APPEAL_WINDOW_DAYS = 7;

export const AttendanceAppealStatusSchema = z.enum(['open', 'upheld', 'rejected', 'withdrawn']);
export type AttendanceAppealStatus = z.infer<typeof AttendanceAppealStatusSchema>;

/** Why the student thinks the lecturer's decision was wrong. */
export const AttendanceAppealRequestSchema = z.object({
  statement: z.string().trim().min(20).max(1000),
}).strict();
export type AttendanceAppealRequest = z.infer<typeof AttendanceAppealRequestSchema>;

export const AttendanceAppealDecisionRequestSchema = z.object({
  decision: z.enum(['uphold', 'reject']),
  /** Shown to the student and the lecturer, and kept with the appeal. */
  note: z.string().trim().min(10).max(500),
}).strict();
export type AttendanceAppealDecisionRequest = z.infer<typeof AttendanceAppealDecisionRequestSchema>;

/** A student's appeal against a rejected dispute, as the student, lecturer and department see it. */
export const AttendanceAppealSummarySchema = z.object({
  id: z.uuid(),
  status: AttendanceAppealStatusSchema,
  statement: z.string().min(1).max(1000),
  /** The course's department, whose administrators decide. */
  departmentName: z.string().min(1).max(200),
  decisionNote: z.string().min(1).max(500).nullable(),
  decidedByName: z.string().min(1).max(160).nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AttendanceAppealSummary = z.infer<typeof AttendanceAppealSummarySchema>;

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
  /** The student's appeal to the department, once sent. */
  appeal: AttendanceAppealSummarySchema.nullable(),
  /** Last moment the student may appeal; null unless the dispute was rejected and can still be appealed. */
  appealDeadline: z.iso.datetime().nullable(),
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
  /**
   * The student's attendance in this course so far, counted as the course report counts it.
   * Null when the student has no enrollment row for the offering.
   */
  standing: z.object({
    attended: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    /** False when the disputed class was before they joined and they have no record for it. */
    countsThisClass: z.boolean(),
  }).nullable(),
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
  /** The student's appeal to the department against a rejection, if they sent one. */
  appeal: AttendanceAppealSummarySchema.nullable(),
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

export const AdministratorAttendanceAppealsQuerySchema = z.object({
  status: z.enum(['open', 'decided', 'all']).optional(),
}).strict();
export type AdministratorAttendanceAppealsQuery = z.infer<typeof AdministratorAttendanceAppealsQuerySchema>;

/** An appeal in the department's queue, with the whole dispute it is about. */
export const AdministratorAttendanceAppealSchema = AttendanceAppealSummarySchema.extend({
  /**
   * True when this administrator decided the original dispute themselves; someone else must
   * decide the appeal.
   */
  conflict: z.boolean(),
  dispute: LecturerAttendanceDisputeSchema,
});
export type AdministratorAttendanceAppeal = z.infer<typeof AdministratorAttendanceAppealSchema>;

export const AdministratorAttendanceAppealsSchema = z.object({
  appeals: z.array(AdministratorAttendanceAppealSchema).max(500),
  openCount: z.number().int().nonnegative(),
});
export type AdministratorAttendanceAppeals = z.infer<typeof AdministratorAttendanceAppealsSchema>;

export const AdministratorAttendanceAppealCountSchema = z.object({
  openCount: z.number().int().nonnegative(),
});
export type AdministratorAttendanceAppealCount = z.infer<typeof AdministratorAttendanceAppealCountSchema>;

export const AdministratorAttendanceAppealDecisionResponseSchema = z.object({
  appeal: AdministratorAttendanceAppealSchema,
  /** Outcome of the attendance correction applied when upholding; null when rejected. */
  correction: z.enum(['applied', 'unchanged']).nullable(),
});
export type AdministratorAttendanceAppealDecisionResponse = z.infer<typeof AdministratorAttendanceAppealDecisionResponseSchema>;

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
  /** Where the role sits, to start a change of role or area from: the faculty (faculty administrators) or department (lecturers, department administrators). */
  facultyId: z.uuid().nullable().default(null),
  departmentId: z.uuid().nullable().default(null),
  staffNumber: z.string().nullable(),
  status: z.enum(['active', 'suspended']),
  joinedAt: z.iso.datetime(),
  /** True when the signed-in administrator may suspend, reactivate or move this person. */
  manageable: z.boolean(),
  isSelf: z.boolean(),
  /** When they last used the app (signed in or opened a page); null if never. */
  lastActiveAt: z.iso.datetime().nullable(),
  /** Attendance sessions they started in the last STAFF_ACTIVITY_DAYS days. */
  recentSessions: z.number().int().nonnegative(),
  /** When their most recent session started, at any time; null if never. */
  lastSessionAt: z.iso.datetime().nullable(),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

/** The window for "sessions lately" on Staff. */
export const STAFF_ACTIVITY_DAYS = 30;

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

/**
 * Moves a staff member to another role or area without a new invitation: same account,
 * password and history. With `apply: false` nothing changes and the answer says what would
 * (courses they would stop teaching, open disputes on them); `apply: true` makes the change.
 */
export const StaffPositionChangeSchema = z.object({
  role: StaffRoleSchema,
  facultyId: z.uuid().nullable().optional(),
  departmentId: z.uuid().nullable().optional(),
  /** Kept in the audit log and shown to the person in their email. */
  reason: z.string().trim().min(10, 'Say why in at least 10 characters.').max(500),
  apply: z.boolean(),
}).strict().superRefine((value, context) => {
  const needsDepartment = value.role === 'lecturer' || value.role === 'department_administrator';
  if (needsDepartment && !value.departmentId) {
    context.addIssue({ code: 'custom', path: ['departmentId'], message: 'Choose a department.' });
  }
  if (value.role === 'faculty_administrator' && !value.facultyId) {
    context.addIssue({ code: 'custom', path: ['facultyId'], message: 'Choose a faculty.' });
  }
});
export type StaffPositionChange = z.infer<typeof StaffPositionChangeSchema>;

export const StaffPositionChangeResultSchema = z.object({
  applied: z.boolean(),
  from: z.object({ role: StaffRoleSchema, scopeLabel: z.string() }),
  to: z.object({ role: StaffRoleSchema, scopeLabel: z.string() }),
  /** True when they move between the lecturer and administrator workspaces (their menu changes). */
  workspaceChanges: z.boolean(),
  /**
   * This semester's (and later) courses they teach that the new place does not cover: they stop
   * teaching them, and the courses' other lecturers carry on. Past semesters are kept as they were.
   */
  coursesLeaving: z.array(z.object({
    courseCode: z.string(),
    courseTitle: z.string(),
    departmentName: z.string(),
    semesterName: z.string(),
    /** Other lecturers still teaching it; 0 means nobody will be teaching it. */
    otherLecturers: z.number().int().nonnegative(),
  })).max(500),
  /** Disputes awaiting a decision on those courses. */
  openDisputes: z.number().int().nonnegative(),
  /** They are taking attendance right now: the change waits until the class closes. */
  teachingNow: z.boolean().default(false),
  /** True when the person was told by email (applied changes only). */
  emailSent: z.boolean(),
});
export type StaffPositionChangeResult = z.infer<typeof StaffPositionChangeResultSchema>;

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

/**
 * JAMB registration numbers. Students admitted by Direct Entry (and fresh
 * UTME students) often have no LASU matric number or LASU email for weeks
 * after they start, so a class list may carry their JAMB registration number
 * until the matric number arrives. Today's numbers are 12 digits and 2
 * letters: the exam year, an 8-digit serial and a 2-letter check, e.g.
 * 202430074987JA. Older numbers (8 digits and 2 letters, e.g. 12345678HC) are
 * still seen and accepted.
 */
const JAMB_PATTERN = /^(\d{4})\d{8}[A-Z]{2}$/;
const JAMB_LEGACY_PATTERN = /^\d{8}[A-Z]{2}$/;
export const JAMB_REG_EXAMPLE = '202430074987JA';

/** Tidies a JAMB number or matric number the way people type and paste them. */
function tidyStudentNumber(raw: string | number | null | undefined): string {
  const value = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : '') : String(raw ?? '');
  return value.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim()
    .replace(/^'/, '').replace(/^(\d+)\.0+$/, '$1').replace(/[\s/-]+/g, '').toUpperCase();
}

/** True for a JAMB registration number in today's (12 digits + 2 letters) or the older (8 + 2) format. */
export function isJambRegNumber(raw: string | number | null | undefined): boolean {
  const value = tidyStudentNumber(raw);
  return JAMB_PATTERN.test(value) || JAMB_LEGACY_PATTERN.test(value);
}

/** The JAMB exam year in a JAMB number (2024 in 202430074987JA); null for the older format. */
export function jambYear(raw: string): number | null {
  const match = JAMB_PATTERN.exec(tidyStudentNumber(raw));
  return match?.[1] ? Number(match[1]) : null;
}

/** Whether a value someone typed is an attempt at a JAMB number (digits ending in letters), right or wrong. */
function looksLikeJambAttempt(value: string): boolean {
  return /^\d{6,}[A-Z]{1,3}$/.test(value) && value.length >= 9 && !/^\d{8}[OIL]$/.test(value);
}

export type StudentNumberKind = 'matric' | 'jamb';

/** 'jamb' when the stored identity is a JAMB registration number, otherwise 'matric'. */
export function studentNumberKind(value: string | null | undefined): StudentNumberKind {
  return value && isJambRegNumber(value) ? 'jamb' : 'matric';
}

export type StudentNumberCheck =
  | { readonly ok: true; readonly value: string; readonly kind: StudentNumberKind }
  | { readonly ok: false; readonly message: string };

/**
 * Checks the number a student is known by on a class list, a register or the
 * sign-up page: a LASU matric number (see checkMatricNumber) or, for a student
 * who has none yet, their JAMB registration number. Explains what is wrong in
 * words, for either.
 */
export function checkStudentNumber(raw: string | number | null | undefined): StudentNumberCheck {
  const value = tidyStudentNumber(raw);
  if (JAMB_PATTERN.test(value) || JAMB_LEGACY_PATTERN.test(value)) return { ok: true, value, kind: 'jamb' };
  if (value && looksLikeJambAttempt(value)) {
    const digits = value.replace(/[A-Z]+$/, '').length;
    const letters = value.length - digits;
    return {
      ok: false,
      message: `That looks like a JAMB registration number but has ${digits} digit${digits === 1 ? '' : 's'} and ${letters} letter${letters === 1 ? '' : 's'}; JAMB numbers have 12 digits and 2 letters (e.g. ${JAMB_REG_EXAMPLE}).`,
    };
  }
  const matric = checkMatricNumber(raw);
  if (!matric.ok) {
    return { ok: false, message: matric.message.startsWith('Add') ? 'Add the matric number (or, for a student without one yet, the JAMB registration number).' : matric.message };
  }
  return { ok: true, value: matric.value, kind: 'matric' };
}

/** "matric number" or "JAMB number", for sentences about a particular student. */
export function studentNumberName(value: string | null | undefined): string {
  return studentNumberKind(value) === 'jamb' ? 'JAMB number' : 'matric number';
}

export type PersonNameCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

const NAME_WORD = /^[\p{L}][\p{L}\p{M}]*(?:['’-][\p{L}][\p{L}\p{M}]*)*$/u;
/** "S.", "S", "S.O.", "S.O", "A.B.C": one or more initials, with or without dots. */
const INITIALS = /^(?:\p{L}\p{M}*\.)+(?:\p{L}\p{M}*)?$|^\p{L}\p{M}*$/u;

/**
 * Names on class lists are letters only (any alphabet, with accents such as
 * Ọlámídé). The one exception is a hyphen or apostrophe joining letters
 * inside a name (Ade-Bello, O’Neil), which is part of the name itself.
 * Digits, dots, initials and other symbols are refused: "AKAPO S. O." is
 * not a name, "AKAPO Samuel Olumide" is. `words`: 'one' for a surname or
 * first name, 'several' for middle names (separated by spaces), 'full' for a
 * whole name typed in one box (at least two words: a first name and a
 * surname).
 */
export function checkPersonName(raw: string | null | undefined, label: string, words: 'one' | 'several' | 'full' = 'one'): PersonNameCheck {
  const value = String(raw ?? '').normalize('NFC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, message: `Enter the ${label}.` };
  if (value.length > (words === 'one' ? 80 : words === 'several' ? 120 : 160)) return { ok: false, message: `The ${label} is too long.` };
  // Initials are named as such first, so "S." is not reported as a stray dot.
  const initial = value.split(' ').find((part) => INITIALS.test(part));
  if (initial) {
    return { ok: false, message: `Write the full ${label}, not an initial (“${initial}”). For example “Samuel”, not “S.”.` };
  }
  const bad = value.match(/[^\p{L}\p{M}'’\- ]/gu);
  if (bad) {
    const shown = [...new Set(bad)].slice(0, 3).map((character) => `“${character}”`).join(', ');
    return { ok: false, message: `Use letters only in the ${label}: remove ${shown}.` };
  }
  const parts = value.split(' ');
  if (words === 'full' && parts.length < 2) {
    return { ok: false, message: `Write the ${label} in full: first name and surname (“${value}” is one word).` };
  }
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
    // A hyphen joins two names (Ade-Bello), so each side is a whole name: "S-O" is two initials.
    if (part.split('-').some((piece) => [...piece.replace(/[\p{M}'’]/gu, '')].length < 2)) {
      return { ok: false, message: `Write the full ${label}, not initials (“${part}”).` };
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

/** "Recent sessions" on the academic structure page count this many days back. */
export const STRUCTURE_ACTIVITY_DAYS = 30;

/** One change to the structure, newest first on the page; `summary` is plain words ("Programme length 4 → 5 years"). */
export const StructureChangeSchema = z.object({
  id: z.uuid(),
  targetType: z.enum(['faculty', 'department', 'academic_session']),
  targetId: z.uuid(),
  action: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  summary: z.string(),
});

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
      /** Active lecturer accounts whose department this is. */
      lecturerCount: z.number().int().nonnegative().default(0),
      /** Students on the department's class lists (every set). */
      classListCount: z.number().int().nonnegative().default(0),
      /** Lecture sessions for the department in the last STRUCTURE_ACTIVITY_DAYS days. */
      recentSessions: z.number().int().nonnegative().default(0),
      /** Start of the department's newest lecture session, or null when none. */
      lastSessionAt: z.iso.datetime().nullable().default(null),
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
  /** The latest changes the viewer may see (their faculties, departments, and every session), newest first. */
  recentChanges: z.array(StructureChangeSchema).default([]),
});
export type InstitutionStructure = z.infer<typeof InstitutionStructureSchema>;
export type StructureChange = InstitutionStructure['recentChanges'][number];

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
/**
 * How long after it ends a session can still be reopened. Later, a reopened session would take
 * scans on another day into the earlier class's register; latecomers are added by hand instead.
 */
export const LECTURE_REOPEN_WINDOW_HOURS = 12;

export const LectureQrModeSchema = z.enum(['dynamic', 'static']);
export type LectureQrMode = z.infer<typeof LectureQrModeSchema>;

export const ClassRepRoleSchema = z.enum(['ghoc', 'hoc']);
export type ClassRepRole = z.infer<typeof ClassRepRoleSchema>;

/** A HOC's or GHOC's assistant: AHOC, AGHOC. */
export const AssistantRoleSchema = z.enum(['aghoc', 'ahoc']);
export type AssistantRole = z.infer<typeof AssistantRoleSchema>;

export const LectureTakerRoleSchema = z.enum(['lecturer', 'administrator', 'ghoc', 'hoc', 'aghoc', 'ahoc']);
export type LectureTakerRole = z.infer<typeof LectureTakerRoleSchema>;

/** Assistants per HOC or GHOC. */
export const MAX_ASSISTANTS = 2;

/**
 * What a HOC or GHOC lets an assistant do besides taking attendance (which every assistant
 * does): see the class's registers, keep the class list, give setup codes and, for a GHOC's
 * assistant, appoint and remove the faculty's HOCs. Appointing assistants is never delegated.
 */
export const AssistantPermissionSchema = z.enum(['registers', 'class_list', 'setup_codes', 'hocs']);
export type AssistantPermission = z.infer<typeof AssistantPermissionSchema>;

/** What a new assistant may do until their HOC changes it: the everyday help, not the keys. */
export const DEFAULT_ASSISTANT_PERMISSIONS: readonly AssistantPermission[] = ['registers', 'class_list'];

/** The permissions an assistant of this post can hold (`hocs` only for a GHOC's). */
export function assistantPermissionsFor(role: ClassRepRole): readonly AssistantPermission[] {
  return role === 'ghoc' ? AssistantPermissionSchema.options : AssistantPermissionSchema.options.filter((item) => item !== 'hocs');
}

/** "HOC", "Assistant HOC", "GHOC", "Assistant GHOC". */
export function repRoleName(role: ClassRepRole | AssistantRole): string {
  return { hoc: 'HOC', ghoc: 'GHOC', ahoc: 'Assistant HOC', aghoc: 'Assistant GHOC' }[role];
}

/** "HOC", "AHOC", "GHOC", "AGHOC": the short names used in menus and badges. */
export function repRoleShort(role: ClassRepRole | AssistantRole): string {
  return { hoc: 'HOC', ghoc: 'GHOC', ahoc: 'AHOC', aghoc: 'AGHOC' }[role];
}

/** Whether attendance was (or is) taken by a class rep or their assistant, not staff. */
export function isClassRepTaker(role: string | null | undefined): role is ClassRepRole | AssistantRole {
  return role === 'hoc' || role === 'ghoc' || role === 'ahoc' || role === 'aghoc';
}

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
  /** Administrators and GHOCs (and GHOC assistants allowed to) can appoint class representatives. */
  canManageClassReps: z.boolean(),
  /** HOCs and GHOCs choose up to MAX_ASSISTANTS assistants and what they may do. */
  canManageAssistants: z.boolean().default(false),
  /** Whether the class list page is theirs to keep (HOCs, GHOCs, assistants allowed to). */
  canKeepClassList: z.boolean().default(false),
  /** For an assistant, the HOC or GHOC they assist. */
  assistantOf: z.string().max(160).nullable().default(null),
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
  /** Students must be in the venue. Left out: on when the venue's location is registered, off otherwise. */
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

/** `GET /api/v1/lecture/sessions?before=…&q=…` or `?live=mine` */
export const LectureSessionListQuerySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  /** Course code or title, e.g. "csc 301" or "operating". */
  q: z.string().trim().max(80).optional(),
  /**
   * `mine`: only sessions the caller opened that are still taking attendance. A small,
   * cheap answer for the app frame's live indicator.
   */
  live: z.literal('mine').optional(),
  /** Fewer sessions than a full page, for summaries such as the administration overview. */
  limit: z.coerce.number().int().min(1).max(60).optional(),
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

/**
 * The attendance report (Attendance overview). Rates follow the course registers: for each
 * course, everyone who attended any of its sessions in the window is on its roster, and a
 * session's rate is the share of that roster present. Percentages are 0–100 with one decimal,
 * or null where nothing was held.
 */
export const LectureReportPeriodSchema = z.enum(['week', 'month', 'term']);
export type LectureReportPeriod = z.infer<typeof LectureReportPeriodSchema>;
/** A course needs this many sessions before anyone is counted below the threshold. */
export const LECTURE_REPORT_MIN_HELD = 3;

export const LectureReportQuerySchema = z.object({
  period: LectureReportPeriodSchema.default('week'),
  department: z.uuid().optional(),
});

const reportRate = z.number().min(0).max(100).nullable();
export const LectureReportSchema = z.object({
  period: LectureReportPeriodSchema,
  /** Inclusive Lagos dates, YYYY-MM-DD. */
  from: z.string(),
  to: z.string(),
  /** The semester covering today, which "Below 75%" counts over (the last 90 days without one). */
  term: z.object({ label: z.string(), from: z.string(), to: z.string() }).nullable(),
  department: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  totals: z.object({
    sessions: z.number().int().nonnegative(),
    openNow: z.number().int().nonnegative(),
    checkIns: z.number().int().nonnegative(),
    students: z.number().int().nonnegative(),
    courses: z.number().int().nonnegative(),
    rate: reportRate,
    /** The same span just before (week and month only). */
    previous: z.object({ sessions: z.number().int().nonnegative(), rate: reportRate }).nullable(),
  }),
  /** `expected`: the rosters of that day's sessions added up, so days can be summed into weeks. */
  daily: z.array(z.object({ date: z.string(), sessions: z.number().int(), checkIns: z.number().int(), expected: z.number().int(), rate: reportRate })).max(200),
  courses: z.array(z.object({
    courseCode: z.string(),
    courseTitle: z.string(),
    sessions: z.number().int(),
    checkIns: z.number().int(),
    /** On the course's roster: attended at least once in the window. */
    students: z.number().int(),
    rate: reportRate,
    /** Students below the threshold in this course this semester. */
    below: z.number().int(),
    lastHeldAt: z.iso.datetime({ offset: true }),
  })).max(300),
  departments: z.array(z.object({
    id: z.uuid().nullable(),
    name: z.string(),
    sessions: z.number().int(),
    checkIns: z.number().int(),
    rate: reportRate,
  })).max(60),
  below: z.object({
    threshold: z.number(),
    /** Different students below the threshold in at least one course (not capped). */
    students: z.number().int().nonnegative(),
    rows: z.array(z.object({
      matricNumber: z.string(),
      fullName: z.string(),
      courseCode: z.string(),
      courseTitle: z.string(),
      attended: z.number().int(),
      held: z.number().int(),
      rate: z.number(),
    })).max(300),
  }),
  checks: z.object({
    manual: z.number().int().nonnegative(),
    outside: z.number().int().nonnegative(),
    sharedPhone: z.number().int().nonnegative(),
    guest: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  }),
  takers: z.object({ lecturer: z.number().int(), classRep: z.number().int(), administrator: z.number().int() }),
});
export type LectureReport = z.infer<typeof LectureReportSchema>;

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

/**
 * Names for the Lecturer field: the institution's lecturers (their own department first) and
 * names typed for earlier sessions, such as a visiting lecturer. Picking keeps names spelled
 * the same on every register; typing a new name still works.
 */
export const LectureLecturerOptionsSchema = z.object({
  lecturers: z.array(z.object({
    name: z.string().max(160),
    /** The lecturer's department, or null for a name typed for an earlier session. */
    departmentName: z.string().max(200).nullable(),
  })).max(600),
});
export type LectureLecturerOptions = z.infer<typeof LectureLecturerOptionsSchema>;

/** Finding a student to add by hand: by matric number or name, from the class lists and accounts. */
export const LectureStudentSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(80) }).strict();

export const LectureStudentMatchSchema = z.object({
  matricNumber: z.string().max(32),
  fullName: z.string().max(200),
  departmentName: z.string().max(200).nullable(),
  /** Whether the student has opened an account (their history then shows the entry). */
  hasAccount: z.boolean(),
  /** Already on this session's list: present, or taken off it. */
  onList: z.object({
    status: z.enum(['present', 'removed']),
    checkedInAt: z.iso.datetime(),
  }).nullable(),
});
export type LectureStudentMatch = z.infer<typeof LectureStudentMatchSchema>;
export const LectureStudentMatchesSchema = z.object({ students: z.array(LectureStudentMatchSchema).max(20) });
export type LectureStudentMatches = z.infer<typeof LectureStudentMatchesSchema>;

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
  /** When the latest of those sessions started; null when it was never taught here. */
  lastSessionAt: z.iso.datetime().nullable().default(null),
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

/**
 * Face match scores (cosine similarity, -1 to 1). A check-in passes from `pass`; below `clear`
 * it passes but a photo is kept for a person to review. `pass` sits above the highest
 * different-person score seen (0.551, in real use); `clear` keeps the review band 0.08 wide,
 * below the same person in two different photos (0.71). See docs/FACE_VERIFICATION.md.
 */
export const FACE_MATCH = { pass: 0.6, clear: 0.68 } as const;

/** How many face checks wait for this person: the badge on Face checks. */
export const FaceReviewCountSchema = z.object({ pending: z.number().int().nonnegative() });
export type FaceReviewCount = z.infer<typeof FaceReviewCountSchema>;

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
    /** Why it was removed, as the lecturer, class rep or face review recorded it. */
    removedReason: z.string().max(300).nullable().default(null),
  })).max(500),
  /**
   * Finished lectures counted in `courses` that the student has no entry for, newest first:
   * the lectures that lower their rate. (A removed entry stays in `entries`, not here.)
   */
  missed: z.array(z.object({
    id: z.uuid(),
    courseCode: z.string().max(32),
    courseTitle: z.string().max(200),
    startsAt: z.iso.datetime(),
    venueName: z.string().max(160).nullable(),
  })).max(500).default([]),
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

/** Sessions a class rep started in this many days count as recent activity. */
export const CLASS_REP_ACTIVITY_DAYS = 30;

export const ClassRepSchema = z.object({
  id: z.uuid(),
  /** The post: HOC or GHOC. An assistant has their principal's post, with `assistantOf` set. */
  role: ClassRepRoleSchema,
  studentUserId: z.uuid(),
  studentName: z.string().max(160),
  matricNumber: z.string().max(64),
  email: z.string().max(320),
  facultyId: z.uuid(),
  facultyName: z.string().max(160),
  /** A HOC's department; null for a GHOC. */
  departmentId: z.uuid().nullable(),
  departmentName: z.string().max(160).nullable(),
  entryYear: z.number().int(),
  /** e.g. "2022/2023 set". */
  setLabel: z.string().max(40),
  appointedAt: z.iso.datetime(),
  appointedByName: z.string().max(160),
  /** Attendance sessions they started in the last CLASS_REP_ACTIVITY_DAYS, since their appointment. */
  recentSessions: z.number().int().nonnegative().default(0),
  /** Their latest session since their appointment. */
  lastSessionAt: z.iso.datetime().nullable().default(null),
  /** For an assistant (AHOC, AGHOC): whose. */
  assistantOf: z.object({ id: z.uuid(), name: z.string().max(160) }).nullable().default(null),
  /** For an assistant: what they may do besides taking attendance. */
  permissions: z.array(AssistantPermissionSchema).max(4).default([]),
});
export type ClassRep = z.infer<typeof ClassRepSchema>;

/** A HOC's or GHOC's assistants, and whether the viewer may change them. */
export const AssistantsSchema = z.object({
  principal: ClassRepSchema,
  assistants: z.array(ClassRepSchema).max(MAX_ASSISTANTS),
  /** Permissions an assistant of this post can be given. */
  available: z.array(AssistantPermissionSchema).max(4),
  /** False when the viewer is the assistant themselves, or may only look. */
  canManage: z.boolean(),
});
export type Assistants = z.infer<typeof AssistantsSchema>;

export const AppointAssistantRequestSchema = z.object({
  /** The HOC's or GHOC's appointment; omitted, the viewer's own. */
  principalId: z.uuid().optional(),
  studentUserId: z.uuid(),
  permissions: z.array(AssistantPermissionSchema).max(4),
}).strict();
export type AppointAssistantRequest = z.infer<typeof AppointAssistantRequestSchema>;

export const UpdateAssistantRequestSchema = z.object({ permissions: z.array(AssistantPermissionSchema).max(4) }).strict();
export type UpdateAssistantRequest = z.infer<typeof UpdateAssistantRequestSchema>;

export const AssistantLookupRequestSchema = z.object({
  principalId: z.uuid().optional(),
  query: z.string().trim().min(3).max(320),
}).strict();

/** A class list in the caller's area: a department's set, with how many students can sign in. */
export const ClassRepListSetSchema = z.object({
  departmentId: z.uuid(),
  entryYear: z.number().int(),
  students: z.number().int().nonnegative(),
  /** Students on the list who have opened an account, so could be appointed. */
  withAccounts: z.number().int().nonnegative(),
});
export type ClassRepListSet = z.infer<typeof ClassRepListSetSchema>;

export const ClassRepListSchema = z.object({
  reps: z.array(ClassRepSchema).max(2000),
  /** Departments the caller may appoint a HOC for. `code` is short and unique ("ECE"). */
  departments: z.array(z.object({ id: z.uuid(), code: z.string().max(40).default(''), name: z.string().max(160), facultyId: z.uuid(), facultyName: z.string().max(160) })).max(1000),
  /** Class lists in the caller's area (one set only for a GHOC), so posts without a rep show. */
  lists: z.array(ClassRepListSetSchema).max(2000).default([]),
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
  /**
   * The span `standing` covers: the semester running now, or the last 90 days when no
   * semester is set up (label null).
   */
  standingSince: z.string(),
  standingLabel: z.string().max(200).nullable(),
  threshold: z.number().int().min(0).max(100),
  courses: z.array(z.object({
    courseCode: z.string().max(32),
    courseTitle: z.string().max(200),
    sessionCount: z.number().int().nonnegative(),
    lastHeldAt: z.iso.datetime(),
    /**
     * How the course stands in that span, as its register counts it: the average of the
     * students' rates, and how many are below the threshold (once it has met
     * LECTURE_REPORT_MIN_HELD times; before that, null). Null when not held in the span.
     */
    standing: z.object({
      held: z.number().int().nonnegative(),
      students: z.number().int().nonnegative(),
      rate: z.number().min(0).max(100).nullable(),
      below: z.number().int().nonnegative().nullable(),
    }).nullable(),
  })).max(500),
});
export type LectureRegisterCourses = z.infer<typeof LectureRegisterCoursesSchema>;

/** The course list's standing is counted against this required attendance (default 75%). */
export const LectureRegisterCoursesQuerySchema = z.object({
  threshold: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

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

/**
 * A plausible personal email (gmail.com, yahoo.com, …) for a student still on
 * a JAMB number, who has no LASU email yet. Reserved and LASU staff domains
 * are refused: the address must be a mailbox the student reads.
 */
export function isPersonalEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)) return false;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  // No LASU address is personal: not the apex (staff), and not a subdomain (students, ADR 040).
  return !/(^|\.)(invalid|test|example|localhost)$/.test(domain) && domain !== 'lasu.edu.ng' && !domain.endsWith('.lasu.edu.ng');
}

/**
 * Which addresses can prove who a student is: a LASU student email always;
 * a personal email only while the student is known by a JAMB number (or
 * joined on one), because then there is no LASU email yet.
 */
export function isStudentProofEmail(email: string, options: { readonly jamb: boolean }): boolean {
  return isLasuStudentEmail(email) || (options.jamb && isPersonalEmail(email));
}

/** Any email a student might give: checked against isStudentProofEmail by the server. */
export const StudentEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a full email address, e.g. name@gmail.com.').max(320));

export const LasuStudentEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(320))
  .refine(isLasuStudentEmail, { message: `Use your LASU student email (…@${LASU_STUDENT_EMAIL_DOMAIN}).` });

/**
 * A personal email a student links to their account when the LASU mailbox is
 * out of reach (ADR 040): codes and notices can go to it, and Google sign-in
 * with it opens the account. It must be a mailbox the student reads, so LASU
 * addresses (student or staff) and throwaway domains are refused.
 */
export const SecondaryEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a full email address, e.g. name@gmail.com.').max(320))
  .refine(isPersonalEmail, { message: 'Use a personal email you can open (e.g. your Gmail), not a LASU address.' });

/** Where a student's account emails go: the LASU address, or their linked personal one (ADR 040). */
export const MailDeliverySchema = z.enum(['primary', 'secondary']);
export type MailDelivery = z.infer<typeof MailDeliverySchema>;

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

/** "ODEJOBI Abraham Oluwaseun": the class-list order, surname in capitals, as on LASU lists. */
export function classListName(parts: { readonly firstName: string; readonly middleName?: string | null; readonly surname: string }): string {
  return [parts.surname.trim().toUpperCase(), parts.firstName, parts.middleName ?? '']
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' ');
}

/**
 * Setup codes a HOC gives a student who cannot get the emailed code: eight
 * characters with no look-alikes (no I, L, O, 0 or 1), shown as ABCD-EFGH.
 */
export const SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SETUP_CODE_LENGTH = 8;
/** How long a setup code works after the HOC creates it. */
export const SETUP_CODE_TTL_MINUTES = 30;

/** "abcd efgh" / "ABCD-EFGH" → "ABCDEFGH". */
export function normalizeSetupCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** "ABCDEFGH" → "ABCD-EFGH". */
export function formatSetupCode(value: string): string {
  const code = normalizeSetupCode(value);
  return code.length === SETUP_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
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

/** A class-list number: a matric number (see checkMatricNumber) or a JAMB registration number. */
const classListMatricField = z
  .union([z.string().max(64), z.number()])
  .transform((value, context) => {
    const check = checkStudentNumber(value);
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
    /** The LASU email on the list (a personal one for a student on a JAMB number), in full; null when the HOC did not give one. */
    listedEmail: z.string().nullable(),
  }).nullable(),
  /**
   * 'jamb' while the student is known by their JAMB registration number (no
   * LASU matric number yet): their personal email stands in for the LASU one
   * until they add their matric number and LASU email.
   */
  numberKind: z.enum(['matric', 'jamb']).default('matric'),
  /** The number the student is known by now (matric, or JAMB while they have none). */
  studentNumber: z.string().nullable().default(null),
  /** Their JAMB number, kept after the matric number arrives (they can still sign in with it). */
  jambNumber: z.string().nullable().default(null),
  /** 'personal' when the confirmed address is a personal one (a JAMB-number student); null before any is confirmed. */
  emailKind: z.enum(['lasu', 'personal']).nullable().default(null),
  /** True once a code sent to their LASU address was entered. */
  emailVerified: z.boolean(),
  /** The account's confirmed address (LASU, or personal for a JAMB-number student) once verified. */
  lasuEmail: z.string().nullable(),
  /**
   * The personal email the student linked (ADR 040), shown in full on their
   * own pages; null when none is linked. Codes and notices can go to it, and
   * Google sign-in with it opens this account.
   */
  secondaryEmail: z.string().nullable().default(null),
  /** True once a code sent to the personal email was entered (it proves ownership). */
  secondaryEmailVerified: z.boolean().default(false),
  /** Where account emails go; 'secondary' only while a verified personal email is linked. */
  mailDelivery: MailDeliverySchema.default('primary'),
  /**
   * Opened with a setup code from the HOC: the HOC vouched for the student,
   * so the face can be registered (and attendance marked) before the LASU
   * email is confirmed.
   */
  vouched: z.boolean().default(false),
  faceRequired: z.boolean(),
  faceRegistered: z.boolean(),
  /** True while the LASU-style starting password is still in use. */
  defaultPassword: z.boolean(),
  /**
   * This sign-in used the starting password, which anyone who knows the
   * student's number and surname can work out. Before registering a face (or,
   * with face checks off, marking attendance) the student chooses their own
   * password with an emailed code or Google (ADR 033).
   */
  choosePassword: z.boolean().default(false),
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
    /** The full name on the class list, e.g. "ODEJOBI Abraham Oluwaseun". */
    fullName: z.string(),
    departmentName: z.string(),
    levelLabel: z.string(),
    /**
     * True when an account is open and its LASU email is confirmed: sign in
     * (or reset the password with a code) instead of starting.
     */
    hasAccount: z.boolean(),
    /**
     * 'none': no account yet. 'open': an account with a confirmed LASU email.
     * 'unconfirmed': an older account uses this matric number but never
     * confirmed a LASU email; whoever confirms the LASU email (or brings a
     * setup code from the HOC) takes it over, keeping its attendance.
     */
    accountStatus: z.enum(['none', 'open', 'unconfirmed']).default('none'),
    // Whether the account still uses the starting password is never said here:
    // anyone can type a matric number, and it would point at guessable accounts.
    /** True when the class list has their LASU email (the code goes there); false: the student types it. */
    emailOnList: z.boolean(),
    /**
     * 'jamb' when they are on the list by their JAMB registration number: the
     * code goes to a personal email (the one on the list, or the one they type).
     */
    numberKind: z.enum(['matric', 'jamb']).default('matric'),
  }),
  z.object({ status: z.literal('not_found'), matricNumber: z.string() }),
  /**
   * The JAMB number typed was replaced on the class list by a matric number:
   * the student signs in (or opens the account) with the matric number now.
   */
  z.object({ status: z.literal('replaced'), matricNumber: z.string(), replacedBy: z.string() }),
]);
export type ClassListLookupResult = z.infer<typeof ClassListLookupResultSchema>;

/**
 * Opening an account: send a code to the LASU address (the listed one unless
 * the list has none). A student on the list by JAMB number gives a personal
 * address instead; the server checks which kind is allowed.
 */
export const OpenAccountCodeRequestSchema = z.object({
  matricNumber: MatricNumberInputSchema,
  email: StudentEmailSchema.optional(),
}).strict();
export type OpenAccountCodeRequest = z.input<typeof OpenAccountCodeRequestSchema>;

export const OpenAccountRequestSchema = z.object({
  matricNumber: MatricNumberInputSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
}).strict();
export type OpenAccountRequest = z.input<typeof OpenAccountRequestSchema>;

/** A setup code from the HOC, typed with or without the dash. */
export const SetupCodeSchema = z.string().max(20)
  .transform(normalizeSetupCode)
  .pipe(z.string().regex(new RegExp(`^[${SETUP_CODE_ALPHABET}]{${SETUP_CODE_LENGTH}}$`), 'Enter the 8-character setup code from your HOC, e.g. ABCD-EFGH.'));

/**
 * Opening an account with a setup code from the HOC instead of the emailed
 * code. The LASU email is needed only when the class list has none; it is
 * confirmed later from the account.
 */
export const OpenWithSetupCodeRequestSchema = z.object({
  matricNumber: MatricNumberInputSchema,
  setupCode: SetupCodeSchema,
  email: StudentEmailSchema.optional(),
}).strict();
export type OpenWithSetupCodeRequest = z.input<typeof OpenWithSetupCodeRequestSchema>;

export const OpenAccountResultSchema = z.object({
  status: z.literal('opened'),
  student: AuthStudentSchema,
  /** The LASU-style starting password, shown once so the student can note it. */
  startingPassword: z.string(),
  /** True when an older, unconfirmed account with this matric number was handed over (its attendance kept). */
  takenOver: z.boolean().default(false),
});
export type OpenAccountResult = z.infer<typeof OpenAccountResultSchema>;

/** Forgot password, for a student with an open account: a code to their confirmed LASU email. */
export const StudentPasswordCodeRequestSchema = z.object({ matricNumber: MatricNumberInputSchema }).strict();
export type StudentPasswordCodeRequest = z.input<typeof StudentPasswordCodeRequestSchema>;

export const StudentPasswordResetRequestSchema = z.object({
  matricNumber: MatricNumberInputSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
  password: NewPasswordSchema,
}).strict();
export type StudentPasswordResetRequest = z.input<typeof StudentPasswordResetRequestSchema>;

export const StudentPasswordResetResultSchema = z.object({
  status: z.literal('password_reset'),
  student: AuthStudentSchema,
  /** Other devices that were signed out. */
  signedOutSessions: z.number().int().nonnegative(),
});
export type StudentPasswordResetResult = z.infer<typeof StudentPasswordResetResultSchema>;

/** A HOC's one-time setup code for one student (shown once). */
export const SetupCodeIssuedSchema = z.object({
  status: z.literal('issued'),
  /** Formatted ABCD-EFGH. */
  code: z.string(),
  expiresAt: z.iso.datetime(),
  matricNumber: z.string(),
  studentName: z.string(),
  /** True when it will take over an older account whose email was never confirmed. */
  takesOver: z.boolean(),
});
export type SetupCodeIssued = z.infer<typeof SetupCodeIssuedSchema>;

/**
 * Administrators only: takes a confirmed account away from whoever confirmed
 * it (the class list had the wrong LASU email, or the wrong person got in),
 * so the real student can open it. The student's correct LASU email goes on
 * the list, and only that address (or a setup code) can open it again.
 */
export const ClassListReleaseRequestSchema = z.object({
  /** LASU email; a personal one for a student still on a JAMB number. */
  email: StudentEmailSchema,
  reason: z.string().trim().min(5, 'Say briefly why (at least 5 characters).').max(300),
}).strict();
export type ClassListReleaseRequest = z.input<typeof ClassListReleaseRequestSchema>;

/**
 * An active or suspended student account linked to no class-list name (administrators only).
 * `listed` says whether its number is on a list anyway, which tells what probably happened.
 */
export const UnlistedStudentSchema = z.object({
  userId: z.uuid(),
  name: z.string().max(160),
  studentNumber: z.string().max(64),
  email: z.string().max(320),
  emailConfirmed: z.boolean(),
  departmentName: z.string().max(200).nullable(),
  status: z.enum(['active', 'suspended']),
  createdAt: z.iso.datetime(),
  /** The last time any of its sign-ins was used. */
  lastSeenAt: z.iso.datetime().nullable(),
  attendanceRecords: z.number().int().nonnegative(),
  faceRegistered: z.boolean(),
  /** It also has staff access, so it is changed on the Staff page instead. */
  isStaff: z.boolean(),
  /**
   * The class-list name with the same number, if any. `linkedToAnother`: that name already has
   * its own account, so this one is a second account for the same student.
   */
  listed: z.object({
    departmentCode: z.string().max(20),
    departmentName: z.string().max(200),
    entryYear: z.number().int(),
    linkedToAnother: z.boolean(),
  }).nullable(),
});
export type UnlistedStudent = z.infer<typeof UnlistedStudentSchema>;

export const UnlistedStudentsSchema = z.object({
  accounts: z.array(UnlistedStudentSchema).max(200),
  /** Every unlisted account in the area, when there are more than are sent. */
  total: z.number().int().nonnegative(),
});
export type UnlistedStudents = z.infer<typeof UnlistedStudentsSchema>;

export const UnlistedStudentStatusRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Say briefly why (at least 5 characters).').max(300),
}).strict();
export type UnlistedStudentStatusRequest = z.input<typeof UnlistedStudentStatusRequestSchema>;

export const UnlistedStudentStatusChangedSchema = z.object({
  userId: z.uuid(),
  status: z.enum(['active', 'suspended']),
});
export type UnlistedStudentStatusChanged = z.infer<typeof UnlistedStudentStatusChangedSchema>;

export const AccountReleasedSchema = z.object({
  status: z.literal('released'),
  matricNumber: z.string(),
  studentName: z.string(),
  /** The confirmed address the account had; told about the release. */
  previousEmail: z.string(),
  /** The corrected address now on the class list. */
  listedEmail: z.string(),
  signedOutSessions: z.number().int().nonnegative(),
  faceDeleted: z.boolean(),
});
export type AccountReleased = z.infer<typeof AccountReleasedSchema>;

/** A signed-in student confirming their LASU address (the listed one unless the list has none); a personal one while on a JAMB number. */
export const StudentEmailCodeRequestSchema = z.object({ email: StudentEmailSchema.optional() }).strict();
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

/* ---------------- a student's linked personal email (ADR 040) ---------------- */

/**
 * Linking or changing the personal email, step 1: the account password (so a
 * borrowed, still-signed-in phone is not enough) and the personal address the
 * code goes to.
 */
export const StudentSecondaryEmailCodeRequestSchema = z.object({
  password: z.string().min(1, 'Enter your password.'),
  email: SecondaryEmailSchema,
}).strict();
export type StudentSecondaryEmailCodeRequest = z.input<typeof StudentSecondaryEmailCodeRequestSchema>;

/** Removing the linked personal email: the account password again. */
export const StudentSecondaryEmailRemoveRequestSchema = z.object({
  password: z.string().min(1, 'Enter your password.'),
}).strict();
export type StudentSecondaryEmailRemoveRequest = z.input<typeof StudentSecondaryEmailRemoveRequestSchema>;

export const StudentSecondaryEmailRemovedSchema = z.object({ status: z.literal('removed') });
export type StudentSecondaryEmailRemoved = z.infer<typeof StudentSecondaryEmailRemovedSchema>;

export const StudentMailDeliveryRequestSchema = z.object({ delivery: MailDeliverySchema }).strict();
export type StudentMailDeliveryRequest = z.input<typeof StudentMailDeliveryRequestSchema>;

export const StudentMailDeliveryResultSchema = z.object({
  status: z.literal('updated'),
  mailDelivery: MailDeliverySchema,
});
export type StudentMailDeliveryResult = z.infer<typeof StudentMailDeliveryResultSchema>;

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
  /** Opened with a HOC's setup code and the LASU email not confirmed yet. */
  setupCodeUsed: z.boolean().default(false),
  /** 'jamb' while the student is on the list by JAMB registration number (Direct Entry, no matric number yet). */
  numberKind: z.enum(['matric', 'jamb']).default('matric'),
  /** Their JAMB number, when the list had it; kept after the matric number replaces it. */
  jambNumber: z.string().nullable().default(null),
  addedByName: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ClassListEntry = z.infer<typeof ClassListEntrySchema>;

/**
 * One class list (a department's set) in the viewer's area, with how far its students have got.
 * The counts are cumulative, like ClassList.counts: `joined` includes everyone further along.
 */
export const ClassListSummarySchema = z.object({
  departmentId: z.uuid(),
  entryYear: z.number().int(),
  setLabel: z.string(),
  total: z.number().int().nonnegative(),
  joined: z.number().int().nonnegative(),
  emailConfirmed: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  /** The latest change to any entry on the list. */
  updatedAt: z.iso.datetime(),
});
export type ClassListSummary = z.infer<typeof ClassListSummarySchema>;

export const ClassListSchema = z.object({
  /** `code` is short and unique in the institution ("ECE"), so pages can link with it. */
  departments: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string(), facultyName: z.string() })).max(500),
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
  /** Every list in the viewer's area (one set only for HOCs and GHOCs), by department then newest set. */
  lists: z.array(ClassListSummarySchema).max(2000),
  faceRequired: z.boolean(),
  /** True when the viewer may reset registered faces (administrators). */
  canResetFaces: z.boolean(),
  /** False for an assistant their HOC has not allowed to give setup codes. */
  canGiveSetupCodes: z.boolean().default(true),
  /**
   * Departments the viewer may move a student into (same set), when a student is on the
   * wrong list: their own faculty for a HOC or GHOC, their area for an administrator.
   */
  moveDepartments: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string(), facultyName: z.string() })).max(500).default([]),
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

/** Moves a student to another department's list for the same set (account, attendance and face stay). */
export const MoveClassListEntryRequestSchema = z.object({ departmentId: z.uuid() }).strict();
export type MoveClassListEntryRequest = z.infer<typeof MoveClassListEntryRequestSchema>;

/**
 * One row of an uploaded class list, as the browser read it. Rows are not
 * validated here: the server checks each one with checkStudentNumber and
 * checkPersonName and reports every problem by row number, so one bad row
 * never hides the others. (Single-entry edits, below, are validated strictly.)
 *
 * `matricNumber` is the number the student is known by: the LASU matric
 * number, or the JAMB registration number of a student without one yet (a
 * JAMB number makes them Direct Entry unless `entryLevel` says otherwise).
 * `jambNumber` is set when the sheet has a JAMB column next to the matric
 * column: a student already on the list by that JAMB number is switched to
 * the matric number, keeping their account and attendance. `lasuEmail` is the
 * student's LASU email, or a personal one for a student on a JAMB number.
 */
export const ClassListRowInputSchema = z.object({
  matricNumber: z.union([z.string().max(64), z.number()]).transform((value) => String(value)),
  jambNumber: z.string().max(64).nullable().optional(),
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
  /** Students on the list by JAMB number who get (or got) their matric number from this upload. */
  switched: z.number().int().nonnegative().default(0),
  /** Rows of students on a JAMB number (Direct Entry, no matric number yet). */
  onJamb: z.number().int().nonnegative().default(0),
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

/**
 * A student on a JAMB number adds their LASU matric number and LASU email,
 * step 1: a code to the LASU email. Their account, attendance, courses and
 * face stay; every register shows the matric number from then on.
 */
export const StudentMatricCodeRequestSchema = z.object({
  matricNumber: z.union([z.string().max(64), z.number()]).transform((value, context) => {
    const check = checkMatricNumber(value);
    if (!check.ok) {
      context.addIssue({ code: 'custom', message: check.message });
      return z.NEVER;
    }
    return check.value;
  }),
  email: LasuStudentEmailSchema,
}).strict();
export type StudentMatricCodeRequest = z.input<typeof StudentMatricCodeRequestSchema>;

/** Step 2: the code from the LASU email switches the account to the matric number. */
export const StudentMatricConfirmRequestSchema = StudentMatricCodeRequestSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
}).strict();
export type StudentMatricConfirmRequest = z.input<typeof StudentMatricConfirmRequestSchema>;

export const StudentMatricSwitchedSchema = z.object({
  status: z.literal('switched'),
  matricNumber: z.string(),
  previousNumber: z.string(),
  email: z.string(),
  /** Attendance records moved to the matric number. */
  attendanceMoved: z.number().int().nonnegative(),
});
export type StudentMatricSwitched = z.infer<typeof StudentMatricSwitchedSchema>;

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

/* ---------------- confirming the email with Google (ADR 027) ---------------- */

/**
 * LASU student emails are Google accounts, so Google can confirm a student
 * owns one: they pick the account on Google's own page and Google signs a
 * statement (an ID token) saying so. It stands in for the 6-digit code
 * everywhere a code is asked for. Only the address is shared: never the
 * mailbox, the password or anything else.
 *
 * The browser makes a random nonce; Google is sent its digest for one
 * purpose (see GOOGLE_PROOF_PURPOSES), so a proof works for that step only
 * and is useless without the nonce that only this browser holds.
 */
export const GOOGLE_PROOF_PURPOSES = ['open', 'reset', 'email', 'matric', 'face', 'signin'] as const;
export type GoogleProofPurpose = (typeof GOOGLE_PROOF_PURPOSES)[number];
/** How long after Google signed it a proof is accepted (Google's own tokens last an hour). */
export const GOOGLE_PROOF_MAX_AGE_SECONDS = 15 * 60;

const googleAgain = 'Sign in with Google again.';
export const GoogleProofSchema = z.object({
  /** The ID token, as Google returned it (three base64url parts). */
  credential: z.string().min(100).max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, googleAgain),
  /** The browser's raw nonce: 32 random bytes, base64url. */
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/, googleAgain),
}).strict();
export type GoogleProof = z.input<typeof GoogleProofSchema>;

/** Public: whether "Continue with Google" is on, and where Google sends the student back. */
export const GoogleSignInConfigSchema = z.object({
  /** Null: not set up on this deployment (the button is hidden). */
  clientId: z.string().nullable(),
  /** The only address Google returns to; the button shows only on this origin. */
  redirectUri: z.string().nullable(),
  hostedDomain: z.string(),
});
export type GoogleSignInConfig = z.infer<typeof GoogleSignInConfigSchema>;

/** Signing in with Google (any account whose confirmed email Google vouches for), in place of the password. */
export const GoogleSignInRequestSchema = z.object({ google: GoogleProofSchema }).strict();
export type GoogleSignInRequest = z.input<typeof GoogleSignInRequestSchema>;

/** Opening an account with Google in place of the emailed code. */
export const OpenWithGoogleRequestSchema = z.object({
  matricNumber: MatricNumberInputSchema,
  google: GoogleProofSchema,
}).strict();
export type OpenWithGoogleRequest = z.input<typeof OpenWithGoogleRequestSchema>;

/** Forgot password: Google confirms the account's email, then the new password. */
export const StudentPasswordGoogleRequestSchema = z.object({
  matricNumber: MatricNumberInputSchema,
  google: GoogleProofSchema,
  password: NewPasswordSchema,
}).strict();
export type StudentPasswordGoogleRequest = z.input<typeof StudentPasswordGoogleRequestSchema>;

/** A signed-in student confirming their email (e.g. after a setup code) with Google. */
export const StudentEmailGoogleRequestSchema = z.object({ google: GoogleProofSchema }).strict();
export type StudentEmailGoogleRequest = z.input<typeof StudentEmailGoogleRequestSchema>;

/** A student on a JAMB number switching to their matric number; Google confirms the LASU email. */
export const StudentMatricGoogleRequestSchema = z.object({
  matricNumber: StudentMatricCodeRequestSchema.shape.matricNumber,
  google: GoogleProofSchema,
}).strict();
export type StudentMatricGoogleRequest = z.input<typeof StudentMatricGoogleRequestSchema>;

/** Taking new face photos: the password and Google, in place of the password and a code. */
export const FaceReplaceGoogleRequestSchema = z.object({
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
  google: GoogleProofSchema,
}).strict();
export type FaceReplaceGoogleRequest = z.input<typeof FaceReplaceGoogleRequestSchema>;

/* ---------------- audit log (administrators) ---------------- */

export const AuditCategorySchema = z.enum(['students', 'faces', 'attendance', 'staff', 'structure', 'venues', 'retention']);
export type AuditCategory = z.infer<typeof AuditCategorySchema>;

/** Entries per page of the audit log. */
export const AUDIT_PAGE_SIZE = 50;
/** Most rows one CSV download carries. */
export const AUDIT_EXPORT_MAX = 5000;
/** The audit summary looks back this many days (and compares with the same span before). */
export const AUDIT_SUMMARY_DAYS = 7;

/**
 * Actions worth a second look: they take something away from a person or hand an account to
 * someone else. The audit log highlights them; nothing about them is blocked.
 */
export const AUDIT_NOTABLE_ACTIONS = [
  'account_released',
  'account_taken_over',
  'face_reset',
  'face_duplicate_refused',
  'face_replace_refused',
  'face_review_rejected',
  'attendee_removed',
  'class_list_entry_removed',
  'staff_suspended',
  'staff_role_changed',
  'student_account_suspended',
  'attendance_appeal_upheld',
] as const;

export const AuditLogQuerySchema = z.object({
  category: AuditCategorySchema.optional(),
  /** Matric number, name or email of the person acted on or acting, or a venue, department or course. */
  q: z.string().trim().max(120).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Only what this staff member or student did. */
  actor: z.uuid().optional(),
  /** Only entries worth a second look (AUDIT_NOTABLE_ACTIONS and deactivations). */
  notable: z.literal('true').optional(),
  cursor: z.string().max(200).optional(),
}).strict();
export type AuditLogQuery = z.input<typeof AuditLogQuerySchema>;

/** One labelled fact about an entry: "Rows: 62", "Programme length: 4 years → 5 years". */
export const AuditFactSchema = z.object({
  label: z.string().max(60),
  value: z.string().max(400),
  /** The value before a change, when the fact is a change. */
  previous: z.string().max(400).nullable(),
});
export type AuditFact = z.infer<typeof AuditFactSchema>;

/** A page in the app the entry is about (a relative path). */
export const AuditLinkSchema = z.object({
  label: z.string().max(80),
  href: z.string().max(300).regex(/^\/(?!\/)/),
});
export type AuditLink = z.infer<typeof AuditLinkSchema>;

export const AuditLogEntrySchema = z.object({
  /** Unique across sources: "<source>:<uuid>". */
  id: z.string().max(80),
  category: AuditCategorySchema,
  action: z.string().max(64),
  summary: z.string().max(200),
  actorName: z.string().max(160).nullable(),
  /** The account that acted, for "everything by this person"; null for the system. */
  actorId: z.uuid().nullable(),
  /** Who or what was acted on (a student's name and matric, a venue, a department…). */
  subject: z.string().max(240).nullable(),
  /** What to search for "everything about this": a matric number, or the name of what was changed. */
  subjectSearch: z.string().max(120).nullable(),
  /** Plain facts read from the record, with internal ids replaced by names. */
  facts: z.array(AuditFactSchema).max(12),
  /** A reason or note someone wrote, in their words. */
  note: z.string().max(1000).nullable(),
  links: z.array(AuditLinkSchema).max(4),
  /** One of AUDIT_NOTABLE_ACTIONS, or a faculty or department deactivated. */
  notable: z.boolean(),
  /** The stored record as text, ids and all, for anyone who needs it exactly. */
  details: z.string().max(2000),
  at: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

const AuditCategoryCountsSchema = z.object({
  students: z.number().int().nonnegative(),
  faces: z.number().int().nonnegative(),
  attendance: z.number().int().nonnegative(),
  staff: z.number().int().nonnegative(),
  structure: z.number().int().nonnegative(),
  venues: z.number().int().nonnegative(),
  retention: z.number().int().nonnegative(),
});
export type AuditCategoryCounts = z.infer<typeof AuditCategoryCountsSchema>;

export const AuditLogPageSchema = z.object({
  entries: z.array(AuditLogEntrySchema).max(100),
  nextCursor: z.string().max(200).nullable(),
  scopeLabel: z.string().max(200),
  /** Department and faculty administrators see student events of their area only, and staff and structure events they made. */
  limitedToScope: z.boolean(),
  /** On the first page: how many entries each category has under the other filters. */
  counts: AuditCategoryCountsSchema.nullable(),
  /** The person `actor` names, so the filter can say who it is. */
  actor: z.object({ id: z.uuid(), name: z.string().max(160) }).nullable(),
});
export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;

/** The last AUDIT_SUMMARY_DAYS days, whatever the filters. */
export const AuditSummarySchema = z.object({
  since: z.iso.datetime(),
  total: z.number().int().nonnegative(),
  /** The same span just before, to compare. */
  previousTotal: z.number().int().nonnegative(),
  byCategory: AuditCategoryCountsSchema,
  /** People who made changes (staff and students acting themselves). */
  people: z.number().int().nonnegative(),
  notableCount: z.number().int().nonnegative(),
  /** The newest notable entries, up to 5. */
  notable: z.array(AuditLogEntrySchema).max(5),
  scopeLabel: z.string().max(200),
  limitedToScope: z.boolean(),
});
export type AuditSummary = z.infer<typeof AuditSummarySchema>;

/** One entry, for a link to it. */
export const AuditEntryDetailSchema = z.object({ entry: AuditLogEntrySchema });
export type AuditEntryDetail = z.infer<typeof AuditEntryDetailSchema>;
export const AUDIT_ENTRY_ID_PATTERN = /^(student|manual|removal|staff|structure|venue):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------------- data retention (administrators) ---------------- */

/**
 * The retention a deployment uses unless RETENTION_GRACE_MONTHS, RETENTION_ACTIVE_DAYS or
 * RETENTION_CHECK_PHOTO_DAYS override it. The help page quotes these, so they cannot drift apart.
 */
export const RETENTION_DEFAULTS = { graceMonths: 12, activeWithinDays: 180, checkPhotoDays: 90 } as const;

export const RetentionPolicySchema = z.object({
  /** Months after a set's final session ends before its face data is deleted. */
  graceMonths: z.number().int().min(0).max(120),
  /** A student who checked in to a lecture this recently keeps their face (still studying). */
  activeWithinDays: z.number().int().min(0).max(3650),
  /** Check-in photos kept for review are deleted after this many days. */
  checkPhotoDays: z.number().int().min(1).max(3650),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

/** The retention page looks this far ahead for sets whose face data will become due. */
export const RETENTION_LOOKAHEAD_MONTHS = 24;
/** Recent clean-up runs listed on the retention page. */
export const RETENTION_RUNS_SHOWN = 10;

export const RetentionSetSchema = z.object({
  departmentId: z.uuid(),
  departmentCode: z.string().max(40),
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
  /**
   * Sets whose face data is due by now or within RETENTION_LOOKAHEAD_MONTHS (finished ones,
   * cleared or not, and those finishing soon), oldest first. Department and faculty
   * administrators get their own area's sets only.
   */
  sets: z.array(RetentionSetSchema).max(2000),
  due: z.object({
    faces: z.number().int().nonnegative(),
    checkPhotos: z.number().int().nonnegative(),
  }),
  /** What is stored now, in the caller's area. */
  holding: z.object({
    faces: z.number().int().nonnegative(),
    /** Registered faces of students on no class list; retention never reaches them (institution administrators only, else 0). */
    facesUnlisted: z.number().int().nonnegative(),
    checkPhotos: z.number().int().nonnegative(),
    oldestCheckPhotoAt: z.iso.datetime().nullable(),
  }),
  lastRun: RetentionRunSummarySchema.nullable(),
  /** The newest runs first (whole institution), up to RETENTION_RUNS_SHOWN. */
  runs: z.array(RetentionRunSummarySchema).max(10),
  scopeLabel: z.string().max(200),
  limitedToScope: z.boolean(),
  /** True when the daily scheduled run is configured (CRON_SECRET set). */
  scheduled: z.boolean(),
  /** Only institution administrators can run it; others see the preview. */
  canRun: z.boolean(),
});
export type RetentionPreview = z.infer<typeof RetentionPreviewSchema>;

/**
 * Where one student on a finished set's list stands: `due` (face goes at the next run),
 * `keeping` (due by date, but checked in within activeWithinDays), `waiting` (set not due
 * yet) or `no_face` (nothing registered to delete).
 */
export const RetentionStudentStateSchema = z.enum(['due', 'keeping', 'waiting', 'no_face']);
export type RetentionStudentState = z.infer<typeof RetentionStudentStateSchema>;

export const RetentionStudentSchema = z.object({
  matricNumber: z.string().max(32),
  name: z.string().max(240),
  hasAccount: z.boolean(),
  state: RetentionStudentStateSchema,
  faceRegisteredAt: z.iso.datetime().nullable(),
  lastCheckInAt: z.iso.datetime().nullable(),
  /** Check-in photos stored for review. */
  checkPhotos: z.number().int().nonnegative(),
});
export type RetentionStudent = z.infer<typeof RetentionStudentSchema>;

/** One set, student by student. */
export const RetentionSetDetailSchema = z.object({
  set: RetentionSetSchema,
  students: z.array(RetentionStudentSchema).max(3000),
  /** More students than are listed. */
  truncated: z.boolean(),
});
export type RetentionSetDetail = z.infer<typeof RetentionSetDetailSchema>;

export const RetentionRunRequestSchema = z.object({ confirm: z.literal(true) }).strict();
export type RetentionRunRequest = z.input<typeof RetentionRunRequestSchema>;

export const RetentionRunResultSchema = z.object({
  facesDeleted: z.number().int().nonnegative(),
  checkPhotosDeleted: z.number().int().nonnegative(),
  ranAt: z.iso.datetime(),
});
export type RetentionRunResult = z.infer<typeof RetentionRunResultSchema>;

/* ---------------- Contact: messages to the LASUATOS team ---------------- */

/**
 * What a message to the team is about. Attendance entries, names and matric
 * numbers are routed to the lecturer, class rep or HOC on the contact page
 * instead; these are the cases only the team can handle.
 */
export const CONTACT_TOPICS = ['adoption', 'problem', 'account', 'privacy', 'other'] as const;
export const ContactTopicSchema = z.enum(CONTACT_TOPICS);
export type ContactTopic = z.infer<typeof ContactTopicSchema>;

export const CONTACT_TOPIC_LABELS: Readonly<Record<ContactTopic, string>> = {
  adoption: 'Bring LASUATOS to a department',
  problem: 'Something isn’t working',
  account: 'Account or sign-in',
  privacy: 'Privacy or data request',
  other: 'Something else',
};

export const CONTACT_ROLES = ['student', 'class_rep', 'lecturer', 'administrator', 'university_staff', 'other'] as const;
export const ContactRoleSchema = z.enum(CONTACT_ROLES);
export type ContactRole = z.infer<typeof ContactRoleSchema>;

export const CONTACT_ROLE_LABELS: Readonly<Record<ContactRole, string>> = {
  student: 'Student',
  class_rep: 'Class rep (HOC or GHOC)',
  lecturer: 'Lecturer',
  administrator: 'HOD, dean or administrator',
  university_staff: 'Other university staff',
  other: 'Someone else',
};

export const CONTACT_PRIVACY_REQUESTS = ['copy', 'correct', 'delete_face', 'object', 'other'] as const;
export const ContactPrivacyRequestSchema = z.enum(CONTACT_PRIVACY_REQUESTS);
export type ContactPrivacyRequest = z.infer<typeof ContactPrivacyRequestSchema>;

export const CONTACT_PRIVACY_REQUEST_LABELS: Readonly<Record<ContactPrivacyRequest, string>> = {
  copy: 'A copy of my data',
  correct: 'Correct something about me',
  delete_face: 'Delete my face data',
  object: 'Object to how my data is used',
  other: 'Another privacy question',
};

export const CONTACT_MESSAGE_MIN = 20;
export const CONTACT_MESSAGE_MAX = 3000;

// Letters (any script), spaces and the punctuation found in names and titles ("Dr. A. Bello-Ojo").
const contactNamePattern = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
// Control characters other than tab and line breaks never belong in a message.
const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => (value ? value : undefined));

export const ContactMessageRequestSchema = z.object({
  topic: ContactTopicSchema,
  name: z.string().trim().min(2, 'Enter your name.').max(120).regex(contactNamePattern, 'Use letters for your name.'),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter an email address we can reply to.')),
  role: ContactRoleSchema.optional(),
  /** Department, faculty or unit. */
  department: optionalText(160),
  /** Students only, and only when it helps (privacy and account requests). */
  matricNumber: optionalText(20)
    .transform((value) => value?.replace(/\s+/g, ''))
    .refine((value) => value === undefined || /^\d{6,12}$/.test(value), 'A matric number has digits only.'),
  privacyRequest: ContactPrivacyRequestSchema.optional(),
  /** Problem reports: which page or step. */
  page: optionalText(200),
  /** Problem reports: browser and device, filled in by the page with consent. */
  device: optionalText(300),
  /** Adoption: roughly how many students. */
  students: z.number().int().min(1).max(100_000).optional(),
  message: z.string().trim()
    .min(CONTACT_MESSAGE_MIN, `Tell us a little more (at least ${CONTACT_MESSAGE_MIN} characters).`)
    .max(CONTACT_MESSAGE_MAX, `Keep it under ${CONTACT_MESSAGE_MAX} characters.`)
    .refine((value) => !controlCharacters.test(value), 'Remove the unusual characters from your message.'),
  /** Spam trap: a field people never see. Must be empty. */
  website: z.string().max(200).optional(),
  /** How long the form was open, in milliseconds (bots post instantly). */
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
}).strict();
export type ContactMessageRequest = z.input<typeof ContactMessageRequestSchema>;
export type ContactMessageInput = z.output<typeof ContactMessageRequestSchema>;

export const ContactMessageSentSchema = z.object({
  /** Quoted in the confirmation email and when the team replies, e.g. "LA-7K3P9Q". */
  reference: z.string().regex(/^LA-[0-9A-Z]{6}$/),
});
export type ContactMessageSent = z.infer<typeof ContactMessageSentSchema>;

export const ContactMessageStatusSchema = z.enum(['new', 'handled']);
export type ContactMessageStatus = z.infer<typeof ContactMessageStatusSchema>;

export const ContactMessageSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  topic: ContactTopicSchema,
  status: ContactMessageStatusSchema,
  name: z.string(),
  email: z.string(),
  role: ContactRoleSchema.nullable(),
  department: z.string().nullable(),
  matricNumber: z.string().nullable(),
  privacyRequest: ContactPrivacyRequestSchema.nullable(),
  page: z.string().nullable(),
  device: z.string().nullable(),
  students: z.number().int().nullable(),
  message: z.string(),
  /** Whether the sender was signed in to the account behind this email. */
  signedIn: z.boolean(),
  createdAt: z.iso.datetime(),
  handledAt: z.iso.datetime().nullable(),
  handledByName: z.string().nullable(),
  /** What the team did, noted when it was marked handled. Only administrators see it. */
  note: z.string().nullable(),
});
export type ContactMessage = z.infer<typeof ContactMessageSchema>;

/** The contact page promises a reply within this many working days (Monday to Friday). */
export const CONTACT_REPLY_WORKING_DAYS = 2;
/** Privacy requests must be answered within 30 days (NDPA 2023 and the NDPC's GAID 2025). */
export const CONTACT_PRIVACY_REPLY_DAYS = 30;
export const CONTACT_NOTE_MAX = 1000;
/** Handled messages are deleted this long after they were handled; any message after 730 days. */
export const CONTACT_HANDLED_KEEP_DAYS = 365;

const CONTACT_DAY = 86_400_000;
/** Lagos is UTC+1 all year, so its weekday is the UTC weekday an hour later. */
const lagosWeekday = (time: number) => new Date(time + 3_600_000).getUTCDay();

/**
 * When a reply is due: two working days after the message arrived (a Friday afternoon
 * message is due on Tuesday afternoon), or 30 days for a privacy request.
 */
export function contactReplyDue(message: { readonly topic: ContactTopic; readonly createdAt: string | Date }): Date {
  const start = new Date(message.createdAt).getTime();
  if (message.topic === 'privacy') return new Date(start + CONTACT_PRIVACY_REPLY_DAYS * CONTACT_DAY);
  let due = start;
  let added = 0;
  while (added < CONTACT_REPLY_WORKING_DAYS) {
    due += CONTACT_DAY;
    const day = lagosWeekday(due);
    if (day !== 0 && day !== 6) added += 1;
  }
  return new Date(due);
}

export const ContactInboxQuerySchema = z.object({
  status: z.enum(['new', 'handled', 'all']).optional(),
  topic: ContactTopicSchema.optional(),
  /** Matches a reference exactly, or words in the name, email or message. */
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
});
export type ContactInboxQuery = z.input<typeof ContactInboxQuerySchema>;

/** Just enough of a message to list it in "Needs a look". */
export const ContactBriefSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  name: z.string(),
  topic: ContactTopicSchema,
  privacyRequest: ContactPrivacyRequestSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type ContactBrief = z.infer<typeof ContactBriefSchema>;

/** The whole inbox at a glance, whatever the filters. */
export const ContactInboxSummarySchema = z.object({
  newByTopic: z.object({
    adoption: z.number().int().nonnegative(),
    problem: z.number().int().nonnegative(),
    account: z.number().int().nonnegative(),
    privacy: z.number().int().nonnegative(),
    other: z.number().int().nonnegative(),
  }),
  /** New messages past their reply date (two working days; 30 days for privacy requests). */
  overdue: z.number().int().nonnegative(),
  oldestNewAt: z.iso.datetime().nullable(),
  /** Privacy requests not yet handled, oldest first (they have a legal deadline). */
  privacyOpen: z.array(ContactBriefSchema).max(20),
  /** Other new messages past their reply date, oldest first. */
  overdueOldest: z.array(ContactBriefSchema).max(5),
  handledLast30Days: z.number().int().nonnegative(),
  /** Median hours from arrival to handled, over messages handled in the last 90 days. */
  medianHandleHours: z.number().nonnegative().nullable(),
});
export type ContactInboxSummary = z.infer<typeof ContactInboxSummarySchema>;

export const ContactInboxSchema = z.object({
  messages: z.array(ContactMessageSchema).max(100),
  nextCursor: z.string().nullable(),
  counts: z.object({ new: z.number().int().nonnegative(), handled: z.number().int().nonnegative() }),
  summary: ContactInboxSummarySchema,
});
export type ContactInbox = z.infer<typeof ContactInboxSchema>;

/** One message, opened by its reference, with the sender's other messages. */
export const ContactMessageDetailSchema = z.object({
  message: ContactMessageSchema,
  /** Other messages from the same email address, newest first. */
  others: z.array(ContactMessageSchema).max(10),
});
export type ContactMessageDetail = z.infer<typeof ContactMessageDetailSchema>;

export const CONTACT_REFERENCE_PATTERN = /^LA-[0-9A-Z]{6}$/;

export const ContactMessageUpdateSchema = z.object({
  status: ContactMessageStatusSchema,
  /** Kept with a handled message; ignored when moving it back to new. */
  note: z.string().trim().max(CONTACT_NOTE_MAX, `Keep the note under ${CONTACT_NOTE_MAX} characters.`).optional(),
}).strict();
export type ContactMessageUpdate = z.input<typeof ContactMessageUpdateSchema>;

export const ContactNewCountSchema = z.object({ new: z.number().int().nonnegative() });
export type ContactNewCount = z.infer<typeof ContactNewCountSchema>;

// ------------------------------------------------------------ system health (ADR 029)

export const EmailProviderNameSchema = z.enum(['brevo', 'gmail', 'resend', 'mailpit']);
export type EmailProviderName = z.infer<typeof EmailProviderNameSchema>;

export const EMAIL_PROVIDER_LABELS: Readonly<Record<EmailProviderName, string>> = {
  brevo: 'Brevo',
  gmail: 'Gmail',
  resend: 'Resend',
  mailpit: 'Mailpit',
};

export const EmailFailureKindSchema = z.enum(['quota', 'setup', 'network', 'recipient', 'unknown']);
export type EmailFailureKind = z.infer<typeof EmailFailureKindSchema>;

export const HealthEmailProviderSchema = z.object({
  provider: EmailProviderNameSchema,
  role: z.enum(['primary', 'fallback']),
  /** Daily allowance; null for no limit. */
  limit: z.number().int().nullable(),
  sentToday: z.number().int().nonnegative(),
  failedToday: z.number().int().nonnegative(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastFailureAt: z.iso.datetime().nullable(),
  lastFailureKind: EmailFailureKindSchema.nullable(),
  /** The provider's reason with credentials removed. */
  lastFailureReason: z.string().nullable(),
  pausedUntil: z.iso.datetime().nullable(),
  state: z.enum(['ready', 'paused', 'full']),
  /** Sent per UTC day, oldest first, matching `email.days`. */
  history: z.array(z.number().int().nonnegative()),
});
export type HealthEmailProvider = z.infer<typeof HealthEmailProviderSchema>;

export const OperatorAlertKindSchema = z.enum([
  'server_error', 'page_error', 'schema_behind', 'email_failover', 'email_failing', 'email_quota', 'error_rate', 'rate_limited', 'sign_in_failures', 'google_failing',
  // ADR 035: database backups.
  'backup_failed', 'backup_late', 'origin_blocked', 'rate_limit_store',
]);
export type OperatorAlertKind = z.infer<typeof OperatorAlertKindSchema>;

export const HealthAlertSchema = z.object({
  id: z.string(),
  kind: OperatorAlertKindSchema,
  summary: z.string(),
  outcome: z.enum(['emailed', 'throttled', 'logged']),
  occurredAt: z.iso.datetime(),
});
export type HealthAlert = z.infer<typeof HealthAlertSchema>;

export const HealthSignalSchema = z.object({
  signal: z.enum(['rate_limited', 'origin_blocked', 'server_errors', 'sign_in_failures', 'google_broken', 'google_refused', 'face_unavailable']),
  count: z.number().int().nonnegative(),
  threshold: z.number().int().positive(),
  windowMinutes: z.number().int().positive(),
});
export type HealthSignal = z.infer<typeof HealthSignalSchema>;

// ------------------------------------------------------------ database backups (ADR 035)

export const BACKUP_STAGES = ['config', 'connect', 'dump', 'restore', 'verify', 'encrypt', 'upload', 'prune', 'done'] as const;
export const BackupStageSchema = z.enum(BACKUP_STAGES);
export type BackupStage = z.infer<typeof BackupStageSchema>;

/** What the nightly backup workflow reports after each run (POST /api/v1/ops/backups). */
export const BackupReportSchema = z.object({
  runId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  runAttempt: z.number().int().positive().max(1_000),
  status: z.enum(['ok', 'failed']),
  stage: BackupStageSchema,
  message: z.string().trim().max(300).nullish(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  tag: z.string().regex(/^db-\d{8}-\d{6}$/).nullish(),
  location: z.url({ protocol: /^https$/ }).max(300).nullish(),
  sizeBytes: z.number().int().nonnegative().nullish(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
  tables: z.number().int().nonnegative().nullish(),
  rows: z.number().int().nonnegative().nullish(),
  kept: z.number().int().nonnegative().nullish(),
  oldestKeptAt: z.iso.datetime().nullish(),
  readOnlyLogin: z.boolean().nullish(),
  schemaCurrent: z.boolean().nullish(),
}).strict().refine((report) => report.status === 'failed' || (report.stage === 'done' && Boolean(report.tag) && report.sizeBytes != null), {
  message: 'A good backup names its release and size.',
});
export type BackupReport = z.infer<typeof BackupReportSchema>;

export const HealthBackupRunSchema = z.object({
  status: z.enum(['ok', 'failed']),
  stage: BackupStageSchema,
  message: z.string().nullable(),
  finishedAt: z.iso.datetime(),
  location: z.string().nullable(),
  runUrl: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  tables: z.number().int().nullable(),
  rows: z.number().int().nullable(),
  kept: z.number().int().nullable(),
  oldestKeptAt: z.iso.datetime().nullable(),
  readOnlyLogin: z.boolean().nullable(),
});
export type HealthBackupRun = z.infer<typeof HealthBackupRunSchema>;

export const HealthBackupsSchema = z.object({
  /** BACKUP_SOURCE_REPOSITORY is set, so nightly backups are expected. */
  configured: z.boolean(),
  /**
   * `ok`: a verified backup in the last 30 hours; `failed`: the newest run failed;
   * `late`: no good backup for 30 hours; `never`: none reported yet; `off`: not set up.
   */
  state: z.enum(['ok', 'failed', 'late', 'never', 'off']),
  last: HealthBackupRunSchema.nullable(),
  lastGood: HealthBackupRunSchema.nullable(),
  /** Good backups in the last 7 days, of 7 expected. */
  goodLast7Days: z.number().int().nonnegative(),
  workflowUrl: z.string().nullable(),
});
export type HealthBackups = z.infer<typeof HealthBackupsSchema>;

export const SystemHealthSchema = z.object({
  checkedAt: z.iso.datetime(),
  /** `ok`: nothing needs attention; `attention`: something degraded; `down`: students are affected now. */
  overall: z.enum(['ok', 'attention', 'down']),
  database: z.object({
    status: z.enum(['up', 'down']),
    latencyMs: z.number().int().nonnegative().nullable(),
    schema: z.enum(['current', 'behind', 'unknown']),
    migration: z.string(),
    /** This server instance's connection pool (each serverless instance has its own). */
    pool: z.object({ total: z.number().int(), idle: z.number().int(), waiting: z.number().int(), max: z.number().int() }).nullable(),
  }),
  email: z.object({
    configured: z.boolean(),
    /** The provider the next email goes through; null when all are skipped (they are then all tried anyway). */
    current: EmailProviderNameSchema.nullable(),
    providers: z.array(HealthEmailProviderSchema),
    days: z.array(z.string()),
    /** Whether operator alerts can be emailed (ALERT_EMAIL set and a provider configured). */
    alertsEmailing: z.boolean(),
    alertRecipients: z.number().int().nonnegative(),
  }),
  alerts: z.array(HealthAlertSchema),
  signals: z.array(HealthSignalSchema),
  cron: z.object({
    configured: z.boolean(),
    lastRunAt: z.iso.datetime().nullable(),
    /** `ok`: ran in the last 26 hours; `late`: older; `never`: no scheduled run yet; `off`: CRON_SECRET not set. */
    state: z.enum(['ok', 'late', 'never', 'off']),
  }),
  google: z.object({ configured: z.boolean() }),
  backups: HealthBackupsSchema,
  rateLimitStore: z.enum(['postgres', 'memory', 'off']),
  release: z.object({ commit: z.string().nullable(), region: z.string().nullable() }),
});
export type SystemHealth = z.infer<typeof SystemHealthSchema>;

/**
 * Public status (ADR 034): what the independent status page checks. Coarse states only,
 * never provider names, counts, versions or errors, because anyone can read it.
 * `off`: the feature is turned off here (the status page hides it).
 */
export const PublicComponentStateSchema = z.enum(['operational', 'degraded', 'down', 'off']);
export type PublicComponentState = z.infer<typeof PublicComponentStateSchema>;

export const PublicStatusSchema = z.object({
  service: z.literal('lasuatos'),
  checkedAt: z.iso.datetime(),
  components: z.object({
    /** The database and its schema: accounts, sign-in and attendance all need it. */
    core: PublicComponentStateSchema,
    /** Many requests failing with a server error lately. */
    errors: PublicComponentStateSchema,
    /** Emailed codes and notices. `operational` while any provider can send. */
    email: PublicComponentStateSchema,
    google: PublicComponentStateSchema,
    face: PublicComponentStateSchema,
  }),
});
export type PublicStatus = z.infer<typeof PublicStatusSchema>;

/** An incident or maintenance notice from the status page, shown as a banner in the app (ADR 034). */
export const StatusNoticeSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(['incident', 'maintenance']),
  impact: z.enum(['minor', 'major', 'maintenance']),
  title: z.string().min(1).max(160),
  /** The latest update, in plain words. */
  message: z.string().max(400),
  /** For maintenance: when it starts and ends. */
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  url: z.url(),
});
export type StatusNotice = z.infer<typeof StatusNoticeSchema>;

export const StatusNoticesSchema = z.object({
  statusPageUrl: z.url().nullable(),
  notices: z.array(StatusNoticeSchema).max(5),
});
export type StatusNotices = z.infer<typeof StatusNoticesSchema>;

// ------------------------------------------------------------ LASU mail (ADR 030)

/**
 * Whether this account can open a LASU inbox here.
 * `ready`: yes; `off`: not switched on (or not yet for this account); `no_google`: Google
 * sign-in is not set up.
 */
export const LasuMailStatusSchema = z.enum(['ready', 'off', 'no_google']);
export type LasuMailStatus = z.infer<typeof LasuMailStatusSchema>;

export const LasuMailConfigSchema = z.object({
  status: LasuMailStatusSchema,
  /**
   * The LASU mailbox to suggest on Google's page: the account's own email when it is a
   * LASU address, otherwise null (the student picks their LASU account there).
   */
  mailbox: z.string().nullable(),
  /** Domains whose Google mailboxes may be opened (LASU's Google Workspace). Empty unless `ready`. */
  domains: z.array(z.string()),
  /** Set when `ready`. */
  clientId: z.string().nullable(),
  redirectUri: z.string().nullable(),
  /** The Workspace domain Google's chooser is narrowed to. */
  hostedDomain: z.string().nullable(),
});
export type LasuMailConfig = z.infer<typeof LasuMailConfigSchema>;

/** The read-only Gmail scope: read messages and settings; never send, change or delete. */
export const LASU_MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
