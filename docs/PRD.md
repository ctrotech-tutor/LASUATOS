# Product requirements

## Purpose

LASUATOS is intended to reduce the time lecturers spend taking attendance while creating a more useful, traceable record for students and authorized administrators. The initial pilot scope is the Faculty of Engineering at Lagos State University. A deployment decision, institutional identity source and operational approvals have not yet been provided.

## User problem

Paper registers and name-by-name roll calls take lecture time, are difficult to reconcile across large classes and make historical reporting tedious. A digital record can improve speed and retrieval, but attendance must not be treated as certain merely because a phone sent a coordinate or scanned a shared image.

## Product outcome

A student should be able to complete a legitimate check-in quickly. A lecturer should be able to create a lecture-specific attendance window, monitor confirmed records and review uncertain cases. Authorized administrators should be able to manage the academic and venue records that make those decisions meaningful.

## Product principles

1. Record evidence and uncertainty separately from the final attendance decision.
2. Enforce identity, course assignment and administrative scope on the server.
3. Confirm attendance only after a database transaction commits.
4. Do not silently rewrite historical records.
5. Collect location only for a verification event, never as continuous background tracking.
6. Provide a fair retry or human-reviewed fallback when location evidence is inconclusive.
7. Keep production records separate from any clearly labeled demonstration environment.
8. Make current capability and missing institutional integrations visible.

## Roles

The planned roles are student, lecturer, course coordinator, department administrator, faculty administrator, institution administrator and system administrator. Administrative authority is scoped to system, institution, faculty or department. Lecturer authority will derive from active course assignments. Students will only be able to retrieve their own records.

A role list and tested administrative-scope helper exist in `packages/contracts` and `packages/auth`. Authentication, request guards and route-level permission enforcement are not implemented yet, so those helpers are not a production security boundary today.

## Initial release workflow

The intended end-to-end flow is:

1. An authorized administrator establishes institutional, academic and venue records.
2. Students and lecturers are provisioned from an approved identity source.
3. An assigned lecturer creates a lecture session for a course offering and registered venue.
4. The lecturer opens attendance and presents a short-lived, session-bound QR challenge.
5. The student authenticates, scans the challenge and grants location permission for that check-in.
6. The server validates enrollment, session state, challenge freshness and evidence.
7. A successful transaction creates one attendance record. Uncertain evidence goes to retry or review rather than automatic punishment.
8. The lecturer closes the session and the student can later review their own record.

The workflow is a product requirement. It is not yet implemented.

## Out of scope for the first pilot

- Full timetable management.
- Continuous or background student tracking.
- Mandatory facial recognition or other biometric checks.
- Browser-based BLE scanning as a universal requirement.
- Claims that GPS, a static marker or Wi-Fi alone proves classroom presence.
- Microservices, a dedicated worker fleet or Redis before a measured need exists.

## Acceptance measures for a future pilot

Targets from the product brief are not measured results. Before adoption they need a written test plan and a representative load test. Candidate measures include 1,000 simultaneous users, 500 check-in requests in 30 seconds, p95 API latency below 500 ms under the agreed test, zero duplicate confirmed records and zero lost committed records.

## Current implementation boundary

The repository currently provides a development workspace, health and readiness endpoints, a first-pass PostgreSQL schema and migration, typed API contracts, a scoped authorization primitive, a readiness checklist and a local-only course roster preflight. The preflight uses a draft LASUATOS CSV contract and does not upload, save, import or verify records. No live institution data is present. See `docs/ACADEMIC_IMPORT.md` and `docs/IMPLEMENTATION_PLAN.md` for the workflow boundary, phase status and known risks.
