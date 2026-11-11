import { spawnSync } from 'node:child_process';

const DEMO_DATABASE_NAME = 'lasuatos_dev';
const DEMO_DATABASE_USER = 'lasuatos_dev';
const DEMO_DATABASE_PASSWORD = 'lasuatos_dev_only';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const LOOPBACK_MAILPIT_HOSTS = ['localhost', '127.0.0.1', '::1'];

function matchesLocalDemoConfiguration() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return false;

  try {
    const url = new URL(databaseUrl);
    const host = url.hostname.toLowerCase();
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const port = url.port || '5432';
    const expectedPort = process.env.POSTGRES_PORT?.trim() || '5433';
    const databaseUser = decodeURIComponent(url.username);
    const databasePassword = decodeURIComponent(url.password);
    const expectedDatabase = process.env.POSTGRES_DB?.trim() || DEMO_DATABASE_NAME;
    const expectedUser = process.env.POSTGRES_USER?.trim() || DEMO_DATABASE_USER;
    const expectedPassword = process.env.POSTGRES_PASSWORD || DEMO_DATABASE_PASSWORD;
    const mailpitHost = process.env.MAILPIT_HOST?.trim().toLowerCase() || '127.0.0.1';
    const expectedMailpitPort = process.env.MAILPIT_SMTP_PORT?.trim() || '1025';

    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      LOOPBACK_HOSTS.includes(host) &&
      !url.search &&
      !url.hash &&
      databaseName === DEMO_DATABASE_NAME &&
      expectedDatabase === DEMO_DATABASE_NAME &&
      port === expectedPort &&
      databaseUser === expectedUser &&
      databasePassword === expectedPassword &&
      process.env.LOCAL_DEMO_MODE === 'true' &&
      process.env.SELF_REGISTRATION_INSTITUTION_SLUG === 'lasuatos-local-demo' &&
      process.env.EMAIL_PROVIDER === 'mailpit' &&
      LOOPBACK_MAILPIT_HOSTS.includes(mailpitHost) &&
      (process.env.MAILPIT_PORT?.trim() || '1025') === expectedMailpitPort &&
      process.env.NODE_ENV !== 'production'
    );
  } catch {
    return false;
  }
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`${label} could not start. Check that the required command is installed.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!matchesLocalDemoConfiguration()) {
  console.error(
    'Local setup stopped before starting Docker. Use the guarded lasuatos_dev settings from .env.example. This command will not migrate a remote database.',
  );
  process.exit(1);
}

run('docker', ['compose', 'up', '-d', '--wait'], 'Docker Compose');
run('pnpm', ['db:migrate'], 'Database migrations');
run('pnpm', ['db:seed:local'], 'Local demo tenant setup');
console.log('Local services are ready. Open Mailpit at http://localhost:8025, then start the web and API apps with pnpm dev.');
