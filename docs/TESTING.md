# Testing and quality checks

## Checks available now

Run from the repository root:

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

The Vitest suite covers API liveness and readiness behavior, safe error responses, administrative scope boundaries, and roster preflight checks for column mapping, schema limits, duplicate enrolments and course consistency. The suite currently has 23 unit tests. The roster tests use synthetic input strings, not institutional records. They do not prove production security, database correctness under concurrency or real-world performance.

The Drizzle schema and migration can be generated without an active database:

```sh
corepack pnpm db:generate
```

A configured development PostgreSQL instance is needed to apply migrations and test database operations. No test database is currently connected.

## Required tests as domains are added

### Identity and authorization

- Login, logout, expiry, revocation, cookie flags and CSRF behavior.
- Inactive accounts, invalid credentials and rate limits.
- Student ownership, assigned lecturer access and every administrative scope.
- IDOR, cross-institution access and role escalation attempts.

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
