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
import { PostgresStaffRepository } from './staff/postgres-repository.js';
import { StaffService } from './staff/service.js';
import { PostgresStructureRepository } from './admin/structure-postgres-repository.js';
import { StructureService } from './admin/structure-service.js';
import { PostgresLectureRepository } from './lecture/postgres-repository.js';
import { LectureService } from './lecture/service.js';
import { createEmailTransport, disputeNotifierFor } from './email/transport.js';
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
  close(): Promise<void>;
}

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

  const lectureService = database
    ? new LectureService({ repository: new PostgresLectureRepository(database.db) })
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
    ...(database ? { checkDatabase: database.checkConnection, checkSchema: database.schemaStatus } : {}),
    ...(authService ? { auth: authService } : {}),
    ...(courseEnrollmentService ? { courseEnrollment: courseEnrollmentService } : {}),
    ...(administratorOverviewService ? { administratorOverview: administratorOverviewService } : {}),
    ...(attendanceService ? { attendance: attendanceService } : {}),
    ...(attendanceDisputeService ? { attendanceDisputes: attendanceDisputeService } : {}),
    ...(venueService ? { venue: venueService } : {}),
    ...(staffService ? { staff: staffService } : {}),
    ...(structureService ? { structure: structureService } : {}),
    ...(lectureService ? { lecture: lectureService } : {}),
  };

  const server = buildServer(serverOptions);
  for (const warning of environmentWarnings(environment)) server.log.warn(warning);
  securityLog = (details, message) => server.log.warn(details, message);
  reportRateLimitStoreError = (error) => {
    server.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Rate-limit store failed; request allowed without counting',
    );
  };

  return {
    server,
    async close() {
      await server.close();
      await database?.close();
    },
  };
}
