# API

## Versioning

Application routes use `/api/v1`. Request validation belongs at the API boundary, shared data shapes live in `packages/contracts`, and attendance decisions are made by the server. Client-submitted roles, status values, distances and verification outcomes are never trusted as authoritative.

## Health routes

### `GET /api/v1/health`

Liveness check. Returns a timestamp and service identifier. It does not reveal configuration or database errors and sets `Cache-Control: no-store`.

### `GET /api/v1/ready`

Readiness check. It returns `200` only after the configured database responds to `SELECT 1` and every migration shipped with this build has been applied. It returns `503` with `database` set to `not_configured` or `down` when a database is not usable, or with `schema: "behind"` when the database is reachable but migrations are missing (run `pnpm prod:migrate`). The response body is `{ status, checks: { database, schema } }`. This endpoint intentionally does not include connection details.

## Account routes

These routes require a configured PostgreSQL database. Student sign-up also requires an existing institution row whose slug matches `SELF_REGISTRATION_INSTITUTION_SLUG` and a server-configured email provider. The local setup creates a clearly labelled synthetic academic structure for development; it is not an official LASU record.

### `POST /api/v1/auth/register`

Accepts `displayName`, `email`, `matricNumber`, `password` and an optional `entryLevel` (`100` for UTME, `200` or `300` for Direct Entry; default `100`). The request is strict and rejects additional properties such as `role`. Passwords must be 12 to 128 characters. Email addresses are trimmed and lowercased. Any email domain is accepted.

A successful request returns `202` with the same generic response whether an account was created or the address already exists. It creates a pending student account with status `invited`, hashes the password, stores the matric number as unverified text, and sends a one-time email link. It does not confirm LASU student status. A student role is assigned only after email verification. Public registration cannot assign lecturer, coordinator or administrator roles.

### `POST /api/v1/auth/resend-verification`

Accepts an email address and returns a generic `202` response whether the pending account exists or not. A new link can be sent no more than once per two minutes per pending account. The endpoint does not disclose whether an address is registered.

### `POST /api/v1/auth/verify-email`

Accepts the one-time token from the email link. The web page reads the token from the URL fragment, removes it from the address bar, and waits for the user to press the confirmation button before sending a JSON POST. This keeps the token out of the initial page request and avoids activating accounts just because an email scanner opened the link. A valid token is consumed once, activates the account, assigns the student role, creates a server session and sets the session cookie. The response returns a safe student-account summary, including a boolean indicating whether the matric number has been checked by an authorized source. That boolean is false for public self-registration.

Expired, malformed or reused links are rejected. Verification links expire after 30 minutes.

### `POST /api/v1/auth/login`

Accepts `{ email, password }`, where `email` may also be a student's matric number (spaces ignored); it is looked up to that student's email. An active, email-confirmed student, provisioned lecturer, or server-provisioned LASU administrator with an active role assignment can sign in. Administrator roles are limited to institution, faculty or department scopes; system-wide administration is not exposed by this application. Invalid credentials use a generic `401` response. Successful sign-in creates a server-managed session and sets the same cookie used by email verification. Public registration accepts student fields only and cannot grant lecturer or administrator access.

### `GET /api/v1/auth/session`

Returns the current student's, lecturer's or administrator's safe account summary when the session is active. Administrator responses include the server-assigned role and its institution/faculty/department scope. The response does not return the session token. Missing, expired or revoked sessions receive `401`.

### `GET /api/v1/auth/session/status`

Always `200`: `{ "signedIn": false }`, or `{ "signedIn": true, "session": … }` with the same summary as above. Pages use this to ask "who is signed in?" so a signed-out visit doesn't log a `401` in the browser console; routes that require an account keep answering `401`.

### `POST /api/v1/auth/logout`

Revokes the current session on the server and clears the browser cookie. It is safe to call without an existing cookie.

### Session cookie

The cookie is named `lasuatos_session`, is HttpOnly and SameSite=Lax, uses Secure in production, and expires after 30 days. The database stores a hash of the session token. There is no email-change route.

### `POST /api/v1/auth/password-reset/request`

Body: `{ "email": string }` (strict; trimmed; an address is lower-cased). Students may send their matric number instead of an address: the link goes to the email on that account. Always returns the same `202` with a generic message, whether or not the address belongs to an account, so it cannot be used to discover accounts. Only active, email-verified accounts with a password are emailed a link (`/reset-password#token=…`). The token is 256 random bits, stored as a SHA-256 digest, expires in 30 minutes and is single use; each user has at most one, and re-requests within two minutes send nothing. Email delivery failures are logged and still return `202`. Returns `503` when email delivery or the database is not configured.

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
| `POST /student/attendance/disputes/{id}/appeal` | 10 per session per hour |
| `POST /admin/attendance-appeals/{id}/decide` | 240 per session per hour |
| `POST /students/open/google` · `/students/password/google` | 300 per address and 10 per matric number, per 15 minutes |
| `POST /students/me/email-google` · `/students/me/matric/google` | 15 per session per 15 minutes |
| `POST /students/me/face/replace/google` | 6 per session per hour |

Emails are compared trimmed and lower-cased. The client address comes from `X-Forwarded-For` only when the request arrives from a proxy listed in `TRUST_PROXY`.

### Cross-origin protection

Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api/` is checked before routing:
- `Sec-Fetch-Site: cross-site` is rejected with `403`.
- `same-origin` and `none` are accepted.
- Otherwise the `Origin` header must exactly match `PUBLIC_APP_URL` or a `TRUSTED_ORIGINS` entry. `Origin: null` is rejected.
- Requests that carry neither header (server-side clients) are accepted.

### Response headers

Every API response includes `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Resource-Policy: same-origin` and `Cross-Origin-Opener-Policy: same-origin`. Production adds `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Account responses are `Cache-Control: no-store`.

Every successful JSON answer to a `GET` carries a weak `ETag`. Send it back in `If-None-Match` and an unchanged answer comes back as `304 Not Modified` with no body. Live screens poll this way (ADR 023). Answers are still `no-store`, so browsers and proxies do not keep them; the client keeps its own last copy.

## Opening a student account (class lists)

Students do not sign up with free-form details. Their HOC (or an administrator) uploads the class list; the student types their matric number, receives a code at their LASU student email (`@st.lasu.edu.ng`), and the account opens with the names from the list. See [FACE_VERIFICATION.md](FACE_VERIFICATION.md) for the face check. `STUDENT_SIGN_UP=class_list` (default) makes `POST /api/v1/auth/register` answer `410`; `open` restores the old form.

### `POST /api/v1/students/lookup`

Public. `{ matricNumber }` (a matric number, or a JAMB registration number for a Direct Entry student without one yet) → `{ status: 'found', matricNumber, fullName, departmentName, levelLabel, hasAccount, accountStatus, emailOnList, numberKind: 'matric'|'jamb' }`, `{ status: 'replaced', matricNumber, replacedBy }` (a JAMB number whose student has their matric number now: use `replacedBy`) or `{ status: 'not_found', matricNumber }`. `fullName` is the full class-list name (`ODEJOBI Abraham Oluwaseun`), so the student can recognise themselves; the per-address and per-matric rate limits keep the list from being harvested in bulk. `accountStatus` is `none`, `open` (an account with a confirmed LASU email: sign in or reset the password; `hasAccount` is true) or `unconfirmed` (an older account uses the matric number but never confirmed a LASU email: opening takes it over). Whether an account still uses its starting password is never revealed. Rate-limited per address and per matric number.

### `POST /api/v1/students/open/code`

Public. `{ matricNumber, email? }`. Sends a 6-digit code to the LASU email on the class list, or to `email` when the list has none (it must end in `@st.lasu.edu.ng` and must not belong to another account; a student on a JAMB number may give a personal address instead, and the email copy says so). Returns `{ status: 'sent', email, expiresInSeconds: 900, resendInSeconds: 60 }` (the address in full, so the student knows which mailbox to open). At most 8 codes per matric number per day. `409` when the account is already open.

### `POST /api/v1/students/open`

Public. `{ matricNumber, code }` → `201 { status: 'opened', student, startingPassword }` and sets the session cookie. The account gets the class list's names, department and entry year, the email is marked verified, and the password is the LASU-style starting password `LASU<matric><SURNAME>` (for example `LASU250211184ODEJOBI`), flagged `passwordIsDefault` until the student changes it. Five wrong codes void the code. A matric number whose account has a confirmed LASU email answers `409` (with the address a reset code would go to). An older account with the matric number and no confirmed LASU email is **taken over** instead: same account (attendance kept), the new email, the starting password, every session and reset link revoked, any registered face deleted, and `takenOver: true` in the response; the address it had is sent a notice.

### `POST /api/v1/students/open/setup-code`

Public. `{ matricNumber, setupCode, email? }` → the same `201` as above. For a student who cannot get the emailed code: their HOC gives a one-time **setup code** (8 characters `ABCD-EFGH` from a look-alike-free alphabet; lowercase and a space instead of the hyphen are accepted). `email` is needed only when the list has none. The email is recorded but not confirmed; the account is *vouched* by the HOC, so the student can register their face and check in, and confirms the email later from their account. Until then, whoever confirms that LASU email can still take the account over. Five wrong tries, use, or 30 minutes void the code. A bad or taken email is refused before the code is spent.

### `POST /api/v1/students/password/code` · `POST /api/v1/students/password`

Public. Forgot password for a student whose account has a confirmed LASU email. Step 1 `{ matricNumber }` → `{ status: 'sent', email, expiresInSeconds, resendInSeconds }` (a code to that email; `409` when the account has no confirmed email). Step 2 `{ matricNumber, code, password }` → `{ status: 'password_reset', student, signedOutSessions }`: sets the new password (not the starting one), signs out every device, signs this one in and emails a notice. Reset codes work only for resetting.

### Confirming with Google instead of a code (ADR 027)

Each code step has a Google twin for students who cannot wait for the email. The browser sends the student to Google (OpenID Connect, `response_type=id_token`, scope `openid email`, `hd=st.lasu.edu.ng`, `redirect_uri` = `PUBLIC_APP_URL/auth/google`) with `nonce` = base64url(SHA-256(`<purpose>:<raw nonce>`)), and then posts `google: { credential, nonce }`: the ID token as returned, and the raw 43-character nonce. The token must be signed by Google for `GOOGLE_CLIENT_ID`, at most 15 minutes old, made for that purpose, with a verified email; a LASU address also needs `hd = st.lasu.edu.ng`. A student on a JAMB number may use a Gmail address instead. The address then has to pass the same checks as a code's. Without `GOOGLE_CLIENT_ID` every one of these answers `503`. A bad token answers `400`, the wrong kind of account `422`, and Google's keys being unreachable `503`.

| Route | Purpose |
| --- | --- |
| `GET /api/v1/students/google` | Public, cached 5 minutes: `{ clientId \| null, redirectUri \| null, hostedDomain }`. |
| `POST /api/v1/students/open/google` | Public. `{ matricNumber, google }` (purpose `open`) → the same `201` as `/students/open`, session cookie included. The address Google confirmed must be the class list's (when it has one) and unused. |
| `POST /api/v1/students/password/google` | Public. `{ matricNumber, google, password }` (purpose `reset`) → the same answer as `/students/password`. The address must be the account's. |
| `POST /api/v1/students/me/email-google` | Signed in. `{ google }` (purpose `email`) → `{ status: 'verified', email }`, like `/me/email-verify` (e.g. after a setup code). |
| `POST /api/v1/students/me/matric/google` | Signed in, on a JAMB number. `{ matricNumber, google }` (purpose `matric`, a LASU address only) → the same answer as `/me/matric`. |
| `POST /api/v1/students/me/face/replace/google` | Signed in. `{ password, google }` (purpose `face`) → `{ status: 'confirmed', allowedUntil }`, in place of the code and confirm steps. The address must be the account's. |

### Signed-in student

| Route | Purpose |
| --- | --- |
| `GET /api/v1/students/me/setup` | `{ classList, numberKind, studentNumber, jambNumber, emailKind, emailVerified, lasuEmail, vouched, faceRequired, faceRegistered, faceEnrolledAt, faceReplaceAllowedUntil, defaultPassword, complete }`: what is left before the student can mark attendance. `defaultPassword` only drives a reminder; changing it is never forced. |
| `POST /api/v1/students/me/email-code` · `/email-verify` | For accounts made before class lists: confirm a LASU student email with a code (`{ email? }`, then `{ code }`). A student on a JAMB number may confirm a personal email. |
| `POST /api/v1/students/me/matric/code` | A student on a JAMB number adds their matric number, step 1: `{ matricNumber (9 digits), email (LASU) }` → `{ status: 'sent', email, expiresInSeconds, resendInSeconds }`. `409` when the matric number is another student's (on the list with a different name, or an account), or the email is taken; `422` when the student is not on a JAMB number. 10 per hour. |
| `POST /api/v1/students/me/matric` | Step 2: `{ matricNumber, email, code }` → `{ status: 'switched', matricNumber, previousNumber, email, attendanceMoved }`. The entry and account take the matric number and LASU email; attendance and help requests move; the JAMB number is kept (it still signs in); the personal address gets a notice. Recorded as `student_number_switched`. 15 per 15 minutes. |
| `POST /api/v1/students/me/face` | `{ consent: true, frames: [{ pose: 'front'\|'left'\|'right', image: base64 JPEG }] }` (3–6 frames, body up to 3 MB) → `201 { status: 'registered', enrolledAt }`. `422` with a message the student can act on (no face, too dark, wrong pose, not live); `409` when the face is already registered to another account. Rate-limited. |
| `GET /api/v1/students/me/face/photo` | The student's own registered photo (JPEG, `private, no-store`). |
| `POST /api/v1/students/me/face/replace/code` | Taking new face photos, step 1: `{ password }` → `{ status: 'sent', email, expiresInSeconds, resendInSeconds }` (a code to the LASU email). `400` wrong password. |
| `POST /api/v1/students/me/face/replace/confirm` | Step 2: `{ code }` → `{ status: 'confirmed', allowedUntil }` (20 minutes). |
| `POST /api/v1/students/me/face/replace` | Step 3: `{ consent: true, frames }` → `{ status: 'replaced', enrolledAt }`. `403` the new photos do not match the registered face; `409` not confirmed (or the window has passed), a face of another account, or 2 replacements in 30 days already. Single-use confirmation. |

### Class lists (HOCs, GHOCs and administrators)

A HOC manages their own department and set (entry year); a GHOC their faculty; administrators everything in their scope, on behalf of HOCs.

| Route | Purpose |
| --- | --- |
| `GET /api/v1/class-lists?departmentId&entryYear` | The list with each student's stage (`not_joined`, `joined`, `email_confirmed`, `ready`), counts and recent history. |
| `POST /api/v1/class-lists/import` | `{ departmentId, entryYear, rows (≤1500), apply }`, body up to 1 MB. With `apply: false` it only checks and reports `added`/`updated`/`unchanged`/`switched`/`onJamb`/`problems`; with `apply: true` it saves all rows or none. Existing accounts with the same matric number are linked. A row's `matricNumber` may be a JAMB number (Direct Entry, 200 level by default; its email may be personal), and `jambNumber` next to a matric number switches a student listed by that JAMB number to the matric number (attendance moved). |
| `POST /api/v1/class-lists/entries/{entryId}` | Correct names, matric number, email or entry level. Replacing a JAMB number with the matric number is allowed for HOCs even after the account is open (same switch as the student's own); other matric changes on an account are for administrators. |
| `POST /api/v1/class-lists/entries/{entryId}/move` | `{ departmentId }`: move a student to the right department's list for the same set. Their account, attendance, courses and face stay. A HOC or GHOC can move within the faculties they keep lists in; across faculties takes an institution administrator. `409` when the student holds a rep post (remove them from it first) or the target list already has the matric number. Recorded on both lists' history (`class_list_entry_moved`, `class_list_entry_moved_out`). |
| `POST /api/v1/class-lists/entries/{entryId}/remove` | Remove a student who has not opened an account. |
| `POST /api/v1/class-lists/entries/{entryId}/reset-face` | Administrators: delete a registered face so the student registers again. |
| `POST /api/v1/class-lists/entries/{entryId}/setup-code` | A one-time setup code for a student who has not confirmed a LASU email → `{ status: 'issued', code, expiresAt (30 min), matricNumber, studentName, takesOver }`. Shown once; a new one replaces it. `409` when the account already has a confirmed LASU email. |
| `POST /api/v1/class-lists/entries/{entryId}/release` | Administrators: `{ email, reason }` → `{ status: 'released', matricNumber, studentName, previousEmail, listedEmail, signedOutSessions, faceDeleted }`. For a confirmed account that is not the listed student's (wrong email on the list, wrong person got in): the account loses its email confirmation and password, every session, reset link and pending code is voided, the face is deleted, the corrected LASU email goes on the list and the previous address gets a notice. Attendance stays. `409` when there is nothing to release. |
| `GET /api/v1/class-lists/entries/{entryId}/photo` | The registered face photo, to spot a wrong person. |

Assistants (AHOC, AGHOC) use these routes only with the `class_list` permission (`403` otherwise), and give setup codes only with `setup_codes`; the list's `canGiveSetupCodes` says which.

Every change is recorded in `student_audit_events` (who, what, before and after; never photos).

### Class reps and their assistants

| Route | Purpose |
| --- | --- |
| `GET /api/v1/class-reps` | Every HOC and GHOC post in the caller's area (administrators; a GHOC allowed to manage HOCs), with assistants included: an assistant has `assistantOf: { id, name }` and `permissions[]`. |
| `POST /api/v1/class-reps/lookup` · `POST /api/v1/class-reps` · `POST /api/v1/class-reps/{repId}/revoke` | Find a student, appoint a HOC or GHOC, end an appointment. Ending (or replacing) a HOC's or GHOC's appointment ends their assistants' too. |
| `GET /api/v1/class-reps/assistants?principalId=` | `{ principal, assistants[], available[], canManage }`. Without `principalId`, the caller's own team (a HOC, a GHOC, or their assistant, who gets `canManage: false`). With it: their GHOC (for a HOC of their set, when allowed to manage HOCs) or an administrator over the post. Anyone else gets `404`. |
| `POST /api/v1/class-reps/assistants/lookup` | `{ principalId?, query }`: a classmate who could assist. `422` when they are not on the HOC's department list (or the GHOC's faculty) for the set, or are the HOC themselves; `409` when they already hold a post. |
| `POST /api/v1/class-reps/assistants` | `{ principalId?, studentUserId, permissions[] }` → `201` the assistant. At most 2 per HOC or GHOC (`409` when full). |
| `POST /api/v1/class-reps/assistants/{repId}` | `{ permissions[] }`: change what they may do. |
| `POST /api/v1/class-reps/assistants/{repId}/remove` | End an assistant's appointment; the assistant may call it to step down. |

Permissions: `registers` (see every session of the class, not only their own), `class_list` (keep the class list, including moves), `setup_codes` (give setup codes; dropped without `class_list`) and, for a GHOC's assistant only, `hocs` (appoint and remove the set's HOCs). Every assistant takes attendance. New assistants get `registers` and `class_list`. Assistants never appoint assistants. Sessions they take record `creatorRole: 'ahoc' | 'aghoc'`.

**Data rules** (import, edits and adding a student by hand at a lecture): matric numbers are exactly 9 digits (spaces, dashes, a leading `'` and a trailing `.0` from spreadsheets are tidied away; letters, scientific notation such as `2.5E+08` and any other length are refused with a message, including a hint when O/0 or I/1 look alike). Surname and first name are one word each, letters only (any alphabet, accents allowed); a hyphen or apostrophe may only join letters (`Ade-Bello`, `O’Neil`); initials, digits and other symbols are refused. Middle names may be several such words. Within one upload a repeated matric number or LASU email is an error (row numbers given); a repeated name is only a warning. A matric number already in another class is an error.

### Face at check-in

When `FACE_CHECK=required`, `GET /api/v1/lecture/check-in/resolve` returns `face: { required, turn: 'left'|'right', registered }` and `POST /api/v1/lecture/check-in` needs `face: { frames }` (a straight and a turned photo, body up to 2 MB). Errors: `409` no face registered, `428` photos missing, `403` the face did not match, `429` too many failed tries for this lecture (6 per 30 minutes), `503` the face engine is unavailable. Attendees carry `faceScore`, `faceNeedsReview` and `faceReview` (`approved`/`rejected`/null); for a close match the session taker can open `GET /api/v1/lecture/sessions/{sessionId}/attendees/{attendeeId}/face-photo`.

### Help requests (face check keeps failing)

| Route | Purpose |
| --- | --- |
| `POST /api/v1/lecture/help-requests` | Student, signed in: `{ ticket }` (from resolve) → `201 { status: 'pending', … }`. `409` before two failed face checks for this lecture, when already on the list or removed by the taker; `410` the ticket expired. Repeating returns the same request. |
| `GET /api/v1/lecture/sessions/{sessionId}/help-request` | The student's own request and its status (`pending`/`added`/`declined`, `takerName`, `decidedAt`). `404` none. |
| `POST /api/v1/lecture/sessions/{sessionId}/help-requests/{requestId}` | Session taker: `{ decision: 'add'\|'decline', location? }`. Add follows the hand-add rules (class reps: open session, in the venue, 10 at most). `409` already decided. |
| `GET /api/v1/lecture/sessions/{sessionId}/help-requests/{requestId}/photo` | The student's registered photo, for the taker. |

The session detail carries `helpRequests[]` (`id`, `status`, `fullName`, `matricNumber`, `reasonLabel`, `failures`, `hasPhoto`, `venueOutcome`, `accuracyMeters`, `createdAt`).

### Face reviews (lecturers and administrators)

| Route | Purpose |
| --- | --- |
| `GET /api/v1/lecture/face-reviews?status=pending\|reviewed&cursor=` | `{ items, pendingCount, nextCursor }`, 30 per page: close-match check-ins in the lecturer's own sessions or the administrator's area. Class reps and other students get `403`. |
| `POST /api/v1/lecture/face-reviews/{checkId}` | `{ decision: 'approve'\|'reject', note? }`. Reject needs a note (3+ characters, else `422`) and removes the check-in. `409` already reviewed. |
| `GET /api/v1/lecture/face-reviews/{checkId}/photo/check` · `/photo/registered` | The two photos to compare (`404` once the check-in photo has been deleted by retention). |

## Student academic profile

The profile route requires a signed-in student (other account types get `403`) and are `no-store`. The level is **worked out, not verified**: nothing here checks LASU records.

### `GET /api/v1/student/profile`

Returns the student's matric number (`matricNumberVerified`, `matricRecognized`), chosen department (`departmentId`, `departmentName`, `programmeYears`), `entryYear`, `entryLevel`, the current `sessionLabel`, `yearOfStudy`, `level`, `levelStatus` (`derived`, `extra_year`, `not_started` or `unknown`) and a ready-to-show `levelLabel`.

How the level is derived:

- A LASU matric number is 9 digits: two-digit entry year, four-digit programme code, three-digit serial (for example `240591001` = entered 2024). The first two digits give the entry year; 10-digit numbers are read the same way.
- Year of study = current session start year − entry year + 1.
- Level = `entryLevel` + (year of study − 1) × 100, capped at the department's `programmeYears` × 100. Beyond the cap the label reads "… · extra year".
- An unreadable matric number gives `levelStatus: "unknown"` and the label "Level unknown"; a future entry year gives `not_started`.

Example: `240591001`, UTME entry, 2026/2027 session, 5-year programme → year 3 → **300 Level**.

The profile also returns `onClassList`, `setLabel` and `classReps[]` (`{ name, role: 'hoc'|'ahoc'|'ghoc'|'aghoc' }`, HOCs first): who keeps the student's class list, to ask for corrections.

**Students cannot change their department or entry route.** For a student on a class list both come from the list, which the HOC (or an assistant allowed to keep it), the GHOC or an administrator corrects (`POST /api/v1/class-lists/entries/{entryId}` for the entry route, `…/move` for the department). The former self-service routes `POST /api/v1/student/profile/entry-level`, `GET /api/v1/student/profile/departments` and `POST /api/v1/student/profile/department` were removed and return `404`. A student on no list keeps what they gave when signing up (only possible with `STUDENT_SIGN_UP=open`) until they are added to one.

## Administrator overview

### `GET /api/v1/admin/overview`

Requires an active session with a server-assigned LASU institution-, faculty- or department-administrator role. Returns counts for active departments, active LASUATOS student and provisioned lecturer accounts, course offerings and active enrollments within the account's current scope. It also returns `studentLevels[]` (`{ level, label, count }`), the scope's students grouped by the level derived from their matric numbers, with "Level unknown" for numbers that cannot be read. The API resolves that scope from the authenticated server session; no client-supplied role or scope is accepted. A student or lecturer session receives `403`, and the response uses `Cache-Control: no-store`.

### `GET /api/v1/admin/attendance`

This route uses the same administrator guard and server-resolved scope as the overview (department → that department; faculty → its departments; institution → all), and it is `no-store`. It returns `{ generatedAt, totals, offerings[] }`. Each offering row has course code/title, department, semester, `sessionsHeld`, `activeEnrollments`, `completedEnrollments`, `expectedCheckIns`, `presentCheckIns` (present check-ins of counted students, so `presentCheckIns / expectedCheckIns` is the `rate`), `inconclusiveCheckIns`, `manualCheckIns`, `revokedCheckIns`, `rate`, `lastSessionAt`, `openDisputes` and `oldestOpenDisputeAt` (ISO time or `null`). `totals` carries the same open-dispute sum and the oldest waiting dispute across the scope.

- Only sessions that have started count, and the rule is the lecturer's course report's, so the two always agree.
- Counted students are those still on the course (`active`) or who finished it when its semester ended (`completed`). Students who left (`withdrawn`) never count.
- Expected check-ins are every record (present or removed) of a counted student, plus every class a counted student missed: on the course when it started, no record, and over. A class still taking attendance is not a miss until it ends.
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

The list returns `{ "venues": […], "usage": […] }`. Each venue has campus/building names, venue type, capacity, status (`pending_review`, `active`, `inactive`), `notes`, and the registered geofence (`geofenceKind` `circle` or `outline`, `geofenceRadiusMeters`, `geofenceOutline`, `geofenceAllowanceMeters`, coordinate, `locationAccuracyMeters`, `locationSampleCount`, `locationRegisteredAt`, `locationRegisteredByName`). `usage` has one entry per venue with sessions in the last `VENUE_USAGE_DAYS` (30): `sessions`, `openSessions`, `lastSessionAt`, `checkIns`, and how the recorded check-ins' locations came out (`inside`, `outside`, `unclear`, `noReading`) plus `handAdded`. The detail route returns a single venue from the same tenant-scoped read.

### `GET /api/v1/admin/venues/{venueId}/evidence`

What the last 30 days say about a venue's boundary: `{ days, pointsShown, points, courses, history }`. `points` (at most 600, newest first) are where phones were at check-in, rounded to about a metre (5 decimal places), with whole-metre accuracy and the outcome (`within`, `outside`, `inconclusive`). Only institution administrators get them; other roles receive `pointsShown: false` and an empty list. `courses` (at most 12) are the courses taught there with session counts and the last session; `history` (at most 20) are the location changes from `venue_location_events` with the actor's name, shape, radius, corner count, allowance and measured accuracy. Responses are `Cache-Control: no-store`.

### `GET /api/v1/admin/venues/building-outlines?latitude=…&longitude=…`

Administrators only. Looks up OpenStreetMap building footprints within about 60 m of a map point, server-side so the browser's `connect-src 'self'` policy is unchanged. Sources are tried in order: the main Overpass instance (6 s), then the OpenStreetMap API `map` call for a ~120 m box (10 s; used whenever Overpass is at capacity, which is common), then an Overpass mirror (6 s). It returns `{ "status": "ok" | "unavailable", "buildings": [{ "name", "osmUrl", "outline", "containsPoint", "distanceMeters", "areaSquareMeters" }] }`. At most 5 buildings come back: buildings that contain the point first (smallest first), then the rest by distance. Each `outline` is ready for the location endpoint: the closing point and corners less than 0.25 m off a straight wall are dropped, and the outline is cut down to 24 corners if needed. Multipolygon buildings use their largest outer ring. Results are cached for 10 minutes per ~1 m spot. Failures are not cached. When every source fails or times out, the route still returns `200` with `status: "unavailable"` and no buildings. A bad or extra query parameter returns `400`; if no lookup is configured the route returns `503`. Responses are `Cache-Control: no-store`. Map data © OpenStreetMap contributors (ODbL).

### `POST /api/v1/admin/venues`

Creates a venue in `pending_review` status. Accepts `campusId`, optional `buildingId`, `code` (normalized uppercase, unique per campus), `name`, `venueType`, optional `floorLabel`/`sectionLabel`/`capacity`/`notes`, and `locationRequired` (default `true`). A pending venue never accepts attendance verification.

### `POST /api/v1/admin/venues/{venueId}` · `POST /api/v1/admin/buildings/{buildingId}`

Institution administrators only. Updates a venue's details (`code`, `name`, `venueType`, `buildingId`, `floorLabel`, `sectionLabel`, `capacity`, `notes`; empty optional fields clear) or a building's `code` and `name`. Codes stay unique per campus (`409` otherwise). The boundary and status have their own routes.

### `POST /api/v1/admin/venues/{venueId}/location`

Registers (or replaces) the venue's boundary. The body is either an outline, `{ "outline": [{ "latitude", "longitude" }, …3–24 corners], "allowanceMeters"?, "reportedAccuracyMeters"?, "sampleCount"? }`, or a circle, `{ "latitude", "longitude", "geofenceRadiusMeters", "allowanceMeters"?, "reportedAccuracyMeters"?, "sampleCount"? }`. Mixing the two returns `400`. Outlines must not cross themselves, repeat a corner, or be smaller than about 4 m² (`400` with the reason). The centre is set to the outline's centroid and `geofenceRadiusMeters` to the distance from it to the furthest corner. `allowanceMeters` (0–100, default 0) is how far outside the shape a reading may land and still count. Coordinates must be plausible (|lat| ≤ 90, |lng| ≤ 180), and a circle's radius must be 5–2000 m. Every registration writes a `venue_location_events` audit row with the actor, time, shape, allowance, reported accuracy and sample count (`registered` the first time, `updated` after that). The API cannot verify that a GPS capture was taken on site, so location events still need institutional review.

### `POST /api/v1/admin/venues/{venueId}/status`

Accepts `{ "status": "active" | "inactive" }`. Activating a venue without a registered coordinate and geofence returns `409`; a database check constraint independently enforces that invariant. Deactivation is always permitted and is the incident response when a boundary is disputed. Creating a venue or building, and every status change, writes an audit log entry.

## Attendance sessions and check-ins

These routes require an active server session. Lecturer actions are restricted to the lecturer's active assignment and role scope; student check-in is restricted to an active enrollment in that same institution and offering. Responses use `Cache-Control: no-store`.

### `POST /api/v1/lecturer/attendance-sessions`

Accepts `courseOfferingId`, an optional `qrOnly` flag (default `false`), an optional nullable `venueId` (must be an active venue in the lecturer's institution; `409` otherwise), a session `title`, and `durationMinutes` (5–240). An assigned lecturer opens the session immediately. The server generates a random 12-character code and returns it once; only its SHA-256 hash is stored, alongside a per-session 256-bit QR secret (`qr_secret`) that backs rotating challenges and is never returned by any endpoint. The session expires at the requested duration or semester end, whichever comes first.

### `GET /api/v1/lecturer/attendance-sessions`

Returns recent sessions for offerings assigned to the signed-in lecturer, with state (`open`, `closed` or `expired`) and check-in count. An optional `courseOfferingId` query parameter filters the list.

### `GET /api/v1/lecturer/attendance-sessions/{attendanceSessionId}`

Returns the assigned lecturer's session (including `qrOnly` and `sharedDeviceCount`) and its roster. Each attendee has display name, matric number, derived `levelLabel`, check-in time, `method`, venue outcome, status and `sharedDevice`. Student email addresses are never returned.

`sharedDevice` is `true` when another student in the same session checked in from the same browser (see the device signal under check-in). It is a prompt to look, never proof: a borrowed phone when a battery died looks the same.

### `POST /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/settings`

Body `{ qrOnly: boolean }` (strict). Switches an open session between "QR or typed code" and "QR only". Returns `{ status: "updated", session }`. Closed or expired sessions return `409`.

### `POST /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/code`

Rotates the code for an open session. The prior code immediately stops working; the new plaintext is returned once. Closed or expired sessions cannot be rotated.

### `POST /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/close`

Closes the session. Repeating the request returns `already_closed` and does not modify recorded attendance.

### `GET /api/v1/lecturer/attendance-sessions/{attendanceSessionId}/qr`

Returns `{ status: "ok", challenge, validUntil, sessionEndsAt }` for an open session owned by the signed-in lecturer (`no-store`). The challenge has the form `lasu1.<sessionUuid>.<windowIndex>.<signature>` and rotates every 20 seconds with one grace window; sessions created before QR support get a secret backfilled on first use. The web client renders this as a QR image and polls it, so projected screenshots expire within seconds. The image encodes a link, `https://<site>/check-in#<challenge>`: a phone's own camera app opens the check-in page directly, and the challenge stays in the URL fragment, which browsers never send to the server or put in logs. The in-app scanner (**Scan QR code**) reads the same link or a bare challenge.

### `GET /api/v1/lecturer/venues`

Returns the active venues in the lecturer's own institution (id, code, name, campus, building, type, configured radius) for the session-setup picklist. Venue coordinates and `locationRequired` are deliberately omitted — the lecturer picks a venue, never a boundary.

### `POST /api/v1/student/attendance/check-in`

Accepts `{ "code": "..." }` or `{ "challenge": "..." }`, plus an optional `location` sample `{ latitude, longitude, accuracyMeters?, capturedAt }` and an optional `deviceToken` (16–64 characters of `A–Z a–z 0–9 _ -`).

- **QR-only sessions** refuse a typed `code` with `409` and a message telling the student to scan the QR in the room. Challenges are always accepted while valid.
- **Device signal:** the browser keeps a random token in local storage and sends it. The server stores only `device_hash` = SHA-256 of `<sessionId>:<deviceToken>`, so hashes cannot be linked across sessions. When two students in one session share a hash, both roster rows show **Shared device**. Nothing is refused because of it. Code submissions are normalized (case, spaces, hyphens); QR challenges are structurally parsed, the session secret is resolved server-side, and the HMAC signature is verified before any check-in work.

Decision order is fixed: duplicate check-in (idempotent `already_checked_in`) → session closed/expired (`409`) → enrollment (`403`) → venue evaluation → transactional commit. When the session's venue is active with a complete boundary and no location was supplied, the venue's `locationRequired` policy decides whether this is a `400` (venue name included) or an unlocated check-in with `venue_outcome` NULL. A supplied sample is evaluated server-side: clearly outside readings are rejected `422` without writing; `within` becomes `within_boundary`; stale, coarse or boundary-straddling readings are committed honestly as `inconclusive` with an `attendance_check_in_evidence` row. If the boundary changed between evaluation and commit, the transaction returns `venue_changed`, is retried once, then returns `409`.

A database unique constraint makes concurrent submissions idempotent. Records carry `method` (`code`/`qr_code`) and never store the plaintext code or challenge. Location evidence does not prove venue presence and never blocks a record where the outcome honestly lands `inconclusive`.

### `GET /api/v1/student/attendance`

Returns `{ records, missed }` for the requesting student only. No student identifier is accepted from the client.

- `records`: their check-ins, newest class first. A removed check-in (`status: revoked`) carries `removedReason`, the reason given for the latest removal; otherwise it is `null`.
- `missed`: classes of their active courses held while they were on the course, now over, with no check-in (newest first, at most 500). It is built from the same source and rule as the summary, so `missed` always matches the summary's `sessionsHeld - attended - revoked`. A class still taking attendance is not missed yet.

### `GET /api/v1/student/attendance/open`

Returns open, unexpired attendance sessions for course offerings in which the signed-in student has an active enrollment (`attendanceSessionId`, course code/title, session title, venue code/name, `locationRequired`, `qrOnly`, closing time and `venueGuide`).

`venueGuide` is `{ campusName, buildingName, floorLabel, sectionLabel, latitude, longitude, radiusMeters }` or `null`. Coordinates are included only for active venues with a registered location. The page uses them for a Google Maps walking link and a "How far am I?" estimate worked out **on the phone**: the student's location is never sent for this. Session codes and QR secrets are never returned by any read endpoint. This supports the student "sessions open in your courses" list; it does not replace the code, which students still receive in class.

### `GET /api/v1/student/attendance/summary`

Returns `{ courses[] }` for the signed-in student's active enrollments: `sessionsHeld` (started sessions since enrollment), `attended` (present records, including lecturer-recorded), `revoked`, `rate` (null when none held) and `lastSessionAt`. History records now also include `method` (`code`/`qr_code`/`manual`) and `status` (`present`/`revoked`).

## Attendance reports and corrections

All routes in this section require a lecturer assigned to the offering. Otherwise they return `404`, so a session or offering outside the lecturer's assignment cannot be distinguished from one that does not exist. All responses are `no-store`.

### `GET /api/v1/lecturer/attendance-report-overview?threshold=75`

Where each of the lecturer's courses stands, for the reports list. `threshold` works as below. Returns `{ threshold, courses[] }`, newest class first, one entry per assigned offering with at least one started session (at most 60): `courseOfferingId`, `sessionsHeld`, `activeStudents`, `averageRate`, `studentsBelowThreshold` and `lastSessionAt`. The figures come from the same code as the full report, so they always agree with it.

### `GET /api/v1/lecturer/course-offerings/{courseOfferingId}/attendance-report?threshold=75`

`threshold` is optional (integer 1–100, default 75); unknown query keys are `400`. Returns:

- `offering`: id, code, title, department, semester.
- `generatedAt`, `threshold`.
- `totals`: `sessionsHeld`, `activeStudents`, `averageRate`, `studentsBelowThreshold`, `presentRecords`, `inconclusiveRecords`, `manualRecords`, `revokedRecords`, `openDisputes`.
- `sessions[]`, oldest first, for started sessions: expected and present counts, `withinBoundaryCount`, `inconclusiveCount`, `unlocatedCount`, `manualCount`, `revokedCount`, `rate`.
- `students[]`: name, student number with a verified flag, enrollment status, `eligibleSessions`, `attendedSessions`, `rate`, `belowThreshold`, and one `cells[]` entry per session.

Each cell is one of `within_boundary`, `inconclusive`, `unlocated`, `manual`, `revoked`, `absent` or `not_enrolled`. The first four count as attended.

- `activeStudents`, the averages, `belowThreshold` and each session's `expectedCount` cover students whose enrollment is `active` or `completed` (the semester ended). Students who withdrew are listed with their marks but not counted.
- `not_enrolled` marks sessions that started before the student enrolled. These are excluded from that student's eligible sessions.
- An `absent` cell in a session that is still open (`status: open`) is not counted yet: a check-in can still arrive. It counts once the session ends. The student summary (`GET /api/v1/student/attendance/summary`) applies the same rule.
- Expected counts and `belowThreshold` consider active enrollments only.
- The threshold is a follow-up aid, not an eligibility rule.

### `GET /api/v1/lecturer/course-offerings/{courseOfferingId}/attendance-report.csv`

The same report as a `text/csv` attachment named `<COURSE-CODE>-attendance-YYYY-MM-DD.csv`. It has a UTF-8 BOM and CRLF line endings, with one row per student (one column per session plus totals). Times are Lagos time (WAT). Each session cell starts with `P` (present) or `A` (absent), with a note where it matters: `P (location unsure)`, `P (marked by lecturer)`, `A (check-in removed)`; sessions before the student joined read `n/a (not on the course yet)`. Cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'` to prevent spreadsheet formula injection.

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

- **`disputes`:** the student's disputes, newest first. Each has course and session identifiers, `kind`, `status`, `statement`, `resolutionNote`, `resolvedByName`, `resolvedAt` and `createdAt`, plus `appeal` (the appeal summary below, or `null`) and `appealDeadline` (set only while the dispute can be appealed now).
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
- **`standing`:** `{ attended, eligible, countsThisClass }`, the student's attendance in the course so far, counted as the course report counts it, and whether the disputed class is among the classes counted; `null` without an enrollment.
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

### Dispute emails

Sending is best-effort: a failed email never blocks or undoes the dispute action, and nothing is sent when `EMAIL_PROVIDER=none`.

- **New dispute:** the course's assigned lecturers are emailed when a student raises the *first* open dispute for a session. Later disputes on the same session wait in the queue without more email, so one busy lecture does not flood an inbox.
- **Decision:** the student is emailed when a lecturer upholds or rejects the dispute, with the lecturer's note. A rejection tells them they can take it to their department.

## Attendance appeals (ADR 026)

After a lecturer rejects a dispute, the student can ask the department that runs the course to look again: once per dispute, within 7 days of the decision. The dispute stays `rejected`; the appeal carries the second decision. An appeal summary is `{ id, status: open|upheld|rejected|withdrawn, statement, departmentName, decisionNote, decidedByName, decidedAt, createdAt }`, and lecturer disputes include it as `appeal`.

### `POST /api/v1/student/attendance/disputes/{disputeId}/appeal`

Body: `{ statement }`, 20–1,000 characters after trimming. Returns `201 { dispute }` with the appeal attached. `404` when the dispute is not the caller's; `409`, in this order, when the dispute was not rejected, already has an appeal (a withdrawn one counts), the student is already present, is no longer actively enrolled, or the 7 days have passed.

### `POST /api/v1/student/attendance/disputes/{disputeId}/appeal/withdraw`

Empty body or `{}`. Returns `{ dispute }` with the appeal `withdrawn`. `409` when it is no longer open. A withdrawn appeal cannot be sent again.

### `GET /api/v1/admin/attendance-appeals?status=open|decided|all`

Administrators only, scoped like the overview (department, faculty or institution, by the course's department); `status` defaults to `open`. Open appeals come oldest first, decided ones by most recent decision. Returns `{ appeals[], openCount }`; each appeal is the summary plus `conflict` (true when this administrator rejected the dispute themselves) and `dispute`, the whole dispute as lecturers see it (student, standing, record, last correction, the lecturer's note).

### `GET /api/v1/admin/attendance-appeals/count`

Returns `{ openCount }` for the menu badge.

### `POST /api/v1/admin/attendance-appeals/{appealId}/decide`

Body: `{ decision: "uphold" | "reject", note }`, 10–500 characters; the student and the lecturer read the note. Returns `{ appeal, correction }`. Upholding applies a `mark_present` correction linked to the dispute and the appeal (`applied`, or `unchanged` when already present). `404` outside the caller's scope; `409` when the appeal is no longer open, the caller decided the original dispute, or (on uphold) the student is not actively enrolled. The decision is final; the database rejects changes and deletion.

Emails: the first open appeal in a department emails its administrators (else the faculty's, else the institution's; at most 20); the decision emails the student and the lecturer who turned the dispute down. Sent, upheld and rejected appeals appear in the audit log as `attendance_appeal_sent`, `attendance_appeal_upheld` (notable) and `attendance_appeal_rejected`.

## Staff provisioning (Phase 11)

Administrator routes resolve the caller's role and area from the session cookie. Faculty and department ids in requests are accepted only when they fall inside that area (`403` otherwise, the same as for unknown ids). Mutations pass the origin guard. See `docs/ADMINISTRATION.md` for the scope rule.

### `GET /api/v1/admin/staff`

Returns `{ members, invitations }`. Members are the active and suspended staff the caller may manage, plus the caller (`isSelf`); `manageable` says whether the caller may suspend or reactivate them. Invitations are pending ones in the caller's area, with `expired` set when past their expiry. Lecturers get `403`, signed-out callers `401`.

### `GET /api/v1/admin/staff/options`

Returns `allowedRoles` and the active faculties and departments the caller may invite into.

### `POST /api/v1/admin/staff/invitations`

Strict body: `email`, `displayName`, `role` (`lecturer`, `department_administrator`, `faculty_administrator`, `institution_administrator`), `facultyId` (faculty administrators), `departmentId` (lecturers and department administrators) and optional `staffNumber` (lecturers only: the number LASU issued, normalised to upper case; omit or `null` when not known). Returns `201` with `{ invitation, emailSent }`. The token is never returned; it only travels by email. Errors: `400` with a field message, `403` out of scope, `409` for an existing account, a pending invitation or a taken staff number. Rate limit: 30 per hour per session.

### `POST /api/v1/admin/staff/invitations/{invitationId}/resend`

Issues a new token, restarts the 7-day expiry and emails it; the old link stops working. Returns `{ invitation, emailSent }`. `404` for invitations outside the caller's area or no longer pending. Rate limit: 30 per hour per session.

### `POST /api/v1/admin/staff/invitations/{invitationId}/revoke`

Revokes a pending invitation. Returns `204`.

### `POST /api/v1/admin/staff/members/{userId}/suspend` and `/reactivate`

Body `{ reason }` (10–500 characters). Suspension sets the account to suspended and revokes every session in one transaction. Reactivation restores sign-in. Returns `204`; `403` for the caller's own account, `404` outside the caller's area, `409` if already in that state.

### `POST /api/v1/admin/staff/members/{userId}/position`

Body `{ role, facultyId?, departmentId?, reason, apply }` (`departmentId` for lecturers and department administrators, `facultyId` for faculty administrators; reason 10–500 characters). With `apply: false` nothing changes; with `apply: true` the change is made in one transaction. Returns `{ applied, from: { role, scopeLabel }, to: { role, scopeLabel }, workspaceChanges, coursesLeaving: [{ courseCode, courseTitle, departmentName, semesterName, otherLecturers }], openDisputes, teachingNow, emailSent }`. Applying deletes the person's course assignments for semesters that have not ended in departments the new place does not cover (past semesters are kept), reuses or creates the lecturer profile when moving to lecturer, writes a `staff_role_changed` audit event and emails the person. `400` for an invalid body; `403` for the caller's own account or a role or area the caller cannot grant (unknown ids look the same); `404` when the person is outside the caller's area; `409` when nothing would change, while they have a lecture or attendance session open, or when their role changed since it was read.

### `POST /api/v1/staff-invitations/preview`

Public. Body `{ token }`. Returns the invitee's name and email, role, area label, institution, inviter (or null for the bootstrap command) and expiry. `404` for invalid, expired, revoked or used links. Rate limit: 30 per 15 minutes per address.

### `POST /api/v1/staff-invitations/accept`

Public. Body `{ token, password, staffNumber? }` (password 12–128 characters). For lecturers, `staffNumber` replaces the one the administrator entered; `null` leaves it empty; omitted keeps the invitation's. The preview (`POST /api/v1/staff-invitations/preview`) returns the invitation's `staffNumber` so it can be shown for confirmation. In one transaction it creates the active account with a confirmed email, the lecturer profile (lecturers), the scoped role assignment, marks the invitation accepted and writes an audit event. It then sets the session cookie and returns `{ status: 'authenticated', account }`, the same shape as sign-in. `404` for an unusable link; `409` if the email has been registered, the staff number taken, or the faculty or department deactivated since the invitation was sent. Rate limit: 20 per 15 minutes per address.

## Academic structure (administrators)

Administrators maintain faculties, departments and academic sessions in the app. Every route resolves the caller's role and area from the session, mutations pass the origin guard, bodies are strict, and every change writes an append-only `structure_audit_events` row with a before/after diff. Nothing here deletes courses, students or attendance: departments and faculties are deactivated, never removed.

Who can do what:

| Action | Institution admin | Faculty admin | Department admin |
| --- | --- | --- | --- |
| Add, rename or deactivate faculties | Yes | No | No |
| Add departments | Any faculty | Own faculty | No |
| Rename a department, set `programmeYears` | Yes | Own faculty | Own department |
| Deactivate a department | Yes | Own faculty | No |
| Add academic sessions, set the current one | Yes | No | No |

### `GET /api/v1/admin/structure`

Returns `{ permissions, faculties[], academicSessions[], recentChanges[] }`, limited to what the caller administers.

- Each department carries `programmeYears`, `studentCount` (signed-up students), `courseOfferingCount`, `lecturerCount` (active lecturer accounts), `classListCount` (class-list entries), `recentSessions` (lecture sessions in the last `STRUCTURE_ACTIVITY_DAYS`, 30), `lastSessionAt` (ISO or `null`), and `editable` / `canDeactivate` for the caller.
- `recentChanges` is the 40 newest structure changes, newest first, for faculties and departments the caller can see and for any session: `{ id, targetType: "faculty" | "department" | "academic_session", targetId, action, actorName, at, summary }`. `summary` is plain words built from the audit diff, e.g. *Renamed from Electrical Engineering; Programme length 4 → 5 years*, *Created with 2 semesters, made current*.

### `POST /api/v1/admin/structure/faculties` and `/faculties/{facultyId}`

Create: `{ code, name }` → `201 { status: "saved", id }`. Update: `{ name?, isActive? }`. Codes are upper-cased; a duplicate code returns `409`.

### `POST /api/v1/admin/structure/departments` and `/departments/{departmentId}`

Create: `{ facultyId, code, name, programmeYears? }` (default 4, range 1–8) → `201`. Update: `{ name?, programmeYears?, isActive? }`. Department codes are unique across the institution, ignoring case. `programmeYears` caps the level shown to students of that department.

### `POST /api/v1/admin/structure/academic-sessions`

Body `{ code: "2027/2028", startsAt, endsAt, makeCurrent?, semesters: [{ name, startsAt, endsAt }] }` with 1–3 semesters that sit inside the session, do not overlap and have different names. Returns `201`.

### `POST /api/v1/admin/structure/academic-sessions/{sessionId}`

Corrects a session: `{ code, startsAt, endsAt, semesters: [{ id?, name, startsAt, endsAt }] }` under the same rules. Existing semesters are sent back with their `id`, since they can be renamed and moved but not removed (classes and offerings point at them); a semester without an `id` is added.

### `POST /api/v1/admin/structure/academic-sessions/{sessionId}/current`

Makes that session current and unsets the previous one in the same transaction. The current session drives every student's derived level.

## Contact messages

Messages to the LASUATOS team from the public contact page, and the institution administrators' inbox (Administration → Messages).

### `POST /api/v1/contact`

Public; signed in or not. Body `{ topic, name, email, role?, department?, matricNumber?, privacyRequest?, page?, device?, students?, message, website?, elapsedMs? }` (`message` 20–3000 characters). Only the fields that belong to the topic are kept. Saves the message, emails every active institution administrator (Reply-To: the sender, with a button to `/admin/messages?message=<reference>`) and sends the sender a receipt that never repeats the message. Returns `201 { reference }`, e.g. `LA-7K3P9Q`. Spam (the hidden `website` field filled in, or `elapsedMs` under 3 seconds) gets a convincing reference but is neither saved nor emailed; more than three links returns `400`.

### `GET /api/v1/admin/messages?status=&topic=&q=&cursor=`

Institution administrators only (`403` for anyone else). `status` is `new` (default), `handled` or `all`; `topic` one of `adoption`, `problem`, `account`, `privacy`, `other`; `q` (up to 100 characters) matches a reference exactly, or words in the name, email or message (`%` and `_` are taken literally). Returns 30 messages at a time, newest first:

- `messages[]`: `{ id, reference, topic, status, name, email, role, department, matricNumber, privacyRequest, page, device, students, message, signedIn, createdAt, handledAt, handledByName, note }`. `signedIn` means the sender was signed in to the account that uses that email address.
- `nextCursor` for the next page, `counts { new, handled }`.
- `summary`, for the whole inbox whatever the filters: `newByTopic`, `overdue` (new messages past their reply date), `oldestNewAt`, `privacyOpen[]` (new privacy requests, oldest first, up to 20), `overdueOldest[]` (other overdue messages, oldest first, up to 5), `handledLast30Days` and `medianHandleHours` (over messages handled in the last 90 days, or `null`). The brief items are `{ id, reference, name, topic, privacyRequest, createdAt }`.

The reply date (`contactReplyDue` in the contracts) is two working days, Monday to Friday in Lagos, as the contact page promises; for privacy requests it is 30 days (NDPA 2023, NDPC GAID 2025).

### `GET /api/v1/admin/messages/count`

`{ new }`, for the menu badge and the overview.

### `GET /api/v1/admin/messages/{reference}`

One message by its reference (any case), with `others[]`: up to 10 other messages from the same email address, newest first. `400` for something that is not a reference, `404` when it no longer exists.

### `POST /api/v1/admin/messages/{messageId}`

Body `{ status: "new" | "handled", note? }` (note up to 1000 characters, trimmed; empty clears it). Marking a new message handled records who and when. Marking an already handled message handled only changes the note: who handled it, and when, stay. Moving it back to new clears the handler and the note. Returns the message; `404` if it no longer exists.

### Retention

The daily retention run deletes handled messages a year after they were handled, and any message two years after it arrived.

## Audit log and data retention (administrators)

### `GET /api/v1/admin/audit?category=&q=&from=&to=&actor=&notable=&cursor=`

Every audit trail (student, manual attendance, removals, staff, structure, venue locations, retention runs) in one list, newest first, 50 at a time. The query is strict (unknown parameters return `400`):

- `category`: one of `students`, `faces`, `attendance`, `staff`, `structure`, `venues`, `retention`.
- `q` (up to 120 characters): the matric number, name or email of the person acting or acted on, or a venue, department or course.
- `from`, `to`: ISO dates, Lagos days, both inclusive (`400` when `from` is after `to`).
- `actor`: a user id; only what that person did.
- `notable=true`: only entries worth a second look (`AUDIT_NOTABLE_ACTIONS`: accounts released or taken over, faces reset or refused, check-in photos rejected, students removed from a lecture or a class list, staff suspended), plus faculties and departments deactivated. Any other value is `400`.
- `cursor`: the `nextCursor` from the previous page.

Returns `{ entries, nextCursor, scopeLabel, limitedToScope, counts, actor }`:

- Each entry is `{ id, category, action, summary, actorName, actorId, subject, subjectSearch, facts, note, links, notable, details, at }`.
  - `id` is `<source>:<uuid>` (`student`, `manual`, `removal`, `staff`, `structure`, `venue`).
  - `facts` (up to 12) are `{ label, value, previous }` read from the stored record, with internal ids replaced by names. `previous` is set when the fact is a change (*Programme length: 4 years → 5 years*).
  - `note` is a reason someone typed. `links` (up to 4) are `{ label, href }` relative paths to the register, class list, structure, venue, staff or retention page the entry touched.
  - `subjectSearch` is what to search for to see everything about the subject. `details` is the stored record as text (up to 2000 characters).
- `counts` is set on the first page only: entries per category under the other filters (the category itself ignored), for the filter chips. It is `null` on later pages.
- `actor` is `{ id, name }` when `actor` was given and found.

Faculty and department administrators see student, face and attendance events in their area, changes to their own faculty or department, and the staff, structure and venue changes they made. They never see retention runs. Lecturers and students get `403`.

### `GET /api/v1/admin/audit/summary`

The last `AUDIT_SUMMARY_DAYS` (7) days, whatever the filters: `{ since, total, previousTotal, byCategory, people, notableCount, notable, scopeLabel, limitedToScope }`. `previousTotal` covers the 7 days before, to compare against. `people` counts distinct people who made changes. `notableCount` is an exact count, and `notable` holds the newest 5 notable entries (same shape as above). Same scope rules as the list.

### `GET /api/v1/admin/audit/entries/{entryId}`

One entry, for a link to it: `{ entry }`. `400` when the id is not `<source>:<uuid>`; `404` when it does not exist or is outside the caller's scope.

### `GET /api/v1/admin/audit/export?category=&q=&from=&to=&actor=&notable=`

The same filters as the list, as a CSV download: `text/csv; charset=utf-8` with a BOM (for Excel), CRLF line endings, `Content-Disposition: attachment; filename="lasuatos-audit-log-YYYY-MM-DD.csv"`.

- **Columns:** *When (Lagos)*, *What*, *Category*, *By*, *About*, *Facts*, *Note*, *Worth a look*, *Entry*.
- **Safety:** cells that start with `=`, `+`, `-` or `@` are prefixed with `'`, so a spreadsheet does not run them as formulas.
- **Size:** at most `AUDIT_EXPORT_MAX` (5000) rows. `x-audit-rows` gives the count, and `x-audit-truncated: true` means there were more (narrow the dates).

### `GET /api/v1/admin/retention`

Administrators only (lecturers and students get `403`). Faculty and department administrators get their own area.

- `policy { graceMonths, activeWithinDays, checkPhotoDays }`, `generatedAt`.
- `sets[]`: `{ departmentId, departmentCode, departmentName, entryYear, setLabel, programmeYears, finishedOn, dueOn, students, faces, dueFaces, keptActive }`. Every set whose faces are due by now or within `RETENTION_LOOKAHEAD_MONTHS` (24), cleared or not, oldest first. `dueFaces` go at the next run; `keptActive` are due by date but the student checked in within `activeWithinDays`.
- `due { faces, checkPhotos }`: what the next run deletes in the caller's area.
- `holding { faces, facesUnlisted, checkPhotos, oldestCheckPhotoAt }`: what is stored now. `facesUnlisted` counts faces of students on no class list, which retention never reaches (institution administrators only, else `0`).
- `lastRun` and `runs[]`: the newest runs for the whole institution (up to `RETENTION_RUNS_SHOWN`, 10), each `{ at, actorName, scheduled, facesDeleted, checkPhotosDeleted }`.
- `scopeLabel`, `limitedToScope`, `scheduled` (`CRON_SECRET` is set) and `canRun` (institution administrators only).

### `GET /api/v1/admin/retention/sets/{departmentId}/{entryYear}`

One set, student by student: `{ set, students: [{ matricNumber, name, hasAccount, state, faceRegisteredAt, lastCheckInAt, checkPhotos }], truncated }`, up to 3000 students. `state` is `due` (goes at the next run), `keeping` (due by date, checked in recently), `waiting` (the set is not due yet) or `no_face`. `400` for a malformed department id or year, `404` when the set is outside the caller's area or its class list is empty.

### `POST /api/v1/admin/retention/run`

Institution administrators only: `{ confirm: true }` → `{ facesDeleted, checkPhotosDeleted, ranAt }`. Holds an advisory lock so two runs cannot overlap; every deletion is audited.

### `GET /api/v1/cron/retention`

Called by Vercel Cron (02:30 UTC daily) with `Authorization: Bearer <CRON_SECRET>`; `401` without the right secret or when `CRON_SECRET` is unset.

## Error responses

Fastify's centralized error handler returns `application/problem+json` with a stable RFC 9457 style shape: `type`, `title`, `status`, optional `detail`, route-template `instance` and `requestId`. Unexpected server errors do not expose internal messages. Client errors use safe, generic detail text rather than reflecting untrusted request values. The exception is domain errors that explicitly set `exposeDetail: true` with a status below 500 and a server-authored message of at most 300 characters. Their message is returned as `detail` (for example, "Your lecturer removed your check-in for this session…"). The http-errors `expose` flag is deliberately ignored. Request IDs are generated by the server.

## Browser routing

The browser uses relative `/api/v1/*` paths. Next.js performs a server-side rewrite to the API origin. Do not add a browser-side request to `localhost`, `127.0.0.1` or the API port. CORS is not enabled because this initial arrangement is same-origin.

Student records enter only through class lists (`/api/v1/class-lists/*`, above): the browser reads the Excel, CSV or pasted list and sends the parsed rows. There is no other academic-data import endpoint.

## Remaining route work

The following remain future work:

- Role or area changes for existing staff (staff invitations are implemented in Phase 11)
- Dispute escalation beyond the course's assigned lecturers
- Checking matric numbers against LASU records, and official roster upload (deliberately out of scope)
- OpenAPI generation

Attendance evidence (code, QR challenge, location) is never proof of identity or presence. Lecturer corrections and dispute decisions are audited, but the in-product review path is not a substitute for an institutional appeals policy. A dispute statement is a request for review, not evidence.
