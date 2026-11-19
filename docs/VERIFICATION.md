# Verification model

## Status

Attendance is evidence-based: each check-in records what was checked beside the decision. There are two pipelines, and both now check the face and the phone rule (ADR 033).

### Quick lecture sessions (`/a`, the main path)

- **Codes** (`packages/verification/src/lecture-codes.ts`). Each session has a server-held random secret. A *dynamic* session shows a QR code that changes every 30 seconds, `/a#lasu2.<session>.<window>.<mac>` (the MAC is HMAC-SHA256 truncated to 16 bytes, 22 base64url characters), with a 6-character code that changes with it; the current and the previous window are accepted, so a frame works for at most about a minute. A *static* session has a fixed 8-character code for a printed poster, `/a/<CODE>`, which the session taker can switch to dynamic at any time. Codes avoid the easily confused I, L, O, 0 and 1, and typed codes are normalised (case, spaces, dashes). A poster code is refused while the session shows a changing QR.
- **Ticket.** A valid scan or code returns a check-in ticket valid for 10 minutes (`POST /api/v1/lecture/resolve`), so a student has time to sign in and take the face photos after the code on screen has moved on. Wrong typed codes have their own per-address limit.
- **Account.** The student is marked with their own account: the one signed in on the phone, or a classmate who signs in for this one check-in. Staff accounts cannot mark attendance.
- **Face.** Two photos (straight, then turned the way the ticket says) are matched on the server against the student's registered face (`docs/FACE_VERIFICATION.md`). Close matches are kept for review; repeated failures can become a request to be added by hand.
- **Venue.** When the session's venue has a mapped boundary and the session requires it (the default for mapped venues), only a confirmed position inside the outline or circle, or within its allowance, is accepted (`evaluatePresence`, see `docs/VENUE_SYSTEM.md`). Every refusal says what to do.
- **Phone rule.** Each browser keeps a random token in local storage; the server stores only SHA-256 of `<sessionId>:<token>`, so a phone cannot be followed from one session to the next. A phone can mark its owner and one classmate in a session; a third student is refused (`409`), counted again under the session row lock. Two students on one phone show as **Shared device** to the session taker, a prompt to look, never proof.
- **Record.** One entry per student per session, enforced by a unique constraint; repeating returns the existing entry. The entry stores the method (`qr`, `code` or `manual`), the venue outcome with distance and accuracy, the device hash and the face score.

### Enrolled-course sessions (`/check-in`, the older tools)

- Sessions may carry an `active` venue (`attendance_sessions.venue_id`) and a server-only `qr_secret`.
- Lecturers project a rotating QR challenge (`GET /api/v1/lecturer/attendance-sessions/{id}/qr`): `lasu1.<sessionUuid>.<20s-window>.<22-character base64url HMAC-SHA256 truncated to 16 bytes>`, accepted for the current plus one grace window. The typed 12-character session code remains as the low-tech fallback, and a lecturer can make a session **QR only** so typed codes are refused (`409`).
- The QR encodes `https://<site>/check-in#<challenge>`. The challenge lives in the URL fragment, which browsers never send to the server, so it does not appear in request logs or `Referer` headers.
- Check-in requires an active enrolment in the offering. When face checks are on it takes two calls: the first checks every rule and returns a face ticket, the second sends the photos (ADR 033).
- When the session's venue is `active` with a complete circular boundary, the sample is evaluated with `evaluateCircularGeofence`: clearly `outside` readings are rejected with `422` (no record is written), `within` is recorded as `within_boundary`, and readings that straddle the boundary or are too coarse are recorded as `inconclusive`, never fake-confirmed.
- Every evaluated reading writes an `attendance_check_in_evidence` row (raw coordinates, accuracy, distances, radius and outcome) separate from the attendance record. A `venue_outcome` of NULL means no boundary was applied (venue inactive, pending, unlocated or unlinked), which is visibly distinct from an evaluated outcome.
- The commit transaction re-derives the venue snapshot; if the boundary changed between evaluation and commit, the check-in is retried once and then returns `409` (`venue_changed`).
- The same phone rule applies. **Disputes:** students can ask the course's lecturers to review a missing or revoked check-in, and appeal a rejection to the department once (ADR 026).

Not implemented: venue marker observation and campus-network or BLE evidence. Matric numbers are not checked against LASU records (out of scope by decision); the level students see is worked out from the class list and matric number and is labelled as such. Location evidence never upgrades a record beyond honest uncertainty, and a refusal or an `inconclusive` outcome is not misconduct.

## Walking guide (location stays on the phone)

Open sessions tied to a venue show where it is (campus, building, floor, section), a Google Maps walking-directions link, and a **How far am I?** button. That button reads the phone's position and compares it with the venue centre **in the browser**: nothing is sent to LASUATOS. It reports:

- **inside** when the distance is within the venue radius plus the reading's accuracy (counted up to 30 m);
- **near** when within the radius plus 150 m;
- otherwise the straight-line distance and a rough walking time at 80 m per minute.

Readings worse than 60 m accuracy carry a note that the estimate is rough. The guide is a convenience: only the check-in itself sends a location, and only for venue-linked sessions.

## Evidence model

What a check-in considers today, and what remains possible later:

1. Authenticated account, opened from a class list (built). Official student registration (not built; out of scope by decision).
2. A short-lived, unpredictable challenge bound to the session (built).
3. Valid session state, and for enrolled courses an active enrolment (built).
4. The student's own face, matched against their registered face (built, ADR 033).
5. Correct venue association and fresh location evidence with its horizontal accuracy (built).
6. Device consistency that does not become permanent identity: the per-session device hash and the phone rule (built).
7. Venue marker observation (planned, not built).
8. BLE or university network evidence, only after the capability and institutional approval are proven (not built).

The server evaluates evidence. The client cannot submit a trusted role, calculated distance, final verification outcome or attendance status.

## Outcomes

An attendance entry is either recorded or refused; it is never recorded as "flagged". The evidence is stored beside it: the venue outcome (`within`, `outside`, `inconclusive` or `unavailable` for lecture sessions; `within_boundary`, `inconclusive` or NULL for enrolled courses), the face score and its review, and the shared-device flag. A close face match waits for a lecturer's review, which can remove the entry. Poor GPS accuracy must lead to a retry or a fair alternative, not automatic punishment. A risk signal is not a finding of misconduct.

## QR challenge requirements

Lecture sessions use `lasu2` challenges (`lecture-codes.ts`, described above): a 30-second window, keyed by the session's secret, exchanged for a 10-minute ticket. The enrolled-course challenge (`packages/verification/src/session-challenge.ts`) signs `<sessionId>.<window>` with an HMAC-SHA256 keyed by a per-session random 256-bit secret stored only in `attendance_sessions.qr_secret`; the 16-byte truncated signature is base64url-encoded. Structural parsing and signature-shape checks run before any cryptographic comparison, verification uses constant-time byte comparison, and sessions pre-dating QR support get their secret backfilled lazily on first display. It binds to one session and expires within about 40 seconds (current window plus one grace window).

Replay resistance against a *fresh* short-lived credential is provided by expiry; the challenge itself is not single-use (the duplicate-check-in constraint is what prevents double-recording). Check-ins and wrong typed codes are rate limited (`docs/API.md`), and bursts of refusals alert the operator. A static poster code is a weaker credential than a changing QR; the venue check and the face check are what stop it being used from elsewhere or for someone else.

## Device signals

The implemented signal is the per-session device hash described above. It is deliberately not a fingerprint: it is a random token the browser can drop at any time, hashed with the session id, so clearing site data gets a new one (ADR 033, F3). Passkeys exist for staff sign-in only (ADR 037); they protect accounts, not check-ins, and students do not use them. Unusual account switching, simultaneous use and repeated failures can support manual review. Browser fingerprinting should not be used as permanent identity. A web app cannot access an Android IMEI. Any extra identity check requires a documented need and privacy review.

## Fair fallback

In a lecture session, the person taking attendance can add a student by hand or remove one with a reason, and a student whose face check keeps failing can ask to be added; all of it is recorded. For enrolled courses, lecturers record or revoke check-ins with a required reason, students can dispute a missing or revoked record within 14 days, and a rejected dispute can be appealed to the department once. The university's own fallback and appeals policy still needs a decision. No student should be shown a confirmed status until the server has committed the record.
