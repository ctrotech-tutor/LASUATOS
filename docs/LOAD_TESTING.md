# Load testing plan

**Status:** QR attendance (the way LASUATOS is used) has been crowd tested against a **real PostgreSQL server** through the production web build, with rate limits on, up to 1,800 students checking in at the same instant (results below). Every student was recorded exactly once in every run. The live Vercel + Neon site has not been load tested (that would create real sessions during term); the figures below describe the setup they were measured on.

## Crowd test for QR attendance: `pnpm load:lecture`

`scripts/load/lecture-burst.mjs` drives the public API exactly as phones and lecturers' screens do:

- each "lecturer" signs in and opens a session (rotating or printed QR);
- each projector fetches QR frames, and each lecturer's screen polls the live list every 4 seconds, as the real page does;
- every student scans (or, for 10%, types the code), then submits a name, matric number and device token;
- 10% submit twice, as on a flaky network (must answer `already_checked_in`);
- afterwards it checks that each hall has exactly one record per student, then deletes the test sessions.

```bash
# Against a local production build (see below). Defaults: 3 halls × 300 students over 60 s.
pnpm load:lecture
HALLS=6 STUDENTS=300 SPREAD_SECONDS=0 CONCURRENCY=300 pnpm load:lecture   # the worst case
HALLS=1 STUDENTS=300 QR_MODE=static pnpm load:lecture                     # one printed poster
```

All settings (`BASE_URL`, `LECTURER_EMAIL`, `LECTURER_PASSWORD`, `HALLS`, `STUDENTS`, `CONCURRENCY`, `SPREAD_SECONDS`, `QR_MODE`, `TYPED_SHARE`, `RETRY_SHARE`, `SAME_ADDRESS`, `KEEP_SESSIONS`) are described at the top of the script. It prints JSON (latency percentiles per step, status counts, the integrity check) and exits non-zero if anything failed. It refuses non-loopback targets unless `ALLOW_REMOTE=yes`. **Never run it against the live site during lectures.**

How it was run: the production web build (`pnpm --filter @lasuatos/web build`, then `next start`, with `API_MODE=embedded` exactly as on Vercel) against PostgreSQL 17 on the same machine, seeded with `seed-local-demo.mjs`, `RATE_LIMIT_STORE=postgres`. Every request came from one address, like a whole class behind one campus Wi-Fi.

### Measured results

Run on 2026-11-10 (on top of commit `a33c287`), Node 22, a 2-vCPU Linux sandbox running the load generator, the web server and PostgreSQL together. "Whole check-in" is scan plus submit, as a student experiences it. Pool = `DATABASE_POOL_MAX` (Vercel uses 3 per function instance).

| Run | Pool | Result | Check-in p95 | Whole check-in p50 / p95 / max |
| --- | --- | --- | --- | --- |
| 1 class, 300 students over 30 s | 10 | 300 recorded, 0 errors | 15 ms | 19 / 30 / 50 ms |
| 3 classes, 900 students over 20 s | 3 | 900 recorded, 0 errors | 59 ms | — |
| 1 class, 300 students at the same instant, printed QR | 10 | 300 recorded, 0 errors | 1,958 ms | 3,799 / 4,035 / 4,111 ms |
| 6 classes, 1,800 students at the same instant | 3 | 1,800 recorded, 0 errors | 2,172 ms | 3,237 / 5,702 / 7,061 ms |
| 6 classes, 1,800 students at the same instant | 10 | 1,800 recorded, 0 errors | 2,013 ms | 2,598 / 7,870 / 10,388 ms |

Every run: 0 duplicates, 0 lost, every retry answered `already_checked_in`, and every lecturer list showed the right count.

How to read this:

- **A real class is fine.** Students arrive over half a minute or more, and then a check-in takes tens of milliseconds.
- **The "same instant" runs are a stress test** (300–1,800 phones pressing submit in the same millisecond). The waiting there is the 2 shared CPUs (load generator, web server and database on one small machine), not the database: the queries use indexes and take no row locks, and a bigger pool did not help. On Vercel each burst is spread over several function instances, each with its own pool, and Neon runs on separate hardware.
- **A fix came out of this test.** The first 1,800-student run got 1,049 refusals (HTTP 429) because a limit counted check-ins per QR ticket, and every student who scans in the same second gets the same ticket. That limit was removed (ADR 020); a test now checks that 400 students can share one ticket.

## Older test: `pnpm load:embedded`

This needs no Docker, database server or email. It starts the real API (the same services and routes as production) on a loopback port, backed by embedded PostgreSQL (PGlite), seeds a synthetic class, then fires every student's check-in at once over real HTTP. About half the students use a fresh QR challenge and half the typed code. It then repeats every check-in to test idempotency, reads the roster and the report, closes the session and checks the database directly.

```bash
pnpm load:embedded                                       # 300 students, 100 in flight
pnpm load:embedded -- --students 600 --concurrency 20
pnpm load:embedded -- --students 300 --qr-share 1        # everyone scans the QR
```

On Windows PowerShell the commands are the same (`corepack pnpm load:embedded`).

It prints JSON with latency percentiles, status counts, throughput and an **integrity** block: records stored, duplicates and students lost. The process exits with an error if any check-in failed or integrity does not match, so it can run in CI.

### Embedded results

Run on 2026-11-10 at commit `8800446`, Node 22, Linux x64 development sandbox, PGlite (a single in-process connection, so every query waits its turn), rate limits off, no network between client and server.

| Run | Result | p50 | p95 | p99 | max | Wall time | Throughput |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 300 students, 100 in flight (half QR, half code) | 300 × `200 checked_in` | 298 ms | 4,190 ms | 4,342 ms | 4,380 ms | 4.5 s | 66/s |
| Same 300 again (retry) | 300 × `already_checked_in` | 1,093 ms | 2,051 ms | — | — | 3.3 s | 90/s |
| 600 students, 20 in flight | 600 × `200 checked_in` | 257 ms | 331 ms | 1,126 ms | 1,322 ms | 8.2 s | 73/s |

In both runs the database held exactly one record per student: **0 duplicates, 0 lost**. With 300 students the roster read took 106 ms and the report 99 ms; closing returned 200.

How to read this:

- **Correctness held** under a burst: every student was recorded exactly once, retries were idempotent, and QR and code check-ins mixed safely.
- **The long tail is queueing.** With 100 requests in flight and one database connection, the last request waits for the 99 before it. Lower concurrency (the 600/20 run) gives a much tighter p95. A real PostgreSQL server with a connection pool serves queries in parallel, so these tails do not transfer to Neon, in either direction.
- **What it does not measure:** network latency from students' phones, Vercel cold starts, Neon's connection limits, or sign-in cost (scrypt). Use the staging procedure below for those.


## What matters for LASUATOS

The demanding moment is a lecture where every student scans the QR code within a minute or two of the lecturer opening a session. A large course can have several hundred students, usually on campus Wi-Fi behind a small number of shared public addresses. Sign-in is the next most expensive operation, because password hashing (scrypt, about 64 MB per hash) is deliberately slow.

## Staging tools for enrolled courses (real database)

| Tool | Location | What it does |
| --- | --- | --- |
| Fixture seeder | `packages/database/scripts/seed-load-fixture.mjs` | Creates `N` synthetic students (`load-student-0001@load-test.invalid` …), shown as "Load Test Student", and enrolls them in one course offering. It runs **only** against the loopback local-demo database with `LOCAL_DEMO_MODE=true`. |
| Burst script | `scripts/load/check-in-burst.mjs` | Signs the lecturer and students in, opens a 15-minute attendance session and fires every student's check-in at once with a concurrency cap. It then reads sessions, fetches the roster, closes the session and prints latency percentiles (p50/p95/p99/max), status counts and throughput as JSON. It refuses non-loopback targets unless `ALLOW_REMOTE=yes`. |

Run it against **staging or a local stack only, never production**:

```bash
# 1. Local stack running (pnpm dev:setup, pnpm dev) and a course offering created by the demo lecturer.
LOAD_COURSE_OFFERING_ID=<uuid> LOAD_STUDENTS=300 LOAD_STUDENT_PASSWORD='load student passphrase' \
  pnpm exec dotenv -e .env -- node packages/database/scripts/seed-load-fixture.mjs

# 2. Capacity run: limits off (allowed outside production only), one machine.
#    Restart the API with RATE_LIMIT_STORE=off first.
BASE_URL=http://localhost:3000 LECTURER_EMAIL=lecturer@lasuatos.example.net LECTURER_PASSWORD='…' \
LOAD_COURSE_OFFERING_ID=<uuid> LOAD_STUDENTS=300 LOAD_STUDENT_PASSWORD='load student passphrase' \
CONCURRENCY=100 LOGIN_CONCURRENCY=10 node scripts/load/check-in-burst.mjs

# 3. Protection run: restart with RATE_LIMIT_STORE=postgres and repeat. Student sign-ins from one
#    address should start returning 429 after the per-address sign-in limit; that is expected.
```

Only one attendance session can be open per offering at a time, so close a leftover session before you re-run.

The staging script below has only been run once end to end against an embedded database (12 students), to show it works. No staging timings are recorded here yet.

## Targets

The QR check-in goals are met in the runs above (on the setup described there). The sign-in and session-read goals are still to be measured in staging before a pilot.

| Scenario | Proposed goal |
| --- | --- |
| 300 check-ins from 300 signed-in students, released within 10 seconds | 0 errors other than expected domain outcomes; p95 under 1 s; every student appears exactly once on the roster |
| 600 check-ins in the same way (two large lectures at once) | No 5xx; p95 under 2 s |
| 300 sign-ins spread over 2 minutes | No 5xx; p95 under 3 s (scrypt dominates); API memory stays within the container limit |
| Session reads (`GET /api/v1/auth/session`) | p95 under 300 ms at 100 concurrent readers |

## How to read and record results

Record the following with every result: the date, the git commit, the host size (CPU and memory), the PostgreSQL size and connection limit, API instance count, network path (same host, LAN, or internet), `RATE_LIMIT_STORE`, student count, concurrency, and the full JSON output. A result describes only that setup.

Watch for:
- **Duplicates or losses:** compare `rosterAttendees` with `studentsSignedIn`. They must match exactly; a mismatch is a correctness bug, not a performance issue.
- **Connection pool exhaustion:** errors or long tails once concurrency exceeds the pool size.
- **Lock waits:** check-ins lock the attendance session row; long p99 values under a burst point there first.
- **Memory under concurrent sign-ins:** each scrypt hash allocates about 64 MB. Sign-in concurrency must stay within the container memory limit, which is one reason sign-ins are throttled.

## Rate limits and load tests

Rate limits are keyed by client address, normalized email and session (see `docs/SECURITY.md`). A single load-generating machine looks like one address, which is close to the real campus situation (many students behind one NAT address). That is why QR resolve and check-in allow 20,000 requests per address per 10 minutes, and why nothing is keyed on the QR ticket (it is shared by everyone who scans in the same second). The crowd test runs with limits **on**, so it also proves the limits do not block a full class. Sign-in limits per address will still stop a single-machine sign-in burst; measure sign-in capacity with limits off in staging. After a run that hits limits, clear them locally with `DELETE FROM rate_limit_counters;`.
