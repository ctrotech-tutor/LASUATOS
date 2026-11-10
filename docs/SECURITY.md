# Security and privacy

## Current security state

This is a development foundation, not a production service. The API has no authenticated user routes, no login or logout flow, no account provisioning and no route-level authorization. The role-scope helper has unit tests but is not attached to an authenticated request. The schema includes a nullable password-hash field and a table for hashed session tokens; neither is used by an authentication implementation. No password or session credential should be stored or accepted through the current API.

No institutional, student, staff, venue or location data is present. No location is collected by this build. There is no compliance certification or institutional approval claimed.

A point-in-time dependency audit on 10 November 2026 reported no known vulnerabilities for production or development dependencies. The lockfile pins reviewed versions, with scoped overrides for vulnerable transitive `esbuild` and `minimatch` releases. This result does not replace ongoing dependency monitoring or a production security review.

## Data categories planned

| Data | Purpose | Access plan | Current state |
| --- | --- | --- | --- |
| Account and institutional identifiers | Sign in and associate a person with the correct institution | Restricted to the person and authorized administrators | Not connected |
| Course and enrollment records | Determine whether a student belongs to a course offering | Scoped academic administrators and assigned lecturers | Schema only, no records |
| Attendance decision and evidence | Keep an auditable lecture record | Student's own history, assigned lecturer and scoped administrators | Not implemented |
| Location evidence | Estimate proximity to a registered venue for a check-in | Restricted, short-lived where feasible, never exposed by default | Not implemented |
| Audit events | Trace administrative changes and corrections | Authorized reviewers only | Not implemented |

Exact purposes, retention periods, lawful basis, user notices and request channels require institutional and legal review before collection.

## Required before production

- Select an approved LASU identity source or an institutionally approved local-account process.
- Implement strong password hashing if passwords are used, secure server-managed sessions, HttpOnly/Secure/SameSite cookies, expiry, revocation and rotation.
- Implement CSRF protection for cookie-authenticated state changes, strict input validation, server-side authorization and object-level scope checks.
- Enforce rate limits at the trusted API edge and protect login and challenge endpoints from abuse.
- Configure HTTPS, secret management, database encryption and backups with documented recovery tests.
- Add security headers to the web application, content security policy, safe file upload rules if uploads are introduced, dependency scanning and incident response.
- Record sensitive administrative changes without putting credentials, raw location or unnecessary personal data in logs.
- Complete a threat model, privacy impact assessment and review against the Nigeria Data Protection Act 2023 and applicable NDPC requirements.

These are requirements, not completed controls. No certification or legal compliance conclusion is claimed.

## Location privacy rules

The future client should request location only after a student begins a specific attendance check-in. It must not track in the background. Store raw coordinates separately from derived distance and outcome, restrict access, define retention with LASU, avoid exposing precise coordinates to ordinary lecturers and provide a reasonable alternative when evidence is poor.

GPS is a proximity signal, not proof of being inside a classroom. Poor accuracy, stale readings, obstruction, device settings and spoofing can all affect results. A mismatch is a review signal, not automatic proof of misconduct.

## Reporting a security concern

This repository has no public security contact configured yet. Before a pilot, the institution should designate a private reporting address, an incident owner and a response procedure. Do not place credentials, personal information or student records in a public issue.
