# LASU administration

LASUATOS is scoped to Lagos State University. Its first academic area is the Faculty of Engineering. Departments, course offerings and administrator scopes sit beneath LASU, so more LASU faculties can be added without introducing other institution choices into the product.

## Who can get in, and how

| Who | How they get an account |
| --- | --- |
| Students | Sign up themselves at `/sign-up` and confirm their email. Public sign-up only ever creates student accounts. |
| The first administrator | Created by someone with server access running `pnpm admin:bootstrap` (see below). This is the only step that needs the server. |
| Every other administrator and every lecturer | Invited by email from the **Staff** page (`/admin/staff`) by an administrator whose area covers them. |

Everyone signs in on the same `/sign-in` page. After the password check, the API reads the account's role assignment from PostgreSQL and opens the matching workspace. There is no staff sign-up form, no role picker in the browser, and email domain never grants a role.

## Administrator scopes

- **Institution administrator.** LASU-wide.
- **Faculty administrator.** One LASU faculty and its departments.
- **Department administrator.** One LASU department.

System-wide administrator roles exist in the schema but are never exposed in the application and cannot be invited. One active administrator scope per account is supported. If legacy data contains several, the narrowest active scope is resolved first (department, then faculty, then institution) with a stable ID ordering; this is not a scope-selection mechanism.

## Who may invite and manage whom

The rule is **at or below your own level, inside your own area** (ADR 014). It was chosen as a sensible default and is easy to change in one file (`apps/api/src/staff/policy.ts`) if LASU decides otherwise.

| Signed-in administrator | May invite and manage |
| --- | --- |
| Institution administrator | Institution, faculty and department administrators and lecturers anywhere in LASU |
| Faculty administrator | Faculty administrators of their own faculty; department administrators and lecturers in that faculty's departments |
| Department administrator | Department administrators and lecturers of their own department |

- The rule is enforced on the server from the session's role assignment. Faculty and department ids sent by the browser are only accepted if they fall inside the administrator's area; anything else gets the same `403`, so ids cannot be probed.
- Nobody can suspend or reactivate their own account.
- Each administrator's staff list only shows the people they could manage, plus themselves.
- Lecturers are still assigned to course offerings the way they are now. An invitation gives a lecturer their department, not their courses.

## Step 0: set up the institution structure (once, then whenever it changes)

Before anyone can be invited into a faculty or department, or create a course, those rows must exist. Copy `config/institution.example.json` to `config/institution.json` and list the faculties, departments, campuses and buildings, plus the academic sessions and semesters. Then run:

```sh
pnpm institution:setup            # uses .env
pnpm prod:institution:setup       # uses .env.production (the free production setup)
```

- It creates missing rows and updates the names, dates and active flags of rows the file names. Rows not in the file are never changed or deleted.
- Everything happens in one transaction, so a problem saves nothing. The command explains what is wrong in the file.
- Department codes must be unique across the institution, because invitations and `admin:bootstrap` find departments by code.
- At most one session can be `"current": true`. Marking a session current clears that flag on the others.
- The file holds the university's structure only. Students, staff, courses and attendance are created by people using the app.
- Each department can set `"programmeYears"` (1–8, default 4), the normal length of its programme. It caps the level students see (for example a 5-year engineering programme shows up to 500 Level, then "extra year").

After the first setup you can make most structure changes in the app instead (next section). The file and the app work on the same rows; re-running the command only changes rows the file names.

## Changing the structure in the app (Academic structure page)

Administrators open **Academic structure** (`/admin/structure`). What each role may change:

| Action | Institution admin | Faculty admin | Department admin |
| --- | --- | --- | --- |
| Add, rename or deactivate faculties | Yes | No | No |
| Add departments | Any faculty | Own faculty | No |
| Rename a department or change its programme length | Yes | Own faculty | Own department |
| Deactivate a department | Yes | Own faculty | No |
| Add an academic session, make a session current | Yes | No | No |

- Nothing is ever deleted. Deactivating a faculty or department hides it from new invitations, course creation and the student department picker; existing courses, students and attendance stay.
- Department codes are unique across the institution, ignoring upper and lower case.
- A new session needs one to three semesters that fall inside it and do not overlap. Making a session current unsets the previous one; every student's level then moves on a year.
- Every change is written to `structure_audit_events` with who made it and a before/after diff. A trigger makes that table append-only.
- The page opens on the current session: which semester and week it is, and how long is left. Under it, **Needs a look** lists what to set up: no current session, a session that has ended, a session ending within 90 days with nothing after it, a faculty without departments, and departments with no lecturers, no class list, or no classes in 30 days mid-semester.
- Departments are listed by faculty with their lecturers, class list, signed-up students and recent classes. Tap one for its details, problems and actions; the address (`?department=ece`, `?faculty=eng`, `?session=2026-2027`) can be shared. **Changes** lists recent changes with who made them.
- **New session** fills in a year on from the latest session (code, dates and semesters); check the dates before adding it. Shortening a programme warns that students past the new last year show as an extra year, and that their face data becomes due for deletion sooner.

## Step 1: create the first administrator (server access)

Run on the server, or locally with a `.env` file:

```sh
pnpm admin:bootstrap --email registrar.ict@lasu.edu.ng --name "Ada Okafor" --scope institution
# a faculty or department administrator instead:
pnpm admin:bootstrap --email dean.eng@lasu.edu.ng --name "Tunde Bello" --scope faculty --faculty ENG
pnpm admin:bootstrap --email hod.ece@lasu.edu.ng --name "Ngozi Eze" --scope department --department ECE
```

- `--institution <slug>` picks the institution (default: `SELF_REGISTRATION_INSTITUTION_SLUG`). Faculty and department codes are matched without regard to letter case.
- The command creates an invitation with no inviting user (recorded as "server bootstrap command") and emails the link through the configured email provider.
- If no email could be sent, or `--print-link` is given, it prints the link. Treat a printed link like a password and give it only to that person.
- Exit codes: `0` created, `2` usage or configuration error, `3` the person already has an account or a pending invitation (safe to ignore when re-running setup), `1` anything else.
- The command only invites administrators, never lecturers.
- Quote a multi-word `--name`. If a shell drops the quotes (this happens on Windows through pnpm), the words straight after `--name` are still read as the name.

## Step 2: the invitee accepts

1. The email links to `/accept-invitation#token=…`. The token is in the URL fragment, which browsers never send to servers. The page removes it from the address bar and history and is served with `no-store` and `no-referrer`.
2. The page shows who invited them, the role and the area.
3. They choose a password (12–128 characters). In one database transaction the server:
   - creates the account as active;
   - marks the email as confirmed, because opening a link sent to that mailbox proves they control it;
   - creates the lecturer profile (department and staff number) for a lecturer;
   - creates the correctly scoped role assignment;
   - marks the invitation accepted and writes an audit event.
4. They are signed in and land in their workspace (`/lecturer/courses` or `/admin`). From then on they use `/sign-in` and the normal password-reset flow.

Links expire after **7 days** and work **once**. Acceptance is refused if, in the meantime, the email was registered, the staff number was taken, or the faculty or department was deactivated; the invitee is told to ask for a new invitation.

## Step 3: invite and manage staff (Staff page)

`/admin/staff`, linked as **Staff** in the administrator navigation.

- **Staff numbers** are the numbers LASU issues; LASUATOS never makes one up and the email
  address is what identifies a lecturer. A number can be entered at invitation, confirmed
  or corrected by the lecturer when they accept, or added once by the lecturer under
  **Account → Your details** if none is recorded. After that only an administrator can
  correct it (Edit on the Staff page; emptying the field removes a wrong number). Each
  number belongs to one lecturer.
- **Invite.** Enter the full name, email and role, then the faculty (faculty administrators) or department (department administrators and lecturers) and, for lecturers, the LASU staff number if you know it (optional). Only roles and areas you may grant are offered. An invitation is refused if the email already has an account, already has a pending invitation, or the staff number belongs to another lecturer. An expired invitation for the same email is closed automatically and replaced.
- **Pending invitations.** Shows sent and expiry times and who sent each one.
  - **Resend** issues a new link, restarts the 7 days and makes the old link stop working.
  - **Revoke** makes the link stop working.
- **Staff in your area.** Shows active and suspended staff.
  - **Suspend** needs a reason (10–500 characters). It blocks sign-in and **signs the person out on every device immediately**.
  - **Reactivate** needs a reason and lets them sign in again with their existing password.
  - **Change role or area** moves someone (a lecturer appointed HOD, an administrator moving department, a wrong role at invitation) without a new invitation. Choose the new role and area and why; **Review change** then shows what will happen before anything changes: the courses they stop teaching this semester (with how many other lecturers each has; "Nobody else" means add a lecturer from Courses), disputes waiting on those courses, and whether their workspace changes. You must be able to manage both where they are and where they are going. It is refused for your own account and while they are taking attendance. Past semesters keep their name; the change applies on their next tap, they are emailed, and it is in the Audit log.

## Class lists (Class lists page)

Student names come from the department, not from students: each class's HOC uploads the class list, and students open their accounts by typing their matric number. This keeps names and matric numbers consistent with the department's records.

**Who uploads.** A HOC sees **Class list** in their menu and manages their own department and set (entry year) only. A GHOC manages their faculty. Administrators open **Class lists** and can upload or fix any list in their scope on a HOC's behalf (for example when a HOC sends the Excel file by WhatsApp).

**How.**
1. Download the template (Matric number, JAMB number (Direct Entry without a matric number yet), Surname, First name, Middle name (optional), Email (optional), Entry level for Direct Entry only), or use the department's existing file: **Excel (.xlsx or the older .xls), Word (.docx or .doc), PDF, CSV, LibreOffice (.ods, .odt) or RTF**. The file is recognised by what is inside it, so a portal's "Export to Excel" download that is really a web page or CSV is read too. A workbook with several sheets shows the one with the most students and offers the others. A PDF is read by where the words sit on the page; scans and photos are refused, because a misread digit would put attendance on the wrong student (ask for the file the list was printed from). Title rows, a heading split over two rows and a mislabelled number column are handled, and certain slips are fixed and listed for checking: the letter O or I typed in a number, email typos (`gmial.com`, a comma for a dot, `st.lasu.edu`), "(DE)" after a name (saved as Direct Entry), titles before names and rows repeated word for word. Columns are found by their headings ("Matric No", "JAMB Reg No", "Surname", "Other names"…) or, without headings, by what is in them, and a single "Name" column is split (the all-capitals word is taken as the surname; guesses are flagged). In a Word document the tables are read (a list split over several pages is joined, repeated headings dropped); a document without tables is read line by line. **Paste** takes rows from Excel or Google Sheets, a Word or PDF list, or a WhatsApp message with one student per line ("1. 250211184 ODEJOBI Abraham"): it shows how many students it found, and how it read them, as you paste.
2. **Check** shows who will be added, updated or left as is, and any problems (missing names, malformed matric numbers, non-LASU emails, duplicates, a matric number already in another class). Nothing is saved until **Save**, and a list with problems is not saved at all.
3. Uploading again updates names and emails; students already on the list keep their accounts. Re-uploading is the easiest way to fix many entries.

**Direct Entry students without a matric number yet.** List them by their **JAMB registration number** (12 digits and 2 letters, e.g. `202530074987JA`), either in the matric column or in a JAMB column with the matric cell empty. They are saved as Direct Entry (200 level unless the entry column says 300) and marked *JAMB number* on the list. The email may be a personal one (Gmail, Yahoo…) while they have no LASU email. They open their account on the sign-up page with **Direct Entry, no matric number yet? Use your JAMB number**, are marked present by that number, and sign in with it.

When their matric number arrives, any of these moves them over, keeping the account, attendance, courses and face:
- the student adds it in **Account → Add my matric number** (the 9 digits and their LASU email; a code goes to the LASU email);
- the HOC opens the student and types the matric number in place of the JAMB number (allowed even after the account is open);
- an upload has both numbers on the row (matric and JAMB columns).
The JAMB number is kept and still signs them in. Attendance typed by hand under the JAMB number moves too.

**Following up.** Each student shows a stage: *Not joined*, *Joined*, *Email confirmed*, *Ready* (face registered). Search, filter by stage, fix a name or email, remove a student who has not joined, or view their registered face photo. Administrators can **reset a face** when the wrong person registered or the student asks for deletion; the student then registers again.

**Students don't change their own department or entry route.** Both come from the class list. A student on the wrong department's list, or listed as UTME when they came by Direct Entry, asks their HOC: open the student, choose **Wrong department** (then where they belong) or **Correct details** (entry route). The account and attendance move with them. A HOC or GHOC can move a student between departments in their faculty; across faculties takes an institution administrator. A student holding a rep post must be removed from it first.

**Assistants (AHOC, AGHOC).** Each HOC and GHOC can choose up to two assistants from their own class on the **Assistants** page. Every assistant takes attendance; the HOC or GHOC chooses whether they also see the registers, keep the class list, give setup codes or (for a GHOC's assistant) appoint HOCs. Administrators and the set's GHOC can manage a HOC's assistants too: open the rep on **Class reps**, then **Assistants**. Replacing or removing a HOC or GHOC ends their assistants' appointments, so the new rep picks their own.

**When a student says "my matric number is not found"**, add them (one row upload or the list editor), and they can open their account straight away.

**When a student cannot get in.**
- *Forgot password* (account with a confirmed LASU email): they reset it themselves. On the sign-up page they type their matric number, then **Reset my password** (a code goes to their LASU email) (or use *Forgot password* with their email or matric number).
- *Cannot open their LASU mailbox*, or *"someone already opened an account with my matric number"* when that account never confirmed a LASU email: the HOC taps **Give setup code** (ticket icon) on the student's row and hands the code over in person or by direct message. It works once, for 30 minutes. The row then shows **Setup code** until the student confirms their email.
- *The wrong person confirmed the account* (the list had someone else's LASU email, or they got in another way): an administrator checks the student's ID, then taps **Release account** on the row, enters the student's correct LASU email and a reason. Whoever had it is signed out and cannot sign in again, the face they registered is deleted and they are told by email; the student then opens the account with a code to the corrected email (or a setup code). Attendance marked meanwhile stays on the account: check it in the registers. HOCs cannot release accounts.

**Settings.** `STUDENT_SIGN_UP=class_list` (default) turns off the old free sign-up form; `open` brings it back. `FACE_CHECK=off` turns off face registration and the face check (see [FACE_VERIFICATION.md](FACE_VERIFICATION.md)).

## Audit trail

Structure changes go to `structure_audit_events` (see above). Every invitation created, resent, revoked or accepted, and every suspension and reactivation, is written to `staff_audit_events` with the acting user (null for the bootstrap command), the affected user or invitation, the reason where one is required, and the time. A database trigger rejects any update or delete, so the trail is append-only. Class-list imports and edits, account openings and takeovers, setup codes, password resets with a code, account releases, email confirmations, face registrations and resets, refused duplicate faces and failed face checks go to `student_audit_events` (append-only in the same way); the latest class-list changes are also shown under **History** on the Class lists page.

**Audit log page** (*Records → Audit log*, `/admin/audit`). Every trail in one list, newest first and grouped by Lagos day: who did what, to whom and when, in plain words.

- **The week at a glance.** Changes in the last 7 days against the week before, how many are *worth a look*, how many people made changes, and the kind of change made most.
- **Worth a look.** Changes that take something away from a person or hand an account to someone else are highlighted, and the newest five are listed at the top: accounts released or taken over, faces reset or refused, check-in photos rejected, students removed from a lecture or a class list, staff suspended or given another role, faculties or departments switched off. Nothing about them is blocked.
- **Filters.** Narrow the list by kind (chips with counts), by period (today, 7 or 30 days, or chosen dates), by *Worth a look*, or by search: a matric number, name, email, course, venue or department.
- **One entry.** Opening an entry shows what changed (old value → new value), the reason given, buttons to the page it touched (the register, class list, structure or venue), *Everything by them* (only that person's changes), *Everything about …* (the whole history of a student, course or room) and the stored record exactly as kept. Every view, including one entry, has its own link.
- **Download CSV.** Saves the current filters as a spreadsheet, up to 5,000 rows. It holds personal data, so keep it private and delete it when you are done.
- **Who sees what.** Institution administrators see everything. Faculty and department administrators see their own area's student, face and attendance events, changes to their faculty or department, and the staff, structure and venue changes they made themselves.
- **Never shown, never changed.** Photos and face measurements never appear. Entries cannot be edited or deleted.

## Face checks and help requests

- **Face checks** (`/face-checks`, also a tab on *Take attendance*): check-ins whose face matched, but not clearly. Lecturers see their own sessions, administrators their area. Compare the check-in photo with the registered one, then **Approve** or **Reject** (a reason is required; the check-in is removed). Class reps cannot review.
- **Help requests**: a student whose face check fails twice at a lecture can ask to be added. The request shows at the top of the session page with the student's registered photo; the person taking attendance taps **Add** or **Decline**.
- **New photos**: students take new face photos themselves on *Account security* (password + LASU email code, and the new photos must match the old face). Use **Reset face** on the class list only when the registered face is of the wrong person.

See [FACE_VERIFICATION.md](FACE_VERIFICATION.md) for the details.

## Messages from the contact page

*Administration → Messages* (`/admin/messages`) is for institution administrators only. Messages people send from the public contact page (questions about using LASUATOS, problems, account trouble, privacy requests) land here, and every active institution administrator also gets an email with the message and an **Open this message** button. Reply from your own email app: **Reply by email** opens a draft with the reference in the subject and their message quoted.

- **Reply dates.** The contact page promises a reply within two working days; a message turns *Overdue* after that. Privacy requests (a copy of their data, a correction, deleting their face data) must be answered within 30 days under the NDPA. They sit at the top under *Needs a look*.
- **Privacy and account requests.** If the sender was not signed in, confirm it is really them before acting (**Ask them to confirm it's them** drafts the email). Do what they asked, then reply.
- **Handled.** When it is dealt with, write a short note on what was done and tap **Mark handled**; the next new message opens. The note, who handled it and when are kept with the message. **Move back to new** if it needs more work.
- **Finding a message.** Search a name, email address, words from the message or its reference (`LA-7K3P9Q`), or filter by topic.
- **Kept for.** Handled messages are deleted a year after they were handled, and any message two years after it arrived, by the nightly clean-up.

## Data retention

*Administration → Data retention* (`/admin/retention`) shows what is due now and when the nightly clean-up takes it, what is stored (faces, faces on no class list, check-in photos), every set from two years before its faces are due until they are cleared (grouped as *Due now*, *Kept for now*, *Coming up* and *Cleared*), the recent runs and the rules. Open a set to see each student on its class list: whose face goes at the next run, who keeps it because they still check in (and until when), and who never registered one. Faculty and department administrators see their own area.

- A set's registered faces are deleted `RETENTION_GRACE_MONTHS` (default 12) months after its final session ends. The end is worked out from the entry year (matric number) and the department's programme length, on 1 September.
- A student who checked in to a lecture in the last `RETENTION_ACTIVE_DAYS` (default 180) days keeps their face (an extra year or carry-over courses).
- Check-in photos kept for face reviews are deleted after `RETENTION_CHECK_PHOTO_DAYS` (default 90) days.
- Accounts, class lists and attendance records are kept; a student who comes back can register their face again.
- It runs by itself every night at 02:30 UTC (03:30 in Lagos) when `CRON_SECRET` is set (see [DEPLOYMENT.md](DEPLOYMENT.md)). Institution administrators can also run it from the page; others see the preview only. Each run is written to the audit log.

## Local demo

`pnpm dev:setup` runs the bootstrap command for `admin@lasuatos.example.net` (institution scope) after seeding the demo tenant. The invitation lands in Mailpit (`http://localhost:8025`) and the link is also printed. Open it, choose a password, and you are the demo institution administrator. From the Staff page you can then invite a lecturer or a faculty or department administrator for the demo faculty, open their invitation in Mailpit, and try the whole chain, including suspension. Re-running setup does not create a second invitation. The seeded demo lecturer (`lecturer@lasuatos.example.net`) still exists for quick testing.

## Workspace overview

`GET /api/v1/admin/overview` returns active department, student, lecturer, course-offering and enrollment counts plus **Students by level** (levels worked out from matric numbers, with "Level unknown" for numbers that cannot be read), and `GET /api/v1/admin/attendance` returns attendance rates and open disputes. Both are filtered by the administrator identity resolved from the HttpOnly session cookie and accept no role, institution, faculty, department or account identifiers from the browser. Responses are private and not cached.

Apart from staff provisioning, the venue directory and the academic structure page, the administrator workspace is read-only. Student names and matric numbers come in through class lists (see *Class lists* above).

## What this does not do

- It does not connect to LASU's student records system. Class lists are as accurate as the HOC's upload; every change is audited with who made it. Student levels are worked out from the matric number (and Direct Entry level on the list).
- It does not verify that an invited person is really LASU staff. The administrator who sends the invitation vouches for that, and the audit trail records who did.
- There is no single sign-on, and no administrator-assisted recovery for staff who lose their mailbox.
- Changing an existing person's role or area is not supported in the product yet; it needs an authorized database change. Suspension is available immediately if access must stop.
