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
import { createGoogleIdTokenVerifier } from './auth/google-id-token.js';
import { FaceVerifier, loadFaceEngine } from './students/face.js';
import { PostgresContactRepository } from './contact/postgres-repository.js';
import { ContactService } from './contact/service.js';
import { SignInCleanup } from './auth/cleanup.js';
import {
  contactNotifierFor,
  createEmailTransport,
  disputeNotifierFor,
  emailChainFor,
  operatorAlertSenderFor,
  PostgresEmailUsageStore,
  studentEmailCodeSenderFor,
  type EmailChainEvent,
} from './email/transport.js';
import { emailAlertFor } from './monitoring/email-alerts.js';
import { OperatorAlerts } from './monitoring/alerts.js';
import { HealthService, PostgresHealthRepository } from './monitoring/health.js';
import { googleSignal, SignalMonitor } from './monitoring/signals.js';
import { environmentWarnings, parseTrustProxy, splitList, type Environment } from './env.js';
import { buildServer, type ServerOptions } from './server.js';
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS, LOG_SERIALIZERS } from './security/headers.js';
import { PostgresGovernanceRepository } from './governance/postgres-repository.js';
import { GovernanceService } from './governance/service.js';
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
  /** Face checks, when FACE_CHECK is required (the load test reads their queue figures). */
  readonly faces: FaceVerifier | undefined;
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
  // Email events (a provider switched, all failing, a quota running out) become operator
  // alerts; the alerts object is created below, after the transport it sends through.
  let reportEmailEvent: (event: EmailChainEvent) => Promise<void> = async () => undefined;
  let reportEmailStoreError: (error: unknown) => void = () => undefined;
  const emailTransport = database
    ? createEmailTransport(environment, globalThis.fetch, {
        usage: new PostgresEmailUsageStore(database.db),
        onEvent: (event) => reportEmailEvent(event),
        onStoreError: (error) => reportEmailStoreError(error),
      })
    : undefined;
  const emailChain = emailChainFor(emailTransport);
  let countGoogleRefusal: (reason: string) => Promise<void> = async () => undefined;
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
        // Offerings use the course list sessions use (set up below; only called per request).
        courseList: async (account, code) => (lectureService ? lectureService.listedCourse(account, code) : null),
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

  const faces = database && environment.FACE_CHECK === 'required'
    ? new FaceVerifier({ engine: loadFaceEngine, queueBudgetMilliseconds: environment.FACE_QUEUE_BUDGET_MS })
    : undefined;
  const studentService = database
    ? new StudentService({
        repository: new PostgresStudentRepository(database.db),
        institutionSlug: environment.SELF_REGISTRATION_INSTITUTION_SLUG,
        emailSender: studentEmailCodeSenderFor(emailTransport),
        faces,
        logger: { warn: (details, message) => securityLog(details, message) },
        onGoogleRefused: (reason) => countGoogleRefusal(reason),
        ...(authService ? { credentials: { verifyStudent: (identifier: string, password: string) => authService.verifyStudentCredentials(identifier, password) } } : {}),
        ...(environment.GOOGLE_CLIENT_ID ? {
          google: {
            clientId: environment.GOOGLE_CLIENT_ID,
            redirectUri: new URL('/auth/google', environment.PUBLIC_APP_URL).toString(),
            verifier: createGoogleIdTokenVerifier({ clientId: environment.GOOGLE_CLIENT_ID }),
          },
        } : {}),
      })
    : undefined;

  const governanceService = database
    ? new GovernanceService({
        repository: new PostgresGovernanceRepository(database.db),
        policy: {
          graceMonths: environment.RETENTION_GRACE_MONTHS,
          activeWithinDays: environment.RETENTION_ACTIVE_DAYS,
          checkPhotoDays: environment.RETENTION_CHECK_PHOTO_DAYS,
        },
        scheduled: Boolean(environment.CRON_SECRET),
      })
    : undefined;

  const contactService = database
    ? new ContactService({
        repository: new PostgresContactRepository(database.db),
        notifier: contactNotifierFor(emailTransport),
        fallbackRecipients: environment.ALERT_EMAIL,
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
  const healthRepository = database ? new PostgresHealthRepository(database.db) : undefined;
  const alerts = new OperatorAlerts({
    recipients: environment.ALERT_EMAIL,
    sender: operatorAlertSenderFor(emailTransport),
    limiter: rateLimiter,
    log: { error: (details, message) => alertLog.error(details, message), warn: (details, message) => alertLog.warn(details, message) },
    history: healthRepository,
  });
  reportEmailEvent = async (event) => {
    await alerts.report(emailAlertFor(event, new Date()));
  };

  const signals = rateLimitStore ? new SignalMonitor({ store: rateLimitStore, alerts }) : undefined;
  countGoogleRefusal = async (reason) => {
    if (signals) await signals.count(googleSignal(reason), { reason });
  };

  const healthService = healthRepository
    ? new HealthService({
        repository: healthRepository,
        email: emailChain,
        signals,
        ...(database ? { checkDatabase: database.checkConnection, checkSchema: database.schemaStatus, poolStats: database.poolStats } : {}),
        alertRecipients: environment.ALERT_EMAIL.length,
        cronConfigured: Boolean(environment.CRON_SECRET),
        googleConfigured: Boolean(environment.GOOGLE_CLIENT_ID),
        rateLimitStore: environment.RATE_LIMIT_STORE,
        release: {
          commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
          region: process.env.VERCEL_REGION ?? null,
        },
      })
    : undefined;

  const serverOptions: ServerOptions = {
    logger: options.logger ?? {
      level: environment.LOG_LEVEL,
      redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR },
      serializers: LOG_SERIALIZERS,
    },
    secureCookies: environment.NODE_ENV === 'production',
    hsts: environment.NODE_ENV === 'production',
    // Embedded (serverless) mode receives the client address from the platform, not from X-Forwarded-For.
    trustProxy: options.serverless ? false : parseTrustProxy(environment.TRUST_PROXY),
    trustedOrigins: [environment.PUBLIC_APP_URL, ...splitList(environment.TRUSTED_ORIGINS)],
    ...(rateLimiter ? { rateLimiter } : {}),
    alerts,
    ...(signals ? { signals } : {}),
    ...(healthService ? { health: healthService } : {}),
    lasuMail: {
      mode: environment.LASU_MAIL,
      pilot: splitList(environment.LASU_MAIL_PILOT),
      domains: splitList(environment.LASU_MAIL_DOMAINS),
      google: environment.GOOGLE_CLIENT_ID
        ? { clientId: environment.GOOGLE_CLIENT_ID, redirectUri: new URL('/auth/google', environment.PUBLIC_APP_URL).toString() }
        : undefined,
    },
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
    ...(governanceService ? { governance: governanceService } : {}),
    ...(contactService ? { contact: contactService } : {}),
    ...(database ? { signInCleanup: new SignInCleanup(database.db) } : {}),
    cronSecret: environment.CRON_SECRET,
    openStudentSignUp: environment.STUDENT_SIGN_UP === 'open',
  };

  const server = buildServer(serverOptions);
  for (const warning of environmentWarnings(environment)) server.log.warn(warning);
  securityLog = (details, message) => server.log.warn(details, message);
  alertLog = { error: (details, message) => server.log.error(details, message), warn: (details, message) => server.log.warn(details, message) };
  reportEmailStoreError = (error) => {
    server.log.warn({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Email usage counts could not be read or saved; sending anyway');
  };
  reportRateLimitStoreError = (error) => {
    server.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Rate-limit store failed; request allowed without counting',
    );
  };

  return {
    server,
    alerts,
    faces,
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
      await faces?.close();
      await database?.close();
    },
  };
}
