import { Pool } from 'pg';

const DEMO_DATABASE_NAME = 'lasuatos_dev';
const DEMO_DATABASE_USER = 'lasuatos_dev';
const DEMO_DATABASE_PASSWORD = 'lasuatos_dev_only';
const DEMO_INSTITUTION_SLUG = 'lasuatos-local-demo';
const DEMO_INSTITUTION_NAME = 'LASUATOS local demo tenant';
const DEMO_TIMEZONE = 'Africa/Lagos';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

function localDatabaseUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const port = url.port || '5432';
    const expectedPort = process.env.POSTGRES_PORT?.trim() || '5433';
    const databaseUser = decodeURIComponent(url.username);
    const databasePassword = decodeURIComponent(url.password);
    const expectedDatabase = process.env.POSTGRES_DB?.trim() || DEMO_DATABASE_NAME;
    const expectedUser = process.env.POSTGRES_USER?.trim() || DEMO_DATABASE_USER;
    const expectedPassword = process.env.POSTGRES_PASSWORD || DEMO_DATABASE_PASSWORD;

    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      LOOPBACK_HOSTS.includes(host) &&
      !url.search &&
      !url.hash &&
      databaseName === DEMO_DATABASE_NAME &&
      expectedDatabase === DEMO_DATABASE_NAME &&
      port === expectedPort &&
      databaseUser === expectedUser &&
      databasePassword === expectedPassword
    );
  } catch {
    return false;
  }
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const institutionSlug = process.env.SELF_REGISTRATION_INSTITUTION_SLUG?.trim();
if (
  process.env.NODE_ENV === 'production' ||
  process.env.LOCAL_DEMO_MODE !== 'true' ||
  institutionSlug !== DEMO_INSTITUTION_SLUG ||
  !databaseUrl ||
  !localDatabaseUrl(databaseUrl)
) {
  console.error(
    'Local demo seeding is restricted to the lasuatos_dev database on this machine. Check LOCAL_DEMO_MODE and SELF_REGISTRATION_INSTITUTION_SLUG.',
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 3_000,
  application_name: 'lasuatos-local-demo-seed',
});

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT name FROM institutions WHERE slug = $1 FOR UPDATE',
      [DEMO_INSTITUTION_SLUG],
    );
    if (existing.rowCount) {
      if (existing.rows[0]?.name !== DEMO_INSTITUTION_NAME) {
        throw new Error('The local demo slug is already used by a different institution row.');
      }
      await client.query('COMMIT');
      console.log('The local demo tenant is already present.');
    } else {
      await client.query(
        'INSERT INTO institutions (slug, name, timezone) VALUES ($1, $2, $3)',
        [DEMO_INSTITUTION_SLUG, DEMO_INSTITUTION_NAME, DEMO_TIMEZONE],
      );
      await client.query('COMMIT');
      console.log('Created the LASUATOS local demo tenant. This is not an official LASU record.');
    }
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    throw new Error('The local demo tenant could not be prepared. Check migrations and the local database.');
  } finally {
    client.release();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local demo setup failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
