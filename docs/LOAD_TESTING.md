# Load testing plan

**Status:** QR attendance has been crowd tested against a **real PostgreSQL server** with rate limits on: up to 1,800 students checking in at the same instant without the face check, and up to 900 students (3 halls) with the **real face check** (`pnpm load:rush`, results below). Every student was recorded exactly once in every run. The first hour of a pilot day (sign-ins, account opening, face registration, the attendance page and session reads, against a LASU-sized database) has been rehearsed the same way (`pnpm load:pilot`, below), and both sign-in and session-read targets are met. The live Vercel + Neon site has not been load tested (that would create real sessions during term); the figures below describe the setup they were measured on. What only real phones can show is covered by the practice day in [`PILOT_PRACTICE_DAY.md`](PILOT_PRACTICE_DAY.md).

## Lecture-start rush with the face check: `pnpm load:rush`

The hardest minute for LASUATOS: a lecturer opens attendance and 300 students scan the QR code, take their two face photos and press submit within the same minute, possibly in several halls at 8 a.m. The face check is the expensive part: each check-in analyses two photos with the face models (about 0.4 CPU-seconds), 25 times the cost of the rest of the check-in.

`apps/api/src/load/lecture-rush.ts` runs it with **production wiring**: `createApiApplication` exactly as the Vercel function builds it (serverless pool of 3, `RATE_LIMIT_STORE=postgres`, `FACE_CHECK=required`, real face models, real PostgreSQL), each server instance in its own process like one warm function instance. It seeds an institution (`load-xxxx`) with lecturers, students, sessions and registered faces (real photos from `packages/face/test/fixtures`), then for each hall:

- the lecturer signs in, adds the course and opens a dynamic-QR session; the projector fetches every new QR frame and the lecturer's screen polls the live list every 4 seconds;
- each phone arrives at a random moment in the spread, scans (`resolve`), opens the camera (`face/warm`), takes 3–8 seconds over the photos and submits the check-in with the photos for the turn it was asked for; 5% sign in on a classmate's phone (password check), 10% send the same check-in twice (a flaky network);
- with `--phone-retries on` (the default) the phone behaves like the web app: busy (503 with `Retry-After`) waits as asked or longer each time, a dropped connection or 502/504 is tried again three times, for up to three minutes;
- every request is cut off at 30 seconds, like the platform's limit;
- finally it checks the database: one attendance row and one face check per student, no duplicates, and the lecturer's list shows the same count.

```bash
# A local PostgreSQL on 127.0.0.1 with an empty database (the script applies the migrations, and on later runs only the new ones).
DATABASE_URL=postgres://lasuatos@127.0.0.1:5432/lasuatos_load pnpm load:rush                     # 1 hall × 300 over 60 s
DATABASE_URL=… pnpm load:rush -- --halls 3 --instances 2 --output rush.json                         # three 8 a.m. classes
DATABASE_URL=… pnpm load:rush -- --phone-retries off                                                # phones that do not retry
DATABASE_URL=… pnpm load:rush -- --face off                                                         # the same rush without the face check
```

Options: `--halls`, `--students` (per hall), `--spread` (arrival seconds), `--instances`, `--pool`, `--face on|off`, `--capture-seconds 3-8`, `--sign-in-share`, `--retry-share`, `--phone-retries on|off`, `--face-budget` (ms, `FACE_QUEUE_BUDGET_MS`), `--rate-limits postgres|memory|off`, `--output file.json`. It refuses any database that is not on `127.0.0.1`/`localhost`, and clears `rate_limit_counters` at the start (every run comes from one address). It exits with an error if anyone was lost or stored twice. Set `LOAD_SERVER_LOGS=yes` to see each server instance's errors in the terminal, with the database's own reason.

### Rush results

Run on 2026-11-18, Node 22, a 2-vCPU Linux sandbox running PostgreSQL 17, the server instances and the 300–900 simulated phones together. Students arrive over 60 seconds. "Submit to saved" is from pressing the button to "You're marked present", including the phone's own retries; "scan to saved" adds the time taking the photos.

| Run | Saved | Scan p50 / p95 | Submit to saved p50 / p95 / max | Server errors | Phone retries |
| --- | --- | --- | --- | --- | --- |
| **Before (main at `08c5849`)**, 1 hall × 300, 1 instance | **241 of 300, 59 lost** | 7.5 s / 16.7 s | 18.5 / 27.8 / 29.9 s | 79 × 500, 1 cut off at 30 s | none (the page did not retry) |
| After, 1 hall × 300, 1 instance | **300 of 300** | 16 ms / 40 ms | 14.4 / 43.6 / 63.5 s | none (173 × 503 busy, retried) | 173 |
| After, phones not retrying (for comparison) | 224 of 300 | 16 ms / 35 ms | 13.3 / 15.3 / 15.7 s | none (76 × 503 busy) | none |
| After, 1 hall × 300, 2 instances | **300 of 300** | 20 ms / 40 ms | 1.7 / 5.8 / 6.4 s | none | 0 |
| After, 3 halls × 300 at once, 2 instances | 899 of 900 (1 gave up after 3 minutes) | 19 ms / 65 ms | 63.5 / 148 / 180 s | none (1,823 × 503 busy, retried) | 1,822 |
| After, 3 halls × 300, **face check off**, 1 instance | 900 of 900 | 14 ms / 21 ms | 15 / 39 / 146 ms | none | 0 |

Every run: 0 duplicates, one face check stored per saved student, and the lecturer's list matched the database. CPU per face check-in: about 0.39–0.43 CPU-seconds (0.016 without the face check). Memory: 550–620 MB per instance with the models loaded (the Hobby function limit is 2 GB).

What broke before, and what changed:

1. **Every request on the instance stalled behind the face models.** The face analysis ran on the request thread, so while photos were analysed nothing else moved: QR scans took 7.5 s (p50), the lecturer's live list 15 s, and requests queued for a database connection timed out after 10 s (`timeout exceeded when trying to connect`), which came back as **500 errors** on scans and check-ins. The pool size was not the problem: the connections were idle, waiting for the thread. **Fix:** the face models run on their own worker thread (`packages/face`, `createFaceEngine()`), so the request thread keeps answering scans, the projector and the lecturer in tens of milliseconds whatever the face queue is doing.
2. **Everyone finished at the end.** Every photo joined one shared queue, so each student's second photo waited behind everybody's first. **Fix:** each check-in's photos are analysed together, first come first served (`FaceVerifier`, one check at a time per instance).
3. **Requests waited until the platform cut them off.** With more photos queued than an instance can analyse in 30 seconds, the late ones waited the full 30 s and failed, and their photos were still analysed afterwards for nobody. **Fix:** admission control. An instance that cannot start a check-in's photos within `FACE_QUEUE_BUDGET_MS` (15 s) answers **503 busy with `Retry-After`** at once, before reading the photos. The expected wait comes from how fast the line actually moved (the time between check-ins finishing), which in the test was a third slower than the analysis alone.
4. **The phone did not retry.** On any 5xx the page showed "busy or waking up" and the student had to start again. **Fix:** the check-in page sends the same photos again by itself (check-in is idempotent: a second send answers "already marked present") and says "Lots of students are checking in right now… Keep this page open. You do not need to take new photos."
5. **Retries stormed.** With a fixed 2–10 s `Retry-After`, 900 students made 18,751 retries, and answering them (reading 300 KB of photos each time, the sign-in limit, the database) slowed the face checks and used up the hall's per-address check-in limit (`429` after 20,000 requests in 10 minutes). Students who signed in on a classmate's phone also used up their own sign-in limit (10 per 15 minutes) while retrying. **Fix:** the busy answer happens in an `onRequest` hook, before the body is read and before any rate limit counts it (3 ms); `Retry-After` is spread at random over the time the recently turned-away phones' photos will take; and the phone waits longer each time it hears busy again (3 s, growing by half, up to 30 s). Same 900 students: 1,822 retries.

How to read this:

- **Throughput per instance is about 2.5–3 face check-ins a second** on this CPU (one photo is about 170 ms of analysis when busy). 300 students over a minute need about 2 instances to finish without anyone waiting; 900 at once need about 6. On Vercel, Fluid compute starts more instances when existing ones are CPU-bound, so a real rush is spread over several instances; the 1-instance runs above are the worst case (no scale-out at all), and even then nobody was lost.
- **Waiting is now a queue, not a failure.** With too few instances, students wait (up to three minutes on the phone) instead of getting errors, and the scan, the projector and the lecturer's list stay fast.
- **The CPU bill is the face check.** See "Face checks and the Vercel CPU allowance" in `docs/DEPLOYMENT.md`.

## Pilot morning: `pnpm load:pilot`

The first hour of a pilot day, in one run. `apps/api/src/load/pilot-morning.ts` uses the same production wiring as the rush (`createApiApplication` with the serverless pool of 3, the PostgreSQL rate-limit store, every request from **one address** like a class on campus Wi-Fi, each server instance in its own process) against a database the size of LASU:

1. **Seeds** 20,000 other students (`--population`): profiles, class-list entries, a session each, 70% with a registered face (signatures of the real size), and a semester of other classes' attendance (about 196,000 rows). Then the pilot: 6 courses with 8 weeks of lectures behind them, `--students` (300) students with accounts and history, and `--openers` (60) students on the class list who have not opened their account yet, each with a setup code from their HOC.
2. **Plans** the sign-in and face-registration queries on that data (`EXPLAIN ANALYZE`), so a missing index shows up as a scan.
3. **Morning:** everyone arrives at a random moment over `--spread` seconds (120). Students sign in as people do: mostly by matric number, 15% by email, 40% still on the starting password (half of them typed in lower case or with spaces, which costs the server a second password check), 10% mistype first. Then the attendance page loads its 7 reads at once and keeps polling (open sessions every 15 s, history every 60 s). Openers check the list, open their account with the setup code and register their face (three real photos, the web app's busy retries).
4. **"Refresh your page":** all 360 signed-in phones reload the attendance page at the same moment.
5. **Session reads:** `--readers` (100) phones read their session back to back for `--read-seconds` (20).

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5432/lasuatos_load pnpm load:pilot
pnpm load:pilot -- --students 424 --openers 112 --spread 600      # the whole pilot cohort over 10 minutes
pnpm load:pilot -- --population 50000 --instances 2 --output pilot.json
```

Other options: `--instances`, `--pool`, `--face on|off`, `--starting-share`, `--loose-share`, `--email-share`, `--typo-share`, `--rate-limits postgres|memory|off`. The JSON report gives each step's latency percentiles and outcomes, CPU, memory and event-loop delay per phase, the query plans, what the database holds afterwards, **database round trips per request for every route** (`server.databaseRoundTripsPerRequest`), and the two targets below, met or not. It exits 1 on any server error, a lost sign-in or a missed target. It refuses any database that is not on this computer; everything it makes belongs to a new institution (`load-XXXX`), so drop the database afterwards. `LOAD_QUERY_TRACE=yes` prints, when the run ends, every statement sent by the busiest request on each route, which is how the round trips below were found. `LOAD_SERVER_LOGS=yes` shows server errors with the database's own reason.

### Pilot morning results

Run on 2026-11-19, Node 22, a 2-vCPU, 4 GB Linux sandbox running PostgreSQL 16 (`shared_buffers` 256 MB), one server instance with a pool of 3, and the simulated phones, all together; default settings (300 signing in and 60 opening accounts over 2 minutes, 20,000 other students). "Before" is `main` at `dec8942`; "after" is with the changes listed below. Latencies are p50 / p95.

| Step | Before | After |
| --- | --- | --- |
| Sign in (every successful sign-in) | 155 / 792 ms | 103 / 279 ms |
| Sign in, starting password typed loosely (two password checks) | 203 / 1,253 ms | 190 / 430 ms |
| Tap **Sign in** → attendance page ready (sign-in plus the 7 reads) | 188 / 1,091 ms | 139 / 319 ms |
| Attendance page, all 7 reads back | 44 / 396 ms | 26 / 69 ms |
| Session reads, 100 phones back to back | 191 / **300 ms** at 481 a second (**target missed**) | 73 / **131 ms** at 1,228 a second |
| Everyone refreshes at once (360 phones × 7 reads), whole page | 8.98 / 9.06 s | 5.7–6.5 / 5.9–6.8 s (three runs) |
| Opening an account: setup code from the HOC | 125 / 1,009 ms | 117 / 314 ms |
| Face registration: photos sent → answer | 1.04 / 1.97 s | 0.71 / 1.35 s |
| Server CPU for the whole run | 124.5 CPU-s | 108.7 CPU-s |

Every run: 300 of 300 signed in, 60 of 60 opened, **0 server errors, 0 refused by the rate limits** (all from one address), peak memory 780–840 MB. The first opener's face was saved and the other 59 were refused as the same face, which is correct: every simulated student uses the same real photos.

Database round trips per request (each one waits for a connection from the instance's pool of 3, so under a crowd they are the cost):

| Route | Before | After |
| --- | --- | --- |
| `GET /auth/session`, `GET /auth/session/status` (every signed-in page) | 3 | 1 |
| `GET /student/attendance`, `…/disputes` | 5 | 3 |
| `GET /student/attendance/open`, `…/summary` | 4 | 2 |
| `GET /student/lecture-history` | 8.7 | 4.7 |
| `GET /students/me/setup` | 6 | 4 |
| `POST /auth/login` | 9.8 | 5.8 |
| `POST /students/me/face` | 11.3 | 8 |
| `POST /students/me/face/warm` | 4 | 2 |

What was slow, and what changed:

1. **Every signed-in request started with three queries.** The session lookup tried administrator, then student, then lecturer, one query each, so a student (most requests) paid for all three. It also wrote "last seen" with an `UPDATE` on every request, which matched no row most of the time. **Fix:** one query returns the session, the account, the student profile and whether the account holds the student role or any administrator role. Only an account with an administrator role, or one that is not a student, takes the original second query, so the answer and its order are unchanged. "Last seen" is read with it and written only when it is due (every 5 minutes). This took session reads under the target and is most of the gain everywhere else.
2. **Sign-in by matric number scanned every student profile** (`upper(replace(student_number, ' ', ''))` had no index: a sequential scan of 21,350 rows, 2.6 ms, for every sign-in by number). **Fix:** an expression index, `student_profiles_matric_key_idx` (migration `0033`): 0.4 ms.
3. **Signing in did more work than it needed.** The credentials took two queries for a student, and starting the session was a five-statement transaction (begin, administrator query, student query, insert, commit). **Fix:** the same one-query approach for both (one query and the insert for a student). The transaction protected nothing: every request resolves the account again.
4. **A role check read every role in the database.** Written as `EXISTS`, PostgreSQL turned the role checks in the new credentials query into a hashed subplan: it read all 20,000 role assignments to look up one account (5.6 ms a sign-in). **Fix:** the checks are scalar subqueries, which cannot be hashed, so each one is an index lookup on that account's own roles (0.05 ms). A test plans the query on a department-sized database and fails if the scan comes back.
5. **The lecture routes started with three queries in a row** to learn who was asking (account, student identity, class-rep appointment). **Fix:** one query.
6. **Face registration loaded every registered face as JSON** to look for a duplicate: 23 MB to parse at 14,000 faces. **Fix:** each face's signature is also stored packed (`centroid_packed`, float32, migration `0033`, which packs the existing rows too): 7.3 MB and nothing to parse. The setup check inside registration also no longer loads the student a second time.

How to read this:

- **One instance, one address, a 2-vCPU box shared with the phones.** On Vercel, Fluid compute adds instances under load, so the refresh storm (the slowest number here) would be spread over several. Runs on this box vary by about 10% (session reads: 1,228–1,331 a second with no change to that code), so small differences between runs are noise.
- **The refresh storm is mostly round trips.** 2,520 requests at once through a pool of 3 finish when the last round trip does. Round trips per page load fell from 35.7 to 19.7 (0.55×) and the storm from 9.0 to about 6.5 s (0.72×); the rest is each request's own work (HTTP, JSON, the 360 simulated phones on the same CPU). The next steps, when it matters: fewer reads on the attendance page, or one read that answers several.
- **Rate limits held a whole class from one address.** About 330 sign-ins in 2 minutes passed the per-address limit (600 per 15 minutes). The pilot cohort (424) signing in within 15 minutes, typos included, is about 470: inside the limit, with little room to spare. Raise it before more than about 500 students sign in behind one campus address (`apps/api/src/security/rate-limit-policies.ts`).
- **The password check is the floor.** A mistyped password costs a second sign-in, and the check is deliberately slow (scrypt), so "mistyped first" journeys take 4–5 s, mostly the student retyping.

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

### Running it on your computer (Windows, macOS, Linux)

The crowd test talks to a LASUATOS that is **already running**; it does not start one. Use two terminals in the project folder:

1. **Terminal 1, start LASUATOS.** Docker Desktop must be running (it hosts the local database).
   ```powershell
   Copy-Item .env.example .env   # first time only (macOS/Linux: cp .env.example .env)
   pnpm dev:setup   # first time only: starts the database, migrates, seeds the demo lecturer
   pnpm dev         # wait for "Ready" and note the Local address it prints
   ```
2. **Terminal 2, run the test.**
   ```powershell
   pnpm load:lecture
   ```

The script finds LASUATOS by itself. It asks `/api/v1/health` on `localhost:3000` to `3003` (and on `PUBLIC_APP_URL` from `.env`) and only uses a server that answers as `lasuatos-api`. **If another project's dev server is already on port 3000**, Next.js starts LASUATOS on the next free port ("Port 3000 is in use, using available port 3001 instead"), and the script skips the other app and finds it there. Nothing is ever sent to a server that is not LASUATOS.

Settings use environment variables. In PowerShell, set them first, then run (they last until you close the terminal):

```powershell
$env:BASE_URL = "http://localhost:3001"      # only if auto-detection cannot find it
$env:HALLS = "1"; $env:STUDENTS = "100"; pnpm load:lecture
Remove-Item Env:HALLS, Env:STUDENTS           # back to the defaults
```

In Command Prompt use `set HALLS=1` and, on macOS or Linux, `HALLS=1 pnpm load:lecture`.

The lecturer password is taken from `LECTURER_PASSWORD`, then `LOCAL_DEMO_LECTURER_PASSWORD` in `.env`, then `demo-password-123`. If `LOCAL_DEMO_LECTURER_PASSWORD` was empty, `pnpm dev:setup` generated a password and printed it once; set `LECTURER_PASSWORD` to it.

| Message | What to do |
|---|---|
| `Could not find LASUATOS running on this computer` | Start it with `pnpm dev` and wait for "Ready". The message lists what answered on each port. |
| `… is not LASUATOS: … a web page titled "…"` | `BASE_URL` points at another app. Stop that app, or set `BASE_URL` to the address LASUATOS printed. |
| `cannot reach its database` | Start Docker Desktop, then `docker compose up -d`. |
| `missing migrations` | `pnpm db:migrate`, then restart `pnpm dev`. |
| `Signing in … was refused (HTTP 401 …)` | Wrong lecturer password; see above. |
| `Too many sign-in attempts` | Wait 15 minutes, or clear local limits: `docker compose exec postgres psql -U lasuatos_dev -d lasuatos_dev -c "DELETE FROM rate_limit_counters;"` |

`pnpm dev` is a development server (slower, compiles pages on first use), so treat its numbers as a functional check. For figures comparable to the table below, use a production build (`pnpm --filter @lasuatos/web build`, then `pnpm --filter @lasuatos/web exec next start`) with `API_MODE=embedded`.

How it was run: the production web build (`pnpm --filter @lasuatos/web build`, then `next start`, with `API_MODE=embedded` exactly as on Vercel) against PostgreSQL 17 on the same machine, seeded with `seed-local-demo.mjs`, `RATE_LIMIT_STORE=postgres`. Every request came from one address, like a whole class behind one campus Wi-Fi.

### Measured results

Run on 2026-11-10 (on top of commit `a33c287`), Node 22, a 2-vCPU Linux sandbox running the load generator, the web server and PostgreSQL together. "Whole check-in" is scan plus submit, as a student experiences it. Pool = `DATABASE_POOL_MAX` (Vercel uses 3 per function instance).

| Run | Pool | Result | Check-in p95 | Whole check-in p50 / p95 / max |
| --- | --- | --- | --- | --- |
| 1 class, 300 students over 30 s | 10 | 300 recorded, 0 errors | 15 ms | 19 / 30 / 50 ms |
| 3 classes, 900 students over 20 s | 3 | 900 recorded, 0 errors | 59 ms | n/a |
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
| Same 300 again (retry) | 300 × `already_checked_in` | 1,093 ms | 2,051 ms | n/a | n/a | 3.3 s | 90/s |
| 600 students, 20 in flight | 600 × `200 checked_in` | 257 ms | 331 ms | 1,126 ms | 1,322 ms | 8.2 s | 73/s |

In both runs the database held exactly one record per student: **0 duplicates, 0 lost**. With 300 students the roster read took 106 ms and the report 99 ms; closing returned 200.

How to read this:

- **Correctness held** under a burst: every student was recorded exactly once, retries were idempotent, and QR and code check-ins mixed safely.
- **The long tail is queueing.** With 100 requests in flight and one database connection, the last request waits for the 99 before it. Lower concurrency (the 600/20 run) gives a much tighter p95. A real PostgreSQL server with a connection pool serves queries in parallel, so these tails do not transfer to Neon, in either direction.
- **What it does not measure:** network latency from students' phones, Vercel cold starts, Neon's connection limits, or sign-in cost (scrypt). Use the staging procedure below for those.


## What matters for LASUATOS

The demanding moment is a lecture where every student scans the QR code within a minute or two of the lecturer opening a session. A large course can have several hundred students, usually on campus Wi-Fi behind a small number of shared public addresses. Sign-in is the next most expensive operation, because password hashing (scrypt, about 32 MB per hash) is deliberately slow.

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

The QR check-in goals are met in the runs above (on the setup described there). The sign-in and session-read goals are met in the pilot-morning run (sign-in p95 279 ms; session reads p95 131 ms at 100 concurrent readers), on the same kind of local setup; the live site's own figures come from the practice day ([`PILOT_PRACTICE_DAY.md`](PILOT_PRACTICE_DAY.md)).

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
- **Memory under concurrent sign-ins:** each scrypt hash allocates about 32 MB (N = 32,768, r = 8; 64 MB is the ceiling allowed). Sign-in concurrency must stay within the container memory limit, which is one reason sign-ins are throttled.

## Rate limits and load tests

Rate limits are keyed by client address, normalized email and session (see `docs/SECURITY.md`). A single load-generating machine looks like one address, which is close to the real campus situation (many students behind one NAT address). That is why QR resolve and check-in allow 20,000 requests per address per 10 minutes, and why nothing is keyed on the QR ticket (it is shared by everyone who scans in the same second). The crowd test runs with limits **on**, so it also proves the limits do not block a full class. Sign-in limits per address will still stop a single-machine sign-in burst; measure sign-in capacity with limits off in staging. After a run that hits limits, clear them locally with `DELETE FROM rate_limit_counters;`.
