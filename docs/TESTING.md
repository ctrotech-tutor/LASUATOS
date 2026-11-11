# Testing and quality checks

## Checks available now

Run from the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Vitest suite covers API liveness and readiness, student/lecturer/administrator account routes and cookies, administrator overview authorization, course offering/enrollment and attendance route permissions, code normalization and hashing, attendance session-code generation and service errors, email adapter behavior and environment validation, scrypt credential helpers, scoped authorization boundaries, roster preflight checks, and safeguards against remote or non-Compose local databases in the setup and seed scripts. The roster/course/attendance tests use synthetic values, not institutional records. One PGlite integration test applies migrations `0000`–`0005` to an embedded PostgreSQL engine and exercises attendance assignment/enrollment checks, hashed codes, duplicate check-in, rotation, roster retrieval, open-session visibility and closing. A second test (`apps/api/src/e2e/attendance-flow.integration.test.ts`) runs the complete product flow over HTTP with the production service wiring: lecturer sign-in, course offering, join-code issuance, student registration, email-verification token capture, enrollment, session creation, code-type confusion rejection (course code ≠ attendance code), check-in plus normalized duplicate retry, open-session listing, roster, close and history. This verifies the API and SQL paths locally, but does not replace a configured PostgreSQL/email service, a real browser or concurrent load. Route and service tests use injected repositories; no real email delivery, production security or real-world performance is tested.

### Venue management

The venue phase adds service and route tests with injected repositories (institution-administrator write gating, code/label normalization, duplicate/cross-tenant error mapping, coordinate and radius validation before database access) plus a PGlite integration test (`apps/api/src/venue/postgres-repository.integration.test.ts`) applying migrations `0000`–`0006` and exercising the full tenant-scoped lifecycle: campus/building/venue creation, duplicate-code and foreign-campus rejection, activation blocked without a registered boundary (service and DB check constraint agree), audited location registration (`registered` then `updated` events), and cross-institution read/write invisibility. The `packages/verification` suite independently covers symmetric and antipodal distance, the full within/outside/inconclusive outcome matrix and input guards of the geofence evaluator. Still needed with a configured PostgreSQL service: concurrent location registration, real GPS accuracy behavior from physical devices at real venues, and venue-aware attendance check-ins once that phase ships.

The Drizzle schema and migration can be generated without an active database:

```sh
pnpm db:generate
```

A configured development or deployment PostgreSQL service is still needed to validate the real driver, deployment configuration and concurrent behavior. This sandbox has no `DATABASE_URL`, Docker or external PostgreSQL service; the PGlite test runs an embedded database in memory.

## Required tests as domains are added

### Identity and authorization

Current unit tests cover strict public registration fields, acceptance of non-school email addresses, server-only student role assignment boundaries, one-time verification response cookies, session lookup, logout cookie clearing, password hashing, generic credential failures and email-adapter request construction.

Still needed:

- PostgreSQL integration tests for duplicate registration, concurrent verification, resend cooldown, token expiry and revocation.
- Password reset, account recovery, session rotation, CSRF review and trusted-edge rate limiting.
- Student ownership, assigned lecturer access and every administrative scope on future routes.
- IDOR, cross-institution access and role-escalation attempts against connected academic workflows.

### Course offerings and enrollment

Unit and API-route tests cover the provisioned lecturer/student boundaries, server-owned account ID, creation conflicts, strict request validation, code normalization and hashing, idempotent repeat joins, one-time code response and no-store headers. The course-join same-institution database check still needs PostgreSQL integration coverage; the PGlite adapter test covers the corresponding attendance enrollment boundary only. Public registration remains student-only.

Still needed with PostgreSQL:

- Apply migrations `0004` and `0005` on a configured PostgreSQL test database; verify course-code hashes/expiry and tenant-aware attendance foreign keys. PGlite applies all migrations locally, but does not verify the deployed PostgreSQL service or rejected cross-tenant inserts.
- Exercise institution/department role scope, concurrent offering/code creation, code rotation/revocation and semester-end rejection.
- Prove same-institution joins, cross-tenant rejection, duplicate enrollment idempotency and withdrawn enrollment behavior; run the complete synthetic student/lecturer flow.

### Academic records

- Tenant-safe faculty, department and course ownership.
- Enrollment uniqueness and historical status changes.
- Session and semester boundary validation.

### Local roster preflight

- Header auto-detection, manual mapping requirements and duplicate source-column rejection.
- Student identifiers remain strings, including leading zeroes.
- Duplicate enrolments are flagged only within the same offering; the report never echoes student numbers.
- Course metadata conflicts, field-size limits, credit-unit bounds and row-width errors are reported.
- Browser checks must remain local. A browser-level test should confirm that selecting a file causes no upload request before this workflow is used with approved records.

### Venue and verification

- Haversine calculations with known points.
- Accuracy and reading-age handling.
- Geofence configuration bounds.
- Challenge randomness, expiry, session binding and replay prevention.
- Explicit handling of verified, inconclusive, flagged and rejected cases.

### Attendance

The current MVP has service and route tests for lecturer/student role boundaries, session-code validation/normalization, session creation duration limits, code hashing, idempotent response shape, roster/history ownership and expired-session display. These use injected repositories. The PGlite adapter test (`apps/api/src/attendance/postgres-repository.integration.test.ts`) additionally applies migrations to embedded PostgreSQL and verifies the real SQL path: lecturer assignment denial, hashed active-code lookup, enrollment enforcement, one check-in per student/session, code rotation invalidating the previous code, tenant-scoped roster retrieval and closed-session check-in rejection.

Still needed with a configured PostgreSQL service:

- Apply migration `0005` through the deployed driver/migration path and verify all composite foreign keys and the unique `(attendance_session_id, student_user_id)` index reject invalid cross-tenant inserts.
- Test semester/session expiry boundaries, close and rotation races, cross-tenant rejection and a student's own history isolation against the real service.
- Submit concurrent check-ins for one student/session; verify exactly one record commits and retries return the original timestamp.
- Exercise concurrent check-ins by many synthetic students and measure database lock behavior before a pilot.

### Reports and corrections

- **Report module:** `apps/api/src/attendance/report.test.ts` unit-tests the pure report module. It covers cell classification (including `not_enrolled` before enrollment and revoked never counting), rate maths with zero eligible sessions, threshold flags for active enrollments only, the student summary, CSV BOM/CRLF/quoting, formula-injection escaping and the filename.
- **Service:** service tests cover reason trimming and length validation before any repository call, and map `not_assigned` to `404` and `session_not_started`/`not_enrolled`/`no_record` to `409`, each with an exposed detail.
- **Routes:** route tests cover lecturer-only reports and CSV headers, threshold/UUID/unknown-query `400`s, correction validation, the audit trail, the student summary, and the revoked re-check-in `409` detail. Admin route tests cover `/api/v1/admin/attendance` (`200`/`403`/`401`). `server.test.ts` checks that only `exposeDetail` errors reveal their message.
- **PGlite integration:** a second test in `apps/api/src/attendance/postgres-repository.integration.test.ts` applies migrations `0000`–`0008` and checks:
  - mark-present, revoke and restore corrections, plus unchanged no-ops writing no audit row
  - the append-only trigger and the revoked re-check-in refusal
  - report cells, totals and the CSV export
  - the student summary
  - the administrator overview at institution scope and at an unrelated department scope (which sees nothing)

Still needed: concurrent corrections against a configured PostgreSQL service, browser end-to-end runs of the report/correction/export UI, and a student-initiated dispute workflow (not implemented).

### End-to-end and load tests

The end-to-end code-based check-in flow can be exercised with the guarded synthetic local setup once PostgreSQL and Mailpit are available; it has not been run in this sandbox. The venue-verified workflow in the product brief remains future work. A pilot load test must use controlled test records and report the actual environment, concurrency, throughput, latency percentiles, errors, database utilization and duplicate count. Do not present the proposed targets as measured results.
