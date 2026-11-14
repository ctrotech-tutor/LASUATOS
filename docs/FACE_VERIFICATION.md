# Face verification

Students mark lecture attendance with their own account. The face check makes
sure the person holding the phone is the account's owner: a classmate who
knows someone's password still cannot mark them present.

- **Registration (once):** three photos — looking straight at the camera, head
  turned left, head turned right — taken in the browser after the student has
  agreed to the face notice. Sent to `POST /api/v1/students/me/face`.
- **Check-in (every class):** two photos — straight, then turned the way the
  check-in asks (left or right, chosen per scan) — sent with
  `POST /api/v1/lecture/check-in` as `face.frames`.

Everything runs on the LASUATOS server. No face data goes to a third party.

## Engine

`packages/face` (`@lasuatos/face`), plain JavaScript on WebAssembly so it runs
in a Vercel Node function without native binaries:

| Step | Model | Licence |
| --- | --- | --- |
| Face detection, 468-point mesh, head pose (yaw/pitch/roll) | [Human](https://github.com/vladmandic/human) 3.3.6: BlazeFace + FaceMesh | MIT |
| Passive liveness | Human's `liveness` and `antispoof` models | MIT |
| Face signature (128 numbers) | OpenCV Zoo [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) 2021dec, run with onnxruntime-web | Apache-2.0 |

The mesh gives five landmarks (eye centres, nose tip, mouth corners). The face
is warped onto the standard 112 × 112 ArcFace template and SFace turns it into
a signature. Two signatures are compared by cosine similarity. OpenCV
publishes 0.363 as SFace's "same person" threshold on LFW; LASUATOS is
stricter (below).

The SFace file's sha256 is checked when the engine loads
(`SFACE_SHA256` in `packages/face/src/index.js`). Every stored template records
the model id (`sface-2021dec`), so a future model change can ask students to
register again instead of comparing incompatible signatures.

Human's own face embeddings were tried and rejected: different people
overlapped with the same person. face-api.js was slower and also overlapped.

### Deployment

`apps/api/scripts/bundle-embedded.mjs` builds the engine into one
self-contained folder, `apps/api/dist/face` (about 57 MB):

```
face.mjs   Human, TensorFlow.js, onnxruntime-web and jpeg-js, bundled
models/    blazeface, facemesh, antispoof, liveness (Human) + sface-2021dec.onnx
wasm/      tfjs-backend-wasm-simd.wasm, ort-wasm-simd-threaded.{mjs,wasm}
```

The web app's API function ships it through `outputFileTracingIncludes` in
`apps/web/next.config.ts`, and `loadFaceEngine()` in
`apps/api/src/students/face.ts` loads it from disk on the first face check.
`FACE_ENGINE_PATH` overrides the location. Development and tests import the
package directly instead.

Measured on the sandbox CPU: loading takes about 0.5–2 s once per warm
function; each photo takes 250–500 ms. A check-in analyses two photos.

## Limits

All limits live in `FACE_LIMITS` (`apps/api/src/students/face.ts`). They were
set from measurements on the test faces in `packages/face/test/fixtures`
(fictional, AI-generated people) and checked by
`apps/api/src/students/face.real.test.ts`, which runs the real models:

| Pair | Cosine similarity |
| --- | --- |
| Same person, both facing the camera | 0.67–0.72 |
| Same person, facing vs turned (about 25°) | about 0.67 |
| Different people of similar appearance (hardest pair) | up to 0.48 |
| Different people, typical | 0.22–0.40 |

| Limit | Value | Meaning |
| --- | --- | --- |
| `match` | 0.52 | The check-in's straight photo must be at least this similar to a registered photo. Above the hardest impostor pair (0.48). |
| `turnMatch` | 0.45 | The turned photo must also look like the registered face, so a live person cannot turn their head in front of a held-up photo of someone else. |
| `clearMatch` | 0.60 | Between `match` and this, the check-in passes but one small photo is kept and the check-in goes on the **Face checks** list for the lecturer (see below). |
| `sameCapture` | 0.50 | Photos taken in one go must all show the same person. |
| `duplicate` | 0.62 | A registration this close to another student's registered face is refused (one person, two accounts) and audited. |
| `live` / `real` | 0.5 / 0.3 | Passive liveness scores. Real faces measured 0.86–1.00 (`live`); `antispoof` is weak on its own, so its bar is low. |
| `frontYaw` | 0.2 rad | "Straight": head turned less than about 11°. |
| `turnYaw` … `maxTurnYaw` | 0.2–1.1 rad | "Turned": about 11°–63°, not a full profile. |
| `minSize` / `maxSize` | 0.16 / 0.9 | Face width as a share of the photo width. |
| brightness, sharpness, roll | 45–225, ≥200, ≤0.4 rad | Photo quality, with a message the student can act on. |

## What stops what

| Attempt | Stopped by |
| --- | --- |
| A classmate signs in with someone's password | Face mismatch (403). Repeated failures for one lecture (6 per 30 minutes) are refused with 429 and audited as `face_check_failed`. |
| A printed photo or a phone screen held to the camera | Passive liveness, plus the head turn (a flat picture does not change pose). |
| A recorded video of the student | The turn direction is derived from the scan's check-in ticket (`turnForTicket`), so an old video turns the right way only half the time, and the ticket expires in 10 minutes. |
| Someone else turning their head in front of the camera | The turned photo must match the registered face too (`turnMatch`). |
| One person registering two accounts | `duplicate` check against every registered face in the institution. |
| Registering someone else's face | Registration needs the account, which opened only with a code sent to the student's LASU email. The registered photo is visible to the HOC and administrators on the class list, who can spot a wrong face; administrators can reset it. |

## When it goes wrong

**The face check keeps failing at a lecture (help request).** After two
refused face checks for the same lecture (`FACE_FAILURES_BEFORE_HELP`), the
check-in page offers *“Ask to be added”*. The student must still be signed in
with their own account and hold a valid scan ticket, so the request proves they
scanned this lecture's QR code a moment ago. The request (name, matric number,
the reason the last check failed, how many failures, and the location result if
there was one) appears at the top of the session page for the person taking
attendance, with the student's **registered** photo. The taker looks up, sees
whether that person is in the room, and taps **Add** (the student is added by
hand with the usual “Added by you” label; class reps need to be inside the
venue, and their 10-student limit and open-session rule still apply) or
**Decline**. The student's phone waits on a “Waiting for …” screen that updates
by itself every few seconds. One request per student per lecture; each decision
is made once and audited (`help_request_created`, `help_request_added`,
`help_request_declined`).

**The face itself changed, or the first photos were poor (new photos).** On
*Account security* the student sees their registered photo and **Take new
photos**: they confirm their password, then a code sent to their LASU email,
which opens a 20-minute window to take three new photos. The new photos must
still match the registered face (`match`), so someone holding an unlocked phone
cannot swap in their own face; they also go through the `duplicate` check. Two
replacements per 30 days. When the registered face is of the wrong person, the
HOC or an administrator resets it instead (the student registers again).

**A close match (face reviews).** Check-ins between `match` and `clearMatch`
go on the **Face checks** page (from *Take attendance*, for lecturers and
administrators only; class reps see a “Face: to review” flag but cannot judge a
classmate). The reviewer sees the check-in photo next to the registered photo,
the score and the session, and taps **Approve** (the check-in stands) or
**Reject** with a reason (the check-in is removed, with “Face check rejected:
reason” shown to the student). Each decision is made once and audited
(`face_review_approved`, `face_review_rejected`).

Passive liveness is not certified presentation-attack detection (ISO/IEC
30107-3). It raises the effort needed to cheat, and the venue check, the
shared-device flag and the session taker's list remain in place alongside it.

## Privacy (Nigeria Data Protection Act 2023)

Face data is biometric, sensitive personal data:

- **Consent:** the student agrees to the face notice before the camera opens
  (`consent: true` is required by the API).
- **Kept:** one 128-number signature per registration photo, their average
  (for the duplicate check), and one 200 × 250 photo of the student facing the
  camera. The other photos are discarded straight away.
- **Check-ins:** the match score is stored with the attendance. The photos are
  discarded, except for a close match, when one small photo is kept with that
  lecture's attendance for review.
- **Who sees the photo:** the HOC and administrators for that class list; the
  person taking attendance for a close-match check-in photo.
- **Deletion:** an administrator can reset (delete) a registered face (the
  student must register again to mark attendance themselves); face data is
  deleted with the account (`ON DELETE CASCADE`).
- **Retention:** registered faces are deleted automatically
  `RETENTION_GRACE_MONTHS` (default 12) after a set's final session ends
  (entry year from the matric number + the department's programme length,
  ending 1 September), unless the student checked in to a lecture in the last
  `RETENTION_ACTIVE_DAYS` (default 180) days. Check-in photos kept for review
  are deleted after `RETENTION_CHECK_PHOTO_DAYS` (default 90). Accounts and
  attendance records stay. See *Data retention* in
  [ADMINISTRATION.md](ADMINISTRATION.md).
- **Audit:** registrations, new photos, resets, refused duplicates, failed
  checks, help requests, face reviews and retention deletions are in
  `student_audit_events`, readable on the *Audit log* page. Audit details never contain photos or signatures.

## Switching it off

`FACE_CHECK=off` disables registration and check-in face checks (for example
if the engine cannot run in a deployment). The default is `required`.
