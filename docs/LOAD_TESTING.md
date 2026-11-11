# Load testing plan

**Status: nothing has been measured yet.** This repository contains a load script and a fixture seeder; it does not contain load-test results. The figures under "Proposed targets" are planning goals for a pilot, not measurements. Never quote them as system capacity.

## What matters for LASUATOS

The demanding moment is a lecture where every enrolled student checks in within a minute or two of the lecturer opening a session. A large course can have several hundred students, usually on campus Wi-Fi behind a small number of shared public addresses. Sign-in is the next most expensive operation, because password hashing (scrypt, about 64 MB per hash) is deliberately slow.

## Tools

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

Before relying on the script, it was run once end to end in the development sandbox against an in-process embedded database (12 students: all signed in, all checked in, and the roster showed 12). That run only shows the script works. Its timings say nothing about performance and are not recorded here.

## Proposed targets (not measured)

These are planning goals to check in staging before a pilot.

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

Rate limits are keyed by client address, normalized email and session (see `docs/SECURITY.md`). A single load-generating machine looks like one address, which is close to the real campus situation (many students behind one NAT address). That is why check-in, enrollment and dispute limits are keyed per session rather than per address. Sign-in limits per address will still stop a single-machine sign-in burst; measure capacity with limits off in staging, then confirm protective behaviour with them on.
