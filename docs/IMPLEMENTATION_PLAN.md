# Implementation plan and risk register

## Repository audit

**Status: complete.** The starting repository contained only a one-line `README.md`, one initial commit and no application, package manifest, database, tests, authentication, environment configuration or product documentation. There was no existing functionality to preserve or dependency set to upgrade. The workspace pins pnpm 12.18.0 in `package.json`; use the installed `pnpm` command directly. The repository has a configured Git remote and the working tree was clean at the start of this task.

No institution credentials, database URL, approved identity integration, academic data, venue coordinates or deployment approvals were present. Those gaps are treated as integration and governance dependencies, not filled with invented values.

## Phase status

### Phase 0: Audit and product foundation

**Complete for this pass.** Added product, architecture, database, API, security, venue, verification, deployment, testing and risk documentation. Research notes on LASU visual identity are in `DECISIONS.md`.

### Phase 1: Foundation

**Complete for this pass.** Implemented:

- pnpm workspace with separate Next.js and Fastify apps.
- Shared Zod contracts and centralized API problem responses.
- PostgreSQL Drizzle schema for institutions, campuses, faculties, departments, accounts, scoped roles, academic sessions, semesters, courses, offerings, enrollments, lecturer assignments and attendance sessions/records.
- Six migrations with restrictive deletion behavior, tenant-aware composite foreign keys, role-to-scope constraints, institution-defined semester labels, account/session tables, hashed enrollment/session codes and duplicate-safe attendance records. They have not been applied to a database in this sandbox.
- An optional PostgreSQL client and honest health/readiness checks.
- A tested administrative scope helper.
- A responsive development workspace with LASUATOS product identity, clear no-records state and live service checks.
- Strict TypeScript, ESLint, Vitest and migration generation scripts.

### Phase 2: Academic data preparation

**In progress.** Implemented a course roster preflight for the intended Engineering pilot. It reads a selected CSV in browser memory, supports manual column mapping, preserves student numbers as text, checks schema limits, repeated enrolments and conflicting course metadata, and reports aggregate counts without showing student numbers. The blank template is a draft LASUATOS contract, not an official LASU export format. It does not upload, save, import or verify records.

**Still needed for this phase:** obtain an approved sample export and confirm its field meanings with the relevant University data owner. Confirm department identifiers, term labels and source-of-truth ownership before making any server-side import.

### Phase 3: Student accounts

**Implemented; local integration still needed.** Implemented student self-registration, email ownership confirmation, student and provisioned-lecturer password sign-in, server-managed sessions and logout. Any email domain is accepted. Public registration rejects role fields and assigns only the student role after confirmation. The matric number is stored as self-reported text and is not unique or checked against an authoritative source. Provider selection is server-side through `.env` for Gmail via Nodemailer, Brevo or Resend.

### Phase 4: Lecturer course offerings and student enrollment

**Implemented; PostgreSQL application and end-to-end local verification remain.** Lecturers can list open semesters at their institution, create offerings only within their provisioned department, list assigned offerings, and issue, rotate or revoke enrollment codes. Codes are generated randomly, hashed in storage and expire at semester end. Signed-in students with an active same-institution profile can redeem a code idempotently and list their own active enrollments. Public registration remains student-only. The guarded demo seed provisions synthetic academic records and one department-scoped demo lecturer with a generated one-time password.

**Still needed:** run the guarded `pnpm dev:setup` flow on a local machine with Docker and Mailpit; apply migration `0004`; exercise lecturer login, offering creation, code rotation/revocation, student registration/confirmation and enrollment against PostgreSQL. The sandbox has no Docker/PostgreSQL service, so migration application, database transactions and browser end-to-end behavior are not verified here. Add course-code rate limiting and database-backed concurrency/cross-tenant tests before any pilot.

### Phase 5: Code-based attendance MVP

**Implemented; embedded-database verification passed, configured-PostgreSQL and end-to-end verification remain.** An assigned lecturer can open a timed session for an assigned offering, share a random code (stored only as a hash), rotate the code, see the roster and close the session. A signed-in student must have an active enrollment in the same institution/offering. The server records one timestamped check-in per student/session in a transaction, and students can view only their own history. Session codes expire at the requested duration or semester end. The user interface describes the evidence accurately: code use/time only, not verified identity, GPS or venue presence.

**Verified here:** the PGlite integration test applies migrations `0000`–`0005` to embedded PostgreSQL and exercises lecturer-assignment denial, code hashing, enrolled and non-enrolled check-ins, duplicate submissions, code rotation, roster retrieval and closing through the real SQL adapter. This caught and confirmed the fix for a roster-query defect.

**Still needed:** apply migration `0005` through the deployed migration path and exercise the full student/lecturer flow (including browser end-to-end and expiry/close races) against a configured PostgreSQL service. Add trusted-edge rate limiting, cross-tenant and concurrency integration tests before any pilot.

### Phase 6: Venue management

**Implemented; embedded-database verification passed, real-device survey verification remains.** The schema now models campuses with optional map anchors, buildings per campus, and venues with type, capacity, optional floor/section, status lifecycle and a circular geofence (coordinate + 5–2000 m radius). Venue location changes are audited in `venue_location_events` with actor, timestamp, coordinate, radius and reported device accuracy. All venue rows use tenant-paired composite keys so no read or write can cross institutions. Institution administrators manage the directory from `/admin/venues`: create venues and buildings, capture the on-site GPS coordinate with a live OpenStreetMap/Leaflet boundary preview, then activate; activation without a registered boundary is refused by the service and independently by the `venues_active_location_ck` constraint. `packages/verification` ships the accuracy-aware Haversine geofence evaluator (`within`/`outside`/`inconclusive`). The demo seed adds a clearly-labelled synthetic campus anchor only — the seeded venue stays pending review with no boundary until registered in person.

### Phase 7: Venue-aware attendance

**Implemented; embedded-database verification passed, real-device and field verification remain.** A lecturer may link an attendance session to an active venue with a registered boundary. Open sessions show a rotating QR challenge (`lasu1.<session>.<20-second window>.<HMAC>`, current plus one grace window) alongside the typed code. When the venue requires location, the student's browser submits a position sample, and the accuracy-aware geofence evaluator records `within_boundary` or `inconclusive` evidence. Readings clearly outside the boundary are refused with a retry message. Inconclusive evidence is recorded and shown as such, never as misconduct. Migration `0007` adds the venue link, QR secret and evidence columns. See [VERIFICATION.md](VERIFICATION.md) and [VENUE_SYSTEM.md](VENUE_SYSTEM.md).

### Phase 8: Dashboards, reports and audited corrections

**Implemented; embedded-database verification passed, configured-PostgreSQL and end-to-end verification remain.**

- **Lecturer reports** (`/lecturer/reports`): for each assigned offering, a register grid (student × session), per-session evidence breakdown, per-student rate, a configurable follow-up threshold (1–100 %, default 75 %) and CSV export. CSV values are protected against spreadsheet formula injection. Sessions that started before a student enrolled are shown as "not yet enrolled" and are not counted against them. The threshold is presented as a planning aid, not an institutional eligibility rule.
- **Audited corrections**: any lecturer assigned to the offering can record a missed check-in (`manual` method) or revoke a check-in once the session has started. A 10–500 character reason is required. Records are never deleted. A revoke sets `status = 'revoked'` and `revoked_at`, and every change appends a row to `attendance_corrections`. A database trigger rejects `UPDATE`/`DELETE` on that table. Corrections run in a transaction with row locks. A revoked student cannot re-check-in themselves. Each session's audit trail is visible from the report.
- **Student summary** (`/attendance`): per-course attended/held counts and rate, with revoked and lecturer-recorded entries labelled in the history.
- **Administrator overview** (`/admin/attendance` plus a dashboard snapshot): per-offering sessions, expected and present check-ins, inconclusive/manual/revoked counts and rate. Results are filtered to the administrator's department, faculty or institution scope on the server.
- **Error details**: domain errors that opt in with `exposeDetail` (status < 500, server-authored message) now return their message as the problem `detail`, so the UI can explain refusals such as a revoked check-in. All other errors keep generic text.

Migration `0008` adds the `manual` method, record status/`revoked_at` (with a consistency check) and the append-only `attendance_corrections` table.

**Verified here:** the PGlite integration test applies migrations `0000`–`0008`. It then exercises mark-present, revoke and unchanged corrections, the append-only trigger, the revoked re-check-in refusal, report cells and CSV, the student summary, and the administrator overview at institution scope and at an unrelated department scope. Unit and route tests cover report maths, CSV escaping, reason validation, outcome-to-error mapping, role guards and query validation.

**Still needed:** apply migration `0008` through the deployed migration path (it uses `ALTER TYPE … ADD VALUE`). Exercise the report, correction and export flows in a browser against a configured PostgreSQL service. Agree with the institution on how long to retain reports.

### Phase 9: Student attendance disputes and lecturer review

**Implemented; embedded-database verification passed, configured-PostgreSQL and browser verification remain.** Students now have an in-product way to ask for a human review of a record, and lecturers have a queue to decide on it. This is a review path, not an appeals process: the institution still needs to agree on whether a further appeal exists beyond the course's lecturers.

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

**Still needed:**
- Apply migration `0009` through the deployed migration path.
- Run the student and lecturer dispute flows in a browser against a configured PostgreSQL service.
- Agree with the institution on the window length, on whether a further appeal exists beyond the course's lecturers, on how long dispute statements are retained and who may read them, and on how students are told about decisions (there are no email notifications yet; students see decisions on `/attendance`).

Not yet implemented: authorized staff-provisioning UI, academic administration/import beyond the venue directory, dispute notifications and escalation beyond the course's lecturers, real-time updates (SSE), audit writes beyond attendance corrections and venue location events, load testing and production deployment. Course enrollment and attendance evidence do not verify student identity or prove venue presence.

## Proposed next sequence

1. Run `pnpm dev:setup` on a local machine with Docker Compose and Mailpit. Use the generated demo lecturer password to create an offering and course code, register/confirm a synthetic student, enroll them, open an attendance session, check in and verify the lecturer roster plus student history. The sandbox has no Docker/PostgreSQL service; attendance SQL is verified only through embedded PGlite.
2. Extend integration coverage (PGlite or a configured test database) to concurrency and cross-tenant rejection for lecturer scope, code rotation/revocation, duplicate enrollment, session expiry/closure and duplicate check-in, then repeat against the real PostgreSQL service.
3. Add trusted-edge rate limits and abuse monitoring for public account routes, course-code redemption and attendance-code check-in; complete CSRF, password recovery and account recovery review before public rollout.
4. Establish an authorized staff-provisioning and academic-data ownership process. Email domain and self-reported matric number must not confer staff roles or prove student status.
5. Obtain an approved sample roster and field meanings before implementing any server-side academic import.
6. Provision an authorized pilot database, create the production LASU institution row through an approved process, and test backup and restore.
7. Build institution, faculty, department and venue administration with server-enforced scope checks. Add venue registration and verification only after physical survey and approval.
8. Obtain an approved location policy and confirm the in-product dispute path (Phase 9) against institutional policy: window length, escalation beyond the course's lecturers, notification, and retention of statements. Agree on report retention and on who may see attendance rates.
9. Complete operational controls, privacy review, accessibility, restore, abuse and measured load tests before any pilot.

## Risk register

| ID | Risk | Likelihood / impact | Mitigation and owner |
| --- | --- | --- | --- |
| R1 | Email confirmation or a self-entered matric number is mistaken for verified student status | High / critical | Keep the distinction visible; the code-based check-in is not proof of LASU identity or venue presence. Add an approved source or human review before formal status claims. Staff roles require separate authorized provisioning. |
| R2 | No production database, backup or recovery plan | High / critical | Choose a managed PostgreSQL service, set connection budgets, test backups and restore before a pilot. |
| R3 | Venue coordinates are wrong or not authorized | Medium / high | Require on-site registration, review, recorded actor and approval. Never invent coordinates. |
| R4 | GPS is inaccurate, stale or spoofed | High / high | Treat location as proximity evidence only; account for accuracy and age; allow retry and human review. |
| R5 | Personal and location data is processed without an approved purpose or retention | Medium / critical | Complete privacy/legal review, notices, access design and retention schedule before collecting data. |
| R6 | Attendance is duplicated or lost under concurrency | Medium / critical | Use database uniqueness, transactions, idempotency and realistic concurrent integration tests. |
| R7 | Lecturer or administrator reaches records outside assigned scope | Medium / critical | Course and attendance routes derive lecturer scope from server-side profiles and assignments; add PostgreSQL IDOR/cross-tenant tests. Broader administrative request guards are not implemented. |
| R8 | Proposed performance goals are mistaken for measured results | Medium / high | Label targets as proposals and publish load-test conditions and measured results only after testing. |
| R9 | Digital palette is mistaken for an official LASU brand standard | Medium / medium | Document that selected hex values are product tokens and request Communications review before institutional rollout. |
| R10 | Latest dependency versions change or prove incompatible | Medium / medium | Pin direct versions and lockfile, run CI checks and review updates rather than using floating `latest` tags. |
| R11 | Drizzle Kit currently pulls deprecated `@esbuild-kit` loader packages | Low / medium | Keep the patched `esbuild` override, monitor Drizzle Kit releases and remove the override only after an audited upstream update. |
| R12 | A local roster preflight is mistaken for an official import or verified registration | Medium / high | Keep the draft contract and local-only boundary visible; require data-owner approval and authoritative identity checks before any server-side import. |
| R13 | Public account endpoints or course/attendance codes are abused before throttling and monitoring exist | Medium / high | Keep public rollout blocked; add trusted-edge throttling, code-abuse monitoring, recovery and abuse tests before a pilot. |
| R14 | A follow-up threshold or rate in reports is mistaken for an official eligibility decision, or a correction is made without accountability | Medium / high | Reports label the threshold as a planning aid and exclude pre-enrollment sessions. Corrections need a reason, are append-only audited and never delete records. Obtain an institutional policy before rates feed any formal decision. |
| R15 | A student's dispute statement is mistaken for evidence, an upheld dispute for proof of presence, or a rejection for a misconduct finding; or disputes go unanswered | Medium / high | The UI and API describe statements as review requests. Upholding records a lecturer's audited judgement, and decisions carry a note the student sees. Open counts and the oldest waiting dispute appear in reports, the lecturer badge and the administrator overview. Notifications, escalation and response-time expectations still need an institutional policy. |
