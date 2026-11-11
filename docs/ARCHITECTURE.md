# Architecture

## Current architecture

LASUATOS starts as a modular monolith in a pnpm workspace. The user interface and API are separate applications in one repository. Domain packages are kept small and explicit. A change to a service boundary should be driven by operational evidence rather than a premature move to microservices.

```text
Browser
  | same-origin /api/v1/* requests
  v
Next.js web app (apps/web)
  | server-side rewrite to API_INTERNAL_URL
  v
Fastify API (apps/api)
  | Drizzle ORM and node-postgres
  v
PostgreSQL (packages/database)

Shared Zod contracts: packages/contracts
Password and token helpers, plus scoped authorization: packages/auth
```

The API exposes health and readiness routes plus a student-account slice for registration, one-time email confirmation, sign-in, session lookup and logout. The database client remains optional so the interface can be reviewed without institutional credentials. Account writes are unavailable until a database and the configured institution row exist. Readiness reports `not_configured` or `down` rather than pretending the service is ready.

## Technology choices

The current pinned direct dependencies are Next.js 16.4.6, React 19.3.1, Fastify 5.12.8, TypeScript 6.0.3, ESLint 10.14.0 with TypeScript ESLint 8.72.2, Tailwind CSS 4.3.5, Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, PostgreSQL driver `pg` 8.23.1, Nodemailer 10.3.1, Zod 4.6.7, lucide-react 1.70.0, pnpm 12.18.0 and Vitest 5.1.0. The selected versions were checked against the available package registry and exercised with the repository checks. Drizzle ORM 1.0 beta is intentionally not used.

Node 22.12 or newer is required for the selected test runner and framework toolchain. The package manager is pinned to avoid unreviewed package-manager changes.

## Module responsibilities

- `apps/web`: accessible operator-facing web workspace and same-origin API routing.
- `apps/api`: request lifecycle, validation, student registration and session services, email delivery adapters, and future domain routes.
- `packages/contracts`: shared request and response shapes. Schemas must not contain database access.
- `packages/auth`: password hashing, one-time token helpers and administrative scope rules. It does not decide student status.
- `packages/database`: PostgreSQL schema, typed client and reviewed migrations.
- Future `packages/attendance` and `packages/verification`: introduce only when those domains are implemented and tested.
- Future worker: add only when background work needs an independent lifecycle.

## Request and browser boundaries

The browser calls a relative path such as `/api/v1/health`. Next.js rewrites that path on the server to `API_INTERNAL_URL`, defaulting to `http://127.0.0.1:4000` for local development. The internal URL is never embedded in browser code. The rewrite avoids exposing a second public browser origin and keeps CORS policy simple.

The Next development server allows the Arena preview host pattern `*.e2b.app`. This is a development-only host allowance. Production hostnames and trusted proxy behavior must be specified by the deployment environment.

Student confirmation email is sent by the API using the server-side `EMAIL_PROVIDER` setting. Local development can use Mailpit to capture messages without sending to an external inbox. Gmail uses Nodemailer with OAuth2 or an eligible App Password. Brevo and Resend use their transactional email APIs. Provider credentials never enter browser code. Email confirmation verifies mailbox access only. The user's matric number is not looked up or treated as proof of student status.

## Data and time

PostgreSQL is the source of truth for future attendance records. Timestamps use timezone-aware columns. Institution-local display defaults to `Africa/Lagos`; all stored instants remain timezone-aware. Academic years and semesters are explicit records, not derived from a user's current class level.

## Reliability and scaling decisions

- Critical check-in creation will be transactional and idempotent.
- Duplicate protection will be a database unique constraint, not a frontend check.
- Historical data will use restrictive deletion rules and append-only audit events where decisions change.
- SSE is the initial real-time option for lecturer views if it is needed. It is not implemented.
- Redis, job queues, PostGIS and separate services are deferred until measured throughput or domain needs justify them.
- Connection pool size is configured conservatively at 10 for the initial API process. Production pooling and total connection budgets must be reviewed against the chosen PostgreSQL provider.

## Security boundaries

Authorization belongs in API handlers and domain services. Student account routes are authenticated, but the tested administrative-scope helper remains a primitive and is not connected to academic routes. Public sign-up cannot assign staff roles. Email confirmation creates a student account, not an institution-verified student identity. No course, attendance or administrative write routes are exposed. No account data can be stored until `DATABASE_URL` is configured. Production deployment is blocked on an approved identity process, trusted-edge rate limiting, CSRF review, privacy decisions, institutional approvals and operational controls.

## Failure behavior

The API health endpoint reports liveness. The readiness endpoint reports whether PostgreSQL responded to `SELECT 1`. Health responses are not cached. A failed readiness check is not presented as a successful database connection. Check-in behavior will be designed so a student is never shown a confirmed result before the server commits it.
