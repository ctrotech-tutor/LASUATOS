#!/usr/bin/env node
// Simulates one class checking in at the same moment, against a NON-PRODUCTION
// LASUATOS stack, and reports latency percentiles and status counts.
//
// Nothing in this repository has been measured with it yet; numbers it prints
// describe only the machine, network and data it was run against. See
// docs/LOAD_TESTING.md for the plan, targets and how to read results.
//
// Prerequisites: a running stack (web + API + PostgreSQL), the local demo
// lecturer, and synthetic students from packages/database/scripts/seed-load-fixture.mjs.
//
//   BASE_URL=http://localhost:3000 LECTURER_EMAIL=... LECTURER_PASSWORD=... \
//   LOAD_COURSE_OFFERING_ID=<uuid> LOAD_STUDENTS=300 LOAD_STUDENT_PASSWORD=... \
//   node scripts/load/check-in-burst.mjs
//
// Options (env): CONCURRENCY (in-flight requests, default 100), LOGIN_CONCURRENCY
// (default 10; password hashing is deliberately slow), ALLOW_REMOTE=yes to target a
// non-loopback staging host. Rate limits will reject a single-machine burst of
// sign-ins: measure capacity with RATE_LIMIT_STORE=off on staging, then re-run
// with limits on to confirm 429 behaviour.

import { performance } from 'node:perf_hooks';

const env = process.env;
const baseUrl = new URL(env.BASE_URL ?? 'http://localhost:3000');
const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(baseUrl.hostname);
if (!loopback && env.ALLOW_REMOTE !== 'yes') {
  console.error('Refusing to target a non-loopback host. Set ALLOW_REMOTE=yes for a staging environment you control. Never run this against production.');
  process.exit(1);
}

const required = ['LECTURER_EMAIL', 'LECTURER_PASSWORD', 'LOAD_COURSE_OFFERING_ID', 'LOAD_STUDENT_PASSWORD'];
const missing = required.filter((name) => !env[name]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}.`);
  process.exit(1);
}

const studentCount = Number(env.LOAD_STUDENTS ?? '300');
const concurrency = Number(env.CONCURRENCY ?? '100');
const loginConcurrency = Number(env.LOGIN_CONCURRENCY ?? '10');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
}

function summarize(name, samples) {
  const latencies = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const statuses = {};
  for (const sample of samples) statuses[sample.status] = (statuses[sample.status] ?? 0) + 1;
  return {
    name,
    requests: samples.length,
    statuses,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies.length ? Math.round(latencies[latencies.length - 1]) : null,
  };
}

async function request(path, { method = 'GET', cookie, body } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        // No Origin/Sec-Fetch-Site: this is a server-side client, which the
        // cross-origin guard treats as carrying no ambient browser credentials.
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, ms: performance.now() - started, headers: response.headers, text };
  } catch {
    return { status: 'network_error', ms: performance.now() - started, headers: new Headers(), text: '' };
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function cookieFrom(result) {
  const match = /lasuatos_session=([A-Za-z0-9_-]{43})/.exec(result.headers.get('set-cookie') ?? '');
  return match ? `lasuatos_session=${match[1]}` : null;
}

const lecturerLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  body: { email: env.LECTURER_EMAIL, password: env.LECTURER_PASSWORD },
});
const lecturer = cookieFrom(lecturerLogin);
if (!lecturer) {
  console.error(`Lecturer sign-in failed (HTTP ${lecturerLogin.status}).`);
  process.exit(1);
}

const students = Array.from({ length: studentCount }, (_, index) => `load-student-${String(index + 1).padStart(4, '0')}@load-test.invalid`);
const logins = await pool(students, loginConcurrency, (email) => request('/api/v1/auth/login', {
  method: 'POST',
  body: { email, password: env.LOAD_STUDENT_PASSWORD },
}));
const cookies = logins.map(cookieFrom).filter(Boolean);
if (!cookies.length) {
  console.error('No student could sign in. Run the load fixture seeder first, and check rate limits.');
  process.exit(1);
}

const opened = await request('/api/v1/lecturer/attendance-sessions', {
  method: 'POST',
  cookie: lecturer,
  body: { courseOfferingId: env.LOAD_COURSE_OFFERING_ID, title: `Load test ${new Date().toISOString()}`, durationMinutes: 15 },
});
if (opened.status !== 201) {
  console.error(`Could not open an attendance session (HTTP ${opened.status}). Close any open session for this offering first.`);
  process.exit(1);
}
const { code, session } = JSON.parse(opened.text);

const burstStarted = performance.now();
const checkIns = await pool(cookies, concurrency, (cookie) => request('/api/v1/student/attendance/check-in', {
  method: 'POST',
  cookie,
  body: { code },
}));
const burstSeconds = (performance.now() - burstStarted) / 1_000;

const sessionReads = await pool(cookies, concurrency, (cookie) => request('/api/v1/auth/session', { cookie }));
const roster = await request(`/api/v1/lecturer/attendance-sessions/${session.id}`, { cookie: lecturer });
await request(`/api/v1/lecturer/attendance-sessions/${session.id}/close`, { method: 'POST', cookie: lecturer });

let rosterCount = null;
try {
  rosterCount = JSON.parse(roster.text).attendees?.length ?? null;
} catch {
  // reported as null
}

console.log(JSON.stringify({
  note: 'Measured only on the target below at the time shown; not a capacity claim for any other environment.',
  target: baseUrl.origin,
  measuredAt: new Date().toISOString(),
  studentsRequested: studentCount,
  studentsSignedIn: cookies.length,
  concurrency,
  checkInBurstSeconds: Number(burstSeconds.toFixed(2)),
  checkInThroughputPerSecond: Number((checkIns.length / burstSeconds).toFixed(1)),
  rosterAttendees: rosterCount,
  results: [
    summarize('student sign-in', logins),
    summarize('check-in burst', checkIns),
    summarize('session read', sessionReads),
  ],
}, null, 2));
