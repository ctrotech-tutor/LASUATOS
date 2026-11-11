# Testing and quality checks

## Checks available now

Run from the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Vitest suite covers API liveness and readiness, student-account route validation and cookies, email adapter behavior and environment validation, scrypt credential helpers, administrative scope boundaries, roster preflight checks, and safeguards against remote or non-Compose local databases in the setup and seed scripts. The roster tests use synthetic strings, not institutional records. Account tests use injected repositories and provider responses; they do not exercise PostgreSQL, real email delivery, production security, concurrency or real-world performance.

The Drizzle schema and migration can be generated without an active database:

```sh
pnpm db:generate
```

A configured development PostgreSQL instance is needed to apply migrations and test database operations. No test database is currently connected.

## Required tests as domains are added

### Identity and authorization

Current unit tests cover strict public registration fields, acceptance of non-school email addresses, server-only student role assignment boundaries, one-time verification response cookies, session lookup, logout cookie clearing, password hashing, generic credential failures and email-adapter request construction.

Still needed:

- PostgreSQL integration tests for duplicate registration, concurrent verification, resend cooldown, token expiry and revocation.
- Password reset, account recovery, session rotation, CSRF review and trusted-edge rate limiting.
- Student ownership, assigned lecturer access and every administrative scope on future routes.
- IDOR, cross-institution access and role-escalation attempts against connected academic workflows.

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

- State transitions, idempotent requests and duplicate prevention.
- Transaction behavior under concurrent submissions.
- Closing/finalization and attendance percentage calculations.
- Corrections with prior and new values, actor, reason and timestamp.

### End-to-end and load tests

The complete admin-to-student workflow in the product brief remains future work. A pilot load test must use controlled test records and report the actual environment, concurrency, throughput, latency percentiles, errors, database utilization and duplicate count. Do not present the proposed targets as measured results.
