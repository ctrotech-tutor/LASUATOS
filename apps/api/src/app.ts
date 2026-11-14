import { createDatabase } from '@lasuatos/database';
import { StudentAuthService, type SecurityEventLogger } from './auth/service.js';
import { PostgresAuthRepository } from './auth/postgres-repository.js';
import { AdministratorOverviewService } from './admin/service.js';
import { PostgresAdministratorOverviewRepository } from './admin/postgres-repository.js';
import { PostgresCourseEnrollmentRepository } from './enrollment/postgres-repository.js';
import { CourseEnrollmentService } from './enrollment/service.js';
import { PostgresAttendanceRepository } from './attendance/postgres-repository.js';
import { AttendanceService } from './attendance/service.js';
import { PostgresAttendanceDisputeRepository } from './attendance/dispute-postgres-repository.js';
import { AttendanceDisputeService } from './attendance/dispute-service.js';
import { PostgresVenueRepository } from './venue/postgres-repository.js';
import { VenueService } from './venue/service.js';
import { createOverpassBuildingLookup } from './venue/building-outlines.js';
import { PostgresStaffRepository } from './staff/postgres-repository.js';
import { StaffService } from './staff/service.js';
import { PostgresStructureRepository } from './admin/structure-postgres-repository.js';
import { StructureService } from './admin/structure-service.js';
import { PostgresLectureRepository } from './lecture/postgres-repository.js';
import { LectureService } from './lecture/service.js';
import { PostgresStudentRepository } from './students/postgres-repository.js';
import { StudentService } from './students/service.js';
import { FaceVerifier, loadFaceEngine } from './students/face.js';
import { createEmailTransport, disputeNotifierFor, operatorAlertSenderFor, studentEmailCodeSenderFor } from './email/transport.js';
import { OperatorAlerts } from './monitoring/alerts.js';
import { environmentWarnings, parseTrustProxy, splitList, type Environment } from './env.js';
import { buildServer, type ServerOptions } from './server.js';
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from './security/headers.js';
import { MemoryRateLimitStore, PostgresRateLimitStore, RateLimiter } from './security/rate-limit.js';


export interface ApiApplicationOptions {
  /**
   * True when the API runs inside a serverless function (the web app's
   * /api/v1 route on Vercel): a smaller connection pool, shorter idle timeout,
   * and the client address supplied by the platform instead of X-Forwarded-For.
   */
  readonly serverless?: boolean;
  readonly logger?: ServerOptions['logger'];
}

export interface ApiApplication {
  readonly server: ReturnType<typeof buildServer>;
  readonly alerts: OperatorAlerts;
  /** Emails the operator when the database is missing updates this code needs. */
  checkSchemaAndAlert(): Promise<void>;
  close(): Promise<void>;
}

type AlertLogTarget = { error(details: Record<string, unknown>, message: string): void; warn(details: Record<string, unknown>, message: string): void };

/** Wires repositories, services, rate limiting and routes from validated configuration. */
export function createApiApplication(environment: Environment, options: ApiApplicationOptions = {}): ApiApplication {
  const database = environment.DATABASE_URL
    ? createDatabase(environment.DATABASE_URL, {
        maxConnections: environment.DATABASE_POOL_MAX ?? (options.serverless ? 3 : 10),
        idleTimeoutMillis: options.serverless ? 10_000 : 30_000,
        connectionTimeoutMillis: environment.DATABASE_CONNECT_TIMEOUT_MS,
      })
    : undefined;
  const emailTransport = database ? createEmailTransport(environment) : undefined;
  const disputeNotifier = disputeNotifierFor(emailTransport);
  let securityLog: SecurityEventLogger['warn'] = () => undefined;
  const authService = database
    ? new StudentAuthService({
        logger: { warn: (details, message) => securityLog(details, message) },
        repository: new PostgresAuthRepository(database.db),
        ...(emailTransport ? { emailTransport } : {}),
        institutionSlug: environment.SELF_REGISTRATION_INSTITUTION_SLUG,
      })
    : undefined;
  const courseEnrollmentService = database
    ? new CourseEnrollmentService({
        repository: new PostgresCourseEnrollmentRepository(database.db),
      })
    : undefined;
  const administratorOverviewService = database
    ? new AdministratorOverviewService({
        repository: new PostgresAdministratorOverviewRepository(database.db),
      })
    : undefined;
  const attendanceService = database
    ? new AttendanceService({
        repository: new PostgresAttendanceRepository(database.db),
      })
    : undefined;
  const attendanceDisputeService = database
    ? new AttendanceDisputeService({
        repository: new PostgresAttendanceDisputeRepository(database.db),
        ...(disputeNotifier ? { notifier: disputeNotifier } : {}),
        logger: { warn: (details, message) => securityLog(details, message) },
      })
    : undefined;
  const venueService = database
    ? new VenueService({
        repository: new PostgresVenueRepository(database.db),
      })
    : undefined;
  const staffService = database
    ? new StaffService({
        repository: new PostgresStaffRepository(database.db),
        authRepository: new PostgresAuthRepository(database.db),
        ...(emailTransport ? { emailTransport } : {}),
        logger: { warn: (details, message) => securityLog(details, message) },
      })
    : undefined;

  const structureService = database
    ? new StructureService({ repository: new PostgresStructureRepository(database.db) })
    : undefined;

  const studentService = database
    ? new StudentService({
        repository: new PostgresStudentRepository(database.db),
        institutionSlug: environment.SELF_REGISTRATION_INSTITUTION_SLUG,
        emailSender: studentEmailCodeSenderFor(emailTransport),
        faces: environment.FACE_CHECK === 'required' ? new FaceVerifier({ engine: loadFaceEngine }) : undefined,
        logger: { warn: (details, message) => securityLog(details, message) },
      })
    : undefined;

  const lectureService = database
    ? new LectureService({
        repository: new PostgresLectureRepository(database.db),
        ...(authService ? { credentials: { verifyStudent: (identifier, password) => authService.verifyStudentCredentials(identifier, password) } } : {}),
        ...(studentService?.faceRequired ? { faces: studentService } : {}),
      })
    : undefined;

  let reportRateLimitStoreError: (error: unknown) => void = () => undefined;
  const rateLimitStore = environment.RATE_LIMIT_STORE === 'off'
    ? undefined
    : environment.RATE_LIMIT_STORE === 'postgres' && database
      ? new PostgresRateLimitStore(database.db)
      : new MemoryRateLimitStore();
  const rateLimiter = rateLimitStore
    ? new RateLimiter({ store: rateLimitStore, onStoreError: (error) => reportRateLimitStoreError(error) })
    : undefined;

  let alertLog: AlertLogTarget = { error: () => undefined, warn: () => undefined };
  const alerts = new OperatorAlerts({
    recipients: environment.ALERT_EMAIL,
    sender: operatorAlertSenderFor(emailTransport),
    limiter: rateLimiter,
    log: { error: (details, message) => alertLog.error(details, message), warn: (details, message) => alertLog.warn(details, message) },
  });

  const serverOptions: ServerOptions = {
    logger: options.logger ?? {
      level: environment.LOG_LEVEL,
      redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR },
    },
    secureCookies: environment.NODE_ENV === 'production',
    hsts: environment.NODE_ENV === 'production',
    // Embedded (serverless) mode receives the client address from the platform, not from X-Forwarded-For.
    trustProxy: options.serverless ? false : parseTrustProxy(environment.TRUST_PROXY),
    trustedOrigins: [environment.PUBLIC_APP_URL, ...splitList(environment.TRUSTED_ORIGINS)],
    ...(rateLimiter ? { rateLimiter } : {}),
    alerts,
    ...(database ? { checkDatabase: database.checkConnection, checkSchema: database.schemaStatus } : {}),
    ...(authService ? { auth: authService } : {}),
    ...(courseEnrollmentService ? { courseEnrollment: courseEnrollmentService } : {}),
    ...(administratorOverviewService ? { administratorOverview: administratorOverviewService } : {}),
    ...(attendanceService ? { attendance: attendanceService } : {}),
    ...(attendanceDisputeService ? { attendanceDisputes: attendanceDisputeService } : {}),
    ...(venueService ? { venue: venueService, buildingOutlines: createOverpassBuildingLookup() } : {}),
    ...(staffService ? { staff: staffService } : {}),
    ...(structureService ? { structure: structureService } : {}),
    ...(lectureService ? { lecture: lectureService } : {}),
    ...(studentService ? { students: studentService } : {}),
    openStudentSignUp: environment.STUDENT_SIGN_UP === 'open',
  };

  const server = buildServer(serverOptions);
  for (const warning of environmentWarnings(environment)) server.log.warn(warning);
  securityLog = (details, message) => server.log.warn(details, message);
  alertLog = { error: (details, message) => server.log.error(details, message), warn: (details, message) => server.log.warn(details, message) };
  reportRateLimitStoreError = (error) => {
    server.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Rate-limit store failed; request allowed without counting',
    );
  };

  return {
    server,
    alerts,
    /**
     * Emails the operator if the database is missing updates this code needs.
     * Called once per cold start in embedded mode; throttled to every 6 hours.
     */
    async checkSchemaAndAlert() {
      if (!database) return;
      const status = await database.schemaStatus().catch(() => 'unknown' as const);
      if (status !== 'behind') return;
      await alerts.report({
        kind: 'schema_behind',
        summary: 'database updates have not been applied',
        details: { fix: 'Redeploy the latest production build (it applies database updates), or run pnpm prod:migrate.' },
        fingerprint: 'schema-behind',
        occurredAt: new Date(),
      });
    },
    async close() {
      await server.close();
      await database?.close();
    },
  };
}
