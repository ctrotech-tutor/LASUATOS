# LASUATOS

LASUATOS is a course and attendance platform for Lagos State University. The first academic scope is the Faculty of Engineering, with departments and role-scoped workspaces designed to grow across LASU.

## Current status

LASUATOS is in a pilot with real LASU students, running on Vercel and Neon at no cost (see [Deployment](docs/DEPLOYMENT.md)). What it does today:

- **Quick lecture attendance.** A lecturer, administrator or class rep (HOC, GHOC or their assistants) opens a session for a course on the course list and shows a QR code that changes every 30 seconds, or prints a fixed poster code. Students scan it with their phone camera (or type the short code) at `/a` and are marked with their own account. Optional checks, each recorded with the attendance: whether the phone was inside the venue's mapped boundary (on by default when the venue is mapped), a face match against the student's registered face, and a shared-phone flag. The person taking attendance can add or remove students by hand, always recorded. See [Lecture attendance](docs/LECTURE_ATTENDANCE.md) and [Face verification](docs/FACE_VERIFICATION.md).
- **Student accounts from class lists.** HOCs and administrators upload class lists; a student types their matric number, confirms with a code sent to their LASU student email (or with Google), and the account opens with the names on the list. Public sign-up with free-form details is off by default.
- **Registers and reports.** Course registers per term with each student's standing, attendance reports for administrators, spreadsheet downloads and printable registers.
- **Administration.** Staff join by email invitation and can be suspended, reactivated or given a new role or area; administrators edit faculties, departments and academic sessions, map venues, appoint class reps, read contact messages, and see one audit log of every change. Data retention runs on a schedule.
- **Operations.** A status page on Cloudflare (`status/`), email alerts when errors, refusals or failed backups pile up, encrypted nightly database backups ([Backups](docs/BACKUPS.md)), rate limits, and security headers.

The older enrolled-course tools (course offerings, join codes, enrolment, their attendance sessions, and disputes with an appeal to the department) are still in the product, hidden until someone uses them (ADR 020).

Limits worth knowing: a confirmed email proves only access to that mailbox, and matric numbers are not checked against LASU's records. Codes, QR scans, location and face matches record what happened at check-in; none of them proves presence or identity on its own, and report thresholds are planning aids, not eligibility rules. `pnpm load:pilot` measured a whole pilot morning on a local database (see [Load testing](docs/LOAD_TESTING.md)); that shows the code scales, not the live site's capacity.

No official institutional, student, staff, course or venue records are seeded. The guarded local setup creates only clearly labelled synthetic data under `LASUATOS local demo tenant`, including a demo faculty, department, academic session, semester and department-scoped lecturer account. These records are not LASU records.

## Local development

Requirements:

- Node.js 22.12 or newer in the Node 22 line
- pnpm 12.18.0, pinned through the `packageManager` field

```sh
pnpm install
cp .env.example .env
pnpm dev:setup
pnpm dev
```

`dev:setup` starts loopback-only PostgreSQL and Mailpit containers, applies the checked-in migrations to the guarded `lasuatos_dev` database, and creates synthetic local demo records only. It refuses remote databases and local database connections that do not match the dedicated Compose settings. Docker Engine with the Compose plugin is required. The example database password is for local development only.

Open the web workspace at `http://localhost:3000`. The API listens on port `4000`. Open `http://localhost:8025` to read confirmation emails captured by Mailpit. With the supplied local settings, messages are captured in Mailpit rather than sent to real inboxes.

The local demo tenant is named `LASUATOS local demo tenant`; it is not a LASU institutional record. The first seed run creates a demo lecturer at `lecturer@lasuatos.example.net` with a generated password printed once in the terminal. Save it for local testing; later setup runs neither reset nor reprint it. To select a fixed local password before first provisioning, set `LOCAL_DEMO_LECTURER_PASSWORD` (12–128 characters) in `.env`. Setup also invites a demo administrator, `admin@lasuatos.example.net`: open the invitation in Mailpit and choose a password.

To try attendance end to end:

1. As the administrator, open **Class list** (`/class-list`), pick the demo department and a set, and upload a few synthetic students (9-digit matric numbers, `@st.lasu.edu.ng` emails).
2. Open a student account at `/sign-up` with one of those matric numbers; the code arrives in Mailpit. Set `FACE_CHECK=off` in `.env` to skip the face check locally, or register a face when asked.
3. As the lecturer or administrator, open **Take attendance** (`/sessions`), start a session for a course on the course list, and open its QR screen.
4. On the student's browser, scan the QR or type the 6-character code at `/a`. The session's list shows the check-in.

Email confirmation verifies mailbox access only; the matric number remains unverified. Do not use real student data until the purpose and handling have been approved.

To review every email LASUATOS sends without sending any, run `pnpm --filter @lasuatos/api email:preview` and open `apps/api/email-previews/index.html`. It writes every email (34 today, HTML and plain text) with sample data. Their copy lives in `apps/api/src/email/messages.ts` and the shared layout in `apps/api/src/email/design.ts`.

To try account security locally, use **Forgot your password?** on the sign-in page; the reset email is captured in Mailpit. Signed-in users find **Security** in the header to see their sessions and change their password.

**If `dev:setup` says Docker's engine is not running** (on Windows the raw error mentions `dockerDesktopLinuxEngine`), start Docker Desktop and wait for "Engine running", check with `docker info`, then run `pnpm dev:setup` again. Docker Desktop on Windows needs WSL 2 (`wsl --install` in an administrator PowerShell, then restart).

To stop the local services while preserving the PostgreSQL volume, run `docker compose down`. Do not add `-v` unless you intend to delete the local database.

For an existing, separately authorized development database, set `DATABASE_URL` and `SELF_REGISTRATION_INSTITUTION_SLUG` yourself, apply migrations only after reviewing the target, and configure a server-side email provider such as Gmail via Nodemailer, Brevo or Resend. Do not point local development at production or an institutional system without authorization. See [Deployment](docs/DEPLOYMENT.md) and [Security](docs/SECURITY.md).

## Deploy for free

LASUATOS runs in production at no cost on Vercel Hobby (web app and API in one deployment), Neon Free (PostgreSQL) and free email (Brevo, a Gmail App Password, or Resend with your own domain). No card is needed. In short:

```powershell
copy .env.production.example .env.production      # fill in the Neon URL + email settings
copy config\institution.example.json config\institution.json
pnpm prod:migrate
pnpm prod:institution:setup
# import the repo on Vercel with Root Directory apps/web and the listed variables, then:
pnpm prod:check
pnpm prod:email:test --to you@example.com
pnpm prod:admin:bootstrap --email you@example.com --name "Your Full Name"
```

Follow [Deployment](docs/DEPLOYMENT.md) for the step-by-step guide, the exact variables and the free-plan limits. Vercel Hobby is for personal, non-commercial use, and Neon pauses when idle, so the first request after a quiet spell takes a moment.

## How lecturers and administrators get in

Students open their own accounts from the class lists. Staff accounts are created by invitation:

1. **First administrator (needs server access, once):** `pnpm admin:bootstrap --email you@lasu.edu.ng --name "Your Name" --scope institution`. Use `--scope faculty --faculty ENG` or `--scope department --department ECE` for a narrower first administrator. The link is emailed, and printed if email is not configured or with `--print-link`.
2. **Accept:** the invitee opens the link, sees the role and area, chooses a password, and is signed in. Accepting also confirms their email.
3. **Everyone else:** administrators open **Staff** (`/admin/staff`) and invite lecturers and administrators at or below their own level, inside their own area. Pending invitations can be resent or revoked; staff can be suspended (which signs them out on every device), reactivated, or given a new role or area, always with a reason that is recorded.

Locally, `pnpm dev:setup` runs step 1 for `admin@lasuatos.example.net`. Open the invitation in Mailpit (`http://localhost:8025`), accept it, and invite a lecturer from **Staff** to try the whole chain. See [Administration](docs/ADMINISTRATION.md) for the full rules.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm load:embedded      # optional: check-in burst on an embedded database, no server needed
```

`db:generate` updates the Drizzle migration from the schema. Review the generated SQL before applying it. `db:migrate` requires a configured PostgreSQL URL.

## Project map

```text
apps/
  api/                  Fastify API: accounts, class lists, attendance, administration, alerts, email
  web/                  Next.js app for students, class reps, lecturers and administrators (also serves the API on Vercel)
packages/
  auth/                 Password hashing, token helpers and scoped authorization
  contracts/            Shared Zod contracts for requests and answers
  database/             Drizzle schema, PostgreSQL client and migrations
  face/                 Face detection and matching, run in the browser and on the server
  verification/         Attendance codes, QR challenges and venue boundary checks
status/                 Independent status page (Cloudflare Worker and D1)
scripts/                Local setup, build, deploy-time migrations, load tests and backups
marketing/              WhatsApp launch material
docs/                   Product, architecture, security and operations notes
```

## Product and engineering notes

- [Product requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [API](docs/API.md)
- [Administrator access](docs/ADMINISTRATION.md)
- [Security and privacy](docs/SECURITY.md)
- [Lecture attendance](docs/LECTURE_ATTENDANCE.md)
- [Face verification](docs/FACE_VERIFICATION.md)
- [Venue system](docs/VENUE_SYSTEM.md)
- [Verification model](docs/VERIFICATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Backups and restore](docs/BACKUPS.md)
- [Testing](docs/TESTING.md)
- [Load testing](docs/LOAD_TESTING.md)
- [Pilot practice day](docs/PILOT_PRACTICE_DAY.md)
- [Design system](docs/design-system.md) and [UI audit](docs/ui-audit.md)
- [Status page](status/README.md)
- [Implementation plan and risk register](docs/IMPLEMENTATION_PLAN.md)
- [Technical decisions and LASU visual research](docs/DECISIONS.md)
- [Contribution guide](CONTRIBUTING.md)

## Naming and identity

The product name is **LASUATOS**. The interface uses a purpose-built wordmark and a restrained blue, ochre and charcoal palette. It does not use or recreate the University's coat of arms. The selected screen colors are product design tokens, not claimed official LASU color codes. See the visual research and source notes in `docs/DECISIONS.md`.
