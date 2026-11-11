# Verification model

## Status

The application implements a code-based attendance MVP: the API opens timed sessions, checks enrolled-student codes and records timestamps. Venue verification, dynamic QR scanning, location capture, device consistency checks and evidence-based attendance decisions are not implemented. No browser permission request for location exists; the current check-in code does not prove physical presence.

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

Challenges should use cryptographically secure randomness or a securely signed token, bind to one active attendance session and registered venue, expire quickly, be validated on the server, reject replay and be rate limited. A permanent URL or static room marker is not an attendance credential by itself. Challenge refresh and final consumption need transactional protection.

## Device signals

WebAuthn or passkeys may support account security. Unusual account switching, simultaneous use and repeated failures can support manual review. Browser fingerprinting should not be used as permanent identity. A web app cannot access an Android IMEI. Any extra identity check requires a documented need and privacy review.

## Fair fallback

The future lecturer workflow should support retry, manual review and a traceable correction reason. Dispute handling and approved fallback policy need institutional decisions. No student should be shown a confirmed status until the server has committed the record.
