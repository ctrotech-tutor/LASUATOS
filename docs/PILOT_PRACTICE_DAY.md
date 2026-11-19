# Pilot practice day (real phones)

The load rehearsals (`docs/LOAD_TESTING.md`) prove the server and database hold a pilot morning. They cannot show what only real people on real phones in a real hall show: cameras in poor light, GPS indoors, campus Wi-Fi, low-end Android phones, emails arriving (or not), Vercel and Neon waking up, and where people get confused. One practice day with a small group, a week or two before the pilot, finds those while they are cheap to fix.

This is normal use of the live site by a small group. It is not a load test: never point a load script at the live site.

## Who and what

- **People:** the lecturer (or an administrator acting as one), the class's HOC, and **15–30 students** from the pilot class. One person (not the lecturer) keeps the record sheet below.
- **Phones, on purpose a mix:** at least two low-end Android phones (2–3 GB RAM, a few years old), one older iPhone, Chrome on Android and Safari on iPhone, one phone with Data Saver on, one with location set to *approximate*. Note each phone's model and browser on the sheet.
- **Networks:** half on campus Wi-Fi (the shared address the rate limits are sized for), half on mobile data.
- **Place:** the hall the pilot uses, with its venue registered (`/admin/venues`) and a projector or a laptop for the QR code. Ten minutes outside the hall are needed too (see *Edge cases*).
- **Time:** about two hours.

## A few days before

- [ ] The practice students are on the class list (Class lists page), with their LASU emails where known.
- [ ] The venue is registered with its outline, and a test session with that venue switches **Students must be in the venue** on by itself.
- [ ] The course is on the course list (`/admin/courses`).
- [ ] *Records → System health* shows everything working: email providers, database, backups (last night's backup ran and was verified), no open alerts. `ALERT_EMAIL` is set.
- [ ] The status page (https://lasuatos-status.lasuatos.workers.dev) is green.
- [ ] `FACE_CHECK` is set as it will be for the pilot (normally `required`).
- [ ] The HOC knows how to **Give setup code** and how to **Add student** by hand.
- [ ] Students are told to bring their own phone, charged, with the LASU email password they actually know.

## On the day: the run sheet

Times are guides. Write down anything that surprised anyone, even when it worked in the end.

### 1. Opening accounts (about 20 minutes)

Everyone who has not opened their account does it now, on their own phone, at the same time.

- [ ] Most open with their matric number and the code sent to their LASU email. **Record how long each email took to arrive** and which inbox it went to (inbox, spam, *Promotions*).
- [ ] Two or three get a **setup code** from the HOC instead (as for a student who cannot open their LASU mailbox).
- [ ] Students who already have an account sign in with their **matric number** and the starting password, at least one typing it in lower case or with spaces.
- [ ] Anyone on the starting password chooses their own.
- [ ] A Direct Entry student without a matric number yet (if there is one) opens with their JAMB number.

### 2. Face registration (about 15 minutes)

- [ ] Everyone registers their face. Watch for: bright windows behind them, dim corners, glasses, hijabs and caps, very dark or very light skin under the hall's lighting, cracked or dirty front cameras.
- [ ] On the oldest phone, check whether the live guide loads or the camera falls back to *Use a countdown instead*. Both must work.
- [ ] **Record every refusal and the exact message shown**, and whether the second try worked.

### 3. A real lecture check-in (about 20 minutes)

- [ ] The lecturer opens a session with the **dynamic QR on the projector** and the venue check on.
- [ ] Everyone scans within the first two minutes, as they would at 8 a.m. **Record the time from opening to the last student marked**, and how many needed more than one try.
- [ ] Ask each student what the location card said ("accurate to ±X m"). Note the readings: indoor GPS decides how generous the venue outline must be.
- [ ] One student whose face check fails twice uses **Ask to be added**, and the lecturer adds or declines them from the session page.
- [ ] One student marks a classmate on their phone (*A classmate without their phone?*). A third student on the same phone must be refused.
- [ ] The lecturer compares the list with a head count.

### 4. Edge cases (about 20 minutes)

- [ ] A student **outside the hall** (corridor, then 50 m away) tries to check in. Expect refused, with a message saying how far away they are.
- [ ] A photo of the QR code sent on WhatsApp to someone outside: refused (venue), and stale after about a minute anyway.
- [ ] A phone with location permission **denied**: the message must say how to turn it on.
- [ ] A phone that loses its connection in the middle of a check-in (airplane mode on, then off): it should retry by itself and end with the student marked once.
- [ ] The HOC adds a student by hand from inside the hall, then tries again after the session has closed (refused: only the lecturer can then).
- [ ] Everyone reloads **My attendance** at the same moment. It should load within a few seconds.
- [ ] Two or three students add LASUATOS to their home screen and open it from there.
- [ ] The lecturer adds a **passkey** in Account (ADR 037), signs out, and signs back in with it; then signs in once with the password and checks the "signed in with your password" email arrives.

### 5. Afterwards (about 15 minutes)

- [ ] Students check **My attendance**: today's lecture shows as attended, with the right course and venue.
- [ ] The lecturer downloads the register (CSV) and checks it against the head count.
- [ ] Any close face matches appear on **Face checks** for the lecturer to approve or reject.
- [ ] *System health* and the status page: no server errors, no alerts, no rate-limit refusals that were not expected.
- [ ] In Vercel, *Usage → Functions → Active CPU* for the hour, and in Neon the compute used: note both, to estimate a full pilot week (see `docs/DEPLOYMENT.md`).

## The record sheet

One row per student per step (a shared spreadsheet works well):

| Phone (model, browser) | Network (Wi-Fi / data) | Step | Seconds | Worked first time? | Message shown, in their words | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## Ready for the pilot when

- At least **95% of the students present are marked within 3 minutes** of the session opening, and the list matches the head count with nobody marked twice.
- **No server errors** on System health or the status page during the day.
- At least **90% register their face within two tries**, and everyone who could not was helped by a path that exists (countdown camera, *Ask to be added*, the HOC adding them by hand).
- Account emails arrive within **2 minutes** for most students, and the setup code got in everyone whose email did not.
- **Every refusal told the student what to do next**, in words they understood.

Anything that misses one of these becomes an issue to fix before the pilot, with the record-sheet rows attached.

## If something goes wrong on the day

| Problem | What to do now |
| --- | --- |
| The face check refuses many students in that hall's light | Keep going with *Ask to be added*. Note the lighting and the phones. If it is widespread, `FACE_CHECK=off` in Vercel for the pilot and redeploy (see `docs/FACE_VERIFICATION.md`, *Switching it off*). |
| Students inside the hall are refused as outside | Check the location readings on the sheet. Turn **Students must be in the venue** off for that session (edit the session) and widen the venue's outline afterwards. |
| Emails do not arrive | The HOC gives setup codes. Check the email providers on *System health*. |
| "Too many requests" | Note the time and the step. These are the per-address pilot limits (`docs/SECURITY.md`); the sheet shows whether they need raising before the pilot. |
| The site is slow or down | Check the status page and *System health*. The lecturer can extend the session by 15 minutes, and the HOC can add students by hand while it recovers. |
