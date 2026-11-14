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
| `clearMatch` | 0.60 | Between `match` and this, the check-in passes but one small photo is kept and the attendee is flagged “Face: check photo” for the person taking attendance. |
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
- **Audit:** registrations, resets, refused duplicates and failed checks are in
  `student_audit_events`. Audit details never contain photos or signatures.

## Switching it off

`FACE_CHECK=off` disables registration and check-in face checks (for example
if the engine cannot run in a deployment). The default is `required`.
