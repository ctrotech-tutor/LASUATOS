/**
 * The lecture-start rush: every student in one or more halls scans the QR code
 * and passes the face check in the same minute, against the real production
 * wiring (createApiApplication: the same services, routes, rate limits,
 * PostgreSQL rate-limit store, connection pool size and face models as the
 * Vercel function) and a real PostgreSQL database on this computer.
 *
 *   DATABASE_URL=postgres://user@127.0.0.1:5432/db pnpm load:rush
 *   pnpm load:rush -- --halls 3 --students 300 --spread 60 --instances 2
 *   pnpm load:rush -- --phone-retries off      (how phones behaved before they retried by themselves)
 *   LOAD_SERVER_LOGS=yes pnpm load:rush        (each server instance prints its errors here)
 *
 * Each server instance is its own process with its own connection pool
 * (DATABASE_POOL_MAX, 3 like Vercel) and its own face engine, like one warm
 * Vercel function instance. Each phone does what the real one does:
 *   scan (resolve) → camera opens (face/warm) → a few seconds taking the two
 *   photos → check-in with the photos, its device token and, for some, a
 *   one-off sign-in on a classmate's phone (password check) → some send it twice.
 * Meanwhile each lecturer's screen polls the live list every 4 s and the
 * projector fetches each new QR frame. Requests running longer than 30 s are
 * cut off, as Vercel cuts /api/v1 off at its 30-second limit.
 *
 * It refuses a database that is not on this computer: it is for a local copy
 * (a fresh database, or a restored copy of staging), never the live site. All
 * rows it makes belong to a new institution (slug load-XXXX), so they never mix
 * with real ones; drop the database afterwards.
 *
 * Photos: the AI-generated test faces in packages/face/test/fixtures (a man
 * facing the camera, turned right and turned left), registered once and used
 * for every student, so each check-in costs the server exactly what a real one
 * does. Prints a JSON report; exits 1 when anyone was lost or counted twice.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { createOpaqueToken, hashOpaqueToken, hashPassword } from '@lasuatos/auth';
import { sql } from 'drizzle-orm';
import { FaceVerifier, loadFaceEngine } from '../students/face.js';
import {
  clampInt,
  createClient,
  instanceEnvironment,
  instanceStats,
  localDatabaseUrl,
  openLocalDatabase,
  Recorder,
  repositoryRoot,
  sessionCookieFrom,
  share,
  sleep,
  startInstance,
  stopInstances,
  packSeededCentroids,
} from './shared.js';

const fixtures = path.join(repositoryRoot, 'packages/face/test/fixtures');

/** LOAD_SERVER_LOGS=yes: each server instance prints its errors to this terminal (see instance.ts). */
const SERVER_LOGS = process.env.LOAD_SERVER_LOGS === 'yes';

/** How long a phone keeps trying a busy check-in (as the web app does). */
const RETRY_WINDOW_MS = 180_000;

const { values: options } = parseArgs({
  options: {
    halls: { type: 'string', default: '1' },
    students: { type: 'string', default: '300' },
    spread: { type: 'string', default: '60' },
    instances: { type: 'string', default: '1' },
    pool: { type: 'string', default: '3' },
    face: { type: 'string', default: 'on' },
    'capture-seconds': { type: 'string', default: '3-8' },
    'sign-in-share': { type: 'string', default: '0.05' },
    'retry-share': { type: 'string', default: '0.1' },
    'phone-retries': { type: 'string', default: 'on' },
    'face-budget': { type: 'string', default: '15000' },
    'rate-limits': { type: 'string', default: 'postgres' },
    output: { type: 'string' },
  },
  allowPositionals: true,
});

/* ------------------------------------------------------------------ */
/* The rush                                                             */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const databaseUrl = localDatabaseUrl();

  const halls = clampInt(options.halls, 1, 1, 20);
  const perHall = clampInt(options.students, 300, 1, 3000);
  const spreadMs = clampInt(options.spread, 60, 0, 1800) * 1000;
  const instanceCount = clampInt(options.instances, 1, 1, 16);
  const poolMax = clampInt(options.pool, 3, 1, 50);
  const faceOn = options.face !== 'off';
  const [captureLow, captureHigh] = (options['capture-seconds'] ?? '3-8').split('-').map((part) => Number(part) * 1000);
  const signInShare = share(options['sign-in-share'], 0.05);
  const retryShare = share(options['retry-share'], 0.1);
  const phoneRetries = options['phone-retries'] !== 'off';
  const faceBudget = clampInt(options['face-budget'], 15_000, 1_000, 25_000);
  const rateLimits = ['postgres', 'memory', 'off'].includes(options['rate-limits'] ?? '') ? options['rate-limits']! : 'postgres';
  const run = randomBytes(2).toString('hex');
  const slug = `load-${run}`;

  /* ---------- database ---------- */
  const { database, db, rows: one } = await openLocalDatabase(databaseUrl);

  // Every run comes from 127.0.0.1, like a hall behind one campus address:
  // start each run with empty rate-limit counters so one run's requests do
  // not count against the next (this database is a local copy; see isLoopback).
  await database.db.execute(sql`DELETE FROM rate_limit_counters`);
  console.error(`Seeding institution ${slug}: ${halls} hall(s) × ${perHall} students…`);
  const seedStarted = performance.now();
  const institution = randomUUID();
  const faculty = randomUUID();
  const department = randomUUID();
  const academicSession = randomUUID();
  const semester = randomUUID();
  await db.execute(sql`INSERT INTO institutions (id, slug, name) VALUES (${institution}, ${slug}, ${`Load test ${run}`})`);
  await db.execute(sql`INSERT INTO faculties (id, institution_id, code, name) VALUES (${faculty}, ${institution}, 'ENG', 'Faculty of Engineering')`);
  await db.execute(sql`INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES (${department}, ${institution}, ${faculty}, 'ECE', 'Electronic and Computer Engineering')`);
  await db.execute(sql`INSERT INTO academic_sessions (id, institution_id, code, starts_at, ends_at) VALUES (${academicSession}, ${institution}, '2026/27', now() - interval '60 days', now() + interval '300 days')`);
  await db.execute(sql`INSERT INTO semesters (id, institution_id, academic_session_id, name, starts_at, ends_at) VALUES (${semester}, ${institution}, ${academicSession}, 'First Semester', now() - interval '30 days', now() + interval '90 days')`);

  const password = `load test passphrase ${run}`;
  const passwordHash = await hashPassword(password);
  const lecturers: { readonly id: string; readonly email: string }[] = [];
  for (let hall = 0; hall < halls; hall += 1) {
    const id = randomUUID();
    const email = `lecturer-${hall + 1}@${slug}.invalid`;
    await db.execute(sql`INSERT INTO users (id, institution_id, email, display_name, password_hash, status, email_verified_at) VALUES (${id}, ${institution}, ${email}, ${`Load Lecturer ${hall + 1}`}, ${passwordHash}, 'active', now())`);
    await db.execute(sql`INSERT INTO lecturer_profiles (user_id, institution_id, department_id, staff_number) VALUES (${id}, ${institution}, ${department}, ${`LOAD-${run}-${hall + 1}`})`);
    await db.execute(sql`INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES (${id}, 'lecturer', 'department', ${institution}, ${department})`);
    lecturers.push({ id, email });
  }

  // One registered face for everyone: the real models' signatures of the test man.
  const photo = async (name: string) => (await readFile(path.join(fixtures, `${name}.jpg`))).toString('base64');
  const [front, right, left] = await Promise.all([photo('a1'), photo('a2'), photo('a3')]);
  let faceRow: { templates: string; centroid: string; photo: Buffer; quality: string; model: string } | null = null;
  if (faceOn) {
    const enrolment = await new FaceVerifier({ engine: loadFaceEngine }).enrol([
      { pose: 'front', image: front },
      { pose: 'left', image: left },
      { pose: 'right', image: right },
    ]);
    faceRow = {
      templates: JSON.stringify(enrolment.templates),
      centroid: JSON.stringify(enrolment.centroid),
      photo: enrolment.photo,
      quality: JSON.stringify(enrolment.quality),
      model: enrolment.model,
    };
  }

  interface Student {
    readonly id: string;
    readonly email: string;
    readonly cookie: string;
    readonly deviceToken: string;
    readonly hall: number;
    readonly signsInHere: boolean;
    readonly sendsTwice: boolean;
    readonly arriveAt: number;
    readonly captureMs: number;
    /** The session token is stored hashed, as a real sign-in stores it. */
    readonly tokenHash: string;
  }
  const students: Student[] = [];
  for (let hall = 0; hall < halls; hall += 1) {
    for (let index = 0; index < perHall; index += 1) {
      const serial = hall * perHall + index;
      const token = createOpaqueToken();
      const signsInHere = Math.random() < signInShare;
      students.push({
        id: randomUUID(),
        email: `student-${String(serial).padStart(5, '0')}@${slug}.invalid`,
        cookie: `lasuatos_session=${token}`,
        deviceToken: randomBytes(16).toString('base64url'),
        hall,
        signsInHere,
        sendsTwice: Math.random() < retryShare,
        arriveAt: spreadMs ? Math.random() * spreadMs : 0,
        captureMs: captureLow! + Math.random() * Math.max(0, captureHigh! - captureLow!),
        tokenHash: hashOpaqueToken(token),
      });
    }
  }
  for (let start = 0; start < students.length; start += 250) {
    const batch = students.slice(start, start + 250);
    const join = <T>(rows: T[], render: (row: T, index: number) => ReturnType<typeof sql>) => sql.join(rows.map(render), sql`, `);
    await db.execute(sql`INSERT INTO users (id, institution_id, email, display_name, password_hash, status, email_verified_at) VALUES ${join(batch, (student, index) => sql`(${student.id}, ${institution}, ${student.email}, ${`Load Student ${start + index + 1}`}, ${student.signsInHere ? passwordHash : null}, 'active', now())`)}`);
    await db.execute(sql`INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ${join(batch, (student, index) => sql`(${student.id}, ${institution}, ${department}, ${`9${run.slice(0, 1).replace(/[^0-9]/, '1')}${String(start + index).padStart(7, '0')}`})`)}`);
    await db.execute(sql`INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ${join(batch, (student) => sql`(${student.id}, 'student', 'institution', ${institution})`)}`);
    await db.execute(sql`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ${join(batch, (student) => sql`(${student.id}, ${student.tokenHash}, now() + interval '1 day')`)}`);
    if (faceRow) {
      const face = faceRow;
      await db.execute(sql`INSERT INTO student_face_profiles (user_id, institution_id, model, templates, centroid, photo, quality, consented_at) VALUES ${join(batch, (student) => sql`(${student.id}, ${institution}, ${face.model}, ${face.templates}::jsonb, ${face.centroid}::jsonb, ${face.photo}, ${face.quality}::jsonb, now())`)}`);
    }
  }
  if (faceRow) await packSeededCentroids(db, institution);
  const seedMs = performance.now() - seedStarted;

  /* ---------- server instances ---------- */
  const childEnvironment = instanceEnvironment({
    databaseUrl,
    slug,
    poolMax,
    rateLimits,
    logs: SERVER_LOGS,
    extra: { FACE_CHECK: faceOn ? 'required' : 'off', FACE_QUEUE_BUDGET_MS: String(faceBudget) },
  });
  console.error(`Starting ${instanceCount} server instance(s), pool ${poolMax} each…`);
  const instances = await Promise.all(Array.from({ length: instanceCount }, () => startInstance(childEnvironment)));
  let nextInstance = 0;
  const pick = () => instances[(nextInstance++) % instances.length]!.base;

  const recorder = new Recorder();
  const record = recorder.record.bind(recorder);
  const call = createClient(recorder, pick);

  /* ---------- lecturers open their sessions ---------- */
  interface Hall { readonly id: string; readonly courseCode: string; readonly cookie: string; frame: { challenge: string; rotatesAt: string | null } | null }
  const hallList: Hall[] = [];
  for (const [index, lecturer] of lecturers.entries()) {
    const login = await call('lecturer: sign in', 'POST', '/api/v1/auth/login', { body: { email: lecturer.email, password } });
    const cookie = sessionCookieFrom(login.cookies);
    if (login.status !== 200 || !cookie) throw new Error(`Lecturer sign-in failed (${login.status}): ${JSON.stringify(login.json)}`);
    const courseCode = `LDT ${101 + index}`;
    const added = await call('lecturer: add course', 'POST', '/api/v1/lecture/course-catalog', { cookie, body: { code: courseCode, title: `Load Test ${index + 1}`, units: 2 } });
    if (added.status !== 201) throw new Error(`Adding the course failed (${added.status}): ${JSON.stringify(added.json)}`);
    const opened = await call('lecturer: open session', 'POST', '/api/v1/lecture/sessions', { cookie, body: { courseCode, courseTitle: `Load Test ${index + 1}`, durationMinutes: 60, qrMode: 'dynamic' } });
    if (opened.status !== 201) throw new Error(`Opening the session failed (${opened.status}): ${JSON.stringify(opened.json)}`);
    hallList.push({ id: String(opened.json?.id), courseCode, cookie, frame: null });
  }

  let running = true;
  async function projector(hall: Hall) {
    while (running) {
      const frame = await call('projector: QR frame', 'GET', `/api/v1/lecture/sessions/${hall.id}/qr`, { cookie: hall.cookie });
      if (frame.status === 200 && frame.json) {
        hall.frame = { challenge: String(frame.json.path).split('#')[1] ?? '', rotatesAt: typeof frame.json.rotatesAt === 'string' ? frame.json.rotatesAt : null };
      }
      const wait = hall.frame?.rotatesAt ? new Date(hall.frame.rotatesAt).getTime() - Date.now() + 50 : 10_000;
      await sleep(Math.max(500, Math.min(wait, 10_000)));
    }
  }
  async function lecturerScreen(hall: Hall) {
    while (running) {
      await call('lecturer: live list', 'GET', `/api/v1/lecture/sessions/${hall.id}`, { cookie: hall.cookie });
      await sleep(4_000);
    }
  }
  const background = hallList.flatMap((hall) => [projector(hall), lecturerScreen(hall)]);
  while (hallList.some((hall) => !hall.frame)) await sleep(50);

  /* ---------- the phones ---------- */
  const before = await Promise.all(instances.map((instance) => instanceStats(instance)));
  const failures: { step: string; status: number; detail: unknown }[] = [];
  let checkedIn = 0;
  let phoneRetriesUsed = 0;
  const started = performance.now();

  async function phone(student: Student) {
    const wait = student.arriveAt - (performance.now() - started);
    if (wait > 0) await sleep(wait);
    const hall = hallList[student.hall]!;
    const whole = performance.now();
    const cookie = student.signsInHere ? undefined : student.cookie;
    let resolved = await call('1 scan (resolve)', 'POST', '/api/v1/lecture/resolve', { body: { challenge: hall.frame!.challenge }, ...(cookie ? { cookie } : {}) });
    if (resolved.status === 410) resolved = await call('1 scan (resolve)', 'POST', '/api/v1/lecture/resolve', { body: { challenge: hall.frame!.challenge }, ...(cookie ? { cookie } : {}) });
    if (resolved.status !== 200 || !resolved.json) {
      failures.push({ step: 'resolve', status: resolved.status, detail: resolved.json?.detail });
      return;
    }
    const ticket = String(resolved.json.ticket);
    const face = resolved.json.face as { required?: boolean; turn?: 'left' | 'right' } | undefined;
    if (faceOn && cookie) void call('2 camera opens (face/warm)', 'POST', '/api/v1/students/me/face/warm', { cookie, body: {} });
    await sleep(student.captureMs);
    const body = {
      ticket,
      deviceToken: student.deviceToken,
      ...(student.signsInHere ? { signIn: { identifier: student.email, password } } : {}),
      ...(faceOn && face?.required
        ? { face: { frames: [{ pose: 'front', image: front }, { pose: face.turn ?? 'right', image: face.turn === 'left' ? left : right }] } }
        : {}),
    };
    const submitWhole = performance.now();
    let result = await call('3 check-in (photos)', 'POST', '/api/v1/lecture/check-in', { body, ...(cookie ? { cookie } : {}) });
    // What the phone now does by itself (apps/web/lib/lecture-api.ts,
    // checkInRetryDelay): "busy" (503 with Retry-After) waits as told, or
    // longer each time it hears "busy" again (3 s growing by half up to 30 s),
    // plus up to a quarter at random, and keeps trying for up to three minutes;
    // cut off, a gateway error or no answer is tried again at most three times.
    let otherFailures = 0;
    let busyAnswers = 0;
    for (let attempt = 1; phoneRetries; attempt += 1) {
      const retryAfter = Number(result.headers.get('retry-after'));
      const busy = result.status === 503 && Number.isFinite(retryAfter) && retryAfter > 0;
      if (!busy && ![0, 502, 503, 504].includes(result.status)) break;
      if (!busy) otherFailures += 1;
      if (otherFailures > 3) break;
      if (busy) busyAnswers += 1;
      const delay = busy
        ? Math.max(Math.min(retryAfter, 60), Math.min(30, 3 * 1.5 ** (busyAnswers - 1))) * 1000 * (1 + Math.random() * 0.25)
        : [2, 4, 8][otherFailures - 1]! * 1000 + Math.random() * 1000;
      if (performance.now() - submitWhole + delay > RETRY_WINDOW_MS) break;
      phoneRetriesUsed += 1;
      await sleep(delay);
      result = await call('3 check-in (phone retry)', 'POST', '/api/v1/lecture/check-in', { body, ...(cookie ? { cookie } : {}) });
    }
    if (result.status !== 201 && !(result.status === 200 && result.json?.status === 'already_checked_in')) {
      failures.push({ step: 'check-in', status: result.status, detail: result.json?.detail ?? result.json?.title });
      return;
    }
    checkedIn += 1;
    record('submit to saved (incl. phone retries)', performance.now() - submitWhole, result.status, 'saved');
    record('scan to saved (incl. taking photos)', performance.now() - whole, result.status, 'saved');
    if (student.sendsTwice) {
      const again = await call('4 sent twice (flaky network)', 'POST', '/api/v1/lecture/check-in', { body, ...(cookie ? { cookie } : {}) });
      // Busy (503) is fine here: the phone would send it again later. What matters is no second entry (see integrity).
      if (again.status !== 503 && (again.status !== 200 || again.json?.status !== 'already_checked_in')) failures.push({ step: 'sent twice', status: again.status, detail: again.json?.detail ?? again.json?.status });
    }
  }

  console.error(`Rush: ${students.length} students arriving over ${spreadMs / 1000} s, face check ${faceOn ? 'on' : 'off'}, phone retries ${phoneRetries ? 'on' : 'off'}…`);
  // Face queue figures once a second: the longest line and the per-photo time under load.
  const faceLine = { peakWaiting: 0, peakWaitingPhotos: 0, photoMsSamples: [] as number[] };
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      await sleep(1_000);
      for (const figures of await Promise.all(instances.map((instance) => instanceStats(instance)))) {
        if (!figures.face) continue;
        faceLine.peakWaiting = Math.max(faceLine.peakWaiting, figures.face.waiting);
        faceLine.peakWaitingPhotos = Math.max(faceLine.peakWaitingPhotos, figures.face.waitingPhotos);
        if (figures.face.waiting > 0) faceLine.photoMsSamples.push(figures.face.photoMilliseconds);
      }
    }
  })();
  await Promise.all(students.map(phone));
  sampling = false;
  await sampler;
  const wallMs = performance.now() - started;
  const after = await Promise.all(instances.map((instance) => instanceStats(instance)));
  running = false;
  await Promise.allSettled(background);

  /* ---------- integrity, straight from the database ---------- */
  const integrity = [];
  for (const hall of hallList) {
    const [row] = await one<{ total: number; distinct_students: number; face_checks: number }>(sql`
      SELECT count(*)::int AS total, count(DISTINCT student_user_id)::int AS distinct_students,
             (SELECT count(*)::int FROM lecture_face_checks WHERE lecture_session_id = ${hall.id}) AS face_checks
      FROM lecture_attendance WHERE lecture_session_id = ${hall.id} AND removed_at IS NULL`);
    const view = await call('lecturer: final list', 'GET', `/api/v1/lecture/sessions/${hall.id}`, { cookie: hall.cookie });
    integrity.push({
      session: hall.courseCode,
      students: perHall,
      stored: row?.total ?? 0,
      distinctStudents: row?.distinct_students ?? 0,
      duplicates: (row?.total ?? 0) - (row?.distinct_students ?? 0),
      faceChecksStored: row?.face_checks ?? 0,
      lecturerSees: (view.json?.presentCount as number | undefined) ?? (view.json?.session as { presentCount?: number } | undefined)?.presentCount ?? null,
    });
  }

  stopInstances(instances);
  await database.close();

  const serverCpuMs = after.reduce((sum, stats, index) => sum + stats.cpuMs - before[index]!.cpuMs, 0);
  const report = {
    note: 'Production wiring (createApiApplication, serverless pool, real face models) on this computer; each instance is one process like one warm Vercel function instance.',
    ranAt: new Date().toISOString(),
    node: process.version,
    cpus: (await import('node:os')).cpus().length,
    settings: {
      halls, studentsPerHall: perHall, totalStudents: students.length, arrivalsOverSeconds: spreadMs / 1000,
      instances: instanceCount, poolPerInstance: poolMax, faceCheck: faceOn, captureSeconds: options['capture-seconds'],
      signInOnClassmatesPhone: signInShare, sentTwice: retryShare, phoneRetries, faceQueueBudgetMs: faceBudget,
      rateLimitStore: rateLimits, oneClientAddress: true,
    },
    seedSeconds: Number((seedMs / 1000).toFixed(1)),
    wallSeconds: Number((wallMs / 1000).toFixed(1)),
    checkedIn,
    lost: students.length - checkedIn,
    phoneRetriesUsed,
    steps: recorder.report(),
    server: {
      cpuSeconds: Number((serverCpuMs / 1000).toFixed(1)),
      cpuMsPerCheckIn: checkedIn ? Math.round(serverCpuMs / checkedIn) : null,
      peakRssMbPerInstance: after.map((stats) => stats.peakRssMb),
      faceQueue: faceOn
        ? {
            peakWaitingPerInstance: faceLine.peakWaiting,
            peakWaitingPhotosPerInstance: faceLine.peakWaitingPhotos,
            photoMsUnderLoad: faceLine.photoMsSamples.length ? Math.round(faceLine.photoMsSamples.reduce((sum, value) => sum + value, 0) / faceLine.photoMsSamples.length) : null,
            completed: after.reduce((sum, stats, index) => sum + (stats.face?.completed ?? 0) - (before[index]!.face?.completed ?? 0), 0),
            turnedAway: after.reduce((sum, stats, index) => sum + (stats.face?.turnedAway ?? 0) - (before[index]!.face?.turnedAway ?? 0), 0),
          }
        : null,
    },
    failures: { count: failures.length, sample: failures.slice(0, 12) },
    integrity,
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (options.output) await writeFile(options.output, `${text}\n`);
  const healthy = integrity.every((hall) => hall.duplicates === 0 && hall.stored === hall.distinctStudents)
    && report.lost === 0;
  if (!healthy) {
    console.error('Not everyone was stored exactly once: see "lost", "failures" and "integrity".');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(), 1_000).unref());
