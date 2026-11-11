# Testing and quality checks

## Checks available now

Run from the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Vitest suite covers API liveness and readiness, student/lecturer/administrator account routes and cookies, administrator overview authorization, course offering/enrollment and attendance route permissions, code normalization and hashing, attendance session-code generation and service errors, email adapter behavior and environment validation, scrypt credential helpers, scoped authorization boundaries, roster preflight checks, and safeguards against remote or non-Compose local databases in the setup and seed scripts. The roster/course/attendance tests use synthetic values, not institutional records. One PGlite integration test applies migrations `0000`–`0005` to an embedded PostgreSQL engine and exercises attendance assignment/enrollment checks, hashed codes, duplicate check-in, rotation, roster retrieval and closing. This verifies the attendance SQL path locally, but does not replace a configured PostgreSQL service or test concurrent load. Route and service tests use injected repositories; no real email delivery, production security or real-world performance is tested.

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

The current MVP has service and route tests for lecturer/student role boundaries, session-code validation/normalization, session creation duration limits, code hashing, idempotent response shape, roster/history ownership and expired-session display. These use injected repositories. The PGlite adapter test (`apps/api/src/attendance/postgres-repository.integration.test.ts`) additionally applies migrations `0000`–`0005` to embedded PostgreSQL and verifies the real SQL path: lecturer assignment denial, hashed active-code lookup, enrollment enforcement, one check-in per student/session, code rotation invalidating the previous code, tenant-scoped roster retrieval and closed-session check-in rejection.

Still needed with a configured PostgreSQL service:

- Apply migration `0005` through the deployed driver/migration path and verify all composite foreign keys and the unique `(attendance_session_id, student_user_id)` index reject invalid cross-tenant inserts.
- Test semester/session expiry boundaries, close and rotation races, cross-tenant rejection and a student's own history isolation against the real service.
- Submit concurrent check-ins for one student/session; verify exactly one record commits and retries return the original timestamp.
- Exercise concurrent check-ins by many synthetic students and measure database lock behavior before a pilot.

Attendance correction/appeal workflows, audit actor/reason fields, attendance percentages, QR-camera scanning and venue verification are not implemented.

### End-to-end and load tests

The end-to-end code-based check-in flow can be exercised with the guarded synthetic local setup once PostgreSQL and Mailpit are available; it has not been run in this sandbox. The venue-verified workflow in the product brief remains future work. A pilot load test must use controlled test records and report the actual environment, concurrency, throughput, latency percentiles, errors, database utilization and duplicate count. Do not present the proposed targets as measured results.
