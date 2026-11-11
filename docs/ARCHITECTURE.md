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

The API exposes health/readiness, student registration and verification, student/lecturer/administrator sign-in, server-managed sessions, lecturer-scoped course offerings and attendance sessions, student enrollment and check-in, and a scope-filtered administrator overview. The database client remains optional so the interface can be reviewed without institutional credentials. Database-backed workflows are unavailable until a database is configured. Readiness reports `not_configured` or `down` rather than pretending the service is ready.

## Technology choices

The current pinned direct dependencies are Next.js 16.4.6, React 19.3.1, Fastify 5.12.8, TypeScript 6.0.3, ESLint 10.14.0 with TypeScript ESLint 8.72.2, Tailwind CSS 4.3.5, Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, PostgreSQL driver `pg` 8.23.1, Nodemailer 10.3.1, Zod 4.6.7, lucide-react 1.70.0, pnpm 12.18.0 and Vitest 5.1.0. The selected versions were checked against the available package registry and exercised with the repository checks. Drizzle ORM 1.0 beta is intentionally not used.

Node 22.12 or newer is required for the selected test runner and framework toolchain. The package manager is pinned to avoid unreviewed package-manager changes.

## Module responsibilities

- `apps/web`: accessible operator-facing web workspace and same-origin API routing.
- `apps/api`: request lifecycle, validation, student/lecturer authentication, course offering/enrollment and attendance services, email delivery adapters, and scoped administrator overview routes.
- `packages/contracts`: shared request and response shapes. Schemas must not contain database access.
- `packages/auth`: password hashing, one-time token helpers and administrative scope rules. It does not decide student status.
- `packages/database`: PostgreSQL schema, typed client and reviewed migrations.
- Attendance session lifecycle and transactional check-in currently live in `apps/api/src/attendance`; a separate verification domain is future work if venue evidence is approved.
- Future worker: add only when background work needs an independent lifecycle.

## Request and browser boundaries

The browser calls a relative path such as `/api/v1/health`. Next.js rewrites that path on the server to `API_INTERNAL_URL`, defaulting to `http://127.0.0.1:4000` for local development. The internal URL is never embedded in browser code. The rewrite avoids exposing a second public browser origin and keeps CORS policy simple.

The Next development server allows the Arena preview host pattern `*.e2b.app`. This is a development-only host allowance. Production hostnames and trusted proxy behavior must be specified by the deployment environment.

Student confirmation email is sent by the API using the server-side `EMAIL_PROVIDER` setting. Local development can use Mailpit to capture messages without sending to an external inbox. Gmail uses Nodemailer with OAuth2 or an eligible App Password. Brevo and Resend use their transactional email APIs. Provider credentials never enter browser code. Email confirmation verifies mailbox access only. The user's matric number is not looked up or treated as proof of student status.

## Data and time

PostgreSQL is the source of truth for attendance sessions and committed check-in records. Timestamps use timezone-aware columns. Institution-local display defaults to `Africa/Lagos`; all stored instants remain timezone-aware. Academic years and semesters are explicit records, not derived from a user's current class level.

## Reliability and scaling decisions

- Check-in creation is transactional and idempotent; the unique `(session, student)` database constraint is the final duplicate guard.
- The attendance service checks the signed-in student's active course enrollment before the transaction creates a record.
- Historical data will use restrictive deletion rules and append-only audit events where decisions change.
- SSE is the initial real-time option for lecturer views if it is needed. It is not implemented.
- Redis, job queues, PostGIS and separate services are deferred until measured throughput or domain needs justify them.
- Connection pool size is configured conservatively at 10 for the initial API process. Production pooling and total connection budgets must be reviewed against the chosen PostgreSQL provider.

## Security boundaries

Authorization belongs in API handlers and domain services. Lecturer course and attendance routes derive institution/department scope from the authenticated profile and verify active course assignments; student enrollment and attendance records are restricted to the signed-in student's profile. Administrator accounts require a provisioned role assignment, and the overview endpoint filters every count to that server-resolved institution, faculty or department. Public sign-up cannot assign staff roles. Email confirmation creates a student account, not an institution-verified student identity. A course code enrolls a student; a separate attendance code records a timestamped code check-in but does not prove venue presence. These database-backed routes require `DATABASE_URL` and appropriately provisioned accounts. The attendance PostgreSQL adapter is exercised by an embedded PGlite integration test; equivalent coverage for auth/course adapters, plus tests against the configured PostgreSQL service, remain outstanding, as do course/attendance-code rate limiting, production CSRF review, privacy decisions, institutional approvals and broader operational controls.

## Failure behavior

The API health endpoint reports liveness. The readiness endpoint reports whether PostgreSQL responded to `SELECT 1`. Health responses are not cached. A failed readiness check is not presented as a successful database connection. The check-in route returns a recorded result only after the database transaction inserts or finds the student's unique session record.
