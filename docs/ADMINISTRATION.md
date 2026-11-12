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

- **Invite.** Enter the full name, email and role, then the faculty (faculty administrators) or department (department administrators and lecturers) and, for lecturers, the staff number. Only roles and areas you may grant are offered. An invitation is refused if the email already has an account, already has a pending invitation, or the staff number belongs to another lecturer. An expired invitation for the same email is closed automatically and replaced.
- **Pending invitations.** Shows sent and expiry times and who sent each one.
  - **Resend** issues a new link, restarts the 7 days and makes the old link stop working.
  - **Revoke** makes the link stop working.
- **Staff in your area.** Shows active and suspended staff.
  - **Suspend** needs a reason (10–500 characters). It blocks sign-in and **signs the person out on every device immediately**.
  - **Reactivate** needs a reason and lets them sign in again with their existing password.

## Audit trail

Structure changes go to `structure_audit_events` (see above). Every invitation created, resent, revoked or accepted, and every suspension and reactivation, is written to `staff_audit_events` with the acting user (null for the bootstrap command), the affected user or invitation, the reason where one is required, and the time. A database trigger rejects any update or delete, so the trail is append-only. There is no in-product viewer yet; read it with SQL.

## Local demo

`pnpm dev:setup` runs the bootstrap command for `admin@lasuatos.example.net` (institution scope) after seeding the demo tenant. The invitation lands in Mailpit (`http://localhost:8025`) and the link is also printed. Open it, choose a password, and you are the demo institution administrator. From the Staff page you can then invite a lecturer or a faculty or department administrator for the demo faculty, open their invitation in Mailpit, and try the whole chain, including suspension. Re-running setup does not create a second invitation. The seeded demo lecturer (`lecturer@lasuatos.example.net`) still exists for quick testing.

## Workspace overview

`GET /api/v1/admin/overview` returns active department, student, lecturer, course-offering and enrollment counts plus **Students by level** (levels worked out from matric numbers, with "Level unknown" for numbers that cannot be read), and `GET /api/v1/admin/attendance` returns attendance rates and open disputes. Both are filtered by the administrator identity resolved from the HttpOnly session cookie and accept no role, institution, faculty, department or account identifiers from the browser. Responses are private and not cached.

Apart from staff provisioning, the venue directory and the academic structure page, the administrator workspace is read-only. The roster preflight at `/setup/roster` is an operator utility that reads a CSV in the browser only; nothing is imported.

## What this does not do

- It does not check students' matric numbers against LASU records, and there is no official roster upload; both are out of scope by decision. Student levels are worked out from the matric number and shown as self-reported.
- It does not verify that an invited person is really LASU staff. The administrator who sends the invitation vouches for that, and the audit trail records who did.
- There is no single sign-on, and no administrator-assisted recovery for staff who lose their mailbox.
- Changing an existing person's role or area is not supported in the product yet; it needs an authorized database change. Suspension is available immediately if access must stop.
