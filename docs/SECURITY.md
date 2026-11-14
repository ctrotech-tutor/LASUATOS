# Security and privacy

## Current security state

LASUATOS supports student self-registration, one-time email confirmation, student/provisioned lecturer/provisioned administrator sign-in, server-side sessions, session lookup and logout. It also supports lecturer-scoped course offerings and attendance sessions, student enrollment and code-based check-in, and a scope-filtered administrator overview. These workflows require the configured database and server-side account state. Public registration remains student-only; it cannot choose a role. Lecturer and administrator accounts require a separate authorized provisioning process.

Student email confirmation proves control of a mailbox, not LASU student status. Any email domain is accepted. The matric number is self-reported, stored as text, not unique across accounts, and remains unverified unless an authorized process checks it. Enrollment proves use of an active course code and same-institution account only. Attendance check-in additionally requires an active enrollment and open session, then records the server timestamp once per student/session. A shared session code can be copied or forwarded; it does not verify venue presence, GPS, or official student identity. The guarded local seed includes only synthetic demo data under a clearly labelled tenant; it never seeds official University records.

Passwords are hashed with Node.js scrypt using a per-password random salt. Email verification, password reset and session tokens are generated from 256 bits of randomness and stored only as SHA-256 digests. Verification and reset links expire after 30 minutes and are single-use. Session cookies are HttpOnly, SameSite=Lax, Secure in production, and expire after 30 days. Account owners can list their sessions, sign out one or all other sessions, change their password and recover a forgotten password (see "Account protection" below). The auth, attendance, dispute and account-security PostgreSQL adapters are exercised against an embedded PGlite database in integration tests; none has been exercised against a configured PostgreSQL service here.

Rate limiting, cross-origin request checks and security headers are implemented in the API, and the web app sends its own security headers (Phase 10, below). They reduce, but do not remove, abuse risk: there is no trusted-edge (CDN or load-balancer) protection and no bot challenge. Email alerts cover server errors, page crashes and an out-of-date schema (`ALERT_EMAIL`, ADR 020), not rate-limit or cross-origin blocks. This is not a complete security review.

The current Arena sandbox has no Docker daemon, PostgreSQL service or email credentials. Readiness reports `database: not_configured`, and database-dependent routes return unavailable responses without creating records. Migrations have not been applied here, and no email has been sent. For a developer's local machine, `compose.yaml` provides loopback-only PostgreSQL and Mailpit; Mailpit captures verification mail without contacting real inboxes. The API redacts email, name, matric number, password, token, enrollment-code and cookie fields in request logs, as well as attendance dispute statements and decision notes (`req.body.statement`, `req.body.note`). Route and service tests run without PostgreSQL; transaction, migration-application and concurrency behavior remain unverified in this sandbox.

The course roster preflight remains browser-only. It does not upload, save, import or verify a selected file. Attendance stores a check-in timestamp and method. Device location is collected only for venue-linked sessions at check-in time, as proximity evidence. There is no compliance certification or institutional approval claimed.

## Account protection (Phase 10)

**Rate limiting.** One policy table (`apps/api/src/security/rate-limit-policies.ts`) applies fixed-window limits before route handlers run:
- **Keys:** client address (sign-in, registration, resend, verification, reset), normalized email (sign-in, registration, resend, reset request) and session (password change, session revocation, enrollment, check-in, disputes). Check-in, enrollment and dispute limits use the session, because a whole lecture can share one campus NAT address.
- **QR attendance** (`/api/v1/lecture/resolve` and `/check-in`, no account needed) is limited per address at 20,000 requests per 10 minutes, with typed-code misses limited to 600 per 10 minutes per address so codes cannot be guessed. Nothing is keyed on the QR ticket: everyone who scans in the same second shares one ticket, and such a limit refused most of a full hall in the crowd test (`docs/LOAD_TESTING.md`). One phone entering several students is flagged to the lecturer as a shared device instead.
- **Counting:** every attempt counts, successful or not, and all of a request's rules are counted so tripping one cannot hide the others. A blocked request gets `429` with `Retry-After` and a plain-language message.
- **Storage:** counters live in PostgreSQL (`rate_limit_counters`), shared by every API instance. The row key is a SHA-256 digest of the policy and subject, so raw addresses, emails and tokens are never stored. Expired windows reset on the next hit and are pruned opportunistically.
- **Failure mode:** if the counter store fails, requests are allowed and the failure is logged (fail-open), so a database hiccup cannot lock everyone out of sign-in or check-in. Production refuses `RATE_LIMIT_STORE=off`.
- **Client addresses** come from `X-Forwarded-For` only when the immediate peer matches `TRUST_PROXY` (default `loopback`, which fits the Next.js rewrite on the same host). A wrong `TRUST_PROXY` either merges everyone into one address or lets clients choose their own; set it to the load balancer's addresses in production.
- **Embedded mode (free Vercel setup, ADR 015)** does not read `X-Forwarded-For` or `TRUST_PROXY`. The client address is Vercel's `x-real-ip`, which the platform sets itself. Use embedded mode only on a host whose edge overwrites that header.
- **The limits are starting values** for the pilot, to be tuned from observed traffic. They are not a capacity statement.

**No hard lockout.** Repeated failed sign-ins are throttled (10 attempts per email and 30 per address per 15 minutes) rather than locking the account. A lockout would let anyone who knows a student's email block that student from signing in before a lecture. Throttling makes guessing impractical without giving others that power.

**Password recovery.**
- **Request** (`POST /api/v1/auth/password-reset/request`): the response is the same `202` whether or not the address has an account, is unverified, is suspended or is in the two-minute cooldown, so it cannot be used to discover accounts. Only active, email-verified accounts with a password receive a link. A pending student must use the confirmation link instead, so recovery cannot bypass email confirmation.
- **Token:** one token per user (a new request replaces the old one), stored as a digest. It expires in 30 minutes and is single use. The link carries the token in the URL fragment, which browsers do not send to servers; the reset page removes it from the address bar and history. The page sends `no-referrer` and `no-store`.
- **Completion** (`POST /api/v1/auth/password-reset/complete`): one transaction consumes the token, replaces the password hash and revokes **every** session of the account. The browser's cookie is cleared and the owner is emailed a notice.
- **Change** (`POST /api/v1/auth/password`): requires the current password. It revokes every other session and invalidates any pending reset link. The owner is emailed a notice. Notices are best effort: a delivery failure is logged, but the change still stands.

**Sessions.** `GET /api/v1/auth/sessions` lists the caller's live sessions with created, last-active and expiry times and marks the current one; tokens are never returned. Last-active is refreshed at most once every 5 minutes per session to limit writes. `DELETE /api/v1/auth/sessions/:id` signs out one other session and `POST /api/v1/auth/sessions/revoke-others` signs out all others. Both are limited to the caller's own sessions (`404` otherwise); the current session ends through normal sign-out. Device names, IP addresses and user agents are deliberately not recorded.

**Cross-site request forgery.** In addition to `SameSite=Lax` cookies, every state-changing API request (`POST`/`PUT`/`PATCH`/`DELETE`) passes an origin check (`apps/api/src/security/origin-guard.ts`):
- `Sec-Fetch-Site: cross-site` is rejected.
- `same-origin` and `none` are accepted.
- Otherwise the `Origin` must exactly match `PUBLIC_APP_URL` or an entry in `TRUSTED_ORIGINS`. `Origin: null` is rejected.
- Requests with neither header come from non-browser clients, which carry no ambient browser cookies to forge, so they are accepted.

A blocked request gets `403` with an explanation. There is no separate CSRF token.

**Security headers.**
- **API:** every response gets `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy` and same-origin resource and opener policies, plus HSTS in production.
- **Web pages** (`apps/web/next.config.ts`): a CSP that allows only the app's own scripts, styles and API, data-URL QR images and OpenStreetMap tiles; `frame-ancestors 'none'`; `X-Frame-Options: DENY`; `nosniff`; `strict-origin-when-cross-origin` referrers (OpenStreetMap's tile policy needs a referrer); and a `Permissions-Policy` that allows geolocation only on this origin, for venue check-in. HSTS and `upgrade-insecure-requests` are sent when `PUBLIC_APP_URL` is HTTPS.
- **Known gap:** the page CSP still permits inline scripts, because the Next.js App Router emits inline bootstrap scripts. A nonce-based CSP (middleware plus dynamic rendering) is the follow-up. Until then the CSP limits where content can load from and blocks framing, but it is not a full defence against injected inline script.

**Error alerts.** Alert emails (`apps/api/src/monitoring/alerts.ts`) carry the route pattern (for example `GET /api/v1/lecture/sessions/:sessionId`, so no IDs or query strings), the error type and message, and the request ID. Request bodies are never included. The error message is shortened, and text that looks like a connection string, an API key or a `token=`/`password=`/`cookie=` value is replaced with `[hidden]` before sending. Browser crash reports (`POST /api/v1/client-errors`) are origin checked and rate limited, always answer `204`, and are only ever turned into an email to the operator, so they cannot be used to reach anyone else.

**Logging.** One shared redaction list (`apps/api/src/security/headers.ts`) is used by both the default and production loggers. It covers cookies, `Set-Cookie`, authorization, email, names, matric numbers, all password fields (`password`, `currentPassword`, `newPassword`), tokens, codes, locations, dispute statements and notes.

## Staff provisioning (Phase 11)

- **No self-service staff roles.** Public sign-up creates students only. Lecturers and administrators exist only through invitations: the first from the server-side `pnpm admin:bootstrap` command, the rest from an administrator's Staff page. Email domain never grants a role.
- **Scope.** Administrators may invite and manage people at or below their own level, inside their own area. This is decided on the server from the session's role assignment; browser-supplied faculty and department ids are only checked against it. Out-of-scope and unknown ids get the same response. System-administrator roles cannot be invited, and nobody can suspend or reactivate themselves.
- **Invitation tokens.** 256 bits from a CSPRNG, stored only as a SHA-256 digest, valid for 7 days and single use. Resending replaces the digest, so older links stop working. Links carry the token in the URL fragment; `/accept-invitation` strips it from history and is served with `no-store` and `no-referrer`. The admin API never returns the token. The bootstrap command prints it only when no email could be sent or `--print-link` is given.
- **Acceptance** creates the account, confirms the email, creates the profile and scoped role assignment, and consumes the invitation in one transaction with the invitation row locked, so a link cannot be accepted twice. It re-checks that the email is still unused, the staff number is free, and the faculty or department is still active.
- **Suspension** revokes every session of the account in the same transaction. Session lookup and sign-in require an active account, so the person is signed out on their next request.
- **Audit.** Every invitation, resend, revoke, acceptance, suspension and reactivation is written to `staff_audit_events` (actor, target, reason, time). A trigger rejects updates and deletes.
- **Rate limits** (pilot starting values): invite and resend 30 per hour per session; preview 30 and accept 20 per 15 minutes per address. Invitation emails are logged on failure without the token.
- **Limits.** The product does not verify that an invitee is really LASU staff; the inviting administrator vouches for that, and the audit trail records who did.

## Student accounts and face verification

- **Opening an account** needs a matric number on an uploaded class list and the 6-digit code sent to the LASU student email (on the list, or typed by the student when the list has none; it must end in `@st.lasu.edu.ng` and be unused). Lookups, code requests and opening are rate-limited per address and per matric number; the lookup reveals only a masked name and never whether an account still uses its starting password.
- **Starting password** `LASU<matric><SURNAME>` follows the LASU portal convention the students already know. It is guessable by anyone who knows the student, so it is not the protection: opening needs the email code, and every check-in needs the student's face. The account is flagged (`password_is_default`) and the student is asked to change it. It is stored as an scrypt hash like any password.
- **Face check at attendance** (`FACE_CHECK=required`): the face must match the registered face, the head must turn the way the scan asks, and passive liveness must pass. Six failed tries per lecture per 30 minutes block further tries and are audited. Passive liveness is not certified presentation-attack detection; the venue check, shared-device flag and the session taker's list stay in place.
- **Duplicates:** a face too close to another student's registered face is refused and audited, so one person cannot hold two accounts.

## Data categories

| Data | Purpose | Current state and boundary |
| --- | --- | --- |
| Email address and display name | Sign in and send a confirmation link | Stored only when a configured development database and institution row are available |
| Password hash | Verify student sign-in | Stored with scrypt; the plain password is not stored |
| Class lists (matric number, surname, first and middle names, LASU email, set) | Open accounts with names that match the department's records | Uploaded by the HOC of that department and set, a GHOC for their faculty, or an administrator in scope. Every import and edit is in `student_audit_events` with before/after values. Students cannot type their own names. The public lookup shows only a masked name |
| Matric number | Identify the student and work out their level | Comes from the class list for accounts opened since class lists; older accounts keep the self-reported value until linked by a class-list import |
| LASU student email | Prove the student controls a `@st.lasu.edu.ng` mailbox | Confirmed with a 6-digit code: stored only as a SHA-256 digest, valid 15 minutes, 5 attempts, 60 seconds between sends, 8 per day |
| Face templates and photo (biometric, sensitive under NDPA 2023) | Make sure only the account owner marks their attendance | Collected only after explicit consent. Three 128-number templates, their average and one 200 × 250 photo. Processed on the LASUATOS server only. Visible to the student, their HOC and administrators. Deleted with the account or reset by an administrator. See [FACE_VERIFICATION.md](FACE_VERIFICATION.md) |
| Check-in face results | Show the session taker how sure the face match was | Scores per lecture and student; the photo is kept only for a close match, with that lecture, for the session taker to compare |
| Email, password-reset and session tokens | Confirm mailbox access, recover a password and maintain sign-in | Only token digests are stored; raw tokens are delivered to the user's browser or email link. Reset tokens are one per user, expire in 30 minutes and are single use |
| Session activity times | Let account owners recognise and end their sessions | Created, last-active (refreshed at most every 5 minutes) and expiry times. No device name, IP address or user agent is stored |
| Rate-limit counters | Slow down guessing, flooding and abuse | A SHA-256 digest of policy plus subject (address, email or session), a count and a window. Raw values are not stored; rows expire with their window and are pruned |
| Course offerings, enrollments and join-code hashes | Manage course membership | Course and enrollment API implemented; only code hashes are stored, and code redemption is rate limited per session |
| Attendance session codes and records | Record an enrolled student's session-code use and server timestamp | Implemented for timed sessions; session code hashes are stored, one record per student/session is enforced, and the workflow does not prove venue presence |
| Location evidence | Evaluate venue proximity | Collected only for venue-linked sessions at check-in time. It is evaluated server-side and stored as evidence separate from the record. It is proximity evidence only, never proof of presence |
| Attendance corrections | Let assigned lecturers record a missed check-in or revoke one | Implemented. A 10–500 character reason is required. Records are never deleted (revocation is a status). Every change appends an `attendance_corrections` row (actor, student, action, previous/resulting status, reason, time), and a trigger rejects edits or deletes of that table |
| Attendance disputes | Let a student ask the course's lecturers to review a missing or revoked check-in | Implemented.<br>**Students:** a student can dispute only their own sessions; the student ID comes from the session, never the request. The 20–1,000 character statement is free text written by the student, and the UI asks them to leave out passwords and medical details.<br>**Lecturers:** only lecturers assigned to the offering can read or decide disputes; anyone else gets `404`. Each decision carries a 10–500 character note that the student sees.<br>**Integrity:** rows are never deleted, decisions are final, and a trigger keeps submission fields immutable. An upheld dispute is applied through the audited correction path and linked by `dispute_id`.<br>**Logging:** statements and notes are redacted from request logs.<br>**Interpretation:** a statement is a review request, not evidence, and a rejection is not a misconduct finding.<br>**Open:** retention, who else may read statements, and escalation still need an institutional policy |
| Attendance reports and exports | Lecturer follow-up and administrator oversight | Implemented with server-side assignment/scope checks and `no-store` responses. CSV exports escape formula-leading cells. A downloaded CSV leaves LASUATOS control and needs an institutional handling and retention rule |
| Audit events | Trace administrative changes | Implemented for venue location changes, attendance corrections and dispute decisions (the dispute row itself records the resolver, time and note); other administrative changes are not yet audited |

Exact purposes, lawful basis, retention periods, user notices and request channels require institutional and legal review before collecting real student data.

## Required before a pilot

- Provision an authorized development database, provision the LASU institution and academic records through an approved process, review migrations `0003` through `0005`, apply them only to that database, and test backup and restore.
- Select and configure an authorized email sender. Verify sender identity or domain with the selected provider. Keep API keys, OAuth credentials and App Passwords in server-side secret storage.
- Put the API behind a trusted edge (load balancer or CDN) with its own coarse limits, set `TRUST_PROXY` to that edge, and add alerting on `429` spikes, `403` cross-origin blocks and rate-limit store failures. Tune the Phase 10 limits from observed pilot traffic.
- Have the Phase 10 controls (rate limits, recovery, session management, origin checks, headers) reviewed independently, then move the page CSP to nonces.
- Decide an account-recovery route for users who have lost access to their mailbox (an administrator-assisted process with identity checks); self-service recovery only works through the registered email.
- Run the load plan in `docs/LOAD_TESTING.md` in staging and record measured results.
- Extend database-backed integration tests beyond the current PGlite tests: migration application through the deployed path, concurrent registration, role-scoped offering creation, join-code rotation/revocation, same-institution course enrollment, duplicate enrollment, attendance session expiry/closure, concurrent duplicate check-in and session revocation.
- Approve the pilot purpose, privacy notice, lawful basis, access controls, retention schedule and user request process with the relevant University owners and legal advisers.
- Add operational monitoring, incident response, secure deployment configuration, encryption, backups and tested recovery.
- Complete a threat model and review against the Nigeria Data Protection Act 2023 and applicable NDPC requirements.

These are requirements, not completed controls. No legal compliance conclusion is claimed.

## Location privacy rules

The future client should request location only after a student begins a specific attendance check-in. It must not track in the background. Store raw coordinates separately from derived distance and outcome, restrict access, define retention with LASU, avoid exposing precise coordinates to ordinary lecturers and provide a reasonable alternative when evidence is poor.

GPS is a proximity signal, not proof of being inside a classroom. Poor accuracy, stale readings, obstruction, device settings and spoofing can all affect results. A mismatch is a review signal, not automatic proof of misconduct.

## Reporting a security concern

This repository has no public security contact configured yet. Before a pilot, the institution should designate a private reporting address, an incident owner and a response procedure. Do not place credentials, personal information or student records in a public issue.
