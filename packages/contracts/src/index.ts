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
  title: z.string().trim().min(1).max(160),
  durationMinutes: z.number().int().min(5).max(240),
}).strict();
export type CreateAttendanceSessionRequest = z.infer<typeof CreateAttendanceSessionRequestSchema>;

export const AttendanceSessionsQuerySchema = z.object({
  courseOfferingId: z.uuid().optional(),
}).strict();
export type AttendanceSessionsQuery = z.infer<typeof AttendanceSessionsQuerySchema>;

export const CheckInAttendanceRequestSchema = z.object({
  code: z.string().trim()
    .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().regex(attendanceCodePattern)),
}).strict();
export type CheckInAttendanceRequest = z.infer<typeof CheckInAttendanceRequestSchema>;

export const AttendanceSessionStatusSchema = z.enum(['open', 'closed', 'expired']);
export type AttendanceSessionStatus = z.infer<typeof AttendanceSessionStatusSchema>;

export const AttendanceSessionSummarySchema = z.object({
  id: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string().min(1).max(32),
  courseTitle: z.string().min(1).max(200),
  title: z.string().min(1).max(160),
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
    displayName: z.string().min(1).max(160),
    checkedInAt: z.iso.datetime(),
  })).max(5000),
});
export type AttendanceSessionDetail = z.infer<typeof AttendanceSessionDetailSchema>;

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
