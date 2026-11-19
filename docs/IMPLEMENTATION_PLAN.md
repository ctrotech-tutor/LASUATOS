# Implementation plan and risk register

## Repository audit

**Status: complete (at the start of the project).** The starting repository contained only a one-line `README.md`, one initial commit and no application, package manifest, database, tests, authentication, environment configuration or product documentation. There was no existing functionality to preserve or dependency set to upgrade. The workspace pins pnpm 12.18.0 in `package.json` (`packageManager`).

No institution credentials, database URL, approved identity integration, academic data, venue coordinates or deployment approvals were present. Those gaps were treated as integration and governance dependencies, not filled with invented values. Production now runs on Vercel and Neon (ADR 015); student records come from the department's class lists (ADR 021), and venues are mapped by administrators in production, never committed to the repository.

## Where things stand (November 2026)

LASUATOS is live on Vercel and Neon and in a pilot with real students. Since Phase 11 the work has been recorded as ADRs rather than numbered phases:

| Area | What was built | Where |
| --- | --- | --- |
| Free production | One Vercel deployment with the API embedded; institution setup command | ADR 015 |
| Quick lecture attendance | Sessions for any course on the course list, changing QR codes, class reps who take attendance, hand-added entries, registers per term | ADR 018, ADR 019, ADR 020, `docs/LECTURE_ATTENDANCE.md` |
| Operations | Migrations on deploy, error alerts, optional enrolled-course tools, crowd test | ADR 020 |
| Class lists | Accounts opened from the department's lists, assistant reps, JAMB numbers, reading the files departments already have | ADR 021, ADR 022, ADR 024 |
| Live screens | Conditional polling | ADR 023 |
| Staff | Role and area changes in place | ADR 025 |
| Appeals | Rejected disputes can go to the department once | ADR 026 |
| Google | Confirm the email with Google; sign in with Google | ADR 027, ADR 028 |
| Monitoring | Email failover, trend alerts, blocked-request alerts, System health | ADR 029, ADR 036 |
| LASU mail | Read-only inbox in the browser | ADR 030 |
| Lecture-start rush | Face checks in a bounded line, phones that retry | ADR 031 |
| Accessibility and privacy | Notice matches the code | ADR 032 |
| Security review | Starting-password sessions, face check on every check-in, venue check on by default | ADR 033 |
| Status page | Cloudflare Worker and D1, apart from LASUATOS | ADR 034, `status/README.md` |
| Backups | Nightly encrypted, restore-verified backups | ADR 035, `docs/BACKUPS.md` |
| Pilot rehearsal | A pilot morning measured locally; sign-in and session reads made to scale (migration 0033) | `docs/LOAD_TESTING.md`, `docs/PILOT_PRACTICE_DAY.md` |
| Unlisted accounts | Overview counts students the way Class lists does; accounts on no class list can be suspended | `docs/ADMINISTRATION.md` |

The phases below are the record of how the first slices were built. Their **Still needed (when written)** lists were current when each phase was written, and each is followed by a **Since then** note; most have since been done (migrations are applied on deploy, every area has PGlite integration tests, real PostgreSQL load tests ran, dispute emails and appeals exist, staff role changes exist). What is still open is under *Next* below.

## Phase status

### Phase 0: Audit and product foundation

**Complete for this pass.** Added product, architecture, database, API, security, venue, verification, deployment, testing and risk documentation. Research notes on LASU visual identity are in `DECISIONS.md`.

### Phase 1: Foundation

**Complete for this pass.** Implemented:

- pnpm workspace with separate Next.js and Fastify apps.
- Shared Zod contracts and centralized API problem responses.
- PostgreSQL Drizzle schema for institutions, campuses, faculties, departments, accounts, scoped roles, academic sessions, semesters, courses, offerings, enrollments, lecturer assignments and attendance sessions/records.
- Six migrations with restrictive deletion behavior, tenant-aware composite foreign keys, role-to-scope constraints, institution-defined semester labels, account/session tables, hashed enrollment/session codes and duplicate-safe attendance records. (There are now 34 migrations, `0000`–`0033`, applied on every production deploy; ADR 020.)
- An optional PostgreSQL client and honest health/readiness checks.
- A tested administrative scope helper.
- A responsive development workspace with LASUATOS product identity, clear no-records state and live service checks.
- Strict TypeScript, ESLint, Vitest and migration generation scripts.

### Phase 2: Academic data preparation

**Superseded.** The early browser-only course roster preflight (`/setup/roster`) and the developer checklist at `/setup` have been removed. Student records now come in through class lists: each class's HOC (or an administrator) uploads the department's list file (Excel, Word, PDF, CSV or LibreOffice, old .xls and .doc included; ADR 024) or pastes it, and students open their accounts by matric number (see `docs/ADMINISTRATION.md`).

**Since then:** no import of University records is planned. The class list a HOC keeps for their department and set is the source of truth for names, matric (or JAMB) numbers, department and entry route (ADR 021, ADR 022).

### Phase 3: Student accounts

**Implemented, then changed.** This phase built student self-registration, email ownership confirmation, password sign-in for students and lecturers, server-managed sessions and logout. Public registration rejected role fields and assigned only the student role after confirmation; the matric number was self-reported text.

**Since then:** students open their accounts from their class list (`STUDENT_SIGN_UP=class_list`, the default). The matric or JAMB number must be on a list (one entry per number per institution), the name and department come from the list, and the email is confirmed with a code to the LASU address or with Google (ADR 027). Students can sign in by matric number and with Google (ADR 028), and a HOC can give a one-time setup code to a student who cannot get the email. The old free sign-up form remains only behind `STUDENT_SIGN_UP=open`. Lecturer accounts come only from staff invitations (Phase 11). Email goes out through Gmail, Brevo or Resend, with failover between them (ADR 029).

### Phase 4: Lecturer course offerings and student enrollment

**Implemented; PostgreSQL application and end-to-end local verification remain.** Lecturers can list open semesters at their institution, create offerings only within their provisioned department, list assigned offerings, and issue, rotate or revoke enrollment codes. Codes are generated randomly, hashed in storage and expire at semester end. Signed-in students with an active same-institution profile can redeem a code idempotently and list their own active enrollments. Public registration remains student-only. The guarded demo seed provisions synthetic academic records and one department-scoped demo lecturer with a generated one-time password.

**Still needed (when written):** run the guarded `pnpm dev:setup` flow on a local machine with Docker and Mailpit; apply migration `0004`; exercise lecturer login, offering creation, code rotation/revocation, student registration/confirmation and enrollment against PostgreSQL. The sandbox has no Docker/PostgreSQL service, so migration application, database transactions and browser end-to-end behavior are not verified here. Add course-code rate limiting and database-backed concurrency/cross-tenant tests before any pilot.

**Since then:** migrations run on deploy, course-code redemption is rate limited, and the flow is covered by PGlite integration tests. Enrolled courses are now optional and hidden until used (ADR 020); quick lecture attendance (ADR 018) is what lecturers use day to day.

### Phase 5: Code-based attendance MVP

**Implemented; embedded-database verification passed, configured-PostgreSQL and end-to-end verification remain.** An assigned lecturer can open a timed session for an assigned offering, share a random code (stored only as a hash), rotate the code, see the roster and close the session. A signed-in student must have an active enrollment in the same institution/offering. The server records one timestamped check-in per student/session in a transaction, and students can view only their own history. Session codes expire at the requested duration or semester end. The user interface describes the evidence accurately: code use/time only, not verified identity, GPS or venue presence.

**Verified here:** the PGlite integration test applies migrations `0000`–`0005` to embedded PostgreSQL and exercises lecturer-assignment denial, code hashing, enrolled and non-enrolled check-ins, duplicate submissions, code rotation, roster retrieval and closing through the real SQL adapter. This caught and confirmed the fix for a roster-query defect.

**Still needed (when written):** apply migration `0005` through the deployed migration path and exercise the full student/lecturer flow (including browser end-to-end and expiry/close races) against a configured PostgreSQL service. Add trusted-edge rate limiting, cross-tenant and concurrency integration tests before any pilot.

**Since then:** migrations run on deploy, check-ins are rate limited, and concurrent check-ins were load tested on a real PostgreSQL (`docs/LOAD_TESTING.md`). Automated browser tests and close races on a real PostgreSQL are still open.

### Phase 6: Venue management

**Implemented; embedded-database verification passed, real-device survey verification remains.** The schema models campuses with optional map anchors, buildings per campus, and venues with type, capacity, optional floor/section, status lifecycle and a circular geofence (coordinate + 5–2000 m radius). (Since then, venues can also be mapped as building outlines with an allowance, migration `0018`; see `docs/VENUE_SYSTEM.md`.) Venue location changes are audited in `venue_location_events` with actor, timestamp, coordinate, radius and reported device accuracy. All venue rows use tenant-paired composite keys so no read or write can cross institutions. Institution administrators manage the directory from `/admin/venues`: create venues and buildings, capture the on-site GPS coordinate with a live OpenStreetMap/Leaflet boundary preview, then activate; activation without a registered boundary is refused by the service and independently by the `venues_active_location_ck` constraint. `packages/verification` ships the accuracy-aware Haversine geofence evaluator (`within`/`outside`/`inconclusive`). The demo seed adds a clearly-labelled synthetic campus anchor only; the seeded venue stays pending review with no boundary until registered in person.

### Phase 7: Venue-aware attendance

**Implemented; embedded-database verification passed, real-device and field verification remain.** A lecturer may link an attendance session to an active venue with a registered boundary. Open sessions show a rotating QR challenge (`lasu1.<session>.<20-second window>.<HMAC>`, current plus one grace window) alongside the typed code. (Quick lecture sessions use the newer `lasu2` codes with 30-second windows and 10-minute tickets; see `docs/VERIFICATION.md`.) When the venue requires location, the student's browser submits a position sample, and the accuracy-aware geofence evaluator records `within_boundary` or `inconclusive` evidence. Readings clearly outside the boundary are refused with a retry message. Inconclusive evidence is recorded and shown as such, never as misconduct. Migration `0007` adds the venue link, QR secret and evidence columns. See [VERIFICATION.md](VERIFICATION.md) and [VENUE_SYSTEM.md](VENUE_SYSTEM.md).

### Phase 8: Dashboards, reports and audited corrections

**Implemented; embedded-database verification passed, configured-PostgreSQL and end-to-end verification remain.**

- **Lecturer reports** (`/lecturer/reports`): for each assigned offering, a register grid (student × session), per-session evidence breakdown, per-student rate, a configurable follow-up threshold (1–100 %, default 75 %) and CSV export. CSV values are protected against spreadsheet formula injection. Sessions that started before a student enrolled are shown as "not yet enrolled" and are not counted against them. The threshold is presented as a planning aid, not an institutional eligibility rule.
- **Audited corrections**: any lecturer assigned to the offering can record a missed check-in (`manual` method) or revoke a check-in once the session has started. A 10–500 character reason is required. Records are never deleted. A revoke sets `status = 'revoked'` and `revoked_at`, and every change appends a row to `attendance_corrections`. A database trigger rejects `UPDATE`/`DELETE` on that table. Corrections run in a transaction with row locks. A revoked student cannot re-check-in themselves. Each session's audit trail is visible from the report.
- **Student summary** (`/attendance`): per-course attended/held counts and rate, with revoked and lecturer-recorded entries labelled in the history.
- **Administrator overview** (`/admin/attendance` plus a dashboard snapshot): per-offering sessions, expected and present check-ins, inconclusive/manual/revoked counts and rate. Results are filtered to the administrator's department, faculty or institution scope on the server.
- **Error details**: domain errors that opt in with `exposeDetail` (status < 500, server-authored message) now return their message as the problem `detail`, so the UI can explain refusals such as a revoked check-in. All other errors keep generic text.

Migration `0008` adds the `manual` method, record status/`revoked_at` (with a consistency check) and the append-only `attendance_corrections` table.

**Verified here:** the PGlite integration test applies migrations `0000`–`0008`. It then exercises mark-present, revoke and unchanged corrections, the append-only trigger, the revoked re-check-in refusal, report cells and CSV, the student summary, and the administrator overview at institution scope and at an unrelated department scope. Unit and route tests cover report maths, CSV escaping, reason validation, outcome-to-error mapping, role guards and query validation.

**Still needed (when written):** apply migration `0008` through the deployed migration path (it uses `ALTER TYPE … ADD VALUE`). Exercise the report, correction and export flows in a browser against a configured PostgreSQL service. Agree with the institution on how long to retain reports.

**Since then:** `0008` is applied in production. Registers count one semester at a time (ADR 020). The retention period is still an institutional decision.

### Phase 9: Student attendance disputes and lecturer review

**Implemented; embedded-database verification passed, configured-PostgreSQL and browser verification remain.** Students now have an in-product way to ask for a human review of a record, and lecturers have a queue to decide on it. This was a review path, not an appeals process. (Since then, a rejected dispute can go to the department once, ADR 026.)

- **Who can dispute what.** A student actively enrolled in an offering (and enrolled when the session started) can dispute a session where they have **no check-in** (`missing_check_in`), or where a lecturer **revoked** their check-in (`revoked_check_in`). The server derives the kind; the client cannot choose it.
- **When.** A missing check-in can be disputed only after check-in has closed, so students are not nudged to dispute instead of checking in. A revoked check-in can be disputed straight away. The window closes 14 days after the session ended (the earlier of close time and scheduled end).
- **Limits.** There can be one open dispute per student and session; a partial unique index enforces it and also settles races. A student can have at most 10 open disputes. Upheld and rejected decisions are final for that session. A student may withdraw an open dispute and raise it again within the window.
- **Eligibility order.** Refusals are checked in a fixed order and the first match is reported: not enrolled → enrolled after the session → not started → already present → still open → window closed → already open → already decided → too many open. Each refusal returns a specific `409` (or `404` when the session is not visible to the student) with a server-authored explanation.
- **Statement and decision.** The student writes a 20–1,000 character statement. The UI asks them to keep it factual and leave out passwords or medical details. Any lecturer assigned to the offering can decide, with a 10–500 character note that the student sees.
  - **Upholding** applies a `mark_present` correction in the same transaction. The note becomes the correction reason, and `attendance_corrections.dispute_id` links the correction to the dispute. The audit trail tags it as an upheld dispute.
  - **Rejecting** leaves the record unchanged.
  - Upholding is refused when the student is no longer actively enrolled; the lecturer can still reject with an explanation.
  - Resolution locks the session row first and then the dispute row, the same lock order as corrections and check-ins.
- **Database guard.** A trigger on `attendance_disputes` blocks deletes, freezes a dispute once decided or withdrawn, and keeps submission fields (student, session, kind, statement, created time) immutable. A check constraint keeps the status and resolver fields consistent.
- **Where it shows up:**
  - **Student, `/attendance`:** a "Something wrong with your record?" panel lists disputable sessions, each with its deadline and, for revocations, the lecturer's reason. It also lists the student's disputes with status and decision notes, plus a confirm-to-withdraw action.
  - **Lecturer, `/lecturer/disputes`:** the review queue, oldest first, with Open, Decided and All tabs and a course filter. Each dispute shows the student's current record and the last correction. The navigation badge uses a lightweight count endpoint.
  - **Lecturer reports:** open-dispute totals, with a link to the queue.
  - **Administrator overview:** open-dispute totals and the oldest waiting dispute, for each offering and overall, with a "most open disputes" sort. Administrators can see disputes but do not decide them.
- **Honest limits.** A statement is a request for review, not evidence of presence. Upholding records the lecturer's judgement, not proof of attendance. Rejecting is not a misconduct finding.

Migration `0009` adds the dispute enums, the `attendance_disputes` table (tenant-aware foreign keys, one-open partial unique index, resolution check, guard trigger) and the nullable `attendance_corrections.dispute_id` foreign key.

**Verified here:**
- **Integration (PGlite):** the test applies migrations `0000`–`0009` and runs the whole workflow:
  - A missing check-in is refused while the session is open; a non-enrolled student gets `404` and a late enrollee is refused.
  - A dispute is submitted with a trimmed statement. A duplicate is refused, and a racing duplicate is caught by the partial unique index.
  - The trigger rejects edits to the statement, changes after a decision, and deletes.
  - A dispute is withdrawn and then resubmitted.
  - The lecturer queue, open count, report total and administrator totals and oldest dispute all reflect the open dispute; an unassigned lecturer sees nothing and gets `404` on resolve.
  - Upholding produces a linked correction (`viaDispute: true`). A revoked check-in is disputed and then rejected.
  - Upholding is refused for a withdrawn enrollee.
  - Submissions are refused after the window closes.
- **Unit and route tests:** these cover every eligibility rule and the order they are checked in, deadline arithmetic, statement and note validation, mapping outcomes to errors, strict bodies and queries, role guards, `401`/`403`/`503` handling and `no-store` headers.

**Still needed (when written):**
- Apply migration `0009` through the deployed migration path.
- Run the student and lecturer dispute flows in a browser against a configured PostgreSQL service.
- Agree with the institution on the window length, on whether a further appeal exists beyond the course's lecturers, on how long dispute statements are retained and who may read them, and on how students are told about decisions (there were no email notifications; students saw decisions on `/attendance`).

**Since then:** `0009` is applied in production. Lecturers are emailed about the first open dispute of a session and students about each decision (`docs/API.md`, *Dispute emails*), and a rejected dispute can be appealed to the department once (ADR 026). Disputes exist only for enrolled-course sessions; quick lecture sessions use hand-adding and help requests instead. The window length and statement retention are still institutional decisions.

### Phase 10: Pilot security hardening

**Implemented; embedded-database verification passed. Configured-PostgreSQL, browser and staging load verification remain.** This phase closes the account-protection gaps that blocked a pilot: unthrottled public endpoints, no password recovery, no way to see or end sessions, no cross-origin checks and no security headers. Academic data import is out of scope by decision and is not planned.

- **Rate limiting.** A central policy table covers sign-in (per address and per email), registration, resend, verification, password-reset request and completion, password change, session revocation, course-code redemption, check-in and dispute submission.
  - Counters are fixed windows in PostgreSQL (`rate_limit_counters`), keyed by a SHA-256 digest of policy and subject, and shared across instances. A memory store exists for single-instance use and tests.
  - Every attempt counts. Blocked requests get `429` with `Retry-After`.
  - Check-in, enrollment and dispute limits are per session, because a lecture shares a campus NAT address.
  - Store failures fail open and are logged. Production refuses `RATE_LIMIT_STORE=off`.
  - `TRUST_PROXY` decides whose `X-Forwarded-For` is believed.
- **No hard lockout.** Failed sign-ins are throttled rather than locking accounts, so knowing a student's email is not enough to block them (ADR 013).
- **Password recovery.**
  - Requests always get a generic `202`, and only active, verified accounts get a link.
  - Each user has one token at a time, stored as a digest. It expires in 30 minutes, is single use and has a two-minute re-issue cooldown. The token travels in the URL fragment.
  - Completing a reset replaces the hash and revokes every session in one transaction, clears the cookie and emails a notice.
- **Password change.** It requires the current password, revokes every other session, invalidates any pending reset link and emails a notice.
- **Session management.** Owners can list live sessions (created, last active, expiry, current marker; never tokens), sign out one other session, or sign out all others. Last-active is refreshed at most every 5 minutes.
- **Cross-origin guard.** State-changing API requests are checked with Fetch Metadata (`Sec-Fetch-Site`) and an exact `Origin` match against `PUBLIC_APP_URL` and `TRUSTED_ORIGINS`. Cross-site requests get `403`.
- **Security headers.** The API sends a deny-all CSP, frame denial, `nosniff`, `no-referrer`, Permissions-Policy, and HSTS in production. Web pages get a CSP that allows only the app, data-URL QR images and OpenStreetMap tiles, frame denial, and geolocation for this origin only. HSTS and upgrade-insecure-requests are sent when the public URL is HTTPS.
- **Email.** All four providers send verification, reset and security-notice messages through one shared, escaped layout.
- **Logging.** A single shared redaction list now also covers `currentPassword`, `newPassword` and `Set-Cookie`.
- **Web.**
  - `/forgot-password`, plus a "Forgot your password?" link on sign-in.
  - `/reset-password`, which reads the fragment, strips it from history, checks both password fields and explains what happens.
  - `/account/security`, which lists sessions with sign-out actions and has a change-password form, linked as "Security" in the account menu.
  - Error messages now show the server's `429` and `403` explanations.
- **Load testing.** A guarded fixture seeder creates synthetic, clearly labelled students in the local demo tenant only, and `scripts/load/check-in-burst.mjs` simulates a class checking in at once and reports percentiles. `docs/LOAD_TESTING.md` sets out the plan and proposed targets. Nothing was measured in this phase (results came later; see `docs/LOAD_TESTING.md`).

Migration `0010` adds `password_reset_tokens` (user primary key, unique token digest, expiry check) and `rate_limit_counters`.

**Verified here:**
- **Integration (PGlite):** migrations `0000`–`0010`, with production repositories over HTTP:
  - Three sessions are listed with one marked current and most recently used first, and no token appears in the response.
  - One session is revoked by id; the current session cannot be revoked that way; all others are revoked.
  - Changing the password refuses a wrong current password, then revokes the others, rejects the old password and accepts the new one.
  - Password-reset responses are identical for known and unknown addresses. Unverified accounts get no link.
  - The cooldown blocks re-sends; after it, a new link replaces the old one and the superseded token is rejected.
  - Completing a reset revokes the existing session; a token cannot be reused and expires after 30 minutes. A password change invalidates a pending link. Only digests are stored.
  - The PostgreSQL rate-limit store returns `429` on the 11th sign-in, stores no raw email or address, increments correctly under concurrent hits and resets after the window.
  - A cross-site reset request is blocked before any email is sent.
- **Unit and route tests:**
  - Limiter windows, eviction, multi-rule decisions and fail-open behaviour.
  - Origin-guard decision matrix.
  - Header presence on success and error responses, and HSTS toggling.
  - Per-email limits that ignore letter case, per-address limits, trusted-proxy addressing, per-session check-in limits and untouched unrelated routes.
  - Service rules for issuing and completing resets, notices and changing passwords.
  - Strict route bodies, generic `202` responses and cookie clearing.
  - Email content (fragment-only links, escaping, Lagos time) and the environment rules.
- **Web:** `next build` passes. A local `next start` served the security headers on `/reset-password` and rendered `/sign-in` (with the new link) and `/account/security`.
- **Load script:** run once end to end against an in-process embedded database to show it works (12 students, roster of 12). That is not a performance measurement.

**Still needed (when written):**
- Apply migration `0010` through the deployed path.
- Run the reset and session flows in a browser with real email delivery.
- Put the API behind a trusted edge, set `TRUST_PROXY` and add alerting.
- Run the load plan in staging and publish the conditions and results.
- Move the page CSP to nonces.
- Agree on an administrator-assisted recovery process for users who have lost their mailbox.

**Since then:**
- `0010` is applied in production, and reset and session flows run with real email.
- The API runs embedded in the Vercel deployment, which supplies the client address (`x-real-ip`), so `TRUST_PROXY` is not used there (ADR 015).
- Alerts email the operator about server errors, page crashes, an out-of-date schema, email trouble, error-rate and `429` bursts, sign-in failures, Google sign-in trouble, backups, cross-origin `403` bursts and rate-limit store failures (ADR 020, ADR 029, ADR 036).
- Load results are published in `docs/LOAD_TESTING.md`; the live site is never load tested.
- Students who cannot get their email can get a one-time setup code from their HOC. Recovery for staff who lose their mailbox is still an institutional decision. The page CSP still uses `'unsafe-inline'` scripts (planned: nonces).

At the end of Phase 10 these were not yet built: staff provisioning (Phase 11), academic administration beyond the venue directory, dispute notifications and escalation, live updates, audit writes beyond attendance corrections and venue location events, measured load results and production deployment. All of these exist now; live screens use conditional polling rather than server-sent events (ADR 023). Attendance still does not prove identity or presence on its own; the face check and venue check are evidence, explained in `docs/VERIFICATION.md` and `docs/FACE_VERIFICATION.md`.

### Phase 11: Staff provisioning by invitation

**Implemented; embedded-database verification passed. Real email delivery and a browser walkthrough remain.** Before this phase only students could create accounts; lecturers and administrators existed only as the seeded demo lecturer or hand-written database rows. See `docs/ADMINISTRATION.md` for the full flow and ADR 014 for the reasoning.

- **Bootstrap command.** `pnpm admin:bootstrap --email … --name … [--scope institution|faculty|department] [--faculty CODE | --department CODE]` creates the first administrator invitation. It is the only step that needs server access. It emails the link, and prints it when email is not configured or `--print-link` is given. Exit code `3` means "already exists", so setup can re-run safely.
- **Staff page** (`/admin/staff`, linked as **Staff** in the admin navigation):
  - an invite form offering only the roles and areas the administrator may grant;
  - pending invitations with Resend (rotates the link) and Revoke;
  - the staff in the administrator's area, with Suspend and Reactivate, each needing a reason.
- **Acceptance page** (`/accept-invitation`). The token is read from the URL fragment and stripped from history; the page is served `no-store` and `no-referrer`. It shows who invited the person, the role and the area, then sets the password. In one transaction the server creates an active account with a confirmed email, the lecturer profile (lecturers), the scoped role assignment, and marks the invitation accepted. The person is then signed in.
- **Scope rule.** At or below your own level, inside your own area, enforced on the server from the session (`apps/api/src/staff/policy.ts`). Out-of-scope and unknown ids look the same. Nobody manages themselves; system-administrator roles are never invitable.
- **Suspension** sets the account to suspended and revokes every session in the same transaction. Session lookup and sign-in already require an active account.
- **Audit.** Migration `0011` adds `staff_invitations` (digest-only tokens, scope-shape and outcome checks, one pending invitation per email) and the append-only `staff_audit_events`.
- **Rate limits** (pilot starting values): invitation create and resend 30 per hour per session; preview 30 and accept 20 per 15 minutes per address.
- **Demo.** `pnpm dev:setup` now creates the demo administrator (`admin@lasuatos.example.net`) through the real bootstrap flow. The invitation appears in Mailpit and the link is also printed.
- **Fixed along the way:** the Venue directory page requested a non-existent `/api/v1/session` endpoint, so it always reported that an administrator account was required. It now uses `/api/v1/auth/session`.
- **Copy:** the home page no longer refers to "provisioned" lecturer accounts and explains that staff join by invitation.

**Verified here:**
- **Integration (PGlite, migrations `0000`–`0011`, production repositories over HTTP):**
  - bootstrap invites an institution administrator, who previews, accepts (short passwords refused), is signed in and cannot reuse the link;
  - they invite a faculty administrator, who accepts;
  - the faculty administrator cannot invite outside their faculty or above their level, and gets a clear message for a missing staff number;
  - duplicates, existing accounts and taken staff numbers are refused, and the invitation response never contains the token;
  - a cross-site invite request is blocked;
  - resend rotates the token, revoke kills it, and another faculty's invitation cannot be revoked;
  - the invited lecturer accepts, lands as a lecturer with the right profile, signs in normally, and cannot use staff routes;
  - the directory shows only manageable people plus self;
  - suspension needs a reason, cannot target a senior administrator or oneself, revokes the live session, blocks sign-in, and cannot be repeated; reactivation restores sign-in;
  - every action is in the audit table, bootstrap rows have no actor, and updates and deletes are rejected;
  - invitations expire after 7 days, a pending one blocks a duplicate while an expired one is replaced, a department administrator is limited to their department, and the bootstrap command rejects bad arguments and unknown codes.
- **Unit:** the scope-policy matrix and the presence of the new rate-limit policies.
- **Web:** `next build` passes with `/admin/staff` and `/accept-invitation`.

**Still needed (when written):**
- Apply migration `0011` through the deployed path.
- Walk through bootstrap, acceptance, invitation and suspension in a browser with real email delivery.
- Confirm with LASU that the default delegation rule is acceptable.
- Add role and area changes for existing staff and an in-product audit viewer if needed.

**Since then:** `0011` is applied in production, where staff join by invitation. Role and area changes exist (ADR 025), and administrators have an audit log page (`/admin/audit`). Confirming the delegation rule with LASU is still open.

### Operations: automatic migrations, alerts, semesters, crowd test (ADR 020)

**Done:**
- Production builds apply pending migrations; `prod:check` fails when the schema is behind.
- Email alerts (`ALERT_EMAIL`) for unexpected 500s, browser page crashes and an out-of-date schema, deduplicated and capped per day.
- Course registers count one semester at a time (with a picker), and students' own rates count only the semesters they took a course in.
- The enrolled-course tools are hidden until an institution, lecturer or student uses them.
- QR crowd test (`pnpm load:lecture`) up to 1,800 simultaneous students on real PostgreSQL, with 0 errors and 0 duplicates; the per-ticket check-in limit it exposed was removed.

**Tests:**
- `monitoring/alerts.test.ts`: deduplication, quiet period, daily cap, scrubbing, the 500, page-crash and schema alerts.
- `lecture/check-in-limits.test.ts`: 400 students share one ticket; the per-address limit still applies.
- `e2e/semester-end.integration.test.ts`: a semester, a session left open at its end, the next semester, the same course code again, registers and student rates per semester.
- `scripts/migrate-on-deploy.test.ts`: when a build migrates.

## Next

In the order agreed with the product owner:

1. **Pilot practice day** on real phones (`docs/PILOT_PRACTICE_DAY.md`), then the first monthly backup restore drill (`docs/BACKUPS.md`).
2. **Passkeys for staff sign-in** (planned, not built).
3. Before more than about 500 students share one campus address within 15 minutes: raise the per-address sign-in limit (600 per 15 minutes today; `docs/LOAD_TESTING.md`).
4. Move the page CSP to nonces.
5. Institutional decisions that the code cannot make: the staff delegation rule (ADR 014), an administrator-assisted recovery route for people who lose their mailbox, the location and data-retention policies, and the privacy and legal review (NDPA 2023).
6. A custom domain (deferred by the product owner).

## Risk register

| ID | Risk | Likelihood / impact | Mitigation and owner |
| --- | --- | --- | --- |
| R1 | Email confirmation or a self-entered matric number is mistaken for verified student status | High / critical | Keep the distinction visible; the code-based check-in is not proof of LASU identity or venue presence. Add an approved source or human review before formal status claims. Staff roles come only from scoped, audited invitations (Phase 11). |
| R2 | No production database, backup or recovery plan | Low / critical | Production runs on Neon with a pooled connection and small per-instance pools. Encrypted nightly backups run in production and each is verified by a full restore before it is kept (ADR 035, `docs/BACKUPS.md`). Remaining: do the first monthly restore drill by hand. |
| R3 | Venue coordinates are wrong or not authorized | Medium / high | Require on-site registration, review, recorded actor and approval. Never invent coordinates. |
| R4 | GPS is inaccurate, stale or spoofed | High / high | Treat location as proximity evidence only; account for accuracy and age; allow retry and human review. |
| R5 | Personal and location data is processed without an approved purpose or retention | Medium / critical | Complete privacy/legal review, notices, access design and retention schedule before collecting data. |
| R6 | Attendance is duplicated or lost under concurrency | Medium / critical | Use database uniqueness, transactions, idempotency and realistic concurrent integration tests. |
| R7 | Lecturer or administrator reaches records outside assigned scope | Medium / critical | Every route derives role and area from the server session (ADR 004); out-of-scope records answer like missing ones. The November 2026 review exercised all routes as every kind of account with no cross-area leak (ADR 033), and PGlite integration tests cover scope per area. |
| R8 | Performance results are mistaken for a guarantee of the live site | Medium / high | `docs/LOAD_TESTING.md` records the rush, pilot-morning and crowd results with the machine, pool and settings they were measured on (including sign-ins: p95 279 ms on a local PostgreSQL), and states that the live Vercel + Neon site is never load tested. The practice day on real phones (`docs/PILOT_PRACTICE_DAY.md`) checks the real network. |
| R9 | Digital palette is mistaken for an official LASU brand standard | Medium / medium | Document that selected hex values are product tokens and request Communications review before institutional rollout. |
| R10 | Latest dependency versions change or prove incompatible | Medium / medium | Pin direct versions and lockfile, run CI checks and review updates rather than using floating `latest` tags. |
| R11 | Drizzle Kit currently pulls deprecated `@esbuild-kit` loader packages | Low / medium | Keep the patched `esbuild` override, monitor Drizzle Kit releases and remove the override only after an audited upstream update. |
| R12 | A class list is mistaken for verified registration | Medium / high | Class lists come from the department's own records through its HOC or an administrator, every import and edit is audited, and a matric number is still not checked against an official LASU identity source. (The earlier local roster preflight has been removed.) |
| R13 | Public account endpoints or course/attendance codes are abused | Medium / high | PostgreSQL-backed rate limits (per address, email, matric number, session and account), throttling rather than lockout, generic responses for reset requests, origin checks and security headers; typed lecture codes have their own miss limit; `429` and cross-origin `403` bursts email the operator (ADR 029, ADR 036); every state-changing route has a limit, enforced by a test. Still needed: tuning from pilot traffic and an independent review. |
| R16 | Rate limits are misconfigured: a wrong `TRUST_PROXY` merges a whole campus into one address, or lets clients pick their own address; a store outage silently disables limits | Medium / high | In production (embedded mode) the address is Vercel's `x-real-ip` and `TRUST_PROXY` is not used; for a self-hosted API, `loopback` fits the bundled topology. Signed-in actions are keyed by session, not address. Store failures fail open, are logged at error level and email the operator after five in 5 minutes (ADR 036). Production refuses `RATE_LIMIT_STORE=off`. |
| R17 | Password recovery is used to take over an account, or users without mailbox access are locked out | Medium / high | Reset links go only to the verified mailbox, are single use and short lived, revoke every session and trigger a notice email. Recovery does not work for unverified accounts. Students without mailbox access get a one-time HOC setup code (single use, 30 minutes, vouched but still taken over by a later LASU email confirmation); a wrongly confirmed account is released only by an administrator with an audited reason and a notice to the old address. The identity check before a release (ID card) still needs institutional agreement. |
| R18 | An administrator invites the wrong person, or a staff invitation link is intercepted or forwarded | Medium / high | Links are single use, expire in 7 days, are stored only as digests and travel in the URL fragment. Invitations are limited to the inviter's area and level, every action is audited with the actor, and suspension revokes all sessions at once. The inviter vouches for identity; the product does not verify staff status. |
| R14 | A follow-up threshold or rate in reports is mistaken for an official eligibility decision, or a correction is made without accountability | Medium / high | Reports label the threshold as a planning aid and exclude pre-enrollment sessions. Corrections need a reason, are append-only audited and never delete records. Obtain an institutional policy before rates feed any formal decision. |
| R15 | A student's dispute statement is mistaken for evidence, an upheld dispute for proof of presence, or a rejection for a misconduct finding; or disputes go unanswered | Medium / high | The UI and API describe statements as review requests. Upholding records a lecturer's audited judgement, and decisions carry a note the student sees. Open counts and the oldest waiting dispute appear in reports, the lecturer badge and the administrator overview. Lecturers and students are emailed, and a rejection can be appealed to the department once (ADR 026). Response-time expectations still need an institutional policy. |
