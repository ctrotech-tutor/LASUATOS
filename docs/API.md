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

The cookie is named `lasuatos_session`, is HttpOnly and SameSite=Lax, uses Secure in production, and expires after 30 days. The database stores a hash of the session token. The current account phase has no password-reset or email-change route. Sign-up and sign-in still need trusted-edge rate limiting before public deployment.

## Administrator overview

### `GET /api/v1/admin/overview`

Requires an active session with a server-assigned LASU institution-, faculty- or department-administrator role. Returns counts for active departments, active LASUATOS student and provisioned lecturer accounts, course offerings and active enrollments within the account's current scope. The API resolves that scope from the authenticated server session; no client-supplied role or scope is accepted. A student or lecturer session receives `403`, and the response uses `Cache-Control: no-store`.

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

The attendance adapter's SQL is covered by an embedded PGlite integration test in `apps/api/src/attendance`; attendance code abuse/rate limiting and tests against a configured PostgreSQL service (including concurrency and real transaction behavior) remain required before any pilot. Location evidence is collected only for venue-linked sessions, at check-in time only, and is stored as evaluation evidence separate from the attendance record.

## Error responses

Fastify's centralized error handler returns `application/problem+json` with a stable RFC 9457 style shape: `type`, `title`, `status`, optional `detail`, route-template `instance` and `requestId`. Unexpected server errors do not expose internal messages. Client errors use safe, generic detail text rather than reflecting untrusted request values. Request IDs are generated by the server.

## Browser routing

The browser uses relative `/api/v1/*` paths. Next.js performs a server-side rewrite to the API origin. Do not add a browser-side request to `localhost`, `127.0.0.1` or the API port. CORS is not enabled because this initial arrangement is same-origin.

The course roster preflight is not an API route. Its CSV is parsed in page memory and is not sent to Fastify. There is no academic-data import endpoint.

## Remaining route work

The following remain future work:

- Authorized lecturer/admin provisioning, role management and academic-data import
- `/institutions/*`, `/faculties/*`, `/departments/*` administration
- Venue-aware attendance sessions (assigning an active venue to a session and consuming its geofence at check-in), QR-camera scanning, location evidence, review/disputes and correction/audit workflows
- `/reports/*` and staff self-service provisioning

The code-based attendance workflow is an MVP and is not venue verification; the venue directory and geofences exist but attendance sessions do not yet consume them. OpenAPI generation, remaining administrative data changes, location/QR verification at check-in, attendance corrections and reports are not implemented.
