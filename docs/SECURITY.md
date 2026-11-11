# Security and privacy

## Current security state

LASUATOS supports student self-registration, one-time email confirmation, student or provisioned-lecturer password sign-in, server-side sessions, session lookup and logout. It also supports lecturer-scoped course-offering and enrollment-code management and student enrollment by lecturer-issued code. These routes require the configured database and server-side account state. Public registration remains student-only; it cannot choose a role. Staff accounts require a separate authorized provisioning process.

Student email confirmation proves control of a mailbox, not LASU student status. Any email domain is accepted. The matric number is self-reported, stored as text, not unique across accounts, and remains unverified unless an authorized process checks it. Enrollment proves use of an active course code and same-institution account only. It does not verify LASU student status or confirm attendance. The guarded local seed includes only synthetic demo data under a clearly labelled tenant; it never seeds official University records.

Passwords are hashed with Node.js scrypt using a per-password random salt. Email verification tokens and session tokens are generated from 256 bits of randomness and stored only as SHA-256 digests. Verification links expire after 30 minutes and are single-use. Session cookies are HttpOnly, SameSite=Lax, Secure in production, and expire after 30 days. The application supports logout revocation. These controls have unit and API route tests, but the PostgreSQL adapter has not been exercised against a configured test database.

The resend flow applies a two-minute per-account cooldown. There is no distributed or trusted-edge rate limiter for registration and password attempts yet. That is a production blocker. Cookie-authenticated mutation routes do not yet have a separate CSRF token. SameSite cookies and the absence of cross-origin API access are not a substitute for a complete security review.

The current Arena sandbox has no Docker daemon, PostgreSQL service or email credentials. Readiness reports `database: not_configured`, and database-dependent routes return unavailable responses without creating records. Migrations have not been applied here, and no email has been sent. For a developer's local machine, `compose.yaml` provides loopback-only PostgreSQL and Mailpit; Mailpit captures verification mail without contacting real inboxes. The API redacts email, name, matric number, password, token, enrollment-code and cookie fields in request logs. Route and service tests run without PostgreSQL; transaction, migration-application and concurrency behavior remain unverified in this sandbox.

The course roster preflight remains browser-only. It does not upload, save, import or verify a selected file. No attendance location is collected. There is no compliance certification or institutional approval claimed.

## Data categories

| Data | Purpose | Current state and boundary |
| --- | --- | --- |
| Email address and display name | Sign in and send a confirmation link | Stored only when a configured development database and institution row are available |
| Password hash | Verify student sign-in | Stored with scrypt; the plain password is not stored |
| Matric number | User-provided account detail | Self-reported text; not used to verify enrollment and not checked against LASU records |
| Email and session tokens | Confirm mailbox access and maintain sign-in | Only token digests are stored; raw tokens are delivered to the user's browser or email link |
| Course offerings, enrollments and join-code hashes | Manage course membership | Course and enrollment API implemented; only code hashes are stored, and code-use rate limiting plus database-backed integration testing are still needed |
| Attendance and location evidence | Keep a lecture record and evaluate venue proximity | Not implemented |
| Audit events | Trace administrative changes | Not implemented |

Exact purposes, lawful basis, retention periods, user notices and request channels require institutional and legal review before collecting real student data.

## Required before a pilot

- Provision an authorized development database, provision the LASU institution and academic records through an approved process, review migrations `0003` and `0004`, apply them only to that database, and test backup and restore.
- Select and configure an authorized email sender. Verify sender identity or domain with the selected provider. Keep API keys, OAuth credentials and App Passwords in server-side secret storage.
- Add trusted-edge rate limits and abuse monitoring for sign-up, resend, sign-in and verification endpoints.
- Complete CSRF, cookie, session rotation, password recovery, account recovery, lockout and security-header review.
- Add database-backed integration tests for migration application, concurrent registration, role-scoped offering creation, join-code rotation/revocation, same-institution enrollment, duplicate enrollment and session revocation.
- Approve the pilot purpose, privacy notice, lawful basis, access controls, retention schedule and user request process with the relevant University owners and legal advisers.
- Add operational monitoring, incident response, secure deployment configuration, encryption, backups and tested recovery.
- Complete a threat model and review against the Nigeria Data Protection Act 2023 and applicable NDPC requirements.

These are requirements, not completed controls. No legal compliance conclusion is claimed.

## Location privacy rules

The future client should request location only after a student begins a specific attendance check-in. It must not track in the background. Store raw coordinates separately from derived distance and outcome, restrict access, define retention with LASU, avoid exposing precise coordinates to ordinary lecturers and provide a reasonable alternative when evidence is poor.

GPS is a proximity signal, not proof of being inside a classroom. Poor accuracy, stale readings, obstruction, device settings and spoofing can all affect results. A mismatch is a review signal, not automatic proof of misconduct.

## Reporting a security concern

This repository has no public security contact configured yet. Before a pilot, the institution should designate a private reporting address, an incident owner and a response procedure. Do not place credentials, personal information or student records in a public issue.
