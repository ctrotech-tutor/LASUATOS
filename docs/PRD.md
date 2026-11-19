# Product requirements

## Purpose

LASUATOS is intended to reduce the time lecturers spend taking attendance while creating a more useful, traceable record for students and authorized administrators. The initial pilot scope is the Faculty of Engineering at Lagos State University. LASUATOS runs in production on free plans (ADR 015) and is being piloted with real students. There is still no institutional identity source (records come from the class lists departments upload), and formal institutional approvals for data handling are outstanding.

## User problem

Paper registers and name-by-name roll calls take lecture time, are difficult to reconcile across large classes and make historical reporting tedious. A digital record can improve speed and retrieval, but attendance must not be treated as certain merely because a phone sent a coordinate or scanned a shared image.

## Product outcome

A student should be able to complete a legitimate check-in quickly. A lecturer should be able to create a lecture-specific attendance window, monitor confirmed records and review uncertain cases. Authorized administrators should be able to manage the academic and venue records that make those decisions meaningful.

## Product principles

1. Record evidence and uncertainty separately from the final attendance decision.
2. Enforce identity, course assignment and administrative scope on the server.
3. Confirm attendance only after a database transaction commits.
4. Do not silently rewrite historical records.
5. Collect location only for a verification event, never as continuous background tracking.
6. Provide a fair retry or human-reviewed fallback when location evidence is inconclusive.
7. Keep production records separate from any clearly labeled demonstration environment.
8. Make current capability and missing institutional integrations visible.

## Roles

- **Student.** Opens an account from the class list (matric number, or a JAMB number until the matric number arrives; ADR 022), marks attendance with their own account and face, and sees only their own records.
- **Class representatives.** A HOC keeps their department's class list for one set and takes attendance; a GHOC does the same across a faculty and may appoint the set's HOCs. Each may choose up to two assistants (AHOC, AGHOC) with chosen permissions (ADR 018, ADR 021). Class reps are students with an extra post, not staff.
- **Lecturer.** Takes attendance for any course on the course list, keeps registers, reviews face matches and disputes.
- **Administrators** at department, faculty or institution level. Every power is limited to their area (ADR 004). System-wide administration is not exposed.

Staff join only by invitation (ADR 014) and can later be given a new role or area in place (ADR 025). Public sign-up cannot grant any staff role or class-rep post. A course-coordinator role was planned early on and has not been built.

## Student accounts

Students do not sign up with free-form details. A HOC or administrator uploads the class list from the files the department already has (ADR 024); the student types their matric number, confirms a code sent to the LASU student email on the list (or confirms with Google, ADR 027), and the account opens with the names from the list. HOCs can also give a one-time setup code to a student who cannot reach that mailbox. The list owns the student's department and entry route (ADR 021).

A confirmed email proves access to that mailbox only. Matric numbers are checked for shape, not against LASU's records. ADR 033 balances security with the student's first morning: a starting password cannot change the password without the emailed code or Google, and every check-in checks the face, so a guessed password alone cannot mark anyone present.

The older free-form sign-up (any email, self-reported matric number; ADR 008) is still in the code behind `STUDENT_SIGN_UP=open`, off by default.

## Attendance

**Quick lecture sessions** are how attendance is taken. Whoever takes attendance picks a course from the course list, optionally a venue, and how long attendance stays open (5 to 360 minutes). The screen shows a QR code that changes every 30 seconds (a screenshot forwarded to a friend stops working within about a minute), or a fixed poster code for rooms without a projector. The student scans it with their phone, signs in if needed, takes two face photos, and is marked once; repeating returns the same record.

Each check-in records its evidence beside the decision:
- **Venue.** When the session's venue has a mapped boundary, the phone's position is checked against it (on by default; ADR 033). Only a confirmed position inside the boundary, or within its small allowance, gets through; every refusal says what to do, and the person taking attendance can add the student by hand. A refusal is not treated as misconduct.
- **Face.** Two photos are matched against the student's registered face on the server; close matches are kept for a lecturer to review (`docs/FACE_VERIFICATION.md`). A student whose face check keeps failing can ask to be added by hand.
- **Phone.** Two students on one phone are flagged as a prompt to look; a third is refused.

The person taking attendance can add a student by hand (class reps only while attendance is open, from inside the venue, at most 10 per class) or remove one with a reason; both stay visible and audited. Rules are in `docs/LECTURE_ATTENDANCE.md`.

**Registers and reports.** Each course has a register per term with every student's standing against a threshold described as a planning aid, downloadable for Excel and printable. Administrators see attendance by course and department across their area.

**When a record is wrong.** In a lecture session, a student whose face check keeps failing asks to be added by hand, and the person taking attendance adds or removes students with a recorded reason. A removed student sees the reason on their attendance page and speaks to whoever took the attendance.

**The older enrolled-course workflow** (course offerings, join codes, enrolment, and their own attendance sessions with `lasu1` QR codes) is still in the product, hidden until someone uses it (ADR 020). It has formal disputes: a student can raise a concern about a missing or removed check-in within 14 days, the course's lecturer decides it with a note the student sees, upholding records the student present through the audited correction path, and a rejected dispute can be appealed once to the department (ADR 026). A statement is a request for review, not evidence, and a rejection is not a misconduct finding.

## How a lecture works today

1. An administrator sets up the faculties, departments, academic session and venues, and appoints class reps; HOCs upload their class lists.
2. Students open their accounts from the list and register their face once.
3. In the lecture, the lecturer or class rep opens a session and shows the QR code.
4. Students scan, sign in if needed, take the face photos, and allow location when the venue is checked.
5. The server checks the code, the session, the account, the face and the location in that order, and records one entry per student.
6. The taker sees the list fill in live, adds or removes anyone by hand, and closes the session (or lets it end on time).
7. Students see their own attendance and missed lectures; lecturers and administrators see registers and reports.

Neither a code, a QR scan, a location reading nor a face match may be described as proof of presence on its own.

## Out of scope for the first pilot

- Full timetable management.
- Continuous or background student tracking.
- Identifying students from a crowd or a photo of the room. The face check compares one student with their own registered face, with their consent (ADR 033), and nothing else.
- Browser-based BLE scanning as a universal requirement.
- Claims that GPS, a static marker or Wi-Fi alone proves classroom presence.
- Microservices, a dedicated worker fleet or Redis before a measured need exists.

## Acceptance measures

Targets from the product brief were 1,000 simultaneous users, 500 check-in requests in 30 seconds, p95 API latency below 500 ms, zero duplicate confirmed records and zero lost committed records. The local load tests (`docs/LOAD_TESTING.md`) measure the code against these on a loopback database, including a full pilot morning (`pnpm load:pilot`). They are not measurements of the live site, which runs on free plans with their own limits; the practice day in `docs/PILOT_PRACTICE_DAY.md` checks the real phones and network.

## What is not built

- Checking students against LASU's records, or importing from LASU systems.
- Disputes and appeals for quick lecture sessions (they exist only for enrolled courses), and an appeal step beyond the department.
- Timetables.
- A course-coordinator role.

See `docs/IMPLEMENTATION_PLAN.md` for the risks still open, and `docs/SECURITY.md` and `docs/ADMINISTRATION.md` for current boundaries.
