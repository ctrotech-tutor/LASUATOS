import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { Pool } from 'pg';

const DEMO_DATABASE_NAME = 'lasuatos_dev';
const DEMO_DATABASE_USER = 'lasuatos_dev';
const DEMO_DATABASE_PASSWORD = 'lasuatos_dev_only';
const DEMO_INSTITUTION_SLUG = 'lasuatos-local-demo';
const DEMO_INSTITUTION_NAME = 'LASUATOS local demo tenant';
const DEMO_FACULTY_CODE = 'DEMO-FAC';
const DEMO_FACULTY_NAME = 'Demo Faculty of Computing';
const DEMO_DEPARTMENT_CODE = 'DEMO-CS';
const DEMO_DEPARTMENT_NAME = 'Demo Department of Computer Science';
const DEMO_SESSION_CODE = 'DEMO-2026-27';
const DEMO_SESSION_STARTS_AT = '2026-09-01T00:00:00.000Z';
const DEMO_SESSION_ENDS_AT = '2027-08-31T22:59:59.999Z';
const DEMO_SEMESTER_NAME = 'Demo First Semester 2026/27';
const DEMO_SEMESTER_STARTS_AT = '2026-09-01T00:00:00.000Z';
const DEMO_SEMESTER_ENDS_AT = '2027-01-31T22:59:59.999Z';
const DEMO_LECTURER_EMAIL = 'lecturer@lasuatos.example.net';
const DEMO_LECTURER_NAME = 'LASUATOS Demo Lecturer';
const DEMO_LECTURER_STAFF_NUMBER = 'DEMO-STAFF-001';
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

function derivePasswordKey(password, salt) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, {
      N: 32_768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function encodePassword(password) {
  // Keep this encoding in sync with packages/auth/src/credentials.ts.
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return ['scrypt', 32_768, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$');
}

async function ensureNamedRow(client, { table, institutionId, code, name, codeColumn = 'code' }) {
  const result = await client.query(
    `SELECT id, name, is_active FROM ${table} WHERE institution_id = $1 AND ${codeColumn} = $2 LIMIT 1`,
    [institutionId, code],
  );
  if (result.rowCount) {
    const row = result.rows[0];
    if (row.name !== name || row.is_active !== true) {
      throw new Error(`A local demo ${table} row already exists with conflicting details.`);
    }
    return row.id;
  }
  return null;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const institutionSlug = process.env.SELF_REGISTRATION_INSTITUTION_SLUG?.trim();
const configuredPasswordValue = process.env.LOCAL_DEMO_LECTURER_PASSWORD;
const configuredPassword = configuredPasswordValue === '' ? undefined : configuredPasswordValue;
if (
  process.env.NODE_ENV === 'production' ||
  process.env.LOCAL_DEMO_MODE !== 'true' ||
  institutionSlug !== DEMO_INSTITUTION_SLUG ||
  !databaseUrl ||
  !localDatabaseUrl(databaseUrl) ||
  (configuredPassword !== undefined && (configuredPassword.length < 12 || configuredPassword.length > 128))
) {
  console.error(
    'Local demo seeding is restricted to the lasuatos_dev database on this machine. Check LOCAL_DEMO_MODE, SELF_REGISTRATION_INSTITUTION_SLUG and the optional local lecturer password.',
  );
  process.exit(1);
}

const generatedLecturerPassword = configuredPassword === undefined;
const lecturerPassword = configuredPassword ?? randomBytes(24).toString('base64url');
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 3_000,
  application_name: 'lasuatos-local-demo-seed',
});

let createdLecturer = false;
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO institutions (slug, name, timezone) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING',
      [DEMO_INSTITUTION_SLUG, DEMO_INSTITUTION_NAME, DEMO_TIMEZONE],
    );
    const institutionResult = await client.query(
      'SELECT id, name, timezone FROM institutions WHERE slug = $1 FOR UPDATE',
      [DEMO_INSTITUTION_SLUG],
    );
    const institution = institutionResult.rows[0];
    if (!institution || institution.name !== DEMO_INSTITUTION_NAME || institution.timezone !== DEMO_TIMEZONE) {
      throw new Error('The local demo slug is already used by a different institution row.');
    }
    let facultyId = await ensureNamedRow(client, {
      table: 'faculties',
      institutionId: institution.id,
      code: DEMO_FACULTY_CODE,
      name: DEMO_FACULTY_NAME,
    });
    if (!facultyId) {
      await client.query(
        'INSERT INTO faculties (institution_id, code, name, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING',
        [institution.id, DEMO_FACULTY_CODE, DEMO_FACULTY_NAME],
      );
      facultyId = await ensureNamedRow(client, {
        table: 'faculties',
        institutionId: institution.id,
        code: DEMO_FACULTY_CODE,
        name: DEMO_FACULTY_NAME,
      });
    }
    if (!facultyId) throw new Error('The local demo faculty could not be prepared.');

    let departmentId = null;
    const existingDepartment = await client.query(
      'SELECT id, name, is_active FROM departments WHERE faculty_id = $1 AND code = $2 LIMIT 1',
      [facultyId, DEMO_DEPARTMENT_CODE],
    );
    if (existingDepartment.rowCount) {
      const row = existingDepartment.rows[0];
      if (row.name !== DEMO_DEPARTMENT_NAME || row.is_active !== true) {
        throw new Error('A local demo department already exists with conflicting details.');
      }
      departmentId = row.id;
    } else {
      await client.query(
        'INSERT INTO departments (institution_id, faculty_id, code, name, is_active) VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING',
        [institution.id, facultyId, DEMO_DEPARTMENT_CODE, DEMO_DEPARTMENT_NAME],
      );
      const departmentResult = await client.query(
        'SELECT id, name, is_active FROM departments WHERE faculty_id = $1 AND code = $2 LIMIT 1',
        [facultyId, DEMO_DEPARTMENT_CODE],
      );
      const row = departmentResult.rows[0];
      if (!row || row.name !== DEMO_DEPARTMENT_NAME || row.is_active !== true) {
        throw new Error('The local demo department could not be prepared.');
      }
      departmentId = row.id;
    }

    let sessionResult = await client.query(
      'SELECT id, starts_at, ends_at FROM academic_sessions WHERE institution_id = $1 AND code = $2 LIMIT 1',
      [institution.id, DEMO_SESSION_CODE],
    );
    if (!sessionResult.rowCount) {
      await client.query(
        `INSERT INTO academic_sessions (institution_id, code, starts_at, ends_at, is_current)
         VALUES ($1, $2, $3, $4, false) ON CONFLICT DO NOTHING`,
        [institution.id, DEMO_SESSION_CODE, DEMO_SESSION_STARTS_AT, DEMO_SESSION_ENDS_AT],
      );
      sessionResult = await client.query(
        'SELECT id, starts_at, ends_at FROM academic_sessions WHERE institution_id = $1 AND code = $2 LIMIT 1',
        [institution.id, DEMO_SESSION_CODE],
      );
    }
    const session = sessionResult.rows[0];
    if (!session || new Date(session.starts_at).toISOString() !== DEMO_SESSION_STARTS_AT ||
      new Date(session.ends_at).toISOString() !== DEMO_SESSION_ENDS_AT) {
      throw new Error('A local demo academic session already exists with conflicting dates.');
    }

    let semesterResult = await client.query(
      'SELECT id, starts_at, ends_at FROM semesters WHERE academic_session_id = $1 AND name = $2 LIMIT 1',
      [session.id, DEMO_SEMESTER_NAME],
    );
    if (!semesterResult.rowCount) {
      await client.query(
        `INSERT INTO semesters (institution_id, academic_session_id, name, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [institution.id, session.id, DEMO_SEMESTER_NAME, DEMO_SEMESTER_STARTS_AT, DEMO_SEMESTER_ENDS_AT],
      );
      semesterResult = await client.query(
        'SELECT id, starts_at, ends_at FROM semesters WHERE academic_session_id = $1 AND name = $2 LIMIT 1',
        [session.id, DEMO_SEMESTER_NAME],
      );
    }
    const semester = semesterResult.rows[0];
    if (!semester || new Date(semester.starts_at).toISOString() !== DEMO_SEMESTER_STARTS_AT ||
      new Date(semester.ends_at).toISOString() !== DEMO_SEMESTER_ENDS_AT) {
      throw new Error('A local demo semester already exists with conflicting dates.');
    }

    let userResult = await client.query(
      'SELECT id, display_name, password_hash, status, email_verified_at FROM users WHERE institution_id = $1 AND lower(email) = lower($2) LIMIT 1 FOR UPDATE',
      [institution.id, DEMO_LECTURER_EMAIL],
    );
    if (!userResult.rowCount) {
      const passwordHash = await encodePassword(lecturerPassword);
      userResult = await client.query(
        `INSERT INTO users (institution_id, email, display_name, password_hash, status, email_verified_at)
         VALUES ($1, $2, $3, $4, 'active', now())
         ON CONFLICT DO NOTHING
         RETURNING id, display_name, password_hash, status, email_verified_at`,
        [institution.id, DEMO_LECTURER_EMAIL, DEMO_LECTURER_NAME, passwordHash],
      );
      if (!userResult.rowCount) {
        userResult = await client.query(
          'SELECT id, display_name, password_hash, status, email_verified_at FROM users WHERE institution_id = $1 AND lower(email) = lower($2) LIMIT 1 FOR UPDATE',
          [institution.id, DEMO_LECTURER_EMAIL],
        );
      } else {
        createdLecturer = true;
      }
    }
    const lecturer = userResult.rows[0];
    if (!lecturer || lecturer.display_name !== DEMO_LECTURER_NAME || !lecturer.password_hash ||
      lecturer.status !== 'active' || !lecturer.email_verified_at) {
      throw new Error('The local demo lecturer email is already used by a different account.');
    }

    const profileResult = await client.query(
      'SELECT institution_id, department_id, staff_number FROM lecturer_profiles WHERE user_id = $1 LIMIT 1',
      [lecturer.id],
    );
    if (!profileResult.rowCount) {
      if (!createdLecturer) throw new Error('The local demo lecturer email is already used by a different account.');
      await client.query(
        `INSERT INTO lecturer_profiles (user_id, institution_id, department_id, staff_number)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [lecturer.id, institution.id, departmentId, DEMO_LECTURER_STAFF_NUMBER],
      );
    }
    const profile = await client.query(
      'SELECT institution_id, department_id, staff_number FROM lecturer_profiles WHERE user_id = $1 LIMIT 1',
      [lecturer.id],
    );
    if (!profile.rowCount || profile.rows[0].institution_id !== institution.id ||
      profile.rows[0].department_id !== departmentId || profile.rows[0].staff_number !== DEMO_LECTURER_STAFF_NUMBER) {
      throw new Error('The local demo lecturer profile already exists with conflicting scope.');
    }

    const studentProfile = await client.query(
      'SELECT user_id FROM student_profiles WHERE user_id = $1 LIMIT 1',
      [lecturer.id],
    );
    if (studentProfile.rowCount) throw new Error('The local demo lecturer email is already used by a different account.');

    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id)
       VALUES ($1, 'lecturer', 'department', $2, $3) ON CONFLICT DO NOTHING`,
      [lecturer.id, institution.id, departmentId],
    );
    const roleResult = await client.query(
      `SELECT role, scope_type, institution_id, faculty_id, department_id
       FROM user_role_assignments WHERE user_id = $1`,
      [lecturer.id],
    );
    if (roleResult.rowCount !== 1 || roleResult.rows[0].role !== 'lecturer' ||
      roleResult.rows[0].scope_type !== 'department' || roleResult.rows[0].institution_id !== institution.id ||
      roleResult.rows[0].faculty_id !== null || roleResult.rows[0].department_id !== departmentId) {
      throw new Error('The local demo lecturer scope could not be prepared.');
    }

    await client.query('COMMIT');
    console.log('Prepared the clearly labelled local demo tenant, sample academic calendar, faculty and department.');
    console.log(`Demo lecturer: ${DEMO_LECTURER_EMAIL}`);
    if (createdLecturer) {
      if (generatedLecturerPassword) {
        console.log(`One-time demo lecturer password: ${lecturerPassword}`);
        console.log('Save this password now; it is not stored in plaintext or printed again on later setup runs.');
      } else {
        console.log('The demo lecturer was provisioned with LOCAL_DEMO_LECTURER_PASSWORD; its value was not printed.');
      }
    } else {
      console.log('The demo lecturer already exists; its password was not changed or printed.');
    }
    console.log(`Demo department: ${DEMO_DEPARTMENT_NAME}; available semester: ${DEMO_SEMESTER_NAME}.`);
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    throw new Error('The local demo tenant could not be prepared. Check the migrations and local database.');
  } finally {
    client.release();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local demo setup failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
