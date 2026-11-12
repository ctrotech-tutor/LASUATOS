/**
 * One-command load test that needs no Docker, no database server and no
 * email: it starts the real API (same services and routes as production) on a
 * loopback port, backed by embedded PostgreSQL (PGlite), seeds a synthetic
 * class, and fires every student's check-in at once over real HTTP.
 *
 *   pnpm load:embedded                      # 300 students, 100 in flight
 *   pnpm load:embedded -- --students 600 --concurrency 200
 *
 * What the numbers mean: PGlite is a single-connection, in-process WebAssembly
 * build of PostgreSQL, so every query is serialised. Results therefore show
 * the application's own overhead and correctness under a burst (no duplicate
 * or lost records, sensible status codes) on the machine you run it on. They
 * are NOT a capacity figure for Vercel + Neon; see docs/LOAD_TESTING.md.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { createOpaqueToken, hashOpaqueToken } from '@lasuatos/auth';
import type { DatabaseClient } from '@lasuatos/database';
import { drizzle } from 'drizzle-orm/pglite';
import { PostgresAttendanceRepository } from '../attendance/postgres-repository.js';
import { AttendanceService } from '../attendance/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { StudentAuthService } from '../auth/service.js';
import { applyMigrations, ids, INSTITUTION_SLUG, LECTURER_EMAIL, LECTURER_PASSWORD, seedLecturerFixture } from '../e2e/harness.js';
import { PostgresCourseEnrollmentRepository } from '../enrollment/postgres-repository.js';
import { CourseEnrollmentService } from '../enrollment/service.js';
import { buildServer } from '../server.js';

interface Sample { readonly ms: number; readonly status: number; readonly outcome: string }

const { values } = parseArgs({
  options: {
    students: { type: 'string', default: '300' },
    concurrency: { type: 'string', default: '100' },
    'qr-share': { type: 'string', default: '0.5' },
  },
  allowPositionals: true,
});
const studentCount = Math.max(1, Math.min(5000, Number(values.students)));
const concurrency = Math.max(1, Math.min(1000, Number(values.concurrency)));
const qrShare = Math.max(0, Math.min(1, Number(values['qr-share'])));

function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!);
}

function summarize(name: string, samples: readonly Sample[], wallMs?: number) {
  const latencies = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const outcomes: Record<string, number> = {};
  for (const sample of samples) outcomes[`${sample.status} ${sample.outcome}`] = (outcomes[`${sample.status} ${sample.outcome}`] ?? 0) + 1;
  return {
    name,
    requests: samples.length,
    outcomes,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies.length ? Math.round(latencies.at(-1)!) : null,
    ...(wallMs ? { wallMs: Math.round(wallMs), throughputPerSecond: Math.round((samples.length / wallMs) * 1000) } : {}),
  };
}

async function pool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<Sample>): Promise<Sample[]> {
  const results: Sample[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++]!;
      results.push(await run(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const setupStarted = performance.now();
  const client = new PGlite();
  await applyMigrations(client);
  await seedLecturerFixture(client);
  const database = drizzle(client) as unknown as DatabaseClient;
  const server = buildServer({
    logger: false,
    secureCookies: false,
    auth: new StudentAuthService({
      repository: new PostgresAuthRepository(database),
      emailTransport: {
        sendVerification: async () => undefined,
        sendPasswordReset: async () => undefined,
        sendSecurityNotice: async () => undefined,
        sendStaffInvitation: async () => undefined,
      },
      institutionSlug: INSTITUTION_SLUG,
    }),
    courseEnrollment: new CourseEnrollmentService({ repository: new PostgresCourseEnrollmentRepository(database) }),
    attendance: new AttendanceService({ repository: new PostgresAttendanceRepository(database) }),
  });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

  async function call(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
    const started = performance.now();
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    const ms = performance.now() - started;
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON */ }
    return { response, json, ms };
  }

  try {
    // Lecturer signs in over HTTP (exercises the real password check once).
    const login = await call('/api/v1/auth/login', { method: 'POST', body: { email: LECTURER_EMAIL, password: LECTURER_PASSWORD } });
    const cookieHeader = login.response.headers.get('set-cookie') ?? '';
    const lecturerCookie = /lasuatos_session=[A-Za-z0-9_-]{43}/.exec(cookieHeader)?.[0];
    if (!lecturerCookie) throw new Error(`Lecturer sign-in failed with ${login.response.status}.`);

    const offering = await call('/api/v1/lecturer/course-offerings', {
      method: 'POST',
      cookie: lecturerCookie,
      body: { courseCode: 'LOAD-101', courseTitle: 'Load Test Course', creditUnits: 2, semesterId: ids.semester, level: '100' },
    });
    const courseOfferingId = String((offering.json.course as Record<string, unknown> | undefined)?.courseOfferingId ?? '');
    if (!/^[0-9a-f-]{36}$/.test(courseOfferingId)) throw new Error(`Creating the course failed with ${offering.response.status}.`);

    // Synthetic students with sessions created directly, so the burst measures
    // check-in rather than deliberately slow password hashing.
    const students: { readonly id: string; readonly cookie: string; readonly deviceToken: string }[] = [];
    for (let index = 0; index < studentCount; index += 1) {
      const id = randomUUID();
      const token = createOpaqueToken();
      const serial = String(index + 1).padStart(4, '0');
      await client.query(
        `INSERT INTO users (id, institution_id, email, display_name, status, email_verified_at)
         VALUES ($1, $2, $3, $4, 'active', now())`,
        [id, ids.institution, `load-student-${serial}@load-test.invalid`, `Load Test Student ${serial}`],
      );
      await client.query(
        'INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ($1, $2, $3, $4)',
        [id, ids.institution, ids.department, `26059${serial}`],
      );
      await client.query(
        "INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'student', 'institution', $2)",
        [id, ids.institution],
      );
      await client.query(
        "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')",
        [id, hashOpaqueToken(token)],
      );
      await client.query(
        "INSERT INTO course_enrollments (institution_id, course_offering_id, student_user_id, status) VALUES ($1, $2, $3, 'active')",
        [ids.institution, courseOfferingId, id],
      );
      students.push({ id, cookie: `lasuatos_session=${token}`, deviceToken: `load-device-${id.replaceAll('-', '')}`.slice(0, 64) });
    }

    const opened = await call('/api/v1/lecturer/attendance-sessions', {
      method: 'POST',
      cookie: lecturerCookie,
      body: { courseOfferingId, title: 'Load burst', durationMinutes: 30 },
    });
    if (opened.response.status !== 201) throw new Error(`Opening the session failed with ${opened.response.status}.`);
    const code = String(opened.json.code);
    const sessionId = String((opened.json.session as Record<string, unknown>).id);
    const setupMs = performance.now() - setupStarted;

    // The projector polls the QR every few seconds; students scan whatever is showing.
    const qr = await call(`/api/v1/lecturer/attendance-sessions/${sessionId}/qr`, { cookie: lecturerCookie });
    let challenge = String(qr.json.challenge);
    const qrTimer = setInterval(() => {
      void call(`/api/v1/lecturer/attendance-sessions/${sessionId}/qr`, { cookie: lecturerCookie })
        .then((next) => { if (typeof next.json.challenge === 'string') challenge = next.json.challenge; })
        .catch(() => undefined);
    }, 5_000);

    const checkIn = async (student: (typeof students)[number], index: number): Promise<Sample> => {
      const useQr = index < Math.round(studentCount * qrShare);
      const result = await call('/api/v1/student/attendance/check-in', {
        method: 'POST',
        cookie: student.cookie,
        body: useQr ? { challenge, deviceToken: student.deviceToken } : { code },
      });
      return { ms: result.ms, status: result.response.status, outcome: String(result.json.status ?? result.json.title ?? '') };
    };

    const burstStarted = performance.now();
    const burst = await pool(students.map((student, index) => ({ student, index })), concurrency, ({ student, index }) => checkIn(student, index));
    const burstMs = performance.now() - burstStarted;

    // Everyone retries at once (a flaky network makes phones resend).
    const retryStarted = performance.now();
    const retries = await pool(students.map((student, index) => ({ student, index })), concurrency, ({ student, index }) => checkIn(student, index));
    const retryMs = performance.now() - retryStarted;
    clearInterval(qrTimer);

    // The lecturer's live roster and the report, read after the burst.
    const roster = await call(`/api/v1/lecturer/attendance-sessions/${sessionId}`, { cookie: lecturerCookie });
    const report = await call(`/api/v1/lecturer/course-offerings/${courseOfferingId}/attendance-report`, { cookie: lecturerCookie });
    const close = await call(`/api/v1/lecturer/attendance-sessions/${sessionId}/close`, { method: 'POST', cookie: lecturerCookie });

    const counts = await client.query<{ total: number; distinct_students: number }>(
      'SELECT count(*)::int AS total, count(DISTINCT student_user_id)::int AS distinct_students FROM attendance_records WHERE attendance_session_id = $1',
      [sessionId],
    );
    const row = counts.rows[0]!;
    const checkedIn = burst.filter((sample) => sample.status === 200 && sample.outcome === 'checked_in').length;
    const result = {
      note: 'Embedded PostgreSQL (PGlite, single connection, in-process). Not a capacity figure for Vercel + Neon.',
      ranAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      students: studentCount,
      concurrency,
      qrShare,
      setupMs: Math.round(setupMs),
      burst: summarize('first check-in burst', burst, burstMs),
      retry: summarize('immediate retry burst', retries, retryMs),
      reads: {
        rosterMs: Math.round(roster.ms),
        rosterStatus: roster.response.status,
        rosterAttendees: Array.isArray(roster.json.attendees) ? roster.json.attendees.length : null,
        reportMs: Math.round(report.ms),
        reportStatus: report.response.status,
        closeStatus: close.response.status,
      },
      integrity: {
        recordsStored: row.total,
        distinctStudents: row.distinct_students,
        acceptedFirstTime: checkedIn,
        duplicates: row.total - row.distinct_students,
        lost: checkedIn - row.total,
      },
    };
    console.log(JSON.stringify(result, null, 2));
    const healthy = result.integrity.duplicates === 0 && result.integrity.lost === 0 && checkedIn === studentCount;
    if (!healthy) {
      console.error('Integrity check failed: every student should be stored exactly once.');
      process.exitCode = 1;
    }
  } finally {
    await server.close();
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
