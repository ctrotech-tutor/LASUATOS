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
- Four generated migrations with restrictive deletion behavior, tenant-aware composite foreign keys, role-to-scope constraints, institution-defined semester labels and the first student-account tables. They have not been applied to a database.
- An optional PostgreSQL client and honest health/readiness checks.
- A tested administrative scope helper.
- A responsive development workspace with LASUATOS product identity, clear no-records state and live service checks.
- Strict TypeScript, ESLint, Vitest and migration generation scripts.

### Phase 2: Academic data preparation

**In progress.** Implemented a course roster preflight for the intended Engineering pilot. It reads a selected CSV in browser memory, supports manual column mapping, preserves student numbers as text, checks schema limits, repeated enrolments and conflicting course metadata, and reports aggregate counts without showing student numbers. The blank template is a draft LASUATOS contract, not an official LASU export format. It does not upload, save, import or verify records.

**Still needed for this phase:** obtain an approved sample export and confirm its field meanings with the relevant University data owner. Confirm department identifiers, term labels and source-of-truth ownership before making any server-side import.

### Phase 3: Student accounts

**In progress.** Implemented student self-registration, email ownership confirmation, password sign-in, server-managed sessions and logout. Any email domain is accepted. Public registration rejects role fields and assigns only the student role after confirmation. The matric number is stored as self-reported text and is not unique or checked against an authoritative source. Provider selection is server-side through `.env` for Gmail via Nodemailer, Brevo or Resend.

**Still needed for this phase:** run `pnpm dev:setup` on a local machine with Docker Compose to apply migration `0003` and exercise the account routes against PostgreSQL and Mailpit. This sandbox has no Docker daemon, so that integration remains unverified here. The local demo tenant is not an official LASU record. For a pilot, use an authorized database and institution row, and add trusted-edge rate limiting, abuse monitoring, CSRF review, password recovery and account recovery before public deployment.

Not yet implemented: course self-enrollment codes, staff provisioning, academic CRUD, server-side academic data import, venue management, attendance sessions, QR challenges, location verification, disputes, reports, audit writes, SSE, load testing and production deployment.

## Proposed next sequence

1. Run `pnpm dev:setup` on a local machine with Docker Compose, inspect the local demo tenant, and exercise account creation, Mailpit confirmation, sign-in and logout. The sandbox cannot run this step because Docker is unavailable there.
2. Add PostgreSQL integration tests for duplicate registration, token rotation, concurrent verification, session revocation and account recovery.
3. Add trusted-edge rate limits, CSRF review, abuse monitoring and recovery flows before any public account rollout.
4. Add a lecturer-controlled course join code so students can self-enroll without individual lecturer approval. Agree expiry, rotation, misuse controls and course data ownership first.
5. Establish an authorized staff-provisioning path. Email domain and self-reported matric number must not confer staff roles or prove student status.
6. Obtain an approved sample roster and field meanings before implementing any server-side academic import.
7. Provision an authorized pilot database, create the production LASU institution row through an approved process, and test backup and restore.
8. Build institution, faculty, department, course and venue administration with server-enforced scope checks.
9. Add lecture-session lifecycle and transactional attendance records, then short-lived session-bound challenges and explainable, accuracy-aware verification.
10. Complete operational controls, privacy review, accessibility, restore, abuse and measured load tests before any pilot.

## Risk register

| ID | Risk | Likelihood / impact | Mitigation and owner |
| --- | --- | --- | --- |
| R1 | Email confirmation or a self-entered matric number is mistaken for verified student status | High / critical | Keep the distinction visible; do not authorize attendance from those fields alone. Add an approved source or human review before claiming verified student status. Staff roles require separate authorized provisioning. |
| R2 | No production database, backup or recovery plan | High / critical | Choose a managed PostgreSQL service, set connection budgets, test backups and restore before a pilot. |
| R3 | Venue coordinates are wrong or not authorized | Medium / high | Require on-site registration, review, recorded actor and approval. Never invent coordinates. |
| R4 | GPS is inaccurate, stale or spoofed | High / high | Treat location as proximity evidence only; account for accuracy and age; allow retry and human review. |
| R5 | Personal and location data is processed without an approved purpose or retention | Medium / critical | Complete privacy/legal review, notices, access design and retention schedule before collecting data. |
| R6 | Attendance is duplicated or lost under concurrency | Medium / critical | Use database uniqueness, transactions, idempotency and realistic concurrent integration tests. |
| R7 | Lecturer or administrator reaches records outside assigned scope | Medium / critical | Enforce object-level authorization server-side and test IDOR and cross-tenant cases. Current helper is not yet connected to routes. |
| R8 | Proposed performance goals are mistaken for measured results | Medium / high | Label targets as proposals and publish load-test conditions and measured results only after testing. |
| R9 | Digital palette is mistaken for an official LASU brand standard | Medium / medium | Document that selected hex values are product tokens and request Communications review before institutional rollout. |
| R10 | Latest dependency versions change or prove incompatible | Medium / medium | Pin direct versions and lockfile, run CI checks and review updates rather than using floating `latest` tags. |
| R11 | Drizzle Kit currently pulls deprecated `@esbuild-kit` loader packages | Low / medium | Keep the patched `esbuild` override, monitor Drizzle Kit releases and remove the override only after an audited upstream update. |
| R12 | A local roster preflight is mistaken for an official import or verified registration | Medium / high | Keep the draft contract and local-only boundary visible; require data-owner approval and authoritative identity checks before any server-side import. |
| R13 | Public account endpoints are abused before rate limiting and recovery controls are in place | Medium / high | Keep public rollout blocked; add trusted-edge throttling, monitoring, recovery and abuse tests before a pilot. |
