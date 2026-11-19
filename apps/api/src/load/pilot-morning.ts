/**
 * Pilot morning rehearsal: the first hour of a pilot day, against the real
 * production wiring (createApiApplication with the serverless pool, the
 * PostgreSQL rate-limit store, every request from ONE address like a class on
 * campus Wi-Fi) and a real PostgreSQL database on this computer.
 *
 *   DATABASE_URL=postgres://user@127.0.0.1:5432/db pnpm load:pilot
 *   pnpm load:pilot -- --students 424 --openers 112 --spread 600     (the whole pilot cohort over 10 minutes)
 *   pnpm load:pilot -- --population 50000 --instances 2 --output pilot.json
 *
 * What it does, in order:
 *
 * 1. Seeds a LASU-sized institution: `--population` other students (default
 *    20,000: profiles, class-list entries, a session each, 70% with a
 *    registered face, a semester of other classes' attendance), and the
 *    pilot: 6 courses with 8 weeks of lectures behind them, `--students`
 *    students with accounts and history, and `--openers` students on the class
 *    list who have not opened their account yet, each with a setup code from
 *    their HOC.
 * 2. Prints how PostgreSQL runs the sign-in and face-registration queries on
 *    that data (EXPLAIN ANALYZE), so a missing index shows up as a scan.
 * 3. Morning: everyone arrives at a random moment over `--spread` seconds.
 *    A student with an account signs in as people do: mostly by matric number,
 *    some by email; some still on the starting password, half of those typed
 *    in lower case or with spaces (two password checks on the server); some
 *    mistype first. Then the attendance page loads its 7 reads at once, and
 *    the open page keeps polling (open sessions every 15 s, history every
 *    60 s). A student opening their account checks the list, opens it with
 *    the setup code, and registers their face (three real photos, the web
 *    app's busy retries).
 * 4. "Refresh your page": every signed-in phone reloads at the same moment.
 * 5. Session reads: `--readers` phones read their session back to back for
 *    `--read-seconds`.
 *
 * Prints a JSON report (each step's latency percentiles and outcomes, CPU and
 * memory per instance, how long the request thread was blocked, what the
 * database holds afterwards, and the targets from docs/LOAD_TESTING.md met or
 * not). Exits 1 on any server error, a lost sign-in or a missed target.
 *
 * It refuses a database that is not on this computer. Everything it makes
 * belongs to a new institution (slug load-XXXX); drop the database afterwards.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cpus } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { hashPassword } from '@lasuatos/auth';
import { startingPassword } from '@lasuatos/contracts';
import { sql } from 'drizzle-orm';
import { FaceVerifier, loadFaceEngine } from '../students/face.js';
import {
  clampInt,
  createClient,
  instanceEnvironment,
  instanceStats,
  localDatabaseUrl,
  openLocalDatabase,
  percentile,
  Recorder,
  repositoryRoot,
  sessionCookieFrom,
  share,
  sleep,
  startInstance,
  stopInstances,
  type InstanceFigures,
  packSeededCentroids,
} from './shared.js';

const SERVER_LOGS = process.env.LOAD_SERVER_LOGS === 'yes';
const fixtures = path.join(repositoryRoot, 'packages/face/test/fixtures');
/** How long the web app keeps retrying a busy face registration (registerFace). */
const RETRY_WINDOW_MS = 180_000;
/** The reads the attendance page makes as it opens (components/my-attendance, student-setup-card, current-account). */
const DASHBOARD_READS = [
  '/api/v1/auth/session/status',
  '/api/v1/student/lecture-history',
  '/api/v1/student/attendance',
  '/api/v1/student/attendance/disputes',
  '/api/v1/student/attendance/summary',
  '/api/v1/student/attendance/open',
  '/api/v1/students/me/setup',
] as const;
/** The goals in docs/LOAD_TESTING.md ("Targets"). */
const TARGETS = { signInP95Ms: 3_000, sessionReadP95Ms: 300 } as const;

const { values: options } = parseArgs({
  options: {
    students: { type: 'string', default: '300' },
    openers: { type: 'string', default: '60' },
    population: { type: 'string', default: '20000' },
    spread: { type: 'string', default: '120' },
    instances: { type: 'string', default: '1' },
    pool: { type: 'string', default: '3' },
    face: { type: 'string', default: 'on' },
    readers: { type: 'string', default: '100' },
    'read-seconds': { type: 'string', default: '20' },
    'starting-share': { type: 'string', default: '0.4' },
    'loose-share': { type: 'string', default: '0.5' },
    'email-share': { type: 'string', default: '0.15' },
    'typo-share': { type: 'string', default: '0.1' },
    'rate-limits': { type: 'string', default: 'postgres' },
    output: { type: 'string' },
  },
  allowPositionals: true,
});

async function main(): Promise<void> {
  const databaseUrl = localDatabaseUrl();
  const signerCount = clampInt(options.students, 300, 1, 5_000);
  const openerCount = clampInt(options.openers, 60, 0, 2_000);
  const population = clampInt(options.population, 20_000, 0, 500_000);
  const spreadMs = clampInt(options.spread, 120, 0, 3_600) * 1000;
  const instanceCount = clampInt(options.instances, 1, 1, 16);
  const poolMax = clampInt(options.pool, 3, 1, 50);
  const faceOn = options.face !== 'off' && openerCount > 0;
  const readerCount = clampInt(options.readers, 100, 0, 2_000);
  const readMs = clampInt(options['read-seconds'], 20, 1, 600) * 1000;
  const startingShare = share(options['starting-share'], 0.4);
  const looseShare = share(options['loose-share'], 0.5);
  const emailShare = share(options['email-share'], 0.15);
  const typoShare = share(options['typo-share'], 0.1);
  const rateLimits = ['postgres', 'memory', 'off'].includes(options['rate-limits'] ?? '') ? options['rate-limits']! : 'postgres';
  const run = randomBytes(2).toString('hex');
  const slug = `load-${run}`;

  const { database, db, rows } = await openLocalDatabase(databaseUrl);
  // Every request comes from 127.0.0.1, like a class behind one campus address:
  // start with empty counters so an earlier run does not count against this one.
  await db.execute(sql`DELETE FROM rate_limit_counters`);

  /* ================================================================ */
  /* 1. Seed                                                            */
  /* ================================================================ */
  console.error(`Seeding ${slug}: ${population.toLocaleString()} other students, ${signerCount} pilot students, ${openerCount} opening today…`);
  const seedStarted = performance.now();
  const institution = randomUUID();
  const faculty = randomUUID();
  const department = randomUUID();
  const academicSession = randomUUID();
  const semester = randomUUID();
  await db.execute(sql`INSERT INTO institutions (id, slug, name) VALUES (${institution}, ${slug}, ${`Load test ${run}`})`);
  await db.execute(sql`INSERT INTO faculties (id, institution_id, code, name) VALUES (${faculty}, ${institution}, 'ENG', 'Faculty of Engineering')`);
  await db.execute(sql`INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES (${department}, ${institution}, ${faculty}, 'ECE', 'Electronic and Computer Engineering')`);
  await db.execute(sql`INSERT INTO academic_sessions (id, institution_id, code, starts_at, ends_at) VALUES (${academicSession}, ${institution}, '2026/27', now() - interval '120 days', now() + interval '240 days')`);
  await db.execute(sql`INSERT INTO semesters (id, institution_id, academic_session_id, name, starts_at, ends_at) VALUES (${semester}, ${institution}, ${academicSession}, 'First Semester', now() - interval '70 days', now() + interval '50 days')`);

  const ownPassword = `pilot morning passphrase ${run}`;
  const ownHash = await hashPassword(ownPassword);

  // Staff: the HOC who uploaded the lists and gave the setup codes, and the lecturers.
  const hoc = randomUUID();
  await db.execute(sql`INSERT INTO users (id, institution_id, email, display_name, password_hash, status, email_verified_at) VALUES (${hoc}, ${institution}, ${`hoc@${slug}.invalid`}, 'Load HOC', ${ownHash}, 'active', now())`);
  const pilotCourses = ['ECE 301', 'ECE 303', 'ECE 305', 'ECE 307', 'ECE 309', 'GNS 301'];
  const otherLecturers = population > 0 ? 60 : 0;
  const lecturerIds: string[] = [];
  for (let index = 0; index < pilotCourses.length + otherLecturers; index += 1) {
    const id = randomUUID();
    lecturerIds.push(id);
    await db.execute(sql`INSERT INTO users (id, institution_id, email, display_name, password_hash, status, email_verified_at) VALUES (${id}, ${institution}, ${`lecturer-${index + 1}@${slug}.invalid`}, ${`Load Lecturer ${index + 1}`}, ${ownHash}, 'active', now())`);
    await db.execute(sql`INSERT INTO lecturer_profiles (user_id, institution_id, department_id, staff_number) VALUES (${id}, ${institution}, ${department}, ${`LOAD-${run}-${index + 1}`})`);
    await db.execute(sql`INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES (${id}, 'lecturer', 'department', ${institution}, ${department})`);
  }

  // A real registered face (the test man in packages/face/test/fixtures) gives the signature size and the portrait.
  const photo = async (name: string) => (await readFile(path.join(fixtures, `${name}.jpg`))).toString('base64');
  const [front, right, left] = await Promise.all([photo('a1'), photo('a2'), photo('a3')]);
  let faceModel = 'sface-2021dec';
  let faceDims = 128;
  let faceQuality = '{}';
  if (faceOn) {
    const enrolment = await new FaceVerifier({ engine: loadFaceEngine }).enrol([
      { pose: 'front', image: front },
      { pose: 'left', image: left },
      { pose: 'right', image: right },
    ]);
    faceModel = enrolment.model;
    faceDims = enrolment.centroid.length;
    faceQuality = JSON.stringify(enrolment.quality);
  }
  const portrait = Buffer.alloc(9_000, 1); // about the size of the stored 200 x 250 JPEG

  /* ---------- the rest of LASU (in SQL: fast enough for 100k+) ---------- */
  if (population > 0) {
    await db.execute(sql`
      INSERT INTO users (id, institution_id, email, display_name, password_hash, status, email_verified_at)
      SELECT gen_random_uuid(), ${institution}, 'p' || g || '@st.lasu.edu.ng', 'Population Student ' || g, ${ownHash}, 'active', now()
      FROM generate_series(1, ${population}) AS g`);
    await db.execute(sql`
      INSERT INTO student_profiles (user_id, institution_id, department_id, student_number)
      SELECT u.id, ${institution}, ${department}, '24' || lpad(substring(u.email FROM 2 FOR position('@' IN u.email) - 2), 7, '0')
      FROM users u WHERE u.institution_id = ${institution} AND u.email LIKE 'p%@st.lasu.edu.ng'`);
    await db.execute(sql`
      INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id)
      SELECT sp.user_id, 'student', 'institution', ${institution} FROM student_profiles sp WHERE sp.institution_id = ${institution}`);
    await db.execute(sql`
      INSERT INTO class_list_entries (institution_id, department_id, matric_number, surname, first_name, lasu_email, entry_year, student_user_id, added_by_user_id)
      SELECT ${institution}, ${department}, sp.student_number, 'POPULATION' || sp.student_number, 'Student', u.email, 2024, u.id, ${hoc}
      FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.institution_id = ${institution}`);
    // A session row each (people sign in on their phones over a term).
    await db.execute(sql`
      INSERT INTO user_sessions (user_id, token_hash, expires_at, last_seen_at)
      SELECT sp.user_id, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now() + interval '20 days', now() - interval '1 day'
      FROM student_profiles sp WHERE sp.institution_id = ${institution}`);
    // 70% have registered their face: a random signature of the real size (random signatures never match a real face).
    await db.execute(sql`
      INSERT INTO student_face_profiles (user_id, institution_id, model, templates, centroid, photo, quality, consented_at)
      SELECT sp.user_id, ${institution}, ${faceModel}, jsonb_build_array(signature.v, signature.v, signature.v), signature.v, ${portrait}, ${faceQuality}::jsonb, now()
      FROM student_profiles sp
      CROSS JOIN LATERAL (SELECT jsonb_agg(random() - 0.5) AS v FROM generate_series(1, ${faceDims}) AS d WHERE sp.user_id IS NOT NULL) AS signature
      WHERE sp.institution_id = ${institution} AND random() < 0.7`);
    // Other classes this semester: each other lecturer held 20 lectures of ~150 students.
    await db.execute(sql`
      INSERT INTO lecture_sessions (institution_id, created_by_user_id, creator_role, course_code, course_title, qr_mode, secret, public_code, starts_at, ends_at, closed_at)
      SELECT ${institution}, l.id, 'lecturer', 'OTH ' || (100 + l.n), 'Other course ' || l.n, 'dynamic', md5(random()::text) || md5(random()::text),
             upper(substr(md5(random()::text), 1, 12)), now() - (w * interval '3 days') - interval '2 hours', now() - (w * interval '3 days') - interval '1 hour', now() - (w * interval '3 days') - interval '1 hour'
      FROM (SELECT id, row_number() OVER () AS n FROM unnest(${sql.raw(`ARRAY[${lecturerIds.slice(pilotCourses.length).map((id) => `'${id}'::uuid`).join(',')}]`)}) AS id) AS l
      CROSS JOIN generate_series(1, 20) AS w`);
    await db.execute(sql`
      INSERT INTO lecture_attendance (institution_id, lecture_session_id, student_user_id, full_name, matric_number, method, created_at)
      SELECT ${institution}, s.id, sp.user_id, 'Population Student', sp.student_number, 'qr', s.starts_at + interval '10 minutes'
      FROM (SELECT id, starts_at, row_number() OVER (ORDER BY id) AS k FROM lecture_sessions WHERE institution_id = ${institution} AND course_code LIKE 'OTH %') AS s
      JOIN student_profiles sp ON sp.institution_id = ${institution}
        AND sp.student_number BETWEEN '24' || lpad(((s.k * 7919) % ${Math.max(1, population - 150)} + 1)::text, 7, '0')
                                  AND '24' || lpad(((s.k * 7919) % ${Math.max(1, population - 150)} + 150)::text, 7, '0')`);
  }

  /* ---------- the pilot class ---------- */
  interface Signer {
    readonly id: string; readonly matric: string; readonly email: string; readonly surname: string;
    readonly onStarting: boolean; readonly typesLoose: boolean; readonly byEmail: boolean; readonly typo: boolean;
    readonly arriveAt: number; cookie: string | null;
  }
  const surnames = ['ADEYEMI', 'OKONKWO', 'BELLO', 'ADEBAYO', 'OGUNLEYE', 'NWOSU', 'OLADIPO', 'ABDULLAHI', 'EZE', 'ODEJOBI', 'ADE-BELLO', 'OLUWASEUN'];
  const signers: Signer[] = Array.from({ length: signerCount }, (_, index) => {
    const onStarting = Math.random() < startingShare;
    return {
      id: randomUUID(),
      matric: `2500${String(index + 1).padStart(5, '0')}`,
      email: `pilot${index + 1}.${run}@st.lasu.edu.ng`,
      surname: surnames[index % surnames.length]!,
      onStarting,
      typesLoose: onStarting && Math.random() < looseShare,
      byEmail: Math.random() < emailShare,
      typo: Math.random() < typoShare,
      arriveAt: spreadMs ? Math.random() * spreadMs : 0,
      cookie: null,
    };
  });
  // Starting passwords are each student's own (LASU + matric + SURNAME): hashed one by one, like the real ones.
  const startingHashes = new Map<string, string>();
  for (let start = 0; start < signers.length; start += 8) {
    await Promise.all(signers.slice(start, start + 8).filter((signer) => signer.onStarting).map(async (signer) => {
      startingHashes.set(signer.id, await hashPassword(startingPassword(signer.matric, signer.surname)));
    }));
  }
  const join = <T>(list: readonly T[], render: (row: T) => ReturnType<typeof sql>) => sql.join(list.map(render), sql`, `);
  for (let start = 0; start < signers.length; start += 250) {
    const batch = signers.slice(start, start + 250);
    await db.execute(sql`INSERT INTO users (id, institution_id, email, display_name, password_hash, password_is_default, status, email_verified_at) VALUES ${join(batch, (signer) => sql`(${signer.id}, ${institution}, ${signer.email}, ${`Pilot ${signer.surname}`}, ${startingHashes.get(signer.id) ?? ownHash}, ${signer.onStarting}, 'active', now())`)}`);
    await db.execute(sql`INSERT INTO student_profiles (user_id, institution_id, department_id, student_number, student_number_verified_at) VALUES ${join(batch, (signer) => sql`(${signer.id}, ${institution}, ${department}, ${signer.matric}, now())`)}`);
    await db.execute(sql`INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ${join(batch, (signer) => sql`(${signer.id}, 'student', 'institution', ${institution})`)}`);
    await db.execute(sql`INSERT INTO class_list_entries (institution_id, department_id, matric_number, surname, first_name, lasu_email, entry_year, student_user_id, added_by_user_id) VALUES ${join(batch, (signer) => sql`(${institution}, ${department}, ${signer.matric}, ${signer.surname}, 'Pilot', ${signer.email}, 2024, ${signer.id}, ${hoc})`)}`);
  }
  await db.execute(sql`
    INSERT INTO student_face_profiles (user_id, institution_id, model, templates, centroid, photo, quality, consented_at)
    SELECT u.id, ${institution}, ${faceModel}, jsonb_build_array(signature.v, signature.v, signature.v), signature.v, ${portrait}, ${faceQuality}::jsonb, now()
    FROM users u CROSS JOIN LATERAL (SELECT jsonb_agg(random() - 0.5) AS v FROM generate_series(1, ${faceDims}) AS d WHERE u.id IS NOT NULL) AS signature
    WHERE u.institution_id = ${institution} AND u.email LIKE ${`pilot%.${run}@st.lasu.edu.ng`}`);
  await packSeededCentroids(db, institution);
  // Eight weeks of the six pilot courses (two lectures a week), each student taking four of them and attending ~85%.
  await db.execute(sql`
    INSERT INTO lecture_sessions (institution_id, created_by_user_id, creator_role, course_code, course_title, qr_mode, secret, public_code, starts_at, ends_at, closed_at)
    SELECT ${institution}, c.lecturer, 'lecturer', c.code, 'Pilot course ' || c.code, 'dynamic', md5(random()::text) || md5(random()::text),
           upper(substr(md5(random()::text), 1, 12)), now() - (w * interval '3.5 days') - interval '2 hours', now() - (w * interval '3.5 days') - interval '1 hour', now() - (w * interval '3.5 days') - interval '1 hour'
    FROM (VALUES ${join(pilotCourses.map((code, index) => ({ code, lecturer: lecturerIds[index]! })), (course) => sql`(${course.code}, ${course.lecturer}::uuid)`)}) AS c(code, lecturer)
    CROSS JOIN generate_series(1, 16) AS w`);
  await db.execute(sql`
    INSERT INTO lecture_attendance (institution_id, lecture_session_id, student_user_id, full_name, matric_number, method, created_at)
    SELECT ${institution}, s.id, sp.user_id, 'Pilot Student', sp.student_number, 'qr', s.starts_at + random() * interval '20 minutes'
    FROM lecture_sessions s
    JOIN student_profiles sp ON sp.institution_id = ${institution} AND sp.student_number LIKE '2500%'
    WHERE s.institution_id = ${institution} AND s.course_code = ANY(${sql.raw(`ARRAY[${pilotCourses.map((code) => `'${code}'`).join(',')}]`)})
      AND abs(hashtext(sp.student_number || s.course_code)) % 3 <> 0 AND random() < 0.85`);

  /* ---------- opening their account today, with a setup code from the HOC ---------- */
  interface Opener { readonly matric: string; readonly code: string; readonly entryId: string; readonly arriveAt: number; readonly captureMs: number; cookie: string | null }
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const openers: Opener[] = Array.from({ length: openerCount }, (_, index) => ({
    matric: `2501${String(index + 1).padStart(5, '0')}`,
    code: Array.from(randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join(''),
    entryId: randomUUID(),
    arriveAt: spreadMs ? Math.random() * spreadMs : 0,
    captureMs: 6_000 + Math.random() * 6_000,
    cookie: null,
  }));
  for (let start = 0; start < openers.length; start += 250) {
    const batch = openers.slice(start, start + 250);
    await db.execute(sql`INSERT INTO class_list_entries (id, institution_id, department_id, matric_number, surname, first_name, lasu_email, entry_year, added_by_user_id) VALUES ${join(batch, (opener) => sql`(${opener.entryId}, ${institution}, ${department}, ${opener.matric}, 'OPENER', 'New', ${`new${opener.matric}.${run}@st.lasu.edu.ng`}, 2024, ${hoc})`)}`);
    await db.execute(sql`INSERT INTO student_setup_codes (class_list_entry_id, code_hash, issued_by_user_id, issued_at, expires_at) VALUES ${join(batch, (opener) => sql`(${opener.entryId}, ${createHash('sha256').update(`setup:${opener.entryId}:${opener.code}`).digest('hex')}, ${hoc}, now(), now() + interval '3 hours')`)}`);
  }
  await db.execute(sql`ANALYZE`);
  const seedMs = performance.now() - seedStarted;
  const [sizes] = await rows<Record<string, number>>(sql`
    SELECT (SELECT count(*)::int FROM student_profiles WHERE institution_id = ${institution}) AS students,
           (SELECT count(*)::int FROM class_list_entries WHERE institution_id = ${institution}) AS class_list_entries,
           (SELECT count(*)::int FROM student_face_profiles WHERE institution_id = ${institution}) AS registered_faces,
           (SELECT count(*)::int FROM lecture_sessions WHERE institution_id = ${institution}) AS lecture_sessions,
           (SELECT count(*)::int FROM lecture_attendance WHERE institution_id = ${institution}) AS lecture_attendance,
           (SELECT count(*)::int FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE u.institution_id = ${institution}) AS user_sessions`);

  /* ================================================================ */
  /* 2. How PostgreSQL runs the hot queries on this data                */
  /* ================================================================ */
  const sample = signers[Math.floor(signers.length / 2)]!;
  async function plan(label: string, query: ReturnType<typeof sql>) {
    const [row] = await rows<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Execution Time': number }> }>(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`);
    const root = row!['QUERY PLAN'][0]!;
    const scans: string[] = [];
    const walk = (node: PlanNode) => {
      if (/Scan/.test(node['Node Type'])) scans.push(`${node['Node Type']}${node['Index Name'] ? ` (${node['Index Name']})` : ''} on ${node['Relation Name'] ?? '?'}${node['Rows Removed by Filter'] ? `, ${node['Rows Removed by Filter']} rows read and thrown away` : ''}`);
      for (const child of node.Plans ?? []) walk(child);
    };
    walk(root.Plan);
    return { label, executionMs: Number(root['Execution Time'].toFixed(2)), scans };
  }
  interface PlanNode { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; 'Rows Removed by Filter'?: number; Plans?: PlanNode[] }
  const plans = [
    // AuthService.login → findStudentEmailByMatric (apps/api/src/auth/postgres-repository.ts)
    await plan('sign-in: find the account by matric number', sql`
      SELECT u.email FROM student_profiles sp JOIN users u ON u.id = sp.user_id JOIN institutions i ON u.institution_id = i.id
      WHERE i.slug = ${slug} AND upper(replace(sp.student_number, ' ', '')) = ${sample.matric} AND u.status <> 'closed' LIMIT 1`),
    // findCredentials (student branch): the account by email
    await plan('sign-in: find the account by email', sql`
      SELECT u.id, u.password_hash FROM users u JOIN institutions i ON u.institution_id = i.id
      WHERE i.slug = ${slug} AND lower(u.email) = ${sample.email} LIMIT 1`),
    // StudentsService.enrolFace → listFaceCentroids: every other registered face in the institution
    await plan('face registration: load every registered face to look for a duplicate', sql`
      SELECT user_id, centroid_packed, CASE WHEN centroid_packed IS NULL THEN centroid END AS centroid
      FROM student_face_profiles WHERE institution_id = ${institution} AND user_id <> ${sample.id}`),
  ];
  const [centroidBytes] = await rows<{ mb: number; packedMb: number }>(sql`
    SELECT round(sum(pg_column_size(centroid)) / 1e6, 1)::float AS mb, round(coalesce(sum(pg_column_size(centroid_packed)), 0) / 1e6, 1)::float AS "packedMb"
    FROM student_face_profiles WHERE institution_id = ${institution}`);

  /* ================================================================ */
  /* 3–5. The morning                                                   */
  /* ================================================================ */
  const environment = instanceEnvironment({
    databaseUrl, slug, poolMax, rateLimits, logs: SERVER_LOGS,
    extra: { FACE_CHECK: faceOn ? 'required' : 'off' },
  });
  console.error(`Starting ${instanceCount} server instance(s), pool ${poolMax} each…`);
  const instances = await Promise.all(Array.from({ length: instanceCount }, () => startInstance(environment)));
  let nextInstance = 0;
  const pick = () => instances[(nextInstance++) % instances.length]!.base;
  const recorder = new Recorder();
  const call = createClient(recorder, pick);
  const failures: { step: string; status: number; detail: unknown }[] = [];
  const fail = (step: string, result: { status: number; json: Record<string, unknown> | null }) => {
    failures.push({ step, status: result.status, detail: result.json?.detail ?? result.json?.title ?? result.json?.status ?? null });
  };
  const stats = () => Promise.all(instances.map((instance) => instanceStats(instance, { reset: true })));
  const phaseFigures: Record<string, { seconds: number; cpuSeconds: number; loopDelayMaxMs: number; loopDelayP99Ms: number }> = {};
  const measurePhase = async (name: string, body: () => Promise<void>) => {
    const before = await stats();
    const started = performance.now();
    await body();
    const after = await stats();
    phaseFigures[name] = {
      seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
      cpuSeconds: Number((after.reduce((sum, figures, index) => sum + figures.cpuMs - before[index]!.cpuMs, 0) / 1000).toFixed(1)),
      loopDelayMaxMs: Math.max(...after.map((figures) => figures.loopDelayMaxMs)),
      loopDelayP99Ms: Math.max(...after.map((figures) => figures.loopDelayP99Ms)),
    };
  };

  async function loadDashboard(step: string, cookie: string): Promise<number> {
    const started = performance.now();
    const results = await Promise.all(DASHBOARD_READS.map((route) => call(`${step}: ${route.replace('/api/v1/', '')}`, 'GET', route, { cookie })));
    for (const [index, result] of results.entries()) if (result.status !== 200) fail(`${step}: ${DASHBOARD_READS[index]}`, result);
    const ms = performance.now() - started;
    recorder.record(`${step} (all 7 reads back)`, ms, results.every((result) => result.status === 200) ? 200 : 500, results.every((result) => result.status === 200) ? 'ready' : 'incomplete');
    return ms;
  }

  let morningOver = false;
  async function stayOnThePage(cookie: string) {
    // As the page does: open sessions every 15 s, the lecture history every 60 s.
    let tick = 0;
    await sleep(Math.random() * 15_000);
    while (!morningOver) {
      await call('page open: poll open sessions (15 s)', 'GET', '/api/v1/student/attendance/open', { cookie });
      if (tick % 4 === 3) await call('page open: poll lecture history (60 s)', 'GET', '/api/v1/student/lecture-history', { cookie });
      tick += 1;
      await sleep(15_000);
    }
  }

  const started = performance.now();
  const at = (ms: number) => sleep(Math.max(0, ms - (performance.now() - started)));
  const idle: Promise<void>[] = [];
  let signedIn = 0;
  let opened = 0;
  let facesSaved = 0;
  let facesRefusedAsSameFace = 0;
  let faceRetries = 0;

  async function signerMorning(signer: Signer) {
    await at(signer.arriveAt);
    const identifier = signer.byEmail ? signer.email.toUpperCase() : (Math.random() < 0.2 ? `${signer.matric.slice(0, 3)} ${signer.matric.slice(3)}` : signer.matric);
    const password = signer.onStarting
      ? (signer.typesLoose ? `lasu ${signer.matric} ${signer.surname.toLowerCase()}` : startingPassword(signer.matric, signer.surname))
      : ownPassword;
    const tap = performance.now();
    if (signer.typo) {
      const wrong = await call('sign in: mistyped password first', 'POST', '/api/v1/auth/login', { body: { email: identifier, password: `${password}x` } });
      if (wrong.status !== 401) fail('sign in: mistyped password first', wrong);
      await sleep(2_000 + Math.random() * 3_000);
    }
    const step = signer.onStarting ? (signer.typesLoose ? 'sign in: starting password, typed loosely' : 'sign in: starting password') : 'sign in: own password';
    const tapped = performance.now();
    const login = await call(step, 'POST', '/api/v1/auth/login', { body: { email: identifier, password } });
    recorder.record('sign in: every successful sign-in', performance.now() - tapped, login.status, login.status === 200 ? 'authenticated' : 'failed');
    const cookie = sessionCookieFrom(login.cookies);
    if (login.status !== 200 || !cookie) {
      fail(step, login);
      return;
    }
    signer.cookie = cookie;
    signedIn += 1;
    await loadDashboard('attendance page', cookie);
    recorder.record('journey: tap "Sign in" → attendance page ready', performance.now() - tapped, 200, 'ready');
    if (signer.typo) recorder.record('journey: with a mistyped password first', performance.now() - tap, 200, 'ready');
    idle.push(stayOnThePage(cookie));
  }

  async function openerMorning(opener: Opener) {
    await at(opener.arriveAt);
    const begun = performance.now();
    const lookup = await call('open account: check the class list', 'POST', '/api/v1/students/lookup', { body: { matricNumber: opener.matric } });
    if (lookup.status !== 200) return fail('open account: check the class list', lookup);
    await sleep(3_000 + Math.random() * 4_000); // typing the setup code
    const open = await call('open account: setup code from the HOC', 'POST', '/api/v1/students/open/setup-code', { body: { matricNumber: opener.matric, setupCode: `${opener.code.slice(0, 4)}-${opener.code.slice(4)}` } });
    const cookie = sessionCookieFrom(open.cookies);
    if (open.status !== 201 || !cookie) return fail('open account: setup code from the HOC', open);
    opener.cookie = cookie;
    opened += 1;
    const setup = await call('open account: setup page', 'GET', '/api/v1/students/me/setup', { cookie });
    if (setup.status !== 200) fail('open account: setup page', setup);
    recorder.record('journey: matric number → account open', performance.now() - begun, 201, 'opened');
    if (faceOn) {
      void call('face registration: camera opens (face/warm)', 'POST', '/api/v1/students/me/face/warm', { cookie, body: {} });
      await sleep(opener.captureMs);
      const body = { consent: true, frames: [{ pose: 'front', image: front }, { pose: 'left', image: left }, { pose: 'right', image: right }] };
      const submitted = performance.now();
      let result = await call('face registration: three photos', 'POST', '/api/v1/students/me/face', { cookie, body });
      // The web app's registerFace: busy (503 + Retry-After) waits and tries again, longer each time, for up to 3 minutes.
      let busy = 0;
      while (result.status === 503 && Number(result.headers.get('retry-after')) > 0) {
        busy += 1;
        const delay = Math.max(Math.min(Number(result.headers.get('retry-after')), 60), Math.min(30, 3 * 1.5 ** (busy - 1))) * 1000 * (1 + Math.random() * 0.25);
        if (performance.now() - submitted + delay > RETRY_WINDOW_MS) break;
        faceRetries += 1;
        await sleep(delay);
        result = await call('face registration: busy, phone tries again', 'POST', '/api/v1/students/me/face', { cookie, body });
      }
      // Every simulated student shows the same test face: the first is saved, the rest are refused as "already
      // registered to another student" after the same work (analysis + duplicate search). Both are expected here.
      if (result.status === 201) facesSaved += 1;
      else if (result.status === 409 && /already registered to another/.test(String(result.json?.detail))) facesRefusedAsSameFace += 1;
      else fail('face registration', result);
      recorder.record('face registration: photos sent → answer (incl. busy retries)', performance.now() - submitted, result.status, result.status === 201 ? 'registered' : result.status === 409 ? 'same face as another student (expected here)' : 'failed');
    }
    await loadDashboard('attendance page', cookie);
    idle.push(stayOnThePage(cookie));
  }

  console.error(`Morning: ${signerCount} signing in and ${openerCount} opening accounts over ${spreadMs / 1000} s, all from one address…`);
  await measurePhase('morning', async () => {
    await Promise.all([...signers.map(signerMorning), ...openers.map(openerMorning)]);
    // Let the open pages poll for one more round before the next phase.
    await sleep(16_000);
  });
  morningOver = true;
  await Promise.all(idle);

  const phones = [...signers.map((signer) => signer.cookie), ...openers.map((opener) => opener.cookie)].filter((cookie): cookie is string => Boolean(cookie));
  console.error(`"Refresh your page": ${phones.length} phones reload at once…`);
  await measurePhase('everyone refreshes', async () => {
    await Promise.all(phones.map((cookie) => loadDashboard('everyone refreshes at once', cookie)));
  });

  let sessionReads = 0;
  if (readerCount > 0 && phones.length > 0) {
    console.error(`Session reads: ${readerCount} phones read their session back to back for ${readMs / 1000} s…`);
    await measurePhase('session reads', async () => {
      const until = performance.now() + readMs;
      await Promise.all(Array.from({ length: readerCount }, async (_, index) => {
        const cookie = phones[index % phones.length]!;
        while (performance.now() < until) {
          const result = await call('session read: GET /auth/session', 'GET', '/api/v1/auth/session', { cookie });
          sessionReads += 1;
          if (result.status !== 200) fail('session read', result);
        }
      }));
    });
  }
  const wallMs = performance.now() - started;
  const final: InstanceFigures[] = await Promise.all(instances.map((instance) => instanceStats(instance)));

  /* ================================================================ */
  /* What the database holds afterwards                                 */
  /* ================================================================ */
  const [after] = await rows<{ sessions: number; linked: number; opener_faces: number; refused: number }>(sql`
    SELECT (SELECT count(*)::int FROM user_sessions s JOIN users u ON u.id = s.user_id
             WHERE u.institution_id = ${institution} AND (u.email LIKE ${`pilot%.${run}@st.lasu.edu.ng`} OR u.email LIKE ${`new%.${run}@st.lasu.edu.ng`})) AS sessions,
           (SELECT count(*)::int FROM class_list_entries WHERE institution_id = ${institution} AND matric_number LIKE '2501%' AND student_user_id IS NOT NULL) AS linked,
           (SELECT count(*)::int FROM student_face_profiles f JOIN users u ON u.id = f.user_id WHERE u.institution_id = ${institution} AND u.email LIKE ${`new%.${run}@st.lasu.edu.ng`}) AS opener_faces,
           (SELECT count(*)::int FROM student_audit_events WHERE institution_id = ${institution} AND action = 'face_duplicate_refused') AS refused`);
  const [limited] = await rows<{ count: number }>(sql`SELECT count(*)::int AS count FROM rate_limit_counters`);
  stopInstances(instances);
  await database.close();

  /* ================================================================ */
  /* Report                                                             */
  /* ================================================================ */
  const steps = recorder.report();
  const allSamples = Object.values(steps);
  const serverErrors = allSamples.reduce((sum, step) => sum + Object.entries(step.outcomes).filter(([key]) => /^(5\d\d|0) /.test(key) && !key.startsWith('503 ')).reduce((total, [, count]) => total + count, 0), 0);
  const refusedByLimits = allSamples.reduce((sum, step) => sum + Object.entries(step.outcomes).filter(([key]) => key.startsWith('429 ')).reduce((total, [, count]) => total + count, 0), 0);
  const signIn = steps['sign in: every successful sign-in'];
  const reads = recorder.get('session read: GET /auth/session').map((entry) => entry.ms).sort((a, b) => a - b);
  const readP95 = percentile(reads, 95);
  const targets = {
    signIn: {
      goal: `${signerCount} sign-ins over ${spreadMs / 1000} s: no server errors, p95 under ${TARGETS.signInP95Ms / 1000} s`,
      p95Ms: signIn?.p95Ms ?? null,
      met: serverErrors === 0 && (signIn?.p95Ms ?? Infinity) < TARGETS.signInP95Ms && signedIn === signerCount,
    },
    sessionReads: {
      goal: `GET /api/v1/auth/session at ${readerCount} concurrent readers: p95 under ${TARGETS.sessionReadP95Ms} ms`,
      p95Ms: readP95,
      perSecond: phaseFigures['session reads'] ? Math.round(sessionReads / phaseFigures['session reads'].seconds) : null,
      met: readerCount === 0 || (readP95 ?? Infinity) < TARGETS.sessionReadP95Ms,
    },
  };
  const report = {
    note: 'Production wiring (createApiApplication, serverless pool, PostgreSQL rate limits) on this computer; each instance is one process like one warm Vercel function instance; every request from one address.',
    ranAt: new Date().toISOString(),
    node: process.version,
    cpus: cpus().length,
    settings: {
      signingIn: signerCount, openingAccounts: openerCount, otherStudents: population, arrivalsOverSeconds: spreadMs / 1000,
      instances: instanceCount, poolPerInstance: poolMax, faceRegistration: faceOn, readers: readerCount, readSeconds: readMs / 1000,
      onStartingPassword: startingShare, startingTypedLoosely: looseShare, byEmail: emailShare, mistypeFirst: typoShare,
      rateLimitStore: rateLimits, oneClientAddress: true,
    },
    database: { ...sizes, registeredFaceSignaturesMb: centroidBytes?.mb ?? null, packedFaceSignaturesMb: centroidBytes?.packedMb ?? null, seedSeconds: Number((seedMs / 1000).toFixed(1)) },
    queryPlans: plans,
    wallSeconds: Number((wallMs / 1000).toFixed(1)),
    outcome: {
      signedIn, of: signerCount, opened, ofOpeners: openerCount,
      facesSaved, facesRefusedAsSameTestFace: facesRefusedAsSameFace, faceBusyRetries: faceRetries,
      serverErrors, refusedByRateLimits: refusedByLimits,
    },
    targets,
    phases: phaseFigures,
    server: {
      cpuSecondsTotal: Number((final.reduce((sum, figures) => sum + figures.cpuMs, 0) / 1000).toFixed(1)),
      peakRssMbPerInstance: final.map((figures) => figures.peakRssMb),
      faceQueue: faceOn ? final.map((figures) => figures.face) : null,
      databaseRoundTripsPerRequest: final[0]?.queriesPerRoute ?? {},
    },
    steps,
    failures: { count: failures.length, sample: failures.slice(0, 12) },
    afterwards: {
      sessionsForTodaysStudents: after?.sessions ?? 0,
      openersLinkedToTheirListEntry: after?.linked ?? 0,
      openerFacesStored: after?.opener_faces ?? 0,
      sameFaceRefusalsAudited: after?.refused ?? 0,
      rateLimitCounters: limited?.count ?? 0,
    },
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (options.output) await writeFile(options.output, `${text}\n`);
  const healthy = serverErrors === 0 && failures.length === 0 && signedIn === signerCount && opened === openerCount
    && targets.signIn.met && targets.sessionReads.met;
  if (!healthy) {
    console.error('The rehearsal found problems: see "failures", "outcome" and "targets".');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(), 1_000).unref());
