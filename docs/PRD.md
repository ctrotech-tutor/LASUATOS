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

The LASU application supports student, lecturer, department-administrator, faculty-administrator and institution-administrator access. System-wide administration is not exposed. Student accounts support self-registration, email confirmation, sign-in and server-managed sessions; lecturer and administrator access is provisioned separately. Public registration creates only a student account after mailbox confirmation and cannot grant staff roles. Email confirmation does not prove student status, and the matric number remains self-reported until checked against an authorized source. Lecturer course creation, attendance sessions, enrollment-code routes and the administrator overview enforce their assigned LASU scope server-side. Institution administrators manage the venue directory. Venue-linked sessions collect location evidence at check-in, and lecturers can make audited attendance corrections. Other administrative data changes are not implemented.

## Student account and enrollment direction

Students can create their own LASUATOS account with a name, email, matric number and password. Any email domain is accepted. A LASU email address is preferred when the student has one, but the domain is not used as proof of student status. The confirmation link establishes mailbox access only. The matric number is self-reported and is not compared with LASU records in this build.

The low-friction course workflow lets a provisioned lecturer create an offering within their institution and department, issue a lecturer-controlled join code, and share it with students. A signed-in student from the same institution can use that code to self-enroll without individual approval. Codes are hashed in storage, expire at semester end, and can be revoked or rotated. These flows do not verify LASU registration or attendance. Code redemption is rate limited per session (Phase 10). Authoritative academic provisioning and testing against a configured PostgreSQL service remain outstanding.

Public sign-up must never grant lecturer, coordinator or administrator roles. Staff accounts require a separate, authorized provisioning process.

## Attendance MVP

An assigned lecturer can open an immediate, time-boxed attendance session for an assigned offering, share its generated code, rotate the code, review the roster and close the session. A signed-in student must have an active enrollment in the same offering to check in. The server stores one timestamped record per student/session and returns an idempotent result for repeated submissions. Enrolled students can see which sessions are currently open in their courses (codes are never listed) and can review only their own check-in history. The code is a shared bearer credential: it records code use and time, not physical venue presence or official student identity. Lecturers can link a session to a registered venue. The session then shows a rotating QR challenge, and check-in submits a location sample that is evaluated as `within boundary` or `inconclusive` (clearly outside readings are refused with a retry path). Inconclusive evidence is not treated as misconduct.

Lecturers have per-course attendance reports: a register grid, per-session evidence breakdown, a follow-up threshold described as a planning aid, and CSV export. They can record a missed check-in or revoke one with a mandatory reason, and every change is permanently audited. Students see per-course attendance summaries. Administrators see scope-filtered attendance rates by course.

Students can raise a concern about a missing or revoked check-in within 14 days of the session ending. The course's assigned lecturers decide it with a note the student sees. Upholding records the student present through the audited correction path, and decisions are final. A statement is a request for human review, not evidence, and a rejection is not a misconduct finding. Open-dispute counts appear for lecturers (badge, report) and administrators (overview).

## Initial release workflow

The intended end-to-end flow is:

1. An authorized operator provisions the institution, academic records and approved venue register.
2. Students create accounts and confirm email ownership. Any authoritative student-status check is a separate, approved process.
3. A provisioned lecturer creates a department-scoped course offering and shares an expiring enrollment code; a same-institution student uses it to self-enroll.
4. An assigned lecturer creates a lecture session for the offering and registered venue.
5. The lecturer opens attendance and presents a short-lived, session-bound QR challenge.
6. The student signs in, scans the challenge and grants location permission for that check-in.
7. The server validates enrollment, session state, challenge freshness and evidence.
8. A successful transaction creates one attendance record. Uncertain evidence goes to retry or review rather than automatic punishment.
9. The lecturer closes the session and the student can later review their own record.

Student accounts, lecturer course offerings, student enrollment and the code-based attendance MVP are implemented, subject to a configured database, email sender and provisioned staff account. Venue-linked QR/location evidence, lecturer reports and audited corrections are implemented. The fuller workflow above still needs authorized, surveyed venue data, institutional agreement on the in-product dispute path (escalation, notifications, retention), and the associated privacy/operational approvals. Neither code- nor location-based check-in may be described as proof of venue presence.

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

The repository provides the public LASUATOS landing and account flows, student and lecturer course workspaces, server-managed student/lecturer/administrator sessions, scoped lecturer course-offering and enrollment-code management, student self-enrollment, time-boxed lecturer attendance sessions, student code check-in and personal attendance history, and a read-only administrator overview filtered to the assigned LASU scope. Attendance is limited to a shared-code workflow and does not verify venue presence or official student identity. The repository also contains a PostgreSQL schema and migrations, typed contracts, scoped authorization checks, and a browser-only roster preflight utility. Database-backed workflows require a configured database and provisioned staff accounts; student registration also requires a configured email sender. Local setup contains only clearly synthetic demo records. The roster preflight uses a draft LASUATOS CSV contract and does not upload, save, import or verify records. Venue-linked sessions with rotating QR challenges and location evidence, lecturer attendance reports with audited corrections and CSV export, student attendance summaries and a scope-filtered administrator attendance overview are available. Student attendance disputes with a lecturer review queue are available. Official student identity checks, dispute notifications and escalation, and administrative data changes beyond the venue directory are not available. See `docs/ADMINISTRATION.md`, `docs/ACADEMIC_IMPORT.md`, `docs/SECURITY.md` and `docs/IMPLEMENTATION_PLAN.md` for current boundaries and risks.
