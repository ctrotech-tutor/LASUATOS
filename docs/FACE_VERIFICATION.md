# Face verification

Students mark lecture attendance with their own account. The face check makes
sure the person holding the phone is the account's owner: a classmate who
knows someone's password still cannot mark them present.

- **Registration (once):** three photos (looking straight at the camera, head
  turned left, head turned right), taken in the browser after the student has
  agreed to the face notice. Sent to `POST /api/v1/students/me/face`.
- **Check-in (every class):** two photos (straight, then turned the way the
  check-in asks: left or right, chosen per scan), sent with
  `POST /api/v1/lecture/check-in` as `face.frames`.

The decision (same person, live) is made on the LASUATOS server. The phone
only guides the student so the photos it sends are good ones. No face data
goes to a third party.

## The camera on the phone

`apps/web/components/face-capture.tsx` is a full-screen camera (it covers the
app header and the tab bar) built like a banking-app selfie check:

1. **Live guide.** Google's MediaPipe Face Landmarker
   (`@mediapipe/tasks-vision` 0.10.35, Apache-2.0) runs in the browser on
   the CPU, 7–15 times a second. It finds the face, its 478 landmarks, its
   head pose and blink scores. `apps/web/lib/face-guide.ts` turns that into
   one instruction at a time: *move closer*, *centre your face*, *more light*,
   *look straight*, *turn a little more*, *hold still*.
2. **Auto-capture.** When the face has been right for a moment (front 0.7 s,
   turns 0.3 s) the photo is taken by itself: three frames from the end of
   the hold, keeping the sharpest. The ring round the circle fills as it
   gets close.
3. **Steps.** Look straight → blink (registration only; skipped after 9 s) →
   turn left/right. The turn arrows and the ring follow the head live.
4. **Review** (registration and new photos) or a quick tick (check-in).

The guide's limits (`FACE_GUIDE`) are a little stricter than the server's
(`FACE_LIMITS`), using the phone/server pose ratios measured on real
selfies, so a photo the phone accepts is one the server accepts.

**Fallback.** If the tracker cannot load (very old phone, no WebAssembly,
slow network: 25 s timeout) or the student taps *Use a countdown instead*,
the camera switches, without restarting, to a countdown that takes each photo
after 3 s / 2 s. The server checks those photos exactly the same way.

**Files and caching.** `scripts/copy-face-assets.mjs` (run by `dev` and
`build`) copies the WebAssembly runtime from the pinned package to
`apps/web/public/face/wasm-0.10.35/` (git-ignored; SIMD and non-SIMD builds
of about 11 MB each; a phone downloads only the one it can run). The model
`apps/web/public/face/face-landmarker-v1.task` (3.8 MB, Google's file,
unmodified, sha256 checked by the script) is committed. Both are served with
a one-year immutable cache and the service worker keeps them in their own
cache (`lasuatos-face-v1`), so the download happens once per phone. Pages
that lead to the camera start the download in the background
(`preloadFaceTracker`, skipped when the phone asks to save data). When the
camera opens it calls `POST /api/v1/students/me/face/warm`, which loads the
server's face models so the photos are checked without a cold start.

The CSP allows `'wasm-unsafe-eval'` (WebAssembly compilation only, not
`eval`). The library's usage logging to Google is blocked by
`connect-src`, which allows only this site and, for LASU mail (ADR 030), Gmail's
API and Google's token revocation; this is intended.

**Upgrading MediaPipe:** change the version in `apps/web/package.json`,
`FACE_RUNTIME_VERSION` in both `scripts/copy-face-assets.mjs` and
`apps/web/lib/face-tracker.ts`, and rename `FACE_CACHE` in
`apps/web/public/sw.js`.

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
function; each photo takes 170–500 ms (about 170 ms when busy). A check-in
analyses two photos, about 0.4 CPU-seconds in all.

### In a crowd

The models run on their own **worker thread** (`createFaceEngine()`), so a
function instance busy with photos still answers QR scans, the projector and
the lecturer's list in milliseconds. Each instance analyses **one check-in's
photos at a time, first come first served** (`FaceVerifier` in
`apps/api/src/students/face.ts`). When a check-in could not start within
`FACE_QUEUE_BUDGET_MS` (15 s), the instance answers **503 busy with
`Retry-After`** straight away, and the check-in page sends the same photos
again by itself (for up to 3 minutes), telling the student to keep the page
open. One instance does about 2.5–3 check-ins a second; Vercel adds instances
when they are CPU-bound. Measurements and the reasons are in
[LOAD_TESTING.md](LOAD_TESTING.md) (`pnpm load:rush`) and ADR 031.

## Limits

All limits live in `FACE_LIMITS` (`apps/api/src/students/face.ts`). They were
set from measurements on the test faces in `packages/face/test/fixtures`
(fictional, AI-generated people) and checked by
`apps/api/src/students/face.real.test.ts`, which runs the real models:

| Pair | Cosine similarity |
| --- | --- |
| Same person, both facing the camera, two different photos (b1–b2) | 0.713 |
| Same person, facing vs turned about 25° (a1–a2, a1–a3) | 0.669, 0.710 |
| Same person, turned left vs turned right | low and unpredictable (opposite sides of the face), so never compared |
| Different people, one facing and one turned (hardest pair, a3–c1) | up to 0.484 |
| Different people of similar appearance (hardest pair, a1–c1) | up to 0.489 |
| Different people, typical | 0.23–0.39 |

And in real use on the live site:

| Check-in | Score |
| --- | --- |
| The registered student, checking in | 0.978 |
| A different person's face against a registered face | 0.551 (passed under the old 0.52 line as a close match; refused now) |

The lines below sit in the gap: every different person measured, including the
real one, stays under `match`, and the same person in two different photos
clears `clearMatch`. A real check-in by the right person scores far higher
(0.978 above), so the review band catches only the unusual ones.

| Limit | Value | Meaning |
| --- | --- | --- |
| `match` | 0.60 | The check-in's straight photo must be at least this similar to a registered photo. Above every different person measured: 0.489 on the test faces and 0.551 in real use. Raised from 0.52 after that real case. Also the bar for new face photos on *Account security*: they must match the old face this well. |
| `turnMatch` | 0.55 | The turned photo must also look like the registered face, so a live person cannot turn their head in front of a held-up photo of someone else. Above a different person turned (up to 0.484; the old 0.45 let that through), below the same person turned vs facing (0.669; against the registered turned photo it scores higher). |
| `clearMatch` | 0.68 | Between `match` and this, the check-in passes but one small photo is kept and the check-in goes on the **Face checks** list for the lecturer (see below). The band stays 0.08 wide, under the same person in two different photos (0.713). |
| `sameCapture` … `sameCaptureWide` | 0.50 → 0.45 | Photos taken in one go must all show the same person. Each turned photo is compared with the straight one (never left with right: they show opposite sides of the face, and real people scored low on that pair). The bar is 0.50 for a turn up to 0.45 rad (about 26°) and eases to 0.45 at 0.8 rad (about 46°), because a bigger turn shows less of what the straight photo shows. The hardest impostor measured straight vs turned (0.484 at 0.45 rad) stays below it. |
| `duplicate` | 0.60 (= `match`) | A registration this close to another student's registered face is refused (one person, two accounts) and audited. Kept equal to `match`, so nobody can register a face that would pass as someone else's (it was 0.62, which left 0.52–0.62 open). |
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
