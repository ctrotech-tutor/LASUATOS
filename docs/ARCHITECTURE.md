# Architecture

## Current architecture

LASUATOS is a modular monolith in a pnpm workspace (ADR 002). The user interface and API are separate applications in one repository, and in production they run as one deployment. Domain packages are kept small and explicit. A change to a service boundary should be driven by operational evidence rather than a premature move to microservices.

```text
Browser
  | same-origin /api/v1/* requests
  v
Next.js web app (apps/web)
  | production (API_MODE=embedded): app/api/v1/[...path]/route.ts runs the API in the same function
  | local development (proxy, default): rewrite to the API process at API_INTERNAL_URL
  v
Fastify API (apps/api)
  | Drizzle ORM and node-postgres
  v
PostgreSQL (packages/database; Neon in production)

Shared Zod contracts: packages/contracts
Password and token helpers, plus scoped authorization: packages/auth
Attendance codes, QR challenges and venue boundary checks: packages/verification
Face detection and matching: packages/face

Outside the app:
  status/                    status page (Cloudflare Worker + D1), polls GET /api/v1/status (ADR 034)
  .github/workflows/backup.yml  nightly encrypted pg_dump to a private repository, reported to POST /api/v1/ops/backups (ADR 035)
  Vercel Cron                GET /api/v1/cron/retention
```

**Embedded mode (ADR 015).** On Vercel, `API_MODE=embedded` makes the Next.js catch-all route hand each `/api/v1/*` request to `apps/api/src/embedded.ts`, which keeps one Fastify application (and one connection pool) per warm function instance and dispatches with `server.inject`, so no port is opened. The same routes, validation, rate limits, origin checks and headers apply as in the standalone server. On a cold start it also checks that every migration has been applied and alerts the operator if not. Deploys run the migrations first (`scripts/migrate-on-deploy.mjs`, ADR 020).

The API covers accounts and sessions, class lists and student account opening, quick lecture attendance with venue and face checks, registers and reports, disputes and appeals, the older enrolled-course tools, staff invitations and roles, academic structure, venues, class reps, contact messages, the audit log, data retention, alerts and the public status. `docs/API.md` lists every route. The database client is optional so the interface can be reviewed without institutional credentials. Database-backed workflows are unavailable until a database is configured. Readiness reports `not_configured` or `down` rather than pretending the service is ready.

## Technology choices

The current pinned direct dependencies are Next.js 16.4.6, React 19.3.1, Fastify 5.12.8, TypeScript 6.0.3, ESLint 10.14.0 with TypeScript ESLint 8.72.2, Tailwind CSS 4.3.5, Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, PostgreSQL driver `pg` 8.23.1, Nodemailer 10.3.1, Zod 4.6.7, lucide-react 1.70.0, Leaflet 1.9.4, pnpm 12.18.0 and Vitest 5.1.0. Tests run PostgreSQL in-process with PGlite 0.5.16; scripts run with tsx 4.23.15; backups are encrypted with `age-encryption` 0.3.1. The face package uses TensorFlow.js 4.22.0, Human 3.3.6, ONNX Runtime Web 1.31.1 and jpeg-js 0.4.4, and the phone's camera guide uses MediaPipe Tasks Vision 0.10.35 (`docs/FACE_VERIFICATION.md`). The selected versions were checked against the available package registry and exercised with the repository checks. Drizzle ORM 1.0 beta is intentionally not used.

Node 22.12 or newer is required for the selected test runner and framework toolchain. The package manager is pinned to avoid unreviewed package-manager changes.

## Module responsibilities

- `apps/web`: the web app for students, class reps, lecturers and administrators, the phone camera (QR scanner and face capture), class-list file reading in the browser (ADR 024), and same-origin API routing.
- `apps/api`: request lifecycle and validation, one folder per area: `auth`, `students` (class lists and account opening), `lecture` (quick lecture attendance, registers, class reps, face reviews), `attendance` and `enrollment` (the older enrolled-course tools), `staff`, `academic`, `admin`, `venue`, `governance` (audit log and retention), `contact`, `mail`, `email` (providers and messages), `monitoring` (health, trend alerts, status, backups), `security` (origin guard, rate limits, headers) and `load` (load tests).
- `packages/contracts`: shared request and response shapes. Schemas must not contain database access.
- `packages/auth`: password hashing, one-time token helpers and administrative scope rules. It does not decide student status.
- `packages/database`: PostgreSQL schema, typed client and reviewed migrations.
- `packages/verification`: pure, dependency-free checks: signed lecture codes and QR challenges (`lecture-codes.ts`, `session-challenge.ts`), and venue presence (`venue-area.ts` for outlines and circles with an allowance, `geofence.ts` for the older circular check). Readings are evaluated as `within`, `outside` or `inconclusive`, with accuracy and age taken into account. GPS is a signal, never proof.
- `packages/face`: face detection, liveness and matching (`docs/FACE_VERIFICATION.md`). The server makes the decision; the browser only guides the student.
- No separate worker. Face checks run in a bounded line inside the API (ADR 031); scheduled work runs from Vercel Cron and GitHub Actions. Add a worker only when background work needs its own lifecycle.

## Request and browser boundaries

The browser calls a relative path such as `/api/v1/health`. Next.js rewrites that path on the server to `API_INTERNAL_URL`, defaulting to `http://127.0.0.1:4000` for local development. The internal URL is never embedded in browser code. The rewrite avoids exposing a second public browser origin and keeps CORS policy simple.

The Next development server allows the preview host pattern `*.e2b.app` (`allowedDevOrigins`), for development only. In production the site is served from its Vercel address; `PUBLIC_APP_URL` names it for the origin guard and email links, and in embedded mode the client address comes from Vercel's `x-real-ip`.

Student confirmation email is sent by the API using the server-side `EMAIL_PROVIDER` setting. Local development can use Mailpit to capture messages without sending to an external inbox. Gmail uses Nodemailer with OAuth2 or an eligible App Password. Brevo and Resend use their transactional email APIs. When more than one provider is configured, they form a chain (ADR 029): a provider that runs out of its daily allowance or refuses is skipped, with the counts and pauses shared through PostgreSQL, and the next one sends the same email. Provider credentials never enter browser code. Email confirmation verifies mailbox access only. The user's matric number is not looked up or treated as proof of student status.

## Data and time

PostgreSQL is the source of truth for attendance sessions and committed check-in records. Timestamps use timezone-aware columns. Institution-local display defaults to `Africa/Lagos`; all stored instants remain timezone-aware. Academic years and semesters are explicit records, not derived from a user's current class level.

## Reliability and scaling decisions

- Check-in creation is transactional and idempotent; the unique `(session, student)` database constraint is the final duplicate guard.
- A lecture check-in checks the code, the session, the account, the face and the venue before the transaction creates a record; the phone rule is counted again under the session row lock. The older enrolled-course check-in also checks the student's active enrolment.
- Historical data uses restrictive deletion rules and append-only audit events where decisions change; database triggers refuse edits to the audit and correction tables and guard dispute and appeal decisions.
- Live lecturer views (the register, the disputes queue) poll with conditional GETs: unchanged answers come back as `304` with no body, the cadence slows when nothing moves, and polling stops in background tabs (ADR 023). SSE waits until the API runs as a long-lived process.
- Redis, job queues, PostGIS and separate services are deferred until measured throughput or domain needs justify them.
- Each serverless instance keeps at most 3 database connections (10 for a standalone API process), set by `DATABASE_POOL_MAX`; production uses Neon's pooled connection. The pilot rehearsal measured a pilot morning at this size (`docs/LOAD_TESTING.md`).
- Sign-in and session reads are built for the lecture-start rush: one query finds who is asking, one query checks the credentials, and an expression index finds students by matric number (`docs/LOAD_TESTING.md`, *Pilot morning*).

## Security boundaries

Authorization belongs in API handlers and domain services. Every route derives the caller's institution, faculty, department, set and class-rep post from the server session, never from the request (ADR 004). Students see only their own records; class reps see their class (ADR 018); administrators see their area. Public sign-up cannot assign staff roles. Staff may also sign in with a passkey (ADR 037): `auth/passkeys.ts` verifies WebAuthn answers with `@simplewebauthn/server` against challenges kept in PostgreSQL, and the web app uses `@simplewebauthn/browser`, loaded only when a passkey is used. A confirmed email proves mailbox access, not an institution-verified identity, and attendance evidence does not prove presence on its own. The PostgreSQL adapters are exercised by integration tests on PGlite (embedded PostgreSQL); CI has no separate PostgreSQL service, and the load tests use a local PostgreSQL 16 (`docs/TESTING.md`). Formal privacy decisions and institutional approvals are outstanding.

Cross-cutting request protections run as Fastify hooks registered before any route (`apps/api/src/security/`):
1. An `onRequest` origin guard rejects cross-site state-changing requests.
2. A `preHandler` rate limiter applies the central policy table after body parsing, so email-keyed limits can apply. Its counters are stored in PostgreSQL.
3. An `onSend` hook adds security headers to every response, including errors.

The web app sets its own page headers in `next.config.ts`. Client addresses come from `X-Forwarded-For` only through Fastify's `trustProxy`, which is configured by `TRUST_PROXY`.

## Failure behavior

The API health endpoint reports liveness. The readiness endpoint reports whether PostgreSQL responded to `SELECT 1` and every migration in the build has been applied. Alerts email the operator about server errors, a database missing migrations, bursts of errors, refused requests and wrong-password sign-ins, email providers failing or running out, Google sign-in failing, failed or late backups, bursts of cross-origin blocks and a failing rate-limit store (ADR 029, ADR 035, ADR 036); the status page shows the coarse state publicly. Health responses are not cached. A failed readiness check is not presented as a successful database connection. The check-in route returns a recorded result only after the database transaction inserts or finds the student's unique session record.
