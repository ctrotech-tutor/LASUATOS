# Deployment

LASUATOS can run in production at no cost on three free plans. No card is needed for any of them:

| Piece | Service (free plan) | What it does here |
| --- | --- | --- |
| Web app **and** API | [Vercel](https://vercel.com) Hobby | Serves the pages and `/api/v1` from one deployment, with HTTPS and a `*.vercel.app` address |
| Database | [Neon](https://neon.tech) Free | Managed PostgreSQL 17 |
| Email | [Brevo](https://www.brevo.com) Free (recommended), Gmail (App Password), or Resend Free | Sign-up confirmation, password reset and staff invitation emails |

The API does not need its own server. With `API_MODE=embedded`, the Next.js route `apps/web/app/api/v1/[...path]/route.ts` runs the same Fastify app inside a Vercel function. Requests get the same routes, validation, rate limits, cross-site protection and security headers as the standalone server (ADR 015). The local development setup is unchanged.

## Free-plan limits

These figures were checked in November 2026. Free plans change, so confirm them on each provider's pricing page.

- **Vercel Hobby is for personal, non-commercial use.** A student project, demo or small pilot fits. If the university adopts LASUATOS officially, it should move to Vercel Pro or its own server (see [Other hosts](#other-hosts)).
- Vercel Hobby includes, per month:
  - 1 million function calls;
  - 4 hours of active CPU time;
  - 100 GB of data transfer.

  Nothing is billed when you go over. The feature pauses until the next cycle instead.
- Vercel runtime logs are kept for **1 hour**. Look at errors soon after they happen.
- Neon Free allows **0.5 GB of storage** and **100 compute-hours a month** per project. That is about 400 hours of the smallest compute size, which a class-sized pilot fits easily.
  - Neon pauses the database after **5 idle minutes**. The first request after a pause waits about half a second to a few seconds while it wakes. This is normal.
  - If the monthly compute is used up, the database stops until the next month. If storage fills up, new writes are refused.
  - Point-in-time restore covers only the last **6 hours**. Take your own backups if the data matters (see [Backups](#backups)).
- Brevo Free sends **300 emails a day**. If a large class signs up on the same day, some confirmation emails will wait until the next day. Students can press **Resend** later.
  - Gmail with an App Password is another free option, at about 500 a day.
  - Brevo adds its logo to the bottom of free-plan emails.
- None of these plans has an uptime guarantee.

## What you need

- The repository on GitHub. It is already at `ctrotech-tutor/LASUATOS`.
- Node 22 and pnpm, which you already use locally.
- About 30 minutes.

All the commands below work in Windows PowerShell from the repository folder.

## Step 1: Create the database (Neon)

1. Go to <https://neon.tech> and sign up. "Continue with GitHub" is quickest.
2. Create a project:
   - **Name:** `lasuatos`
   - **Postgres version:** 17
   - **Region:** AWS Europe Central 1 (Frankfurt), the same region as the Vercel functions in `apps/web/vercel.json`
3. Open **Connect**, switch on **Connection pooling**, and copy the connection string. It contains `-pooler` and ends with `?sslmode=require`.

## Step 2: Set up email

Pick one of these options:

| Option | Free limit | What you need |
| --- | --- | --- |
| **Brevo** (recommended) | 300 a day | A Brevo account and one verified sender address. No domain needed. Sends over HTTPS, so networks that block mail ports do not stop it. |
| **Gmail** | about 500 a day | A Gmail account with 2-Step Verification and an App Password. No domain needed. Uses the mail port 465, which some networks block. |
| **Resend** | 100 a day | A **domain you own**, verified in Resend with DNS records. Without a domain, Resend only delivers to your own Resend login address, so students would never get their confirmation emails. |

### Brevo

1. Go to <https://www.brevo.com> and create a free account.
2. Go to **Settings → Senders, Domains & Dedicated IPs → Senders → Add a sender**. Enter the address emails should come from, for example your Gmail, then click the confirmation link Brevo sends you. (The address you signed up with is often already listed.)
3. Go to **Settings → SMTP & API → API Keys → Generate a new API key**, and copy the key. It starts with `xkeysib-`. The SMTP key (`xsmtpsib-…`) on the same page does **not** work here.
4. Open <https://app.brevo.com/security/authorised_ips> and click **Deactivate blocking**. Vercel has no fixed IP address, so with blocking on, Brevo refuses every email from the live site with "unrecognised IP address".
5. Use these settings:
   - `EMAIL_PROVIDER=brevo`
   - `BREVO_API_KEY=` the `xkeysib-…` key
   - `EMAIL_FROM_ADDRESS=` exactly the sender address from step 2

Brevo may ask you to confirm your account details before it sends. Answer those prompts. They do not involve payment.

A free address such as `@gmail.com` cannot be authenticated by Brevo, so Brevo shows the email as coming from a substitute address such as `you@….t-sender-sib.com`, still with the name `LASUATOS`. Emails are delivered, but some may land in spam. Sending from your own domain, authenticated in Brevo, fixes this when you have one.

### Gmail

1. Turn on 2-Step Verification at <https://myaccount.google.com/security>.
2. Open <https://myaccount.google.com/apppasswords>, create an App Password named `LASUATOS`, and copy the 16 characters.
3. Use these settings:
   - `EMAIL_PROVIDER=gmail`
   - `GMAIL_USER=` your Gmail address
   - `GMAIL_APP_PASSWORD=` the App Password (never your normal Google password)

   Emails come from your Gmail address.

## Step 3: Prepare the database from your computer

```powershell
copy .env.production.example .env.production
copy config\institution.example.json config\institution.json
```

Open `.env.production` and fill in these values:

- `DATABASE_URL`: the Neon pooled connection string.
- The email settings for the option you picked in step 2.
- Leave `PUBLIC_APP_URL` as it is for now. You will set it after the first deploy.

`.env.production` is git-ignored. Never commit it.

Next, open `config/institution.json` and check the faculties, departments, campus and academic calendar. It ships with the Faculty of Engineering and its six departments (Aeronautical and Astronautical, Chemical and Polymer, Civil, Electronic and Computer, Industrial and Systems, Mechanical; all 5-year programmes) at the Epe campus, and the 2026/2027 session. Add or rename entries as needed:

- Codes must be unique.
- Department codes must be unique across the whole institution.
- Dates need a time zone offset (`+01:00` is Lagos time).

This file contains only the university's structure. Students, lecturers, courses and attendance are created by people using the app.

Then run:

```powershell
pnpm prod:migrate
pnpm prod:institution:setup
```

What each command does:

- `prod:migrate` creates all the tables.
- `prod:institution:setup` creates LASU and the structure listed in the file.

Both commands are safe to run again. Edit the JSON and re-run `prod:institution:setup` whenever you add a department or a new session. It updates the rows the file names and never deletes anything.

After this first setup, administrators can also add departments, change programme lengths and start new sessions from **Academic structure** in the app (see `docs/ADMINISTRATION.md`). Each department may set `"programmeYears"` in the file (default 4); it caps the level students see.

## Step 4: Deploy (Vercel)

1. Go to <https://vercel.com> and sign up with GitHub.
2. Choose **Add New… → Project**, then import `ctrotech-tutor/LASUATOS`.
3. Set **Root Directory** to `apps/web` and leave the framework as Next.js. The build and install commands come from `apps/web/vercel.json`, and Node 22 comes from `apps/web/package.json`.
4. Open **Environment Variables** and add the following:

   | Name | Value |
   | --- | --- |
   | `API_MODE` | `embedded` |
   | `DATABASE_URL` | the Neon pooled connection string |
   | `SELF_REGISTRATION_INSTITUTION_SLUG` | `lasu` (the `slug` in `config/institution.json`) |
   | `RATE_LIMIT_STORE` | `postgres` |
   | `EMAIL_PROVIDER` | `brevo` (or `gmail` / `resend`) |
   | `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS` | for Brevo (mark the key **Sensitive**) |
   | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | for Gmail, instead of the Brevo values (mark the password **Sensitive**) |
   | `EMAIL_FROM_NAME` | `LASUATOS` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (makes Vercel use the pnpm version pinned in `package.json`) |
   | `ALERT_EMAIL` | optional: your email address (comma-separate up to 10). You are emailed when something breaks; see "Error alerts" below |

   - You can leave `PUBLIC_APP_URL` unset. The app then uses the project's production `https://….vercel.app` address automatically.
   - If you later add your own domain, set `PUBLIC_APP_URL` to it and redeploy.
5. Click **Deploy**. When it finishes, copy the production address, for example `https://lasuatos.vercel.app`.
6. Put that address in `PUBLIC_APP_URL` in your local `.env.production`. The invitation links you create from your computer use it.

Every push to `main` now redeploys automatically.

## Step 5: Check it

```powershell
pnpm prod:check
```

All six checks should say `OK`: the home page, sign-in page, API, database, database up to date, and HTTPS header. The first run can take a few seconds while Neon wakes up.

Then send yourself a test email with the email settings from `.env.production`:

```powershell
pnpm prod:email:test --to you@example.com
```

It prints `Sent` when the provider accepted the message, or the provider's reason and the fix when it did not. Check the inbox and the spam folder. The test runs from your computer. The live site sends from Vercel, so with Brevo also make sure IP blocking is off (step 2).

## Step 6: Create the first administrator

```powershell
pnpm prod:admin:bootstrap --email you@example.com --name "Your Full Name"
```

The invitation arrives by email. Add `--print-link` to also print the link in the terminal. Open it, choose a password, and you are signed in as institution administrator.

From the **Staff** page you can then invite lecturers and other administrators. Students sign up themselves at `/sign-up`, confirm their email, and join courses with the lecturer's course code. See [Administration](ADMINISTRATION.md) for the details.

## Updating

- Code changes deploy when they reach `main`.
- **Database migrations run automatically.** Each production build on Vercel (`VERCEL_ENV=production` with `DATABASE_URL` set) applies any new migration in `packages/database/drizzle/` before building, using the same `db:migrate` as `pnpm prod:migrate`. Migrations only add to the schema and are recorded, so a build with nothing new does nothing. If a migration fails, the build fails and the previous deployment keeps serving. Preview builds never migrate.
  - To turn this off (for example to migrate by hand during a maintenance window), set `SKIP_DATABASE_MIGRATIONS=true` on Vercel and run `pnpm prod:migrate` yourself.
  - On other hosts, set `MIGRATE_ON_BUILD=1` to get the same behaviour from `pnpm run build`.
- **Check:** open `/api/v1/ready`. It returns `200` with `"schema":"current"` when every migration is applied, and `503` with `"schema":"behind"` otherwise (with `ALERT_EMAIL` set you are also emailed). Point uptime monitors at this URL.

To migrate by hand from Windows PowerShell, in the repository folder:

```powershell
git pull
corepack pnpm install --frozen-lockfile
corepack pnpm prod:migrate
corepack pnpm prod:check
```

## Backups

Neon Free can only restore the last 6 hours. For anything you care about, take a dump now and then with PostgreSQL's `pg_dump` (installed with PostgreSQL, or run through Docker):

```powershell
docker run --rm -v "${PWD}:/backup" postgres:17-alpine pg_dump "<your Neon direct connection string>" -f /backup/lasuatos-backup.sql
```

Use the **direct** connection string (without `-pooler`) for `pg_dump`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `prod:check` fails "API health" with 503 | The API could not start. Open Vercel → your project → **Logs** (kept for 1 hour) and look for "LASUATOS API could not start". It names the missing or invalid setting. Check that `API_MODE=embedded` is set, then redeploy. |
| `prod:check` fails "Database" | `DATABASE_URL` is missing or wrong on Vercel, or Neon's monthly compute is used up (Neon dashboard → Usage). |
| Sign-in shows "This request was blocked because it did not come from the LASUATOS app" | The site was opened on a different address than `PUBLIC_APP_URL`, such as a Vercel **preview** URL. Use the production address, or add the other origin to `TRUSTED_ORIGINS`. |
| Students never get the confirmation email | Run `pnpm prod:email:test --to you@example.com`; it prints the provider's reason and the fix. On the live site, Vercel → **Logs** shows "email could not be delivered" with the same `reason`. Common causes: Brevo IP blocking still on ("unrecognised IP address"), the SMTP key used instead of the `xkeysib-` API key, `EMAIL_FROM_ADDRESS` not a verified Brevo sender, or the 300-a-day limit (Brevo → Transactional → Logs). For Gmail, `GMAIL_APP_PASSWORD` must be an App Password. Also look in the recipient's spam folder. |
| `prod:admin:bootstrap` says the invitation email could not be delivered | The invitation was still created. The `Reason:` line says why the email failed. Running the command again only reports that an invitation already exists, so add `--print-link` the first time to get the link in the terminal. For later invitations, fix email and press **Resend** on the Staff page (this makes a new link). |
| `/api/v1/ready` says `"schema":"behind"` | A migration has not been applied. Open the latest production deployment's build log on Vercel and look for "Applying database migrations". If it was skipped, check `SKIP_DATABASE_MIGRATIONS`; if it failed, the log says why. You can always run `pnpm prod:migrate` from your computer. |
| "Too many requests" | The rate limits are working. They are pilot starting values (see `docs/SECURITY.md`). |
| The first page load after a quiet period is slow | Neon is waking from its 5-minute idle pause. This is expected on the free plan. |
| The Vercel build fails at install | Make sure `ENABLE_EXPERIMENTAL_COREPACK=1` is set and Root Directory is `apps/web`. |
| Opening the site asks you to log in to Vercel | Deployment Protection is on. Use the production `….vercel.app` address, or turn off Vercel Authentication under Settings → Deployment Protection. |
| Pushing to `main` does not deploy | Settings → Git: make sure the repository is connected and automatic deployments are enabled. Deployments → **Redeploy** also works. |
| `prod:*` commands say `DATABASE_URL is not set` | Create `.env.production` in the repository root (step 3). |

## Error alerts

With `ALERT_EMAIL` set (and email working), the site emails you when:

- a request fails with an unexpected server error (HTTP 500);
- a page crashes in someone's browser (the "Something went wrong" screen);
- `/api/v1/ready` finds the database behind the code.

Each email says what failed, when, the request or page, and a request ID to search for in Vercel → **Logs**. Passwords, connection strings, keys and tokens are removed first. The same problem is emailed at most once every 30 minutes and at most 20 alerts a day are sent, so a crash loop cannot use up the email plan; every occurrence is still written to the logs. Without `ALERT_EMAIL`, problems are only logged.

Separately, in enrolled courses, the lecturer is emailed when a student disputes an attendance record, and the student is emailed when the dispute is answered. These go to the people involved, not to `ALERT_EMAIL`.

## Other hosts

The standalone API is still supported, for example on a university server or VPS:

- Run `pnpm --filter @lasuatos/api dev`, or `tsx src/index.ts` under a process manager, with `API_HOST`, `API_PORT` and `DATABASE_URL` set.
- Run the web app with `next start`, leaving `API_MODE` unset (the default "proxy" mode) and `API_INTERNAL_URL` pointing at the API.
- Put both behind one HTTPS origin. Set `TRUST_PROXY` to the load balancer's address. Never set it to `true` on an API that clients can reach directly.

Embedded mode takes the client address from Vercel's `x-real-ip` header, which Vercel sets itself. Do not use embedded mode on a host whose edge does not overwrite that header, because rate limits would then trust a client-supplied value.

## Local setup

Local development needs Node 22.12 or newer in the Node 22 line, pnpm 12.18.0, and Docker Desktop (Docker Engine with the Compose plugin). Run:

```sh
pnpm install
cp .env.example .env
pnpm dev:setup
pnpm dev
```

- The web app binds to `0.0.0.0:3000` and the API to `0.0.0.0:4000`. Next.js rewrites `/api/v1/*` to the API using `API_INTERNAL_URL`. Browser code must use relative URLs only.
- `compose.yaml` starts PostgreSQL on loopback port `5433`, and Mailpit on `1025` (SMTP) and `8025` (its inbox).
- `pnpm dev:setup` refuses any database other than the local `lasuatos_dev` Compose database. It then applies migrations, seeds clearly labelled synthetic demo records only, and invites the demo administrator.
- None of the demo records is an official LASU record. Never run `db:seed:local` against production. It refuses to run anyway unless `LOCAL_DEMO_MODE=true` and the database is local.

## Before an official university pilot

The free setup above runs the complete product. Before the university relies on it with real students, also do the following:

- Get institutional approval for hosting, data processing, privacy, retention, identity and venue registration.
- Move to plans with an SLA and longer backups and logs, or to the university's own servers.
- Add uptime checks on `/api/v1/health` (liveness) and `/api/v1/ready` (readiness). Set `ALERT_EMAIL`. Consider alerting on bursts of `429` and cross-origin `403` responses, and on "Rate-limit store failed" log lines (the limiter fails open).
- The QR crowd test in `docs/LOAD_TESTING.md` has been run; also measure sign-ins in staging, and run an accessibility check and a security review, and record the measured results with their conditions.
- Keep secrets only in the host's environment settings. Never print connection strings or API keys.
