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
- PostgreSQL Drizzle schema for institutions, campuses, faculties, departments, accounts, scoped roles, academic sessions, semesters, courses, offerings, enrollments and lecturer assignments.
- Five generated migrations with restrictive deletion behavior, tenant-aware composite foreign keys, role-to-scope constraints, institution-defined semester labels, account/session tables and hashed enrollment codes. They have not been applied to a database in this sandbox.
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

Not yet implemented: authorized staff-provisioning UI, academic administration/import, venue management, attendance sessions, QR challenges, location verification, disputes, reports, audit writes, SSE, load testing and production deployment. Course membership does not confirm attendance or verified student status.

## Proposed next sequence

1. Run `pnpm dev:setup` on a local machine with Docker Compose and Mailpit. Use the one-time demo lecturer credential to create an offering, issue and rotate a code, register/confirm a synthetic student, and verify same-institution enrollment. The sandbox cannot apply migrations or reach PostgreSQL.
2. Add PostgreSQL integration and concurrency tests for lecturer scope, course metadata conflicts, code rotation/revocation, cross-tenant rejection, duplicate enrollment and auth/session behavior.
3. Add trusted-edge rate limits and abuse monitoring for public account routes and course-code redemption; complete CSRF, password recovery and account recovery review before public account rollout.
4. Establish an authorized staff-provisioning and academic-data ownership process. Email domain and self-reported matric number must not confer staff roles or prove student status.
5. Obtain an approved sample roster and field meanings before implementing any server-side academic import.
6. Provision an authorized pilot database, create the production LASU institution row through an approved process, and test backup and restore.
7. Build institution, faculty, department and venue administration with server-enforced scope checks.
8. Add lecture-session lifecycle and transactional attendance records, then short-lived session-bound challenges and explainable, accuracy-aware verification.
9. Complete operational controls, privacy review, accessibility, restore, abuse and measured load tests before any pilot.

## Risk register

| ID | Risk | Likelihood / impact | Mitigation and owner |
| --- | --- | --- | --- |
| R1 | Email confirmation or a self-entered matric number is mistaken for verified student status | High / critical | Keep the distinction visible; do not authorize attendance from those fields alone. Add an approved source or human review before claiming verified student status. Staff roles require separate authorized provisioning. |
| R2 | No production database, backup or recovery plan | High / critical | Choose a managed PostgreSQL service, set connection budgets, test backups and restore before a pilot. |
| R3 | Venue coordinates are wrong or not authorized | Medium / high | Require on-site registration, review, recorded actor and approval. Never invent coordinates. |
| R4 | GPS is inaccurate, stale or spoofed | High / high | Treat location as proximity evidence only; account for accuracy and age; allow retry and human review. |
| R5 | Personal and location data is processed without an approved purpose or retention | Medium / critical | Complete privacy/legal review, notices, access design and retention schedule before collecting data. |
| R6 | Attendance is duplicated or lost under concurrency | Medium / critical | Use database uniqueness, transactions, idempotency and realistic concurrent integration tests. |
| R7 | Lecturer or administrator reaches records outside assigned scope | Medium / critical | Course routes derive lecturer scope from server-side profiles and assignments; add PostgreSQL IDOR/cross-tenant tests. Broader administrative request guards are not implemented. |
| R8 | Proposed performance goals are mistaken for measured results | Medium / high | Label targets as proposals and publish load-test conditions and measured results only after testing. |
| R9 | Digital palette is mistaken for an official LASU brand standard | Medium / medium | Document that selected hex values are product tokens and request Communications review before institutional rollout. |
| R10 | Latest dependency versions change or prove incompatible | Medium / medium | Pin direct versions and lockfile, run CI checks and review updates rather than using floating `latest` tags. |
| R11 | Drizzle Kit currently pulls deprecated `@esbuild-kit` loader packages | Low / medium | Keep the patched `esbuild` override, monitor Drizzle Kit releases and remove the override only after an audited upstream update. |
| R12 | A local roster preflight is mistaken for an official import or verified registration | Medium / high | Keep the draft contract and local-only boundary visible; require data-owner approval and authoritative identity checks before any server-side import. |
| R13 | Public account endpoints or course-code redemption are abused before throttling and monitoring exist | Medium / high | Keep public rollout blocked; add trusted-edge throttling, code-abuse monitoring, recovery and abuse tests before a pilot. |
