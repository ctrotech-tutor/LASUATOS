# Quick lecture attendance

The fastest way to take attendance. It does not need course offerings or enrolment.

## Who can take attendance

- **Lecturers** and **administrators**.
- **GHOC**: the general head of class for one faculty and one academic set (for example, Faculty of Engineering, 2023/2024 set). Appointed by an institution or faculty administrator.
- **HOC**: the head of class for one department and set. Appointed by an administrator or by the GHOC of that faculty and set.

Manage class reps at `/class-reps`. A student needs an account before being appointed.

## Taking attendance (`/sessions`)

1. Pick the course from the [course list](#course-list). The title comes from the list;
   the **Lecturer** field is filled in with a lecturer's own name (class reps get the
   lecturer they named last time for that course). Today's date is set automatically.
2. Choose how long attendance stays open (15 min to 3 hrs).
3. Choose the QR type:
   - **On a screen (dynamic)**: changes every 30 seconds with a 6-character code. Show it full screen on a projector, a TV or your phone.
   - **Printed poster (static)**: one fixed QR code and an 8-character code. Download the A4 PNG or print it. It works only while the session is open.
4. Optionally pick a venue. When its location is registered, **Students must be in the venue** switches on by itself (see [Venue check](#venue-check)). With a printed poster and no venue check, the form warns that a photo of the poster works from anywhere.

The student list updates live. You can remove an entry (with a reason), restore it, extend by 15 minutes, close, reopen, switch the QR type, and export CSV for Excel.

## Course list

Sessions are opened by picking a course, never by typing one, so a course is spelt the
same way in every session, register and export.

- **Built-in list** (`apps/api/src/lecture/course-catalog.ts`): the 44 courses every
  engineering student takes under the NUC CCMAS (2022), which LASU adopted from
  2023/2024: GET 101–502, GST, ENT, 100-level MTH/PHY/CHM/COS/STA and SIWES, each with
  level, semester and units. Checked against the NUC CCMAS document and the University
  of Ibadan CCMAS course list. Where the listings disagree (GET 203's units), the value
  is left blank.
- **Departmental courses** (ECE, MEE, CPE, AAE, civil, industrial): LASU does not
  publish its B.Eng course lists online in a form that can be checked, so none are
  guessed. Any lecturer, administrator or class rep adds a missing course once
  (**Course not on the list? Add it**, also at the bottom of the open course list: code
  like `ECE 305`, title, units) and everyone at the institution can pick it. These are
  stored in the `courses` table with `added_by_user_id`.
- Creating or editing a session with a code that is not on the list (or is hidden)
  returns `422`. A `courseTitle` in the request is ignored.

### Editing the list when codes change (`/admin/courses`)

Codes change: CCMAS codes differ by entry cohort, and a department can teach a common
course under its own prefix (the GET courses taught as MEE). Nothing is hard-coded for
good: the built-in list is a starting point that each institution overrides.

- **Who:** institution and faculty administrators manage the whole list. Department
  administrators, and the person who added a course, can change the institution's own
  (added or changed) courses.
- **Change one course** (Edit, on `/admin/courses` or **Fix this course** under the
  picker): code, title, units, and **Hide from the course list**. Changing a built-in
  course stores a replacement row (`courses.standard_code` = the built-in key, e.g.
  `GET201`) that takes its place and keeps its semester; the row shows "Was GET 201".
  Setting a hidden built-in course back to exactly its built-in details deletes the
  replacement row.
- **Move sessions:** when a code changes, **Move the N sessions already taken** renames
  those sessions to the new code and title in the same transaction, so their registers
  continue. Off, they stay under the old code. If other people took sessions under the
  old code, only a faculty or institution administrator can move them (`403`).
- **Rename a code prefix** (GET → MEE): pick the current prefix, type the new one,
  **Preview changes**. The preview lists every course that would change with its session
  count, and anything skipped: a code that already exists, or a built-in course with
  unknown units (GET 203; set its units first). **Rename** applies everything in one
  transaction, or nothing.
- **Hide instead of delete:** hidden courses (`courses.hidden_at`) are not offered when
  opening a session, but sessions taken keep them. A course with sessions cannot be
  removed, only hidden.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/lecture/course-catalog[?include=hidden]` | `{ courses[{ id, code, title, units, level, semester, group, source, addedByName, canEdit, builtInCode, hidden, sessionCount }], recent[{ code, lecturerName }], standardSource, canManage }`. Hidden courses only for managers. |
| POST | `/api/v1/lecture/course-catalog` | `{ code, title, units }` → `201` course; `409` if the code is on the list; 60/hour |
| POST | `/api/v1/lecture/course-catalog/{id}` | `{ code?, title?, units?, hidden?, moveSessions? }` → `{ course, sessionsMoved }`; `403` unless added by you or you are an administrator; `409` if the new code is taken |
| POST | `/api/v1/lecture/course-catalog/standard/{code}` | Same body, for a built-in course (`GET209`); faculty and institution administrators |
| POST | `/api/v1/lecture/course-catalog/rename-prefix` | `{ from, to, moveSessions, apply }` → `{ changes[], conflicts[], applied, sessionsMoved }`; `apply: false` previews |
| POST | `/api/v1/lecture/course-catalog/{id}/remove` | → `{ status: "removed" }`; `409` "Hide it instead" when in use |

### Adding a student by hand

A student whose phone is dead, or who has no smartphone, can be added by the person
running the session: **Add student** on the session page, then full name and matric
number.

**Class reps (HOC, GHOC)** sit in the class, so their adds are limited to what they can
vouch for. This is how the "HOC registers absent friends" problem is closed without
anyone leaving the lecture to find the HOC:

- Only **while attendance is open**. After it closes (time up or closed by hand), a class
  rep's add returns `409`. A student who missed it has to ask the lecturer.
- When the session checks the venue, the rep's own phone must be **inside the venue**:
  the request carries the rep's `location`, checked by the same rule as a student
  check-in (`422` otherwise).
- At most **10** hand-added students per rep per class (`MAX_REP_ADDS_PER_SESSION`). A
  classmate who has no phone with them can instead sign in on a friend's phone (see
  [Marking attendance](#marking-attendance-a)), which needs their own password, so
  nobody can do it for them.

**Lecturers and administrators** can add at any time after the session starts, including
after it closes; those entries are flagged **Added after class** on the list and in the
CSV (`addedAfterClose: true`).

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

`POST /api/v1/lecture/sessions/{sessionId}/attendees` with `{ fullName, matricNumber, location? }` →
`201 { status: "added", fullName, matricNumber }`. Rate limit: 600 per hour per session.

## Venue check

When a session requires its venue, a check-in is accepted only when the phone's position
confirms the student is there. The QR code (which changes every 30 seconds on a screen)
stays the main proof of presence; the venue check stops codes being used from elsewhere.

### Registering a venue (`/admin/venues`)

Administrators register each venue's boundary in one of two shapes:

- **Outline the hall** (recommended): the hall's corners, 3 to 24 of them, in order
  around the building. The quickest way is **Use building shape from map**: tap inside
  the building on the map and its OpenStreetMap footprint loads as the outline (traced
  from aerial photos, usually within a few metres). If the tap is inside more than one
  mapped building (a wing inside a complex), the others are offered as alternatives.
  Check that the shape matches the hall, then save. You can also tap the corners
  yourself, or stand in each corner and capture it with GPS. Drag a corner to adjust it.
  Halls inside a bigger building (one room on one floor) need their own corners, because
  the footprint covers the whole building.
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
settled by the time the student taps the button. Cached positions are never
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
**A student can mark only themselves**, with their own student account. Typed names and
matric numbers are no longer accepted (older clients' `fullName` and `matricNumber` are
ignored), so a student cannot put someone else on the list.

- **Signed in on their own phone**: one tap.
- **Not signed in**: the page asks for their email or matric number and password. If it
  is their own phone they can tick *keep me signed in*.
- **A classmate without their phone**: on the friend's phone, *A classmate without their
  phone? Let them sign in here*. They type their own email or matric number and password
  (`signIn` in the check-in body). This marks them only: the phone stays signed in as its
  owner, and nothing of theirs is kept on it. Because it needs their password, it cannot
  be done for an absent student without handing over their account.
- **A staff account** cannot be marked present (`403`); a student can sign in for the
  check-in on that phone.

Students can also sign in on the normal sign-in page with their matric number instead of
their email.

Errors: no account and no `signIn` → `401`; wrong password → `401` ("do not match a
student account", without saying which part); rate limit for `signIn`: 600 per address
and 10 per account per 15 minutes.

### A phone marks its owner and one classmate

Each phone can mark at most **two** students per class (`MAX_STUDENTS_PER_PHONE`): its
owner and one classmate who signed in on it. A third is refused with "A phone can mark its
owner and one classmate…". The same students trying again is fine, and removing an entry
frees its place. Without this rule, a student in the hall could sign in friends one after
another, and the venue check would pass because that phone really is in the room. The
phone is recognised by a random code kept in the browser (only a per-session hash is
stored). The list flags entries that share a phone.

### How sure is "present"?

With a registered venue, **Students must be in the venue**, and the screen QR, an entry needs:

| Check | Stops |
| --- | --- |
| QR changes every 30 s (valid about 60 s) | Codes sent around on WhatsApp after the fact |
| Fresh GPS reading (under 2 minutes old), good enough to decide (≤ 100 m), inside the outline or its allowance | Marking from hostels, home or the next building |
| Each student signs in as themselves; a phone marks at most two | Marking absent friends from your own phone |
| Class reps add only during class, from inside the venue, at most 10 | The HOC registering absent friends after class |
| Live list with location, accuracy and flags | Lets the taker remove anything that looks wrong |

What a web app **cannot** prove, and why:

- **Inside the walls vs just outside them.** Phone GPS indoors is usually 10–30 m off, so
  the allowance band (15–25 m) also covers corridors and the area right outside the hall.
  No setting fixes this: a smaller allowance turns away students who really are inside.
- **Faked GPS.** Fake-location apps (Android developer options) and desktop browser tools
  can report any position, and browsers do not tell websites a position is faked. A student
  doing this still needs the current screen QR, which a friend has to send within about a minute.
- **Leaving after marking.** A check-in records that the student was there when they
  marked, not that they stayed.

For those, the person taking attendance remains the last check: compare the count with the
room, and remove entries that look wrong.

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
