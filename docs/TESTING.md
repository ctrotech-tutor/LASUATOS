# Testing and quality checks

## Checks available now

Run from the repository root:

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

The Vitest suite currently covers API liveness and readiness behavior, including database errors that must not leak, and administrative scope boundaries. The current suite has 12 unit tests. It does not prove production security, database correctness under concurrency or real-world performance.

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
