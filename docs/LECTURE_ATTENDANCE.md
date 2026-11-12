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
4. Optionally pick a venue and require students to be inside it (location is checked once).

The student list updates live. You can remove an entry (with a reason), restore it, extend by 15 minutes, close, reopen, switch the QR type, and export CSV for Excel. Entries made on the same phone as other students are flagged.

## Marking attendance (`/a`)

Students scan the QR code with their phone camera, or open `/a` and type the code.
- **Without an account**: they type their full name and matric number. These can be remembered on the phone.
- **Signed in**: one tap. Earlier guest entries with the same matric number are attached to the account.

Lectures marked this way appear under "Lectures you marked" on `/attendance`.

## Production

Migrations `0012`–`0014` must be applied before deploying: `pnpm prod:migrate`.

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
