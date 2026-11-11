// Provisions synthetic, clearly labelled load-test students enrolled in one
// course offering of the LOCAL DEMO tenant, so scripts/load/check-in-burst.mjs
// can simulate a class checking in together. It refuses any database other
// than the loopback local-demo database and never touches real institutions.
//
//   LOAD_COURSE_OFFERING_ID=<uuid> LOAD_STUDENTS=300 LOAD_STUDENT_PASSWORD='...' \
//     pnpm --filter @lasuatos/database exec dotenv -e ../../.env -- node scripts/seed-load-fixture.mjs
//
// Students are named load-student-0001@load-test.invalid … and share one
// password (hashed once). The .invalid domain can never receive mail.

import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { Pool } from 'pg';

const DEMO_DATABASE_NAME = 'lasuatos_dev';
const DEMO_INSTITUTION_SLUG = 'lasuatos-local-demo';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(`seed-load-fixture: ${message}`);
  process.exit(1);
}

function assertLocalDemoDatabase(value) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    fail('DATABASE_URL is missing or invalid.');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) || name !== DEMO_DATABASE_NAME) {
    fail(`refusing to run: DATABASE_URL must point at the loopback "${DEMO_DATABASE_NAME}" local demo database.`);
  }
  if (process.env.LOCAL_DEMO_MODE !== 'true' || process.env.NODE_ENV === 'production') {
    fail('refusing to run: set LOCAL_DEMO_MODE=true and do not use NODE_ENV=production.');
  }
}

function encodePassword(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(['scrypt', 32_768, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$'));
    });
  });
}

assertLocalDemoDatabase(process.env.DATABASE_URL);
const offeringId = process.env.LOAD_COURSE_OFFERING_ID?.trim() ?? '';
const count = Number(process.env.LOAD_STUDENTS ?? '300');
const password = process.env.LOAD_STUDENT_PASSWORD ?? '';
if (!UUID.test(offeringId)) fail('set LOAD_COURSE_OFFERING_ID to a course offering id from the local demo tenant.');
if (!Number.isInteger(count) || count < 1 || count > 5_000) fail('LOAD_STUDENTS must be an integer from 1 to 5000.');
if (password.length < 12 || password.length > 128) fail('LOAD_STUDENT_PASSWORD must be 12–128 characters.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const offering = await client.query(
      `SELECT o.institution_id FROM course_offerings o JOIN institutions i ON i.id = o.institution_id
       WHERE o.id = $1 AND i.slug = $2`,
      [offeringId, DEMO_INSTITUTION_SLUG],
    );
    if (offering.rowCount !== 1) fail('that course offering does not belong to the local demo tenant.');
    const institutionId = offering.rows[0].institution_id;
    const passwordHash = await encodePassword(password);

    let created = 0;
    for (let index = 1; index <= count; index += 1) {
      const label = String(index).padStart(4, '0');
      const email = `load-student-${label}@load-test.invalid`;
      const user = await client.query(
        `INSERT INTO users (institution_id, email, display_name, password_hash, status, email_verified_at)
         VALUES ($1, $2, $3, $4, 'active', now())
         ON CONFLICT DO NOTHING RETURNING id`,
        [institutionId, email, `Load Test Student ${label}`, passwordHash],
      );
      const userId = user.rows[0]?.id
        ?? (await client.query('SELECT id FROM users WHERE institution_id = $1 AND email = $2', [institutionId, email])).rows[0]?.id;
      if (!userId) fail(`could not create or find ${email}.`);
      if (user.rowCount) created += 1;
      await client.query(
        `INSERT INTO student_profiles (user_id, institution_id, student_number) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, institutionId, `LOAD-${label}`],
      );
      await client.query(
        `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id)
         SELECT $1, 'student', 'institution', $2
         WHERE NOT EXISTS (SELECT 1 FROM user_role_assignments WHERE user_id = $1 AND role = 'student')`,
        [userId, institutionId],
      );
      await client.query(
        `INSERT INTO course_enrollments (institution_id, course_offering_id, student_user_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [institutionId, offeringId, userId],
      );
    }
    await client.query('COMMIT');
    console.log(`Load fixture ready: ${count} synthetic students (${created} new) enrolled in ${offeringId}.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
