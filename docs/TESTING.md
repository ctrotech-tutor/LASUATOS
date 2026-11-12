# Testing and quality checks

## Checks available now

Run from the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Vitest suite covers API liveness and readiness, student/lecturer/administrator account routes and cookies, administrator overview authorization, course offering/enrollment and attendance route permissions, code normalization and hashing, attendance session-code generation and service errors, email adapter behavior and environment validation, scrypt credential helpers, scoped authorization boundaries, roster preflight checks, and safeguards against remote or non-Compose local databases in the setup and seed scripts. The roster/course/attendance tests use synthetic values, not institutional records. The PGlite integration tests (sharing `apps/api/src/attendance/integration-fixture.ts`) apply every migration in order. The first to an embedded PostgreSQL engine and exercises attendance assignment/enrollment checks, hashed codes, duplicate check-in, rotation, roster retrieval, open-session visibility and closing. A second test (`apps/api/src/e2e/attendance-flow.integration.test.ts`) runs the complete product flow over HTTP with the production service wiring: lecturer sign-in, course offering, join-code issuance, student registration, email-verification token capture, enrollment, session creation, code-type confusion rejection (course code ≠ attendance code), check-in plus normalized duplicate retry, open-session listing, roster, close and history. This verifies the API and SQL paths locally, but does not replace a configured PostgreSQL/email service, a real browser or concurrent load. Route and service tests use injected repositories; no real email delivery, production security or real-world performance is tested.

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

Still needed: concurrent corrections against a configured PostgreSQL service, and browser end-to-end runs of the report/correction/export UI.

### Attendance disputes

- **Policy:** `apps/api/src/attendance/dispute-policy.test.ts` covers:
  - every eligibility rule, plus the order that decides which reason is reported when several apply
  - the session-ended time (the earlier of close time and scheduled end) and the inclusive 14-day deadline
  - whether a session is still accepting check-ins
  - resubmission after withdrawal, and the open-dispute cap boundary (9 is allowed, 10 is refused)
- **Service:** `dispute-service.test.ts` covers:
  - statement and note trimming and length checks before any repository call
  - the server deriving the dispute kind
  - mapping each refusal and the `already_open` race result to `404`/`409` with exposed detail
  - listing only sessions that are structurally eligible
  - the lecturer queue defaulting to open disputes
  - mapping each resolution outcome
- **Routes:** `dispute-routes.test.ts` covers:
  - serialization
  - `401` (missing or unknown cookie), `403` (wrong account type, checked before the service is called) and `503` (no service)
  - strict bodies that reject `studentId` or `kind` from the client, and strict queries
  - empty-body withdrawal
  - the count endpoint
  - `no-store` on every route
- **PGlite integration:** `dispute.integration.test.ts` applies migrations `0000`–`0009` and runs the full workflow:
  - a missing check-in is refused while check-in is open; non-enrolled and late-enrolled students are refused
  - submission, the duplicate check, and a racing duplicate caught by the partial unique index
  - the guard trigger: submission fields are immutable, decided disputes are frozen, and deletes are rejected
  - withdrawal and resubmission
  - lecturer scope: an unassigned lecturer sees nothing and gets `404`
  - open counts in the queue, the badge count, the report total and the administrator totals and oldest waiting dispute
  - upholding produces a correction linked to the dispute (`viaDispute: true`), after which a new dispute is refused because the student is present
  - a revoked check-in is disputed, with the lecturer's reason shown, and then rejected
  - upholding is refused for a withdrawn enrollee
  - submissions are refused after the window closes

Still needed: concurrent resolution by two lecturers against a configured PostgreSQL service, and browser runs of the student panel and the lecturer review queue.

### Account security (Phase 10)

- **Unit** (`apps/api/src/security/*.test.ts`):
  - Rate-limit keys are digests and never contain the subject.
  - Fixed windows reset on time and memory eviction is bounded.
  - Every rule is counted and the longest `Retry-After` wins.
  - The limiter fails open when the store fails.
  - The origin-guard decision matrix covers safe methods, Fetch Metadata values, exact `Origin` matching, `Origin: null` and header-less clients.
- **HTTP hooks** (`security/http.test.ts`):
  - Headers are present on both success and `404` responses, and HSTS appears only when enabled.
  - A cross-site mutation returns `403`, while the app origin and same-origin requests pass.
  - The sign-in email limit ignores letter case; the address limit applies across many emails.
  - `X-Forwarded-For` is honoured only from a trusted proxy.
  - Check-in is limited per session, not per address.
  - Unrelated routes are not counted.
- **Service** (`auth/service.test.ts`):
  - A reset token is stored as a digest with a 30-minute expiry, and only the raw token is emailed.
  - Missing, ineligible and cooling-down addresses send nothing but still resolve.
  - An unconfigured transport returns `503`; a delivery failure is deferred.
  - Completion stores a fresh hash and sends a notice; invalid tokens are rejected; a notice failure does not fail the reset.
  - A password change requires a session and the correct current password and rejects an unchanged password.
  - Sessions can be listed and revoked.
- **Routes** (`auth/routes.test.ts`):
  - Reset requests return an identical generic `202`, including when delivery is deferred.
  - Strict bodies and password lengths are enforced.
  - Completion clears the cookie (`Secure` in production).
  - Password change returns `401`/`400`/`200`.
  - The session list contains no tokens and is `no-store`.
  - The revoke routes return `200`/`400`/`401`/`404`.
- **Email:** reset links carry the token only in the fragment, display names are escaped, notices use Lagos time and contain no links, and the provider path is exercised.
- **Environment:** the defaults are applied, `TRUST_PROXY` is parsed, production refuses `RATE_LIMIT_STORE=off`, and `TRUSTED_ORIGINS` must contain bare origins.
- **Integration (PGlite)** (`apps/api/src/e2e/account-security.integration.test.ts`, sharing `e2e/harness.ts` with the attendance flow):
  - **Sessions:** listing, revoking by id, revoking all others, and last-seen ordering.
  - **Password change:** sessions are revoked, the old password is rejected and the new one accepted.
  - **Reset:** no enumeration, unverified accounts excluded, cooldown and superseded tokens, single use, 30-minute expiry, and invalidation by a password change. Only digests are stored.
  - **Rate limits:** the PostgreSQL store returns `429` after 10 sign-ins and stores no raw identifiers; concurrent increments and window reset are checked.
  - **Cross-origin:** a cross-site reset request is blocked before any email is sent.

### Staff provisioning (Phase 11)

Implemented in `apps/api/src/e2e/staff-provisioning.integration.test.ts` (PGlite, production repositories over HTTP) and `apps/api/src/staff/policy.test.ts`:

- **Bootstrap:** creates an institution-administrator invitation with no inviter, emails it and only prints the link when asked or when email fails. Bad arguments and unknown faculty or department codes are rejected, and a duplicate pending invitation exits as "already exists".
- **Acceptance:** preview shows role, area and inviter. Short passwords are refused. Accepting signs the person in with the right workspace and a confirmed email, creates the lecturer profile and scoped role, and the link cannot be reused. Links expire after 7 days.
- **Scope:** faculty administrators cannot invite outside their faculty or above their level; department administrators only into their own department. Another area's invitations cannot be revoked. The directory lists only manageable people plus self. Lecturers get `403` and signed-out callers `401`. The policy matrix is unit tested.
- **Conflicts:** pending duplicates (ignoring letter case), existing accounts and taken staff numbers are refused. An expired invitation is replaced.
- **Tokens:** the invitation response never contains a token, resend rotates it, revoke kills it, and a cross-site invite request is blocked.
- **Suspension:** needs a reason and cannot target oneself or a senior administrator. It revokes the live session and blocks sign-in; repeating it gives `409`. Reactivation restores sign-in.
- **Audit:** all six actions are recorded with actor and reason, and updates and deletes on the audit table fail.

Still to run: the same walkthrough in a browser with real email delivery, and migration `0011` against a configured PostgreSQL server.

### End-to-end and load tests

The end-to-end code-based check-in flow can be exercised with the guarded synthetic local setup once PostgreSQL and Mailpit are available; it has not been run in this sandbox. Phase 10 adds a guarded load fixture seeder and a check-in burst script; `docs/LOAD_TESTING.md` explains how to run them and what to record. **No load results have been measured.** A pilot load test must use controlled test records and report the actual environment, concurrency, throughput, latency percentiles, errors, database utilization and duplicate count. Do not present the proposed targets as measured results.
