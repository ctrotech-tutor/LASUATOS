// Crowd test for QR attendance: several lecture halls open sessions at the same
// time and every student scans and submits within a short window, the busiest
// moment the site will see (8 a.m. on a weekday).
//
// It drives the real public API over HTTP exactly as phones do:
//   resolve (scan or typed code) → check-in (name, matric, device token)
// while each lecturer's screen polls the live list every 4 s and the projector
// fetches the next rotating QR frame. Afterwards it retries some check-ins
// (must be idempotent), checks every hall's count, and deletes the test
// sessions it created.
//
//   pnpm load:lecture                        (reads .env, finds LASUATOS on this computer)
//   HALLS=6 STUDENTS=300 SPREAD_SECONDS=90 pnpm load:lecture
//   Windows PowerShell: $env:HALLS=6; pnpm load:lecture
//
// Before it sends anything it checks that the address really is LASUATOS (its
// /api/v1/health answers "lasuatos-api") and that the database is up to date, so it
// never posts to some other app that happens to use the same port.
//
// Settings (environment, or .env in the repository root):
//   BASE_URL           site to test. If unset, it tries PUBLIC_APP_URL from .env, then
//                      http://localhost:3000 to :3003, and uses the first that is
//                      LASUATOS. Non-loopback targets need ALLOW_REMOTE=yes. Never point
//                      this at the live site during lectures: it creates real sessions.
//   LECTURER_EMAIL     an account that may open sessions (default: the local demo
//                      lecturer, lecturer@lasuatos.example.net).
//   LECTURER_PASSWORD  its password (default: LOCAL_DEMO_LECTURER_PASSWORD from .env;
//                      pnpm dev:setup prints a generated one if that is empty).
//   HALLS              sessions open at the same time (default 3).
//   STUDENTS           students per hall (default 300).
//   CONCURRENCY        requests in flight from this machine (default 150).
//   SPREAD_SECONDS     arrivals spread over this many seconds (default 60; 0 = all at once).
//   QR_MODE            dynamic (rotating QR, default) or static (printed poster).
//   TYPED_SHARE        share of students who type the code instead of scanning (default 0.1).
//   RETRY_SHARE        share who submit twice, as on a flaky network (default 0.1).
//   SAME_ADDRESS       yes (default on loopback): every request carries one client
//                      address, like a whole campus behind one Wi-Fi NAT. Only honoured
//                      where the app reads x-real-ip from the request (local embedded mode).
//   KEEP_SESSIONS      yes to keep the sessions instead of deleting them.
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const env = process.env;
const trimSlash = (value) => String(value).trim().replace(/\/+$/, '');
const isLoopback = (url) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(url);
const BASE = await findSite();
const HALLS = clampInt(env.HALLS, 3, 1, 50);
const STUDENTS = clampInt(env.STUDENTS, 300, 1, 5000);
const CONCURRENCY = clampInt(env.CONCURRENCY, 150, 1, 2000);
const SPREAD_MS = clampInt(env.SPREAD_SECONDS, 60, 0, 1800) * 1000;
const QR_MODE = env.QR_MODE === 'static' ? 'static' : 'dynamic';
const TYPED_SHARE = clampNumber(env.TYPED_SHARE, 0.1);
const RETRY_SHARE = clampNumber(env.RETRY_SHARE, 0.1);
const loopback = isLoopback(BASE);
const SAME_ADDRESS = (env.SAME_ADDRESS ?? (loopback ? 'yes' : 'no')) === 'yes';
const CAMPUS_ADDRESS = '203.0.113.10';

if (!loopback && env.ALLOW_REMOTE !== 'yes') {
  console.error(`Refusing to load-test ${BASE}. Set ALLOW_REMOTE=yes for a staging site you own (never the live site during lectures).`);
  process.exit(2);
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value ?? '', 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function clampNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stops with a plain explanation (no stack trace, no HTML dump). */
function fail(lines) {
  console.error(['', ...[lines].flat(), ''].join('\n'));
  process.exit(1);
}

/** A short, readable summary of a response body: a JSON message, an HTML page title, or the start of the text. */
function describeBody(text) {
  try {
    const json = JSON.parse(text);
    return String(json.detail ?? json.message ?? json.title ?? json.error ?? JSON.stringify(json)).slice(0, 200);
  } catch {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
    if (title) return `a web page titled "${title}"`;
    return text.replace(/\s+/g, ' ').trim().slice(0, 120) || '(empty)';
  }
}

/**
 * What answers at this address: 'lasuatos' (with the health JSON), 'other' (some other
 * app, with a description) or 'none' (nothing listening).
 */
async function probe(base) {
  try {
    const response = await fetch(`${base}/api/v1/health`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (json?.service === 'lasuatos-api') return { kind: 'lasuatos', ok: response.ok && json.status === 'ok' };
    return { kind: 'other', what: `HTTP ${response.status}, ${describeBody(text)}` };
  } catch (error) {
    return { kind: 'none', what: error?.cause?.code ?? error?.name ?? 'no answer' };
  }
}

async function findSite() {
  if (env.BASE_URL?.trim()) {
    const base = trimSlash(env.BASE_URL);
    const found = await probe(base);
    if (found.kind === 'lasuatos') return base;
    fail(found.kind === 'none'
      ? [`Nothing is answering at ${base} (${found.what}).`, 'Start LASUATOS first (see "Running it on your computer" in docs/LOAD_TESTING.md), or fix BASE_URL.']
      : [`${base} is not LASUATOS: /api/v1/health answered with ${found.what}.`,
        'Another app is probably using that port. Nothing was sent to it.',
        'Stop that app, or point BASE_URL at the address LASUATOS printed when it started.']);
  }
  const candidates = [...new Set([
    ...(env.PUBLIC_APP_URL && isLoopback(trimSlash(env.PUBLIC_APP_URL)) ? [trimSlash(env.PUBLIC_APP_URL)] : []),
    'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003',
  ])];
  const seen = [];
  for (const base of candidates) {
    const found = await probe(base);
    if (found.kind === 'lasuatos') {
      if (base !== candidates[0]) console.error(`Found LASUATOS at ${base}.`);
      return base;
    }
    seen.push(`  ${base}: ${found.kind === 'none' ? `nothing listening (${found.what})` : `another app (${found.what})`}`);
  }
  fail([
    'Could not find LASUATOS running on this computer, so nothing was sent anywhere.',
    ...seen,
    '',
    'Start it first, in another terminal:',
    '  copy .env.example to .env, then pnpm dev:setup   (once; needs Docker Desktop)',
    '  pnpm dev           (wait until it says Ready)',
    'If another app already uses port 3000, Next.js moves LASUATOS to the next free port and',
    'prints it ("using available port 3001"); this script looks there too. Otherwise set BASE_URL.',
  ]);
}

/** The database must be reachable and up to date, or every check-in would fail. */
async function checkReady() {
  try {
    const response = await fetch(`${BASE}/api/v1/ready`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (response.ok) return;
    const json = await response.json().catch(() => null);
    if (json?.checks?.database === 'down') fail([`LASUATOS at ${BASE} cannot reach its database.`, 'Start it (Docker Desktop, then docker compose up -d) and try again.']);
    if (json?.checks?.schema === 'behind') fail([`The database behind ${BASE} is missing migrations.`, 'Run: pnpm db:migrate   then restart pnpm dev and try again.']);
    fail(`LASUATOS at ${BASE} is not ready (HTTP ${response.status}).`);
  } catch (error) {
    fail(`LASUATOS at ${BASE} did not answer its readiness check (${error?.name ?? error}).`);
  }
}

// ---------------------------------------------------------------- HTTP + stats
const samples = new Map();
function record(step, ms, status, outcome) {
  if (!samples.has(step)) samples.set(step, []);
  samples.get(step).push({ ms, status, outcome });
}

async function call(step, method, path, { body, cookie } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(SAME_ADDRESS ? { 'x-real-ip': CAMPUS_ADDRESS } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const status = response.status;
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const outcome = json?.status ?? (response.ok ? 'ok' : (json?.detail ?? json?.title ?? `http_${status}`));
    record(step, performance.now() - started, status, String(outcome).slice(0, 80));
    return { status, json, headers: response.headers };
  } catch (error) {
    record(step, performance.now() - started, 0, error?.name === 'TimeoutError' ? 'timeout' : 'network_error');
    return { status: 0, json: null, headers: new Headers() };
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
}
function summarize(step) {
  const list = samples.get(step) ?? [];
  const latencies = list.map((sample) => sample.ms).sort((a, b) => a - b);
  const outcomes = {};
  for (const sample of list) outcomes[`${sample.status} ${sample.outcome}`] = (outcomes[`${sample.status} ${sample.outcome}`] ?? 0) + 1;
  return {
    requests: list.length,
    outcomes,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies.length ? Math.round(latencies.at(-1)) : null,
  };
}

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------- the lecture
async function signIn() {
  const email = env.LECTURER_EMAIL?.trim() || 'lecturer@lasuatos.example.net';
  const password = env.LECTURER_PASSWORD || env.LOCAL_DEMO_LECTURER_PASSWORD || 'demo-password-123';
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(SAME_ADDRESS ? { 'x-real-ip': '198.51.100.99' } : {}) },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(30_000),
  }).catch((error) =>
    fail([
      `Signing in at ${BASE} got no answer (${error?.name === 'TimeoutError' ? 'no reply within 30 seconds' : error?.message ?? error}).`,
      'Check the terminal running pnpm dev for errors (often the database), then try again.',
    ]),
  );
  if (!response.ok) {
    const reason = describeBody(await response.text());
    if (response.status === 401 || response.status === 400 || response.status === 403) {
      fail([
        `Signing in as ${email} was refused (HTTP ${response.status}: ${reason}).`,
        'Use an account that can take attendance:',
        '  - the local demo lecturer: its password is LOCAL_DEMO_LECTURER_PASSWORD in .env, or the one',
        '    pnpm dev:setup printed if that was empty; or',
        '  - any lecturer: set LECTURER_EMAIL and LECTURER_PASSWORD.',
        'PowerShell: $env:LECTURER_PASSWORD="..."; pnpm load:lecture',
      ]);
    }
    if (response.status === 429) fail(['Too many sign-in attempts from this computer; wait 15 minutes, or clear the local limits:', '  docker compose exec postgres psql -U lasuatos_dev -d lasuatos_dev -c "DELETE FROM rate_limit_counters;"']);
    fail(`Lecturer sign-in failed (HTTP ${response.status}: ${reason}).`);
  }
  return response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
}

const runId = randomBytes(2).toString('hex').toUpperCase();
await checkReady();
console.error(`Crowd test against ${BASE}: ${HALLS} hall(s) × ${STUDENTS} students, ${QR_MODE} QR, arrivals over ${SPREAD_MS / 1000} s…`);
const cookie = await signIn();
const halls = [];
for (let index = 0; index < HALLS; index += 1) {
  const created = await call('lecturer: open session', 'POST', '/api/v1/lecture/sessions', {
    cookie,
    body: { courseCode: `LOD ${String(100 + index)}`, courseTitle: `Crowd test ${runId} hall ${index + 1}`, durationMinutes: 60, qrMode: QR_MODE },
  });
  if (created.status !== 201) throw new Error(`Could not open a session (${created.status}): ${JSON.stringify(created.json)}`);
  halls.push({ id: created.json.id, courseCode: created.json.courseCode, frame: null });
}

// Projector: keep each hall's current QR frame, refreshing when it rotates.
let running = true;
async function projector(hall) {
  while (running) {
    const frame = await call('projector: QR frame', 'GET', `/api/v1/lecture/sessions/${hall.id}/qr`, { cookie });
    if (frame.status === 200) hall.frame = frame.json;
    const wait = hall.frame?.rotatesAt ? Math.max(500, new Date(hall.frame.rotatesAt).getTime() - Date.now() + 50) : 15_000;
    await sleep(Math.min(wait, 15_000));
  }
}
// Lecturer's screen: the live list refreshes every 4 seconds while open.
async function lecturerScreen(hall) {
  while (running) {
    await call('lecturer: live list', 'GET', `/api/v1/lecture/sessions/${hall.id}`, { cookie });
    await sleep(4_000);
  }
}
const background = halls.flatMap((hall) => [projector(hall), lecturerScreen(hall)]);
while (halls.some((hall) => !hall.frame)) await sleep(100);

// Students: everyone in every hall, arriving over SPREAD_SECONDS.
const students = [];
for (const [hallIndex, hall] of halls.entries()) {
  for (let index = 0; index < STUDENTS; index += 1) {
    const serial = hallIndex * STUDENTS + index;
    students.push({
      hall,
      fullName: `Load Student ${runId} ${String(serial).padStart(4, '0')}`,
      // 9 digits like a LASU matric: 2-digit year + 4-digit programme + 3-digit serial (made unique per run).
      matricNumber: `9${String(Number.parseInt(runId, 16) % 10)}${String(serial).padStart(7, '0')}`,
      deviceToken: randomBytes(16).toString('base64url'),
      typed: Math.random() < TYPED_SHARE,
      retry: Math.random() < RETRY_SHARE,
      arriveAt: SPREAD_MS ? Math.random() * SPREAD_MS : 0,
    });
  }
}
students.sort((a, b) => a.arriveAt - b.arriveAt);

function resolveBody(student) {
  const frame = student.hall.frame;
  if (frame.mode === 'static') return { code: frame.code, scanned: !student.typed };
  if (student.typed) return { code: frame.code };
  return { challenge: frame.path.split('#')[1] };
}

const started = performance.now();
const failures = [];
await pool(students, CONCURRENCY, async (student) => {
  const wait = student.arriveAt - (performance.now() - started);
  if (wait > 0) await sleep(wait);
  const totalStarted = performance.now();
  let resolved = await call('student: scan/resolve', 'POST', '/api/v1/lecture/resolve', { body: resolveBody(student) });
  // A rotating code can change between reading it and sending it; phones simply scan again.
  if (resolved.status === 410 || (resolved.status === 404 && student.typed)) {
    resolved = await call('student: scan/resolve (again)', 'POST', '/api/v1/lecture/resolve', { body: resolveBody(student) });
  }
  if (resolved.status !== 200) {
    failures.push({ step: 'resolve', status: resolved.status, detail: resolved.json?.detail });
    return;
  }
  const body = { ticket: resolved.json.ticket, fullName: student.fullName, matricNumber: student.matricNumber, deviceToken: student.deviceToken };
  const checkIn = await call('student: check-in', 'POST', '/api/v1/lecture/check-in', { body });
  if (checkIn.status !== 201) {
    failures.push({ step: 'check-in', status: checkIn.status, detail: checkIn.json?.detail });
    return;
  }
  record('student: whole check-in', performance.now() - totalStarted, 201, 'checked_in');
  if (student.retry) {
    const again = await call('student: retry (same ticket)', 'POST', '/api/v1/lecture/check-in', { body });
    if (again.status !== 200 || again.json?.status !== 'already_checked_in') failures.push({ step: 'retry', status: again.status, detail: again.json?.detail ?? again.json?.status });
  }
});
const wallMs = performance.now() - started;
running = false;
await Promise.allSettled(background);

// Integrity: every hall holds exactly its students, once each.
const integrity = [];
for (const hall of halls) {
  const view = await call('lecturer: final list', 'GET', `/api/v1/lecture/sessions/${hall.id}`, { cookie });
  const attendees = view.json?.attendees ?? [];
  const matrics = attendees.map((attendee) => attendee.matricNumber);
  integrity.push({
    session: hall.courseCode,
    expected: STUDENTS,
    present: view.json?.session?.presentCount ?? null,
    listed: attendees.length,
    duplicates: matrics.length - new Set(matrics).size,
    sharedPhoneFlags: attendees.filter((attendee) => attendee.sharedDeviceCount > 0).length,
  });
}

if (env.KEEP_SESSIONS !== 'yes') {
  for (const hall of halls) {
    await call('lecturer: delete test session', 'POST', `/api/v1/lecture/sessions/${hall.id}/delete`, { cookie, body: { confirmCourseCode: hall.courseCode } });
  }
}

const ok = failures.length === 0 && integrity.every((hall) => hall.present === STUDENTS && hall.listed === STUDENTS && hall.duplicates === 0);
const report = {
  ok,
  target: BASE,
  run: runId,
  settings: { halls: HALLS, studentsPerHall: STUDENTS, totalStudents: students.length, concurrency: CONCURRENCY, spreadSeconds: SPREAD_MS / 1000, qrMode: QR_MODE, typedShare: TYPED_SHARE, retryShare: RETRY_SHARE, oneClientAddress: SAME_ADDRESS },
  wallSeconds: Number((wallMs / 1000).toFixed(1)),
  checkInsPerSecond: Number((students.length / (wallMs / 1000)).toFixed(1)),
  steps: Object.fromEntries([...samples.keys()].map((step) => [step, summarize(step)])),
  failures: { count: failures.length, sample: failures.slice(0, 10) },
  integrity,
  id: randomUUID(),
};
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
