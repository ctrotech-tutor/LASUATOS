# Paste this ENTIRE file into Claude, then delete this top line

Everything below the divider is one complete prompt. It gives Claude the task, the LASUATOS design spec, the app facts, and the full cost content to work from.

---

## The task

Turn the cost document at the bottom of this prompt into a **proper, polished document** I can present to LASU faculty and university management (non-technical audience). Produce it as a clean, well-structured document — ideally a Notion page (or a Google Doc / PDF-ready layout if that's easier) — with real headings, real tables, and callout blocks for the headline points. Do not summarise it away: this is the full text, and the detail is the point. Keep every section, every table, every number.

## LASUATOS design spec — follow this look

- **Colours:**
  - Moss green `#123f2e` — primary brand colour (headers, emphasis blocks)
  - Deep moss `#0d251a` — dark background variant
  - Gold `#e9c06a` — accent (headline figures, callout borders, key numbers)
  - Cream `#fbf8ef` — light background / card fill
- **Fonts:** Plus Jakarta Sans (bold weights) for headings and display text; Inter for body text. If the platform can't set fonts, keep the hierarchy clean (H1/H2/H3) so the fonts can be applied later.
- **Tone:** honest, plain, confident. No pitch-speak, no hype, no "revolutionary". This document's whole credibility comes from stating the catches *before* anyone asks. Never soften or remove a limitation.
- **Money:** always show both dollars and naira where the source does, using ~₦1,400 per US dollar, and keep the "checked November 2026 / re-check on the day" framing — prices move.
- **Structure guidance:** open with a title block (title + "Prepared 20 November 2026" + one-line context), then a prominent callout for the ₦0/month headline, then the sections in order with their tables intact. Put the "honest risks" section in a visually distinct block (it's the section that builds trust). End with the quick-facts box.

## Hard rules

1. **Do not change, round, or invent any number.** If a figure looks odd, keep it exactly as written.
2. Do not add new services, prices, or providers. Everything in the document was verified against live pricing on 19–20 Nov 2026.
3. Keep the honest risks and the "free plans are how a project starts, not how a university runs" framing — that honesty is the brief.

## About the app (context so your framing is accurate)

**LASUATOS** is a live attendance and course platform built for Lagos State University (LASU), running in production as a pilot with real students.

- Students open accounts from class lists uploaded by their HOC; attendance is marked per lecture with a **30-second rotating QR code**, a **face check** against the registered photo, a **one-phone-one-owner rule** (a phone can mark its owner plus one classmate, flagged), and **GPS proximity** for mapped venues.
- Security posture: scrypt password hashing, 256-bit single-use tokens stored as SHA-256 digests, HttpOnly sessions, per-route rate limits, **passkeys (WebAuthn) for staff**, encrypted nightly database backups that are test-restored before being kept, a public status page, and email alerts for error bursts and failing providers.
- Students can sign in with Google, link a personal email for account mail, and confirm their LASU email through it; lecturers get join codes, disputes/appeals, and correction workflows.
- Scale facts: **182 API routes** (every one rate-limited and validated), **1,280 automated tests** run on every change, **38 written architecture decision records**, two security reviews, load-tested against a simulated 300-student lecture rush. Runs entirely in a phone browser as an installable PWA — nothing from an app store.
- Total infrastructure spend to date: **₦0**.

## The content to format (verbatim source — keep all of it)

---

# LASUATOS — what it costs, honestly

*Prepared 20 November 2026. Every price below was checked against the providers' current rates this week. Naira figures use ~₦1,400 per US dollar (official mid-market ₦1,353, parallel market ~₦1,470 on 19–20 Nov 2026) — re-check on the day.*

## The honest headline

**LASUATOS costs ₦0 a month to run today** — that is real, not a pitch. Every service it runs on has a permanent free plan, and the system was designed around those limits.

The honest second half: free plans are how a student project starts, not how a university runs. This document shows both sides — what we pay now, exactly what the free plans allow, what breaks first, and what the paid ladder costs in naira.

## 1. What runs today — the full inventory

| Piece | Provider & plan | Monthly cost | What it does |
| --- | --- | --- | --- |
| Web app **and** API (one deployment) | Vercel Hobby | **$0** | Everything students and lecturers touch |
| Database (PostgreSQL 17) | Neon Free | **$0** | Accounts, classes, attendance records |
| Transactional email (codes, resets, security alerts) | Brevo Free — 300 emails/day | **$0** | Gmail App Password (~500/day) is the configured failover |
| Google sign-in | Google Cloud OAuth | **$0** | "Continue with Google" |
| Nightly encrypted database backups | GitHub Actions → private GitHub repo | **$0** | Every backup is test-restored before it is kept |
| Public status page | Cloudflare Workers Free | **$0** | Stays up even if the app is down |
| Code hosting, CI, pull-request checks | GitHub Free | **$0** | 1,280 automated tests on every change |
| Domain name | None — lasuatos.vercel.app | **$0** | Free address included with Vercel |
| **Total** | | **$0 / ₦0 per month** | |

No credit card is attached to any of these services. There is no way to wake up to a bill.

## 2. What the free plans actually allow (checked this week)

**Vercel Hobby — the app itself**
- 1,000,000 function calls, 4 hours of active CPU, 100 GB of data transfer per month.
- The measured expensive operation is the face check: ≈0.4 CPU-seconds per check-in (from our load tests). Six 300-student classes in a morning ≈ 12 CPU-minutes. The 4-hour monthly budget covers roughly **20 heavy teaching days**.
- If we exceed it: the app **pauses until the 1st of next month**. It does not bill.
- **The catch:** Hobby's terms are *personal, non-commercial use only*. Fine for a student project and pilot. Official LASU adoption means Pro or the university's own servers — that is the plan, not a surprise.

**Neon Free — the database**
- 100 compute-hours per month, 1 GB storage, sleeps after 5 idle minutes (wakes in ~1 second — students notice a brief pause on the first request of a quiet period).
- Attendance rows are tiny; 1 GB is years of records. Storage is not the risk.
- **The catch:** point-in-time restore only goes back 6 hours on Free — which is exactly why we built the nightly encrypted backup to GitHub.

**Brevo Free — email**
- 300 emails per day. A code sign-in, a password reset, and a security notice all count.
- **The catch:** a big first-week rush (hundreds of sign-ups the same morning) can exhaust the daily budget — that's why the Gmail fallback exists and why the new personal-email feature lets students receive mail where they actually read it. Paid Starter removes the daily cap: **from $9/month (~₦12,600)**.

## 3. Vercel vs Railway — the real comparison (November 2026 prices)

| | **Vercel** (what we use) | **Railway** |
| --- | --- | --- |
| Free tier | Yes — $0 forever, no card | $0 plan gives $1/month of usage — not enough to run anything real |
| Entry paid plan | Pro **$20/mo** (includes 1 seat + $20 usage credit) | Hobby **$5/mo** (includes $5 of usage) |
| How it bills | Per request; sleeps = costs nothing | Per second; an always-on server bills while idle too |
| Usage rates past the plan | CPU from $0.128/hr; invocations from $0.60/million | $20/vCPU and $10/GB RAM per month + egress |
| Realistic bill for LASUATOS | **$0** today; ~$20/mo at faculty scale | App + Postgres on Railway ≈ **$22/mo** from day one |
| Database | Not included (we use Neon free) | Can bundle Postgres on the same bill |
| Commercial use | Needs Pro | Allowed on Hobby |

**Recommendation, honestly:** Vercel now — it's the only one that costs nothing, and it's built for exactly this stack (Next.js). Railway becomes interesting only if we need an always-on server; its Hobby plan is cheap but LASUATOS on it would cost ~$22/month for what Vercel gives us free. The app is deliberately portable (the API can run embedded on Vercel or standalone on any server), so this decision is reversible. If LASU adopts LASUATOS, the real answer is the university's own infrastructure.

## 4. Domain names (the one purchase actually worth making)

| Option | Price (checked Nov 2026) | Note |
| --- | --- | --- |
| **lasuatos.vercel.app** (today) | $0 | Works, but hard to say in a lecture hall |
| **.com** (Namecheap etc.) | ~$10–12/yr ≈ **₦14,000–17,000/yr** | Paid in dollars; your bank converts |
| **.com.ng** (GO54, QServers, Truehost…) | **₦3,000–7,000/yr** | Cheapest real option; Nigerian registrars bill in naira |
| **.ng** | ₦9,200–13,500 to register, ~₦15,000/yr renewal | Short and local, pricier |
| **attendance.lasu.edu.ng** | ₦0 | Only LASU IT can create it — that is the institutional adoption path |

**Recommendation:** a **.com.ng at ~₦5,000–7,000/year** is the only spending worth doing soon — purely so the address is easy to announce and remember. It connects to Vercel in minutes, no plan change needed.

## 5. The growth ladder — what it costs as usage grows

| Stage | What changes | Monthly cost (₦ @ ~1,400/$) |
| --- | --- | --- |
| **Today** — pilot, faculty-scale testing | Nothing | **₦0** |
| **Daily use across a faculty** (~2–3k students) | Vercel → Pro ($20/mo, includes $20 usage credit) | **~₦28,000/mo** |
| **Whole university** (all 30,000+ students daily) | + Neon → Launch (usage-based, ~$15/mo typical) + possibly Brevo Starter ($9/mo) if email passes 300/day | **~₦50,000–60,000/mo** worst case |
| **Official LASU adoption** | University servers + lasu.edu.ng address | **₦0 to the project** — the university hosts it |

For perspective: full-university daily use costs about as much as a few lecturers' monthly data bundles — and attendance data for 30,000 students is the value side of that equation.

## 6. The honest risks (say these before someone asks)

1. **Free plans can pause mid-semester.** If a heavy month exhausts Vercel's CPU budget, the app pauses until the monthly reset. Mitigation: usage is monitored; the move to Pro is a 10-minute settings change we can make the moment a faculty adopts it for real.
2. **One person's accounts.** Today every service sits under the developer's personal accounts. For institutional use, ownership should move to a department/team account — all providers here support that transfer.
3. **Dollar pricing meets a moving naira.** The paid tiers are billed in USD. ₦28,000/month is today's number; budget with headroom.
4. **Cold starts.** Free-tier sleeping (Neon, serverless functions) means the first request after a quiet spell takes ~1–2 seconds longer. In practice: the lecturer opens the session page while students settle, and everything is warm by the time phones come out.
5. **Free email is the tightest cap.** 300/day is fine for steady state; orientation week isn't steady state. The Gmail fallback (~500/day) doubles headroom, and paid Brevo Starter ($9/mo) removes the cap entirely.

## 7. Why it can be free at all (the engineering answers)

- **Face photos are deleted immediately after each check-in** (retention policy) — storage stays near zero, and it's the right privacy answer too.
- **Serverless everything** — the app sleeps at 3 am and costs nothing.
- **Backups are encrypted dumps in a private GitHub repo**, verified nightly by actually restoring them — no backup vendor bill.
- **Students link the email they already read** (new personal-email feature) — the 300/day email budget stretches further.
- **No media hosting** — QR codes render in the browser; nothing heavy is stored or streamed.

## 8. Quick facts for anywhere in the presentation

- **182 API routes**, every one rate-limited, validated, and covered by automated checks.
- **1,280 automated tests** run on every change before it can go live.
- **38 written architecture decisions** — every "why" is on record.
- **Two independent security reviews**, load-tested with a simulated 300-student lecture rush.
- Face verification, staff passkeys, encrypted nightly backups, public status page — features many paid products don't have.
- Runs entirely in a phone browser; installable to the home screen, nothing from an app store.
- Total infrastructure spend to date: **₦0**.
