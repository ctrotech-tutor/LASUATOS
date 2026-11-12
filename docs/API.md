# API

## Versioning

Application routes use `/api/v1`. Request validation belongs at the API boundary, shared data shapes live in `packages/contracts`, and attendance decisions are made by the server. Client-submitted roles, status values, distances and verification outcomes are never trusted as authoritative.

## Health routes

### `GET /api/v1/health`

Liveness check. Returns a timestamp and service identifier. It does not reveal configuration or database errors and sets `Cache-Control: no-store`.

### `GET /api/v1/ready`

Readiness check. It returns `200` only after the configured database responds to `SELECT 1`. It returns `503` with one of `not_configured` or `down` when a database is not usable. This endpoint intentionally does not include connection details.

## Account routes

These routes require a configured PostgreSQL database. Student sign-up also requires an existing institution row whose slug matches `SELF_REGISTRATION_INSTITUTION_SLUG` and a server-configured email provider. The local setup creates a clearly labelled synthetic academic structure for development; it is not an official LASU record.

### `POST /api/v1/auth/register`

Accepts `displayName`, `email`, `matricNumber` and `password`. The request is strict and rejects additional properties such as `role`. Passwords must be 12 to 128 characters. Email addresses are trimmed and lowercased. Any email domain is accepted.

A successful request returns `202` with the same generic response whether an account was created or the address already exists. It creates a pending student account with status `invited`, hashes the password, stores the matric number as unverified text, and sends a one-time email link. It does not confirm LASU student status. A student role is assigned only after email verification. Public registration cannot assign lecturer, coordinator or administrator roles.

### `POST /api/v1/auth/resend-verification`

Accepts an email address and returns a generic `202` response whether the pending account exists or not. A new link can be sent no more than once per two minutes per pending account. The endpoint does not disclose whether an address is registered.

### `POST /api/v1/auth/verify-email`

Accepts the one-time token from the email link. The web page reads the token from the URL fragment, removes it from the address bar, and waits for the user to press the confirmation button before sending a JSON POST. This keeps the token out of the initial page request and avoids activating accounts just because an email scanner opened the link. A valid token is consumed once, activates the account, assigns the student role, creates a server session and sets the session cookie. The response returns a safe student-account summary, including a boolean indicating whether the matric number has been checked by an authorized source. That boolean is false for public self-registration.

Expired, malformed or reused links are rejected. Verification links expire after 30 minutes.

### `POST /api/v1/auth/login`

Accepts email and password. An active, email-confirmed student, provisioned lecturer, or server-provisioned LASU administrator with an active role assignment can sign in. Administrator roles are limited to institution, faculty or department scopes; system-wide administration is not exposed by this application. Invalid credentials use a generic `401` response. Successful sign-in creates a server-managed session and sets the same cookie used by email verification. Public registration accepts student fields only and cannot grant lecturer or administrator access.

### `GET /api/v1/auth/session`

Returns the current student's, lecturer's or administrator's safe account summary when the session is active. Administrator responses include the server-assigned role and its institution/faculty/department scope. The response does not return the session token. Missing, expired or revoked sessions receive `401`.

### `POST /api/v1/auth/logout`

Revokes the current session on the server and clears the browser cookie. It is safe to call without an existing cookie.

### Session cookie

The cookie is named `lasuatos_session`, is HttpOnly and SameSite=Lax, uses Secure in production, and expires after 30 days. The database stores a hash of the session token. There is no email-change route.

### `POST /api/v1/auth/password-reset/request`

Body: `{ "email": string }` (strict; trimmed and lower-cased). Always returns the same `202` with a generic message, whether or not the address belongs to an account, so it cannot be used to discover accounts. Only active, email-verified accounts with a password are emailed a link (`/reset-password#token=…`). The token is 256 random bits, stored as a SHA-256 digest, expires in 30 minutes and is single use; each user has at most one, and re-requests within two minutes send nothing. Email delivery failures are logged and still return `202`. Returns `503` when email delivery or the database is not configured.

### `POST /api/v1/auth/password-reset/complete`

Body: `{ "token": string (43 base64url characters), "password": string (12–128) }` (strict). On success it returns `200` with `{ "status": "password_reset", "message": … }`, replaces the password hash, consumes the token, **revokes every session of the account**, clears this browser's cookie and emails the owner a notice. An unknown, expired, superseded or used token returns `400` with one explanatory `detail`.

### `POST /api/v1/auth/password`

Requires a session. Body: `{ "currentPassword": string (1–128), "newPassword": string (12–128) }` (strict). Returns `200` with `{ "status": "password_changed", "revokedSessions": number }`. The current session stays signed in; every other session is revoked, any pending reset link is invalidated and the owner is emailed a notice. A wrong current password, or a new password identical to the current one, returns `400` with a specific `detail`. Without a valid session it returns `401`.

### `GET /api/v1/auth/sessions`

Requires a session. Returns `{ "sessions": [{ "id", "createdAt", "lastSeenAt" | null, "expiresAt", "current" }] }` for the caller's live sessions, most recently active first (up to 100). Tokens are never returned. `lastSeenAt` is refreshed at most once every 5 minutes. No device name, IP address or user agent is recorded.

### `POST /api/v1/auth/sessions/revoke-others`

Requires a session; takes no body (any non-empty body returns `400`). Signs out every other live session of the caller and returns `{ "revokedSessions": number }`.

### `DELETE /api/v1/auth/sessions/{sessionId}`

Requires a session. Signs out one other session belonging to the caller and returns `{ "revokedSessions": 1 }`. A session that is not the caller's, has already ended, or is the current session returns `404` (end the current session with `POST /api/v1/auth/logout`).

### Rate limits

Requests to these routes are counted before the handler runs. Every attempt counts, whether or not it succeeds. Over a limit, the API returns `429` with a `Retry-After` header (in seconds) and a plain-language `detail`. The limits are starting values for the pilot and may change.

| Route | Limits |
| --- | --- |
| `POST /auth/login` | 30 per address and 10 per email, per 15 minutes |
| `POST /auth/register` | 10 per address and 3 per email, per hour |
| `POST /auth/resend-verification` | 10 per address and 5 per email, per hour |
| `POST /auth/verify-email` | 30 per address per 15 minutes |
| `POST /auth/password-reset/request` | 10 per address and 5 per email, per hour |
| `POST /auth/password-reset/complete` | 20 per address per 15 minutes |
| `POST /auth/password` | 10 per session and 30 per address, per hour |
| `POST /auth/sessions/revoke-others` | 20 per session per hour |
| `DELETE /auth/sessions/{id}` | 60 per session per hour |
| `POST /enrollments/join` | 20 per session and 300 per address, per 10 minutes |
| `POST /student/attendance/check-in` | 30 per session per 5 minutes |
| `POST /student/attendance/disputes` | 20 per session per hour |

Emails are compared trimmed and lower-cased. The client address comes from `X-Forwarded-For` only when the request arrives from a proxy listed in `TRUST_PROXY`.

### Cross-origin protection

Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api/` is checked before routing:
- `Sec-Fetch-Site: cross-site` is rejected with `403`.
- `same-origin` and `none` are accepted.
- Otherwise the `Origin` header must exactly match `PUBLIC_APP_URL` or a `TRUSTED_ORIGINS` entry. `Origin: null` is rejected.
- Requests that carry neither header (server-side clients) are accepted.

### Response headers

Every API response includes `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Resource-Policy: same-origin` and `Cross-Origin-Opener-Policy: same-origin`. Production adds `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Account responses are `Cache-Control: no-store`.

## Administrator overview

### `GET /api/v1/admin/overview`

Requires an active session with a server-assigned LASU institution-, faculty- or department-administrator role. Returns counts for active departments, active LASUATOS student and provisioned lecturer accounts, course offerings and active enrollments within the account's current scope. The API resolves that scope from the authenticated server session; no client-supplied role or scope is accepted. A student or lecturer session receives `403`, and the response uses `Cache-Control: no-store`.

### `GET /api/v1/admin/attendance`

This route uses the same administrator guard and server-resolved scope as the overview (department → that department; faculty → its departments; institution → all), and it is `no-store`. It returns `{ generatedAt, totals, offerings[] }`. Each offering row has course code/title, department, semester, `sessionsHeld`, `activeEnrollments`, `expectedCheckIns`, `presentCheckIns`, `inconclusiveCheckIns`, `manualCheckIns`, `revokedCheckIns`, `rate`, `lastSessionAt`, `openDisputes` and `oldestOpenDisputeAt` (ISO time or `null`). `totals` carries the same open-dispute sum and the oldest waiting dispute across the scope.

- Only sessions that have started count.
- Expected check-ins pair each started session with each actively enrolled student who was enrolled when it started. Present check-ins by students who enrolled after a session began are added to the denominator.
- `rate` is `null` when nothing is expected. It is capped at 1,000 offerings per response.

## Course offerings and enrollment

These routes require an active server session. Student enrollment routes accept only student accounts. Lecturer routes accept only provisioned lecturer accounts whose database profile and role scope still authorize the action. The server derives institution and department from that profile; clients cannot supply or override either scope. Every response uses `Cache-Control: no-store`.

### `GET /api/v1/lecturer/semesters`

Returns semesters at the lecturer's institution whose end time has not passed. A department-scoped lecturer must still have a valid role assignment for the department in their profile.

### `POST /api/v1/lecturer/course-offerings`

Accepts a strict JSON object with `courseCode`, `courseTitle`, `creditUnits`, `semesterId` and `level`. The server creates the course metadata and department/semester offering using the lecturer's provisioned institution and department, then assigns the offering to that lecturer. The response is `201` with `status: created` or `200` with `status: already_assigned` when the same lecturer already owns the offering. A course code already registered with different title or credit units, or an offering belonging to another lecturer, is not overwritten.

### `GET /api/v1/lecturer/course-offerings`

Returns only course offerings assigned to the authenticated lecturer, with a boolean indicating whether an enrollment code is currently active. Other lecturers' assignments and join-code hashes are not returned.

### `POST /api/v1/lecturer/course-offerings/{courseOfferingId}/join-code`

Issues a cryptographically random 12-character code for an offering assigned to the lecturer. The plaintext is returned once with its semester-end expiry; the database stores only its SHA-256 hash. Issuing another code revokes the previous one. The endpoint never returns an existing plaintext code. Lecturers may copy the response value, so the client displays and labels it as a one-time secret.

### `DELETE /api/v1/lecturer/course-offerings/{courseOfferingId}/join-code`

Revokes the active code for an offering assigned to the lecturer. Returns `204` with no body. Repeated revocation is not treated as a success when there is no active code.

### `POST /api/v1/enrollments/join`

Accepts `{ "code": "..." }` from a signed-in student. Whitespace and hyphens are removed and letter case is normalized before lookup. The code must be active and unexpired, and the student profile must belong to the same institution as the offering. Successful joins return `status: enrolled`; using the same code again for an active enrollment returns `status: already_enrolled`. A valid code does not verify LASU student status or confirm attendance.

### `GET /api/v1/enrollments`

Returns only the authenticated student's active course enrollments. Students cannot query another student's identifier or submit account, institution, role or enrollment status fields.

Course-code redemption and attendance-code check-in are sensitive to brute-force and code-sharing abuse. Request logs redact the submitted `code` field; the API still needs trusted-edge rate limits and abuse monitoring. The API provides no course approval or staff provisioning workflow: lecturer accounts must be provisioned through an authorized database/admin process. Public student registration remains the only self-service registration route.

## Venue management

These routes manage the campus → building → venue hierarchy and venue geofences. All routes require an active server session with the administrator account type and use `Cache-Control: no-store`. Reads are institution-wide for any administrator in the institution; writes (`POST`) require the `institution_administrator` role because a venue boundary affects every department that shares the space. The server derives the tenant from the session account's institution; no client-supplied institution or scope is accepted. Student or lecturer sessions receive `403`; absent venue services respond `503`.

### `GET /api/v1/admin/campuses`

Returns the institution's campuses with code, name, optional address and optional campus-level map anchor coordinates.

### `GET /api/v1/admin/buildings` · `POST /api/v1/admin/buildings`

Lists buildings with their campus names. Creation accepts `{ "campusId", "code", "name" }`; the code is normalized to uppercase and must be unique per campus. A campus outside the administrator's institution cannot be referenced.

### `GET /api/v1/admin/venues` · `GET /api/v1/admin/venues/{venueId}`

Lists venues with campus/building names, venue type, capacity, status (`pending_review`, `active`, `inactive`) and the registered geofence (`geofenceKind`, `geofenceRadiusMeters`, coordinate). The detail route returns a single venue from the same tenant-scoped read.

### `POST /api/v1/admin/venues`

Creates a venue in `pending_review` status. Accepts `campusId`, optional `buildingId`, `code` (normalized uppercase, unique per campus), `name`, `venueType`, optional `floorLabel`/`sectionLabel`/`capacity`/`notes`, and `locationRequired` (default `true`). A pending venue never accepts attendance verification.

### `POST /api/v1/admin/venues/{venueId}/location`

Registers (or replaces) the venue's coordinate and circular boundary from `{ "latitude", "longitude", "geofenceRadiusMeters", "reportedAccuracyMeters?" }`. Coordinates must be plausible (|lat| ≤ 90, |lng| ≤ 180) and the radius must stay within 5–2000 m. Every registration writes a `venue_location_events` audit row with the actor, timestamp, coordinate, radius and reported accuracy (`registered` for the first registration, `updated` thereafter). Venue coordinates must be measured at the venue with the administering device; the API cannot verify on-site truthfulness, so institutional review of location events remains necessary.

### `POST /api/v1/admin/venues/{venueId}/status`

Accepts `{ "status": "active" | "inactive" }`. Activating a venue without a registered coordinate and geofence returns `409`; a database check constraint independently enforces that invariant. Deactivation is always permitted and is the incident response when a boundary is disputed.

## Attendance sessions and check-ins

These routes require an active server session. Lecturer actions are restricted to the lecturer's active assignment and role scope; student check-in is restricted to an active enrollment in that same institution and offering. Responses use `Cache-Control: no-store`.

### `POST /api/v1/lecturer/attendance-sessions`

Accepts `courseOfferingId`, an optional nullable `venueId` (must be an active venue in the lecturer's institution; `409` otherwise), a session `title`, and `durationMinutes` (5–240). An assigned lecturer opens the session immediately. The server generates a random 12-character code and returns it once; only its SHA-256 hash is stored, alongside a per-session 256-bit QR secret (`qr_secret`) that backs rotating challenges and is never returned by any endpoint. The session expires at the requested duration or semester end, whichever comes first.

### `GET /api/v1/lecturer/attendance-sessions`

Returns recent sessions for offerings assigned to the signed-in lecturer, with state (`open`, `closed` or `expired`) and check-in count. An optional `courseOfferingId` query parameter filters the list.

### `GET /api/v1/lecturer/attendance-sessions/{attendanceSessionId}`

Returns the assigned lecturer's session and the display names/check-in times for students recorded in its roster. It does not return student email addresses or matric numbers.

### `POST /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/code`

Rotates the code for an open session. The prior code immediately stops working; the new plaintext is returned once. Closed or expired sessions cannot be rotated.

### `POST /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/close`

Closes the session. Repeating the request returns `already_closed` and does not modify recorded attendance.

### `GET /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/qr`

Returns `{ status: "ok", challenge, validUntil, sessionEndsAt }` for an open session owned by the signed-in lecturer (`no-store`). The challenge has the form `lasu1.<sessionUuid>.<windowIndex>.<signature>` and rotates every 20 seconds with one grace window; sessions created before QR support get a secret backfilled on first use. The web client renders this as a QR image and polls it, so projected screenshots expire within seconds.

### `GET /api/v1/lecturer/venues`

Returns the active venues in the lecturer's own institution (id, code, name, campus, building, type, configured radius) for the session-setup picklist. Venue coordinates and `locationRequired` are deliberately omitted — the lecturer picks a venue, never a boundary.

### `POST /api/v1/student/attendance/check-in`

Accepts `{ "code": "..." }` or `{ "challenge": "..." }`, plus an optional `location` sample `{ latitude, longitude, accuracyMeters?, capturedAt }`. Code submissions are normalized (case, spaces, hyphens); QR challenges are structurally parsed, the session secret is resolved server-side, and the HMAC signature is verified before any check-in work.

Decision order is fixed: duplicate check-in (idempotent `already_checked_in`) → session closed/expired (`409`) → enrollment (`403`) → venue evaluation → transactional commit. When the session's venue is active with a complete boundary and no location was supplied, the venue's `locationRequired` policy decides whether this is a `400` (venue name included) or an unlocated check-in with `venue_outcome` NULL. A supplied sample is evaluated server-side: clearly outside readings are rejected `422` without writing; `within` becomes `within_boundary`; stale, coarse or boundary-straddling readings are committed honestly as `inconclusive` with an `attendance_check_in_evidence` row. If the boundary changed between evaluation and commit, the transaction returns `venue_changed`, is retried once, then returns `409`.

A database unique constraint makes concurrent submissions idempotent. Records carry `method` (`code`/`qr_code`) and never store the plaintext code or challenge. Location evidence does not prove venue presence and never blocks a record where the outcome honestly lands `inconclusive`.

### `GET /api/v1/student/attendance`

Returns only the requesting student's recorded check-ins. No student identifier is accepted from the client.

### `GET /api/v1/student/attendance/open`

Returns open, unexpired attendance sessions for course offerings in which the signed-in student has an active enrollment (`attendanceSessionId`, course code/title, session title, venue code/name, `locationRequired` and closing time only). Session codes and QR secrets are never returned by any read endpoint. This supports the student "sessions open in your courses" list; it does not replace the code, which students still receive in class.

### `GET /api/v1/student/attendance/summary`

Returns `{ courses[] }` for the signed-in student's active enrollments: `sessionsHeld` (started sessions since enrollment), `attended` (present records, including lecturer-recorded), `revoked`, `rate` (null when none held) and `lastSessionAt`. History records now also include `method` (`code`/`qr_code`/`manual`) and `status` (`present`/`revoked`).

## Attendance reports and corrections

All routes in this section require a lecturer assigned to the offering. Otherwise they return `404`, so a session or offering outside the lecturer's assignment cannot be distinguished from one that does not exist. All responses are `no-store`.

### `GET /api/v1/lecturer/course-offerings/{courseOfferingId}/attendance-report?threshold=75`

`threshold` is optional (integer 1–100, default 75); unknown query keys are `400`. Returns:

- `offering`: id, code, title, department, semester.
- `generatedAt`, `threshold`.
- `totals`: `sessionsHeld`, `activeStudents`, `averageRate`, `studentsBelowThreshold`, `presentRecords`, `inconclusiveRecords`, `manualRecords`, `revokedRecords`, `openDisputes`.
- `sessions[]`, oldest first, for started sessions: expected and present counts, `withinBoundaryCount`, `inconclusiveCount`, `unlocatedCount`, `manualCount`, `revokedCount`, `rate`.
- `students[]`: name, student number with a verified flag, enrollment status, `eligibleSessions`, `attendedSessions`, `rate`, `belowThreshold`, and one `cells[]` entry per session.

Each cell is one of `within_boundary`, `inconclusive`, `unlocated`, `manual`, `revoked`, `absent` or `not_enrolled`. The first four count as attended.

- `not_enrolled` marks sessions that started before the student enrolled. These are excluded from that student's eligible sessions.
- Expected counts and `belowThreshold` consider active enrollments only.
- The threshold is a follow-up aid, not an eligibility rule.

### `GET /api/v1/lecturer/course-offerings/{courseOfferingId}/attendance-report.csv`

The same report as a `text/csv` attachment named `<COURSE-CODE>-attendance-YYYY-MM-DD.csv`. It has a UTF-8 BOM and CRLF line endings, with one row per student (one column per session plus totals). Cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'` to prevent spreadsheet formula injection.

### `POST /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/corrections`

Body: `{ studentId, action: "mark_present" | "revoke", reason }`. The reason must be 10–500 characters after trimming. Returns `{ status: "applied" | "unchanged", record }`.

- **When it is allowed:** any lecturer assigned to the offering may correct a session once it has started (`409` before that).
- **`mark_present`:** requires an active enrollment (`409` otherwise). It creates a `manual` record or restores a revoked one.
- **`revoke`:** requires an existing record (`409` otherwise). It sets `status = revoked` and `revoked_at`.
- **Records are never deleted.**
- **Audit trail:** every applied change appends an `attendance_corrections` row (actor, student, action, previous and resulting status, reason, time) in the same transaction. No-op requests return `unchanged` and write no audit row.
- **After a revoke:** a student whose check-in was revoked receives `409` when trying to check in again.

### `GET /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/corrections`

Returns the session's audit trail, newest first: `{ corrections: [{ id, studentId, studentName, actorName, action, previousStatus, resultingStatus, reason, viaDispute, createdAt }] }`. `viaDispute` is `true` when the correction was applied by upholding a student dispute. Lecturer roster attendees now include `studentId`, `status` and `revokedAt`.

The attendance adapter's SQL is covered by an embedded PGlite integration test in `apps/api/src/attendance`; attendance code abuse/rate limiting and tests against a configured PostgreSQL service (including concurrency and real transaction behavior) remain required before any pilot. Location evidence is collected only for venue-linked sessions, at check-in time only, and is stored as evaluation evidence separate from the attendance record.

## Attendance disputes

Students ask the lecturers assigned to a course to review a missing or revoked check-in, and those lecturers decide. All routes are `no-store`, and their bodies and queries are strict (unknown keys return `400`).

- **Student routes:** these never accept a student identifier; the student is the signed-in account. A lecturer or administrator session receives `403`.
- **Lecturer routes:** these reach only disputes in offerings the lecturer is assigned to (assignment type `lecturer`, an active and verified account, an active department, and a matching role scope). Anything else returns `404`.
- **Refusals:** each one returns a server-authored `detail` explaining what the student or lecturer can do next.

### `GET /api/v1/student/attendance/disputes`

Returns `{ disputes[], disputableSessions[], windowDays, openLimit }`:

- **`disputes`:** the student's disputes, newest first. Each has course and session identifiers, `kind`, `status`, `statement`, `resolutionNote`, `resolvedByName`, `resolvedAt` and `createdAt`.
- **`disputableSessions`:** sessions the student could dispute now. Each has course and session details, the derived `kind`, the `revocation` reason and time (for revoked check-ins), and `disputeDeadline`.
- **When the open-dispute limit is reached:** sessions are still listed, but submitting returns `409`.

### `POST /api/v1/student/attendance/disputes`

Body: `{ attendanceSessionId, statement }`, where the statement is 20–1,000 characters after trimming. The server derives `kind`. Returns `201 { dispute }`.

- **`404`:** the session does not exist, or the student has never been enrolled in its offering.
- **`409`:** returned for each eligibility rule, in this order: not actively enrolled, enrolled after the session started, not started, already present, check-in still open (for missing check-ins), more than 14 days after the session ended, a dispute already open, the session already decided, or 10 open disputes.

Concurrent duplicates are settled by the one-open partial unique index.

### `POST /api/v1/student/attendance/disputes/{disputeId}/withdraw`

The body must be empty or `{}`. Returns `{ dispute }` with `status: "withdrawn"`.

- `404` when the dispute is not the caller's.
- `409` when it is no longer open.

A withdrawn dispute can be raised again within the window.

### `GET /api/v1/lecturer/attendance-disputes?status=open|resolved|all&courseOfferingId=…`

`status` defaults to `open`. Open disputes are sorted oldest first, and decided ones by most recent decision. Returns `{ disputes[], openCount }`. Each dispute includes:

- **Student:** name, student number with its verified flag, and current enrollment status.
- **Session and course:** session, course and venue names.
- **The dispute:** `kind`, `status` and `statement`.
- **Current record:** status, method, venue outcome, check-in time and revocation time.
- **`lastCorrection`:** the most recent correction (action, reason, actor and time).
- **Decision:** resolution details.

### `GET /api/v1/lecturer/attendance-disputes/count`

Returns `{ openCount }` for the navigation badge. No query parameters are accepted.

### `POST /api/v1/lecturer/attendance-disputes/{disputeId}/resolve`

Body: `{ decision: "uphold" | "reject", note }`, where the note is 10–500 characters after trimming and is shown to the student. Returns `{ dispute, correction }`.

- **Uphold:** applies a `mark_present` correction in the same transaction, with the note as its reason and the dispute linked. `correction` is `applied`, or `unchanged` if the student was already present.
- **Reject:** leaves the record as it is; `correction` is `null`.
- **`409`:** the dispute is no longer open, or (on uphold) the student is not actively enrolled.

Decisions are final; the database rejects later changes and any deletion.

## Staff provisioning (Phase 11)

Administrator routes resolve the caller's role and area from the session cookie. Faculty and department ids in requests are accepted only when they fall inside that area (`403` otherwise, the same as for unknown ids). Mutations pass the origin guard. See `docs/ADMINISTRATION.md` for the scope rule.

### `GET /api/v1/admin/staff`

Returns `{ members, invitations }`. Members are the active and suspended staff the caller may manage, plus the caller (`isSelf`); `manageable` says whether the caller may suspend or reactivate them. Invitations are pending ones in the caller's area, with `expired` set when past their expiry. Lecturers get `403`, signed-out callers `401`.

### `GET /api/v1/admin/staff/options`

Returns `allowedRoles` and the active faculties and departments the caller may invite into.

### `POST /api/v1/admin/staff/invitations`

Strict body: `email`, `displayName`, `role` (`lecturer`, `department_administrator`, `faculty_administrator`, `institution_administrator`), `facultyId` (faculty administrators), `departmentId` (lecturers and department administrators) and `staffNumber` (lecturers). Returns `201` with `{ invitation, emailSent }`. The token is never returned; it only travels by email. Errors: `400` with a field message, `403` out of scope, `409` for an existing account, a pending invitation or a taken staff number. Rate limit: 30 per hour per session.

### `POST /api/v1/admin/staff/invitations/{invitationId}/resend`

Issues a new token, restarts the 7-day expiry and emails it; the old link stops working. Returns `{ invitation, emailSent }`. `404` for invitations outside the caller's area or no longer pending. Rate limit: 30 per hour per session.

### `POST /api/v1/admin/staff/invitations/{invitationId}/revoke`

Revokes a pending invitation. Returns `204`.

### `POST /api/v1/admin/staff/members/{userId}/suspend` and `/reactivate`

Body `{ reason }` (10–500 characters). Suspension sets the account to suspended and revokes every session in one transaction. Reactivation restores sign-in. Returns `204`; `403` for the caller's own account, `404` outside the caller's area, `409` if already in that state.

### `POST /api/v1/staff-invitations/preview`

Public. Body `{ token }`. Returns the invitee's name and email, role, area label, institution, inviter (or null for the bootstrap command) and expiry. `404` for invalid, expired, revoked or used links. Rate limit: 30 per 15 minutes per address.

### `POST /api/v1/staff-invitations/accept`

Public. Body `{ token, password }` (12–128 characters). In one transaction it creates the active account with a confirmed email, the lecturer profile (lecturers), the scoped role assignment, marks the invitation accepted and writes an audit event. It then sets the session cookie and returns `{ status: 'authenticated', account }`, the same shape as sign-in. `404` for an unusable link; `409` if the email has been registered, the staff number taken, or the faculty or department deactivated since the invitation was sent. Rate limit: 20 per 15 minutes per address.

## Error responses

Fastify's centralized error handler returns `application/problem+json` with a stable RFC 9457 style shape: `type`, `title`, `status`, optional `detail`, route-template `instance` and `requestId`. Unexpected server errors do not expose internal messages. Client errors use safe, generic detail text rather than reflecting untrusted request values. The exception is domain errors that explicitly set `exposeDetail: true` with a status below 500 and a server-authored message of at most 300 characters. Their message is returned as `detail` (for example, "Your lecturer removed your check-in for this session…"). The http-errors `expose` flag is deliberately ignored. Request IDs are generated by the server.

## Browser routing

The browser uses relative `/api/v1/*` paths. Next.js performs a server-side rewrite to the API origin. Do not add a browser-side request to `localhost`, `127.0.0.1` or the API port. CORS is not enabled because this initial arrangement is same-origin.

The course roster preflight is not an API route. Its CSV is parsed in page memory and is not sent to Fastify. There is no academic-data import endpoint.

## Remaining route work

The following remain future work:

- Role or area changes for existing staff (staff invitations are implemented in Phase 11)
- `/institutions/*`, `/faculties/*`, `/departments/*` administration
- Dispute notifications (email) and escalation beyond the course's assigned lecturers
- OpenAPI generation and the remaining administrative data changes

Attendance evidence (code, QR challenge, location) is never proof of identity or presence. Lecturer corrections and dispute decisions are audited, but the in-product review path is not a substitute for an institutional appeals policy. A dispute statement is a request for review, not evidence.
