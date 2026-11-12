# Verification model

## Status

The attendance pipeline is now venue-aware and evidence-based:

- Sessions may carry an `active` venue (`attendance_sessions.venue_id`) and a server-only `qr_secret`.
- Lecturers can project a **rotating QR challenge** (`GET /api/v1/lecturer/attendance-sessions/{id}/qr`): `lasu1.<sessionUuid>.<20s-window>.<22-char base64url HMAC-SHA256 truncated to 16 bytes>`, accepted for the current plus one grace window. The typed 12-character session code remains as the low-tech fallback and can be rotated as before.
- Student check-in accepts either a typed code or a QR challenge plus an optional device location sample (`latitude`, `longitude`, `accuracyMeters`, `capturedAt`). The web client requests the browser's current position when an open enrolled session is venue-linked.
- When the session's venue is `active` and has a complete circular boundary, the server evaluates the sample with the geofence evaluator: clearly `outside` readings are rejected with a 422 (no record is written), `within` is recorded as `within_boundary`, and uncertainty-straddling or coarse readings are recorded honestly as `inconclusive` — never fake-confirmed.
- Every accepted venue evaluation writes an `attendance_check_in_evidence` row (raw coordinates, accuracy, captured/evaluated distances, radius and outcome) separate from the attendance record. Records carry `method` (`code` or `qr_code`) and a `venue_outcome` of `within_boundary`, `inconclusive` or NULL. NULL means no boundary was applied (venue inactive, pending, unlocated, or deliberately unlinked), which is the incident-response path and is visibly distinct from an evaluated outcome.
- The commit transaction re-derives the venue snapshot; if the boundary changed between evaluation and commit, the check-in is retried once and then returns 409 (`venue_changed`).

- **Scanning:** the QR encodes a link, `https://<site>/check-in#<challenge>`. A phone's built-in camera app opens the check-in page straight away; the in-app **Scan QR code** button (camera via the browser's `BarcodeDetector`, with a fallback decoder) reads the same link. The challenge lives in the URL fragment, which browsers never send to the server, so it does not appear in request logs or `Referer` headers.
- **QR-only sessions:** a lecturer can tick **QR only** when opening a session, or switch it at any time while the session is open (`POST …/settings`). Typed codes are then refused with a 409, so a code forwarded on WhatsApp is useless; the student has to see the rotating QR in the room.
- **Device signal:** each browser keeps a random token in local storage and sends it with check-in. The server stores only SHA-256 of `<sessionId>:<token>` (the `device_hash` column on the attendance record), so the same phone cannot be followed from one session to the next. When two students in one session share a hash, both roster rows show **Shared device** and the session header counts them. It is a prompt to look, never proof (a borrowed phone when a battery died looks identical), and it never blocks a check-in. Clearing site data or using a private window resets the token, so its absence proves nothing either.
- **Disputes:** students can ask the course's lecturers to review a missing or revoked check-in; upholding applies an audited correction (see `docs/API.md`).

Still not implemented: venue marker observation, campus-network or BLE evidence, and escalation beyond the course's lecturers. Matric numbers are not checked against LASU records (out of scope by decision); the level students see is derived from the matric number's first two digits and is labelled self-reported. Location evidence never upgrades a record beyond honest uncertainty, and an `inconclusive` outcome is not misconduct.

## Walking guide (location stays on the phone)

Open sessions tied to a venue show where it is (campus, building, floor, section), a Google Maps walking-directions link, and a **How far am I?** button. That button reads the phone's position and compares it with the venue centre **in the browser**: nothing is sent to LASUATOS. It reports:

- **inside** when the distance is within the venue radius plus the reading's accuracy (counted up to 30 m);
- **near** when within the radius plus 150 m;
- otherwise the straight-line distance and a rough walking time at 80 m per minute.

Readings worse than 60 m accuracy carry a note that the estimate is rough. The guide is a convenience: only the check-in itself sends a location, and only for venue-linked sessions.

## Intended evidence model

A future verification decision may consider:

1. Authenticated account and official student registration.
2. Active enrollment in the course offering.
3. Lecturer assignment and valid session state.
4. A short-lived, unpredictable challenge bound to the session and venue.
5. Correct venue association and fresh location evidence with its horizontal accuracy.
6. Optional venue marker observation.
7. Device or account consistency signals that do not become permanent identity.
8. Optional BLE or university network evidence only after the capability and institutional approval are proven.

The server evaluates evidence. The client cannot submit a trusted role, calculated distance, final verification outcome or attendance status.

## Outcomes

The planned outcomes are `verified`, `inconclusive`, `flagged` and `rejected`. Location signals should be stored as evidence and uncertainty, separate from the final attendance record. Poor GPS accuracy must lead to a retry or a fair alternative, not automatic punishment. A risk signal is not a finding of misconduct.

## QR challenge requirements

The implemented challenge (`packages/verification/src/session-challenge.ts`) signs `<sessionId>.<window>` with an HMAC-SHA256 keyed by a per-session random 256-bit secret stored only in `attendance_sessions.qr_secret`; the 16-byte truncated signature is base64url-encoded. Structural parsing and signature-shape checks run before any cryptographic comparison, verification uses constant-time byte comparison, and sessions pre-dating QR support get their secret backfilled lazily on first display. The challenge binds to one session and expires within ~40 seconds (current window plus one grace window).

Replay resistance against a *fresh* short-lived credential is provided by expiry; the challenge itself is not single-use (the duplicate-check-in constraint is what prevents double-recording). Rate limiting and abuse monitoring at the trusted edge remain required. A permanent URL or static room marker is never an attendance credential.

## Device signals

The implemented signal is the per-session device hash described above. It is deliberately not a fingerprint: it is a random token the browser can drop at any time, hashed with the session id. WebAuthn or passkeys may later support account security. Unusual account switching, simultaneous use and repeated failures can support manual review. Browser fingerprinting should not be used as permanent identity. A web app cannot access an Android IMEI. Any extra identity check requires a documented need and privacy review.

## Fair fallback

Lecturers can record a missed check-in or revoke one with a required reason (permanently logged), and students can dispute a missing or revoked record within 14 days. The approved institutional fallback and appeals policy still needs a university decision. No student should be shown a confirmed status until the server has committed the record.
