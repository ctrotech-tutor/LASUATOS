# Testing and quality checks

## Checks available now

Run from the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Vitest suite covers API liveness and readiness, student/lecturer/administrator account routes and cookies, administrator overview authorization, course offering/enrollment and attendance route permissions, code normalization and hashing, attendance session-code generation and service errors, email adapter behavior and environment validation, scrypt credential helpers, scoped authorization boundaries, and safeguards against remote or non-Compose local databases in the setup and seed scripts. The roster/course/attendance tests use synthetic values, not institutional records. The PGlite integration tests (sharing `apps/api/src/attendance/integration-fixture.ts`) apply every migration in order. The first to an embedded PostgreSQL engine and exercises attendance assignment/enrollment checks, hashed codes, duplicate check-in, rotation, roster retrieval, open-session visibility and closing. A second test (`apps/api/src/e2e/attendance-flow.integration.test.ts`) runs the complete product flow over HTTP with the production service wiring: lecturer sign-in, course offering, join-code issuance, student registration, email-verification token capture, enrollment, session creation, code-type confusion rejection (course code ≠ attendance code), check-in plus normalized duplicate retry, open-session listing, roster, close and history. This verifies the API and SQL paths locally, but does not replace a configured PostgreSQL/email service, a real browser or concurrent load. Route and service tests use injected repositories; no real email delivery, production security or real-world performance is tested.

**Size.** About 1,220 tests in 138 files (`apps/**`, `packages/**`, `scripts/**` and `status/**`, per `vitest.config.ts`); a full run takes about three minutes on a 2-vCPU machine. 25 files are integration tests (`*.integration.test.ts`) that run the real PostgreSQL repositories on PGlite, an in-process PostgreSQL, after applying every migration:

- **Accounts:** `account-security`, `account-recovery`, `account-release`, `google-proof`, `auth/cleanup`, `sign-in-scale` (sign-in and session lookups at LASU size, and their query plans).
- **Students and class lists:** `student-onboarding`, `class-records`, `direct-entry-jamb`, `unlisted-accounts`.
- **Lecture attendance:** `lecture-flow` (scan, ticket, check-in, phone rule, hand-adding, registers), `face-help-governance` (face checks, help requests, reviews, audit log, retention), `semester-end`.
- **Enrolled courses:** `attendance-flow`, `attendance/postgres-repository`, `dispute`, `dispute-appeal`.
- **Administration:** `staff-provisioning`, `admin/structure`, `admin/record-editing`, `venue/postgres-repository`, `institution/setup`, `institution/engineering-departments`, `contact`, `system-health`.

**CI** (`.github/workflows/ci.yml`) runs `pnpm lint`, `pnpm typecheck`, `pnpm test` and the web build on every push and pull request. It has no separate PostgreSQL service: the integration tests bring their own PGlite database. The load tests below are run by hand against a local PostgreSQL 16.

**Docs that are checked.** `apps/api/src/security/rate-limit-docs.test.ts` fails when the rate-limit table in `docs/API.md` no longer matches `rate-limit-policies.ts`, or when a policy names a route the server does not serve. Regenerate the table with `pnpm --filter @lasuatos/api docs:rate-limits`.

Earlier slices added, among others:

- **Student level:** reading the entry year from LASU matric numbers (9 and 10 digits, non-LASU shapes rejected), Direct Entry, programme-length caps, "extra year", "not started" and "Level unknown"; the profile, entry-level and department routes; and admin `studentLevels`.
- **QR:** challenge signing and expiry, the `/check-in#…` link helpers (`buildCheckInLink`, `extractCheckInChallenge`), QR-only sessions refusing typed codes with 409, the `/settings` toggle, and the shared-device flag (two students, one token) in the end-to-end flow.
- **Disputes:** lecturers emailed only for the first open dispute of a session; students emailed on uphold and reject; a failing email never breaks the action.
- **Academic structure:** the role matrix (institution / faculty / department admin), case-insensitive department codes, one current session, semester validation, and an audit row for every change.
- **Walking guide:** the open-session `venueGuide` (coordinates only for active venues) and the on-phone distance helper (`apps/web/lib/walking-guide.test.ts`: inside, near, away and the rough-accuracy note).

### Browser and mobile checks

Pages were checked in headless Chromium at 390 × 844 (phone), 820 (tablet) and 1280 (desktop) for every role: no page scrolls sideways, the phone bottom tab bar and account menu work, tables turn into labelled cards on phones, and the QR check-in link lands correctly. This was a manual pass, not an automated test.

### Venue management

The venue phase adds service and route tests with injected repositories (institution-administrator write gating, code/label normalization, duplicate/cross-tenant error mapping, coordinate and radius validation before database access) plus a PGlite integration test (`apps/api/src/venue/postgres-repository.integration.test.ts`) applying migrations `0000`–`0006` and exercising the full tenant-scoped lifecycle: campus/building/venue creation, duplicate-code and foreign-campus rejection, activation blocked without a registered boundary (service and DB check constraint agree), audited location registration (`registered` then `updated` events), and cross-institution read/write invisibility. The `packages/verification` suite independently covers symmetric and antipodal distance, the full within/outside/inconclusive outcome matrix and input guards of the geofence evaluator. Still needed with a configured PostgreSQL service: concurrent location registration, real GPS accuracy behavior from physical devices at real venues, and venue-aware attendance check-ins once that phase ships.

The Drizzle schema and migration can be generated without an active database:

```sh
pnpm db:generate
```

PGlite runs the same SQL as PostgreSQL but in one process, so true concurrency (many connections, row locks under contention) is exercised by the load tests on a real local PostgreSQL instead (`docs/LOAD_TESTING.md`): up to 1,800 simultaneous check-ins with 0 duplicates and 0 lost, and a pilot morning of sign-ins and session reads.

## Coverage by area

Each area lists what is tested. Items marked *open* are not covered yet.

### Identity and authorization

Current unit tests cover strict public registration fields, acceptance of non-school email addresses, server-only student role assignment boundaries, one-time verification response cookies, session lookup, logout cookie clearing, password hashing, generic credential failures and email-adapter request construction.

Since then: reset, recovery, release, Google proofs, session revocation, rate limits and the origin guard have PGlite integration tests (see *Account security* below), and the November 2026 review exercised every route as every kind of account (ADR 033). *Open:* concurrent email verification on a real PostgreSQL.

### Course offerings and enrollment

Unit and API-route tests cover the provisioned lecturer/student boundaries, server-owned account ID, creation conflicts, strict request validation, code normalization and hashing, idempotent repeat joins, one-time code response and no-store headers. The course-join same-institution database check still needs PostgreSQL integration coverage; the PGlite adapter test covers the corresponding attendance enrollment boundary only. Public registration remains student-only.

Every migration is applied on each production deploy and by every integration test. *Open:* concurrent offering and code creation on a real PostgreSQL. (The enrolled-course tools are hidden until used, ADR 020.)

### Academic records

Covered by `admin/structure`, `admin/record-editing`, `institution/setup` and `semester-end` (role matrix, case-insensitive codes, one current session, semester validation, registers per semester, audit rows).

### Venue and verification

`packages/verification` unit tests cover Haversine distances with known points, outline validation and simplification, `evaluatePresence` for every reason (stale, approximate, coarse, inside, within the allowance, outside, outside but uncertain), the older circular evaluator, combining GPS fixes, lecture codes (windows, grace, tickets, normalisation, the alphabet) and the `lasu1` challenge (signing, expiry, session binding). The lecture service and `lecture-flow` integration test cover the venue check end to end, including the refusal messages.

### Attendance

The current MVP has service and route tests for lecturer/student role boundaries, session-code validation/normalization, session creation duration limits, code hashing, idempotent response shape, roster/history ownership and expired-session display. These use injected repositories. The PGlite adapter test (`apps/api/src/attendance/postgres-repository.integration.test.ts`) additionally applies migrations to embedded PostgreSQL and verifies the real SQL path: lecturer assignment denial, hashed active-code lookup, enrollment enforcement, one check-in per student/session, code rotation invalidating the previous code, tenant-scoped roster retrieval and closed-session check-in rejection.

Quick lecture sessions are covered by `lecture-flow` (PGlite) and the lecture service and route tests. Concurrent check-ins by many students, retries and the phone rule under the session lock were measured on a real PostgreSQL by `pnpm load:lecture` and `pnpm load:rush` (0 duplicates, 0 lost). *Open:* close and rotation races on a real PostgreSQL for the enrolled-course sessions.

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

*Open:* concurrent corrections on a real PostgreSQL, and automated browser runs of the report, correction and export screens.

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

Appeals have their own integration test (`dispute-appeal.integration.test.ts`: eligibility, the guard trigger, who may decide, the linked correction, emails). *Open:* concurrent resolution by two lecturers on a real PostgreSQL, and automated browser runs.

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

Role and area changes (ADR 025, `POST /api/v1/admin/staff/members/{userId}/position`) are covered in the same integration test, including the `staff_role_changed` audit row. *Open:* an automated browser run with real email delivery.

### End-to-end and load tests

The whole flow can be tried by hand with the guarded synthetic local setup (`README.md`, *Local development*). There are no automated browser tests; pages were checked by hand in a headless browser. Phase 10 added a guarded load fixture seeder and a check-in burst script for staging, and `pnpm load:embedded` runs a whole burst against the real API on an embedded database with an integrity check. `pnpm load:rush` (a lecture-start rush with the real face check) and `pnpm load:pilot` (a pilot morning: sign-ins, account opening, face registration, the attendance page and session reads on a LASU-sized database) run the production wiring against a local PostgreSQL. `docs/LOAD_TESTING.md` explains how to run them all and records their results. **No staging or production capacity has been measured**; the real-phone practice day (`docs/PILOT_PRACTICE_DAY.md`) is the check on the live site. A pilot load test must use controlled test records and report the actual environment, concurrency, throughput, latency percentiles, errors, database utilization and duplicate count. Do not present the proposed targets as measured results.
