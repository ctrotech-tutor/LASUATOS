# Verification model

## Status

The attendance pipeline is now venue-aware and evidence-based:

- Sessions may carry an `active` venue (`attendance_sessions.venue_id`) and a server-only `qr_secret`.
- Lecturers can project a **rotating QR challenge** (`GET /api/v1/lecturer/attendance-sessions/{id}/qr`): `lasu1.<sessionUuid>.<20s-window>.<22-char base64url HMAC-SHA256 truncated to 16 bytes>`, accepted for the current plus one grace window. The typed 12-character session code remains as the low-tech fallback and can be rotated as before.
- Student check-in accepts either a typed code or a QR challenge plus an optional device location sample (`latitude`, `longitude`, `accuracyMeters`, `capturedAt`). The web client requests the browser's current position when an open enrolled session is venue-linked.
- When the session's venue is `active` and has a complete circular boundary, the server evaluates the sample with the geofence evaluator: clearly `outside` readings are rejected with a 422 (no record is written), `within` is recorded as `within_boundary`, and uncertainty-straddling or coarse readings are recorded honestly as `inconclusive` — never fake-confirmed.
- Every accepted venue evaluation writes an `attendance_check_in_evidence` row (raw coordinates, accuracy, captured/evaluated distances, radius and outcome) separate from the attendance record. Records carry `method` (`code` or `qr_code`) and a `venue_outcome` of `within_boundary`, `inconclusive` or NULL. NULL means no boundary was applied (venue inactive, pending, unlocated, or deliberately unlinked), which is the incident-response path and is visibly distinct from an evaluated outcome.
- The commit transaction re-derives the venue snapshot; if the boundary changed between evaluation and commit, the check-in is retried once and then returns 409 (`venue_changed`).

Still not implemented: device consistency signals, camera-based scanning in the browser (the challenge is accepted as text for API clients), venue marker observation, campus-network evidence, and dispute/manual-review workflows. Location evidence never upgrades a record beyond honest uncertainty, and an `inconclusive` outcome is not misconduct.

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

WebAuthn or passkeys may support account security. Unusual account switching, simultaneous use and repeated failures can support manual review. Browser fingerprinting should not be used as permanent identity. A web app cannot access an Android IMEI. Any extra identity check requires a documented need and privacy review.

## Fair fallback

The future lecturer workflow should support retry, manual review and a traceable correction reason. Dispute handling and approved fallback policy need institutional decisions. No student should be shown a confirmed status until the server has committed the record.
