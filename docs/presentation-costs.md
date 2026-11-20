# LASUATOS — What it costs, and why it costs that

Presentation notes. Every number here was checked against the actual deployment (November 2026).
Naira figures are approximate at about ₦1,500 per US dollar — check today's rate before quoting.

---

## The one-line answer

**LASUATOS costs ₦0 a month to run today.** Every part of it is on a free plan, and it was
engineered deliberately to fit them. Only when the whole university uses it daily does it need
paid plans — and even then, about $20–40 a month, less than one lecturer's data bundle.

---

## What runs today, and what each piece costs

| Piece | Service | Plan | Cost |
| --- | --- | --- | --- |
| Web app **and** API (one deployment) | Vercel | Hobby | **$0** |
| Database (PostgreSQL 17) | Neon | Free | **$0** |
| Email (codes, resets, security notices) | Brevo, with Gmail and Resend as failovers | Free | **$0** |
| Google sign-in ("Continue with Google") | Google Cloud OAuth | Free | **$0** |
| Nightly encrypted database backups, verified by restoring them | GitHub Actions → private GitHub repo releases | Free | **$0** |
| Public status page (separate from the app, stays up if it goes down) | Cloudflare Workers | Free | **$0** |
| Source code hosting, pull-request checks, CI | GitHub | Free | **$0** |
| Domain name | not bought — uses lasuatos.vercel.app | — | **$0** |
| **Total** | | | **$0 / month** |

---

## What the free plans actually allow (the honest limits)

These are measured, not guessed — from the lecture-hall load tests (`docs/LOAD_TESTING.md`):

- **Vercel Hobby:** 1 million function calls, 4 hours of active CPU, and 100 GB of data per month.
  The face check is the expensive part: about 0.4 CPU-seconds per check-in. Six 300-student classes
  every morning use about 12 CPU-minutes a day, so the free plan covers roughly **a month of
  faculty-scale piloting** before it pauses (it pauses — it never bills by surprise).
- **Neon Free:** 0.5 GB storage and about 100 compute-hours a month. The database sleeps after
  5 idle minutes and wakes in about a second. Class lists and attendance rows are tiny — storage
  is not the constraint; face photos are deleted after verification, by design.
- **Brevo Free:** 300 emails a day. With the new personal-email feature, students who can't open
  their LASU mailbox link their Gmail once — so the daily email budget goes much further.
- **The catch to say out loud:** Vercel Hobby's terms are for *non-commercial* use. That is fine
  for a student project and pilot. If LASU adopts LASUATOS officially, the right move is Vercel
  Pro or the university's own servers (below) — which is the plan, not a surprise.

---

## When it grows: the paid ladder

| Stage | What changes | Monthly cost |
| --- | --- | --- |
| Today — pilot and faculty-scale testing | nothing | **$0** |
| Regular daily use across a faculty | Vercel → Pro (more CPU, bills instead of pausing, real SLA) | **~$20 (≈ ₦30k)** |
| A whole university | + Neon → Launch (10 GB storage, longer history) | **~$20 + $19 = ~$39 (≈ ₦58k)** |
| Official LASU adoption | university servers + an official lasu.edu.ng address | **₦0 to the project** (the university hosts it) |

Even the worst case — every student at LASU using it daily on paid cloud plans — is under
**$40 a month**. Attendance for 30,000+ students for the price of a few litres of fuel a day.

---

## Vercel vs Railway (the question everyone asks)

| | **Vercel** (what we use) | **Railway** |
| --- | --- | --- |
| Free tier | Yes — Hobby, $0 forever | No real free tier; trial credit, then paid |
| Entry price | $0 | ~$5/month + usage |
| Built for | Next.js (what LASUATOS is) — zero server to manage | Always-on server processes you manage yourself |
| Scaling | Automatic, per request; sleeps = costs nothing | You pay for idle time too |
| Commercial use | Hobby forbids it; Pro is $20/user/mo | Allowed on any paid plan |
| Database | Not included — we use Neon (free) | Can host Postgres on the same bill (~$5–10/mo) |
| Typical bill for LASUATOS | $0 today; $20/mo at faculty scale | ~$10–25/mo from day one |

**Verdict: Vercel now, Railway only if we ever need an always-on server or commercial terms on a
tight budget — and LASU's own infrastructure if the university adopts it.** LASUATOS deliberately
runs both ways: the API can run embedded inside the Vercel app (today) or standalone on any server
(`docs/DEPLOYMENT.md`), so we are never locked in.

---

## Domain names

| Option | Cost | Note |
| --- | --- | --- |
| **lasuatos.vercel.app** (today) | $0 | Comes free with Vercel, HTTPS included |
| **lasuatos.com** or similar | ~$10–12/year (≈ ₦17k) | Bought once a year, e.g. Namecheap |
| **lasuatos.ng** / **.com.ng** | ≈ ₦15k–25k/year | Nigerian registrars (Qservers, Whogohost…) |
| **attendance.lasu.edu.ng** | ₦0 | The university's own domain — only LASU IT can create it; that is the institutional adoption path |

Recommendation: a .com (~₦17k/year) is the only purchase worth making soon, purely so the address
is easy to say and remember. Everything else already works.

---

## If they ask "why is it free?"

Because the expensive mistakes were engineered out:

- **Face photos are deleted** right after each check-in (retention policy, ADR 024) — storage stays tiny.
- **The app is serverless** — it sleeps when nobody uses it and costs nothing at 3 am.
- **Backups are encrypted dumps in a private GitHub repo** — no backup service bill, and every night's
  backup is proven by actually restoring it before it is kept (ADR 035).
- **300 emails a day is plenty** when students link the email they already read (ADR 040).
- Free plans **pause instead of billing** — the project can never wake up to a surprise invoice.

---

## Quick facts worth dropping anywhere in the presentation

- 182 API routes, each one rate-limited, validated, and covered by automated checks.
- 1,273 automated tests run on every change before it can go live.
- 40 written architecture decisions (`docs/DECISIONS.md`) — every "why" is on record.
- Two independent security reviews (ADRs 032–033), load-tested with a simulated 300-student
  lecture rush.
- Face verification, passkeys for staff, encrypted nightly backups, a public status page —
  features many paid products don't have.
- Runs entirely on a student's phone browser — nothing to install (installable as an app if wanted).
