import { createDatabase } from '@lasuatos/database';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { createEmailTransport } from '../email/transport.js';
import { loadEnvironment } from '../env.js';
import { BOOTSTRAP_USAGE, parseBootstrapArguments, runBootstrap } from './bootstrap.js';
import { PostgresStaffRepository } from './postgres-repository.js';
import { StaffError, StaffService } from './service.js';

const environment = loadEnvironment();
let request;
try {
  request = parseBootstrapArguments(process.argv.slice(2), environment.SELF_REGISTRATION_INSTITUTION_SLUG);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(BOOTSTRAP_USAGE);
  process.exit(2);
}
if (!environment.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run this on the server (or locally with a .env file).');
  process.exit(2);
}

const database = createDatabase(environment.DATABASE_URL, {
  maxConnections: 2,
  connectionTimeoutMillis: environment.DATABASE_CONNECT_TIMEOUT_MS,
});
const emailTransport = createEmailTransport(environment);
const repository = new PostgresStaffRepository(database.db);
const staff = new StaffService({
  repository,
  authRepository: new PostgresAuthRepository(database.db),
  ...(emailTransport ? { emailTransport } : {}),
  logger: { warn: (_details, message) => console.warn(`Warning: ${message}`) },
});

try {
  const outcome = await runBootstrap(request, { staff, repository, publicAppUrl: environment.PUBLIC_APP_URL });
  console.log(`Invitation created for ${outcome.email}: ${outcome.roleLabel}, ${outcome.scopeLabel}.`);
  console.log(`It expires ${outcome.expiresAt} and works once.`);
  console.log(outcome.emailSent ? 'The invitation email was sent.' : 'No email was sent (email is not configured or delivery failed).');
  if (outcome.link) {
    console.log('\nInvitation link (treat it like a password; give it only to this person):');
    console.log(outcome.link);
  }
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof StaffError ? error.message : error);
  // Exit code 3 means "already done" (account or pending invitation exists), so setup scripts can re-run safely.
  process.exitCode = error instanceof StaffError && error.statusCode === 409 ? 3 : 1;
} finally {
  await database.close();
}
