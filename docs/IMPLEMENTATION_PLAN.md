# Implementation plan and risk register

## Repository audit

**Status: complete.** The starting repository contained only a one-line `README.md`, one initial commit and no application, package manifest, database, tests, authentication, environment configuration or product documentation. There was no existing functionality to preserve or dependency set to upgrade. Node 22.22.3, npm 10.9.8 and Corepack 0.34.6 are available. pnpm was not installed globally; the workspace now pins pnpm through Corepack. The repository has a configured Git remote and the working tree was clean at the start of this task.

No institution credentials, database URL, approved identity integration, academic data, venue coordinates or deployment approvals were present. Those gaps are treated as integration and governance dependencies, not filled with invented values.

## Phase status

### Phase 0: Audit and product foundation

**Complete for this pass.** Added product, architecture, database, API, security, venue, verification, deployment, testing and risk documentation. Research notes on LASU visual identity are in `DECISIONS.md`.

### Phase 1: Foundation

**In progress.** Implemented:

- pnpm workspace with separate Next.js and Fastify apps.
- Shared Zod contracts and centralized API problem responses.
- PostgreSQL Drizzle schema for institutions, campuses, faculties, departments, accounts, scoped roles, academic sessions, semesters, courses, offerings, enrollments and lecturer assignments.
- An initial three-file migration set with restrictive deletion behavior, tenant-aware composite foreign keys, role-to-scope constraints and institution-defined semester labels.
- An optional PostgreSQL client and honest health/readiness checks.
- A tested administrative scope helper.
- A responsive development workspace with LASUATOS product identity, clear no-records state and live service checks.
- Strict TypeScript, ESLint, Vitest and migration generation scripts.

Not yet implemented: authentication endpoints, server request guards, user provisioning, institutional data import, admin CRUD, course CRUD, venue management, attendance sessions, QR challenges, location verification, disputes, reports, audit writes, SSE, load testing and production deployment.

## Proposed next sequence

1. Review the first migration with a real PostgreSQL engine and exercise migration up/down or forward-fix procedures.
2. Agree the institutional identity source, account provisioning owner and approved login method.
3. Implement authenticated sessions, logout, expiry, server-side authorization and audit events before exposing CRUD routes.
4. Build institution and academic structure services with scoped administrative screens and integration tests.
5. Build venue registration and authorization workflows before accepting any coordinates.
6. Add lecture session lifecycle and transactional attendance records.
7. Add dynamic challenge validation and explainable, accuracy-aware verification.
8. Complete student, lecturer and administrator workflows, reports, disputes and operational controls.
9. Test with controlled data, accessibility checks, security review and a measured load test before any pilot.

## Risk register

| ID | Risk | Likelihood / impact | Mitigation and owner |
| --- | --- | --- | --- |
| R1 | No approved source for student and staff identity | High / critical | LASU ICT and registry must select a supported source and provisioning owner before authentication rollout. |
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
