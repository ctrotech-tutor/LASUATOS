# API

## Versioning

Application routes use `/api/v1`. Request validation belongs at the API boundary, shared data shapes live in `packages/contracts`, and the server owns all future attendance decisions. Client-submitted roles, status values, distances and verification outcomes will never be trusted as authoritative.

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

Course-code redemption is sensitive to brute-force and abuse attempts. Request logs redact the submitted `code` field. The API currently provides no course approval or staff provisioning workflow: lecturer accounts must be provisioned through an authorized database/admin process. Public student registration remains the only self-service registration route.

## Error responses

Fastify's centralized error handler returns `application/problem+json` with a stable RFC 9457 style shape: `type`, `title`, `status`, optional `detail`, route-template `instance` and `requestId`. Unexpected server errors do not expose internal messages. Client errors use safe, generic detail text rather than reflecting untrusted request values. Request IDs are generated by the server.

## Browser routing

The browser uses relative `/api/v1/*` paths. Next.js performs a server-side rewrite to the API origin. Do not add a browser-side request to `localhost`, `127.0.0.1` or the API port. CORS is not enabled because this initial arrangement is same-origin.

The course roster preflight is not an API route. Its CSV is parsed in page memory and is not sent to Fastify. There is no academic-data import endpoint.

## Remaining route work

The following remain future work:

- Authorized lecturer/admin provisioning, role management and academic-data import
- `/institutions/*`, `/campuses/*`, `/faculties/*`, `/departments/*`, `/venues/*` administration
- `/lecture-sessions/*`, `/attendance/*`, `/verification/*`
- `/disputes/*`, `/reports/*`, `/audit-logs/*`

The course enrollment routes are not an attendance system. OpenAPI generation, attendance, venue verification, reports and staff self-service provisioning are not implemented.
