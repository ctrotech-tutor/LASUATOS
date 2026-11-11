import { createDatabase } from '@lasuatos/database';
import { StudentAuthService } from './auth/service.js';
import { PostgresAuthRepository } from './auth/postgres-repository.js';
import { AdministratorOverviewService } from './admin/service.js';
import { PostgresAdministratorOverviewRepository } from './admin/postgres-repository.js';
import { PostgresCourseEnrollmentRepository } from './enrollment/postgres-repository.js';
import { CourseEnrollmentService } from './enrollment/service.js';
import { PostgresAttendanceRepository } from './attendance/postgres-repository.js';
import { AttendanceService } from './attendance/service.js';
import { createEmailTransport } from './email/transport.js';
import { loadEnvironment } from './env.js';
import { buildServer, type ServerOptions } from './server.js';

const environment = loadEnvironment();
const database = environment.DATABASE_URL
  ? createDatabase(environment.DATABASE_URL)
  : undefined;
const emailTransport = database ? createEmailTransport(environment) : undefined;
const authService = database
  ? new StudentAuthService({
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

const serverOptions: ServerOptions = {
  logger: {
    level: environment.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.email',
        'req.body.displayName',
        'req.body.matricNumber',
        'req.body.password',
        'req.body.token',
        'req.body.code',
        'req.body.location',
      ],
      censor: '[REDACTED]',
    },
  },
  secureCookies: environment.NODE_ENV === 'production',
  ...(database ? { checkDatabase: database.checkConnection } : {}),
  ...(authService ? { auth: authService } : {}),
  ...(courseEnrollmentService ? { courseEnrollment: courseEnrollmentService } : {}),
  ...(administratorOverviewService ? { administratorOverview: administratorOverviewService } : {}),
  ...(attendanceService ? { attendance: attendanceService } : {}),
};

const server = buildServer(serverOptions);
let closing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  server.log.info({ signal }, 'Shutting down API');

  try {
    await server.close();
    await database?.close();
  } catch (error) {
    server.log.error({ err: error }, 'API shutdown did not complete cleanly');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await server.listen({ host: environment.API_HOST, port: environment.API_PORT });
} catch (error) {
  server.log.error({ err: error }, 'API failed to start');
  await database?.close();
  process.exitCode = 1;
}
