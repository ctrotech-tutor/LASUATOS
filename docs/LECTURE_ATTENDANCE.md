# Quick lecture attendance

The fastest way to take attendance. It does not need course offerings or enrolment.

## Who can take attendance

- **Lecturers** and **administrators**.
- **GHOC**: the general head of class for one faculty and one academic set (for example, Faculty of Engineering, 2023/2024 set). Appointed by an institution or faculty administrator.
- **HOC**: the head of class for one department and set. Appointed by an administrator or by the GHOC of that faculty and set.

Manage class reps at `/class-reps`. A student needs an account before being appointed.

## Taking attendance (`/sessions`)

1. Type the course code and title. Today's date is set automatically.
2. Choose how long attendance stays open (15 min to 3 hrs).
3. Choose the QR type:
   - **On a screen (dynamic)**: changes every 30 seconds with a 6-character code. Show it full screen on a projector, a TV or your phone.
   - **Printed poster (static)**: one fixed QR code and an 8-character code. Download the A4 PNG or print it. It works only while the session is open.
4. Optionally pick a venue and require students to be inside it (see [Venue check](#venue-check)).

The student list updates live. You can remove an entry (with a reason), restore it, extend by 15 minutes, close, reopen, switch the QR type, and export CSV for Excel. Entries made on the same phone as other students are flagged.

### Adding a student by hand

A student whose phone is dead, or who has no smartphone, can be added by the person
running the session: **Add student** on the session page, then full name and matric
number.

- Only after the session has started (`409` before). The matric number must be a valid
  LASU number (`422`).
- If the matric number belongs to a student account, the entry is linked to it and shows
  in that student's history.
- The entry is marked **Added by &lt;name&gt;** on the list and in the CSV, and stores no
  device or location data. Every manual entry records who added it (`added_by_user_id`).
- Adding someone already on the list returns `409`. Adding someone who was removed
  restores the entry (`200 { status: "restored" }`).
- A student who was removed cannot mark themselves again; only the session taker can
  restore them.

`POST /api/v1/lecture/sessions/{sessionId}/attendees` with `{ fullName, matricNumber }` →
`201 { status: "added", fullName, matricNumber }`. Rate limit: 600 per hour per session.

## Venue check

When a session requires its venue, a check-in is accepted only when the phone's position
confirms the student is there. The QR code (which changes every 30 seconds on a screen)
stays the main proof of presence; the venue check stops codes being used from elsewhere.

### Registering a venue (`/admin/venues`)

Administrators register each venue's boundary in one of two shapes:

- **Outline the hall** (recommended): the hall's corners, 3 to 24 of them, in order
  around the building. Tap them on the map (OpenStreetMap shows building shapes when
  you zoom in), or stand in each corner and capture it with GPS. Drag a corner to adjust it.
- **Circle around a point**: a centre and a radius (centre to the furthest seat).

Both have an **allowance**, 0–100 m: how far outside the walls a phone reading may land
and still count. Phone GPS inside buildings is usually 10–30 m off. Suggested allowance
is 15–25 m. The form suggests one from the accuracy you measured.

GPS capture averages readings while you hold the phone still for 10–20 seconds. It
shows the accuracy (±metres), how many readings were averaged, and a quality label. A single
reading taken indoors can be 20–50 m off, which is why a venue registered from one indoor
reading with a 10 m radius turned students away from inside the hall.

Once a venue is registered, the button reads **Update location and boundary**. Venues registered
before outlines existed have no allowance and are flagged **Review boundary** in the
list. Every change writes a `venue_location_events` audit row.

### What the student sees

The phone watches its position from the moment the check-in page opens, so GPS has
settled by the time the student has typed their details. Cached positions are never
used. Readings from the last 10 seconds are combined: the sharpest one, steadied by
those that agree with it. A live card shows where they stand ("You're at LT1, accurate
to ±12 m", "About 35 m from LT1", "Your phone is sharing only an approximate location"
with the setting to change on iPhone or Android). The same rule runs on the server,
which makes the decision.

After a successful check-in: **Location confirmed · accurate to ±X m**.

### The rule (`packages/verification/src/venue-area.ts`, `evaluatePresence`)

In order:

1. Reading older than 2 minutes → not accepted ("take a fresh reading").
2. Further outside than the allowance **plus the whole accuracy radius** → outside.
3. Accuracy of 1 km or worse → not accepted (Precise Location is off; iPhone Safari
   then reports ±3–9 km).
4. Accuracy worse than 100 m, or none → not accepted.
5. Inside the shape → accepted.
6. Outside the shape by no more than the allowance → accepted.
7. Otherwise → not accepted ("about N m outside, accuracy ±M m").

The accuracy radius is never added to the allowance, so a vague reading cannot stretch the boundary.
Previously a reading counted as inside whenever the venue circle *could* contain it, and
readings with unknown accuracy passed. That is how check-ins from well outside a 30–40 m
boundary got through.

The check-in body's `location` is `{ latitude, longitude, accuracyMeters, capturedAt,
ageMilliseconds?, sampleCount? }`. `ageMilliseconds` is the reading's age measured on the
phone's own clock, so a phone clock set wrong does not make a fresh reading look stale.
The result includes `venueOutcome` and `locationAccuracyMeters`. Coordinates are stored
only for readings that were used to decide.

The lecturer's list shows each entry's result with its accuracy ("In venue · ±12 m",
"30 m outside · ±25 m"), and the CSV has *Metres outside walls* and *GPS accuracy (m)*
columns.

## Marking attendance (`/a`)

Students scan the QR code with their phone camera, or open `/a` and type the code.
- **Without an account**: they type their full name and matric number. These can be remembered on the phone.
- **Signed in**: one tap. Earlier guest entries with the same matric number are attached to the account.

### What students see (`/attendance`)

- **Your attendance**: overall percentage across every lecture they could have attended,
  then one bar per course with the 75% line marked. A course below 75% is flagged with
  how many lectures in a row they need to get back to 75%:
  `ceil((0.75 × held − attended) ÷ 0.25)`.
- **Lectures you marked**: each lecture, with how it was recorded (QR scan, typed code,
  or added by the lecturer). The first six are shown, with *Show all*.
- "Held" counts every started session, of that course code, run by the people who ran a
  session the student attended. This is the same number the course register uses.
- Students with only quick-lecture attendance (no course enrolment) see only these
  sections.

`GET /api/v1/student/lecture-history` → `{ entries[], courses[{ courseCode, courseTitle, held, attended, rate }] }`.

## Production

Migrations `0012`–`0016` must be applied: `pnpm prod:migrate`. Until they are,
`/api/v1/ready` returns `503` with `schema: "behind"` (see [DEPLOYMENT.md](DEPLOYMENT.md)).

## Course registers

`/registers` (also reachable from the **Registers** tab on `/sessions`) turns every
session of a course into one register — the sheet a department needs for exam
eligibility.

- **Who can see it:** anyone who can take attendance. Each person sees the registers
  for the sessions they can see (lecturers and class reps: their own sessions;
  administrators: sessions in their scope).
- **How students are matched:** by normalised matric number across all sessions of the
  course code (`CSC 201`, `csc201 ` and `CSC  201` are the same course). The most recent
  name typed is shown. Entries a session taker removed are not counted.
- **Percentages:** attended ÷ sessions held, to one decimal place. Only sessions that
  have started count as held.
- **Eligibility threshold:** 75% by default (`DEFAULT_ATTENDANCE_THRESHOLD`), adjustable
  on screen to 50–80%. Students below it are flagged, and one tap shows only them.
- **Export:** *Excel / CSV* downloads a UTF-8 sheet (S/N, name, matric, one column per
  session with P/A, attended, held, percentage, eligible). Cells that start with
  `= + - @` are escaped so spreadsheet apps never run them as formulas. *Print* produces
  a clean A4 grid without the app chrome.

API:

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/v1/lecture/registers` | `{ courses: [{ courseCode, courseTitle, sessionCount, lastHeldAt }] }` |
| GET | `/api/v1/lecture/register?course=CSC%20201` | `{ courseCode, courseTitle, sessions[], students[{ matricNumber, fullName, hasAccount, present[], attended, rate }], generatedAt }` |

Errors: `400` when `course` is missing, `403` for accounts that cannot take attendance,
`404` when the caller has no sessions for that course.

## App behaviour (installable)

LASUATOS is an installable web app (PWA): **Add to Home screen** on Android/iOS or
**Install** in desktop Chrome/Edge opens it full-screen with its own icon.

- `/manifest.webmanifest` starts the app at `/launch`, which sends each person to their
  home (student → `/attendance`, lecturer → `/sessions`, admin → `/admin`, signed out → `/`).
  Shortcuts: *Mark attendance*, *Take attendance*, *My attendance*.
- `/sw.js` caches only static assets and an offline page. It **never caches API calls**,
  so attendance data is always live; with no network, pages fall back to `/offline`.
- Live screens (QR code, attendee list, student history) poll only while visible, keep
  the screen awake while a QR is shown, and give a short vibration on successful check-in
  where the phone supports it.
- Confirmations and prompts use in-app dialogs (bottom sheets on phones) instead of
  browser pop-ups.

## Public pages

- `/help`: how it works, FAQs for students and for lecturers/class reps, and how to
  install the app.
- `/privacy`: plain-language privacy notice under the Nigeria Data Protection Act 2023
  (what is recorded, why, who can see it, device code and location, cookies, retention,
  rights, security). Linked from the footer, the landing page, the guest check-in form,
  sign-up and the student attendance page. **Have the University's data protection
  officer review it before wide rollout.**
- Shared links show a preview card (`/opengraph-image`, 1200×630). Its absolute URL uses
  `PUBLIC_APP_URL`, or Vercel's production domain when that is not set.
- Every signed-in and public page has a *Skip to content* link for keyboard and screen
  reader users, and a thin loading bar while a slow page opens.
