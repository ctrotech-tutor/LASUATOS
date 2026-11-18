# LASUATOS status page

The public status page for LASUATOS (ADR 034): is it working, what is affected, what to do meanwhile, and when it is fixed. Like githubstatus.com, but in words students use.

It is a **Cloudflare Worker** with a Cron Trigger and a D1 database, on Cloudflare's free plan. It runs on a different provider and network from LASUATOS (Vercel and Neon), so it still answers when LASUATOS, Vercel or the database is down. It has no dependencies and is not part of the pnpm workspace; the root `pnpm test`, `pnpm typecheck` and `pnpm lint` cover it.

## What it does

Every minute it:

1. **Checks LASUATOS from outside.** It loads the home page (it must answer 200 and really be LASUATOS, not the host's error page) and `GET /api/v1/health`. Every few minutes it also reads `GET /api/v1/status`, LASUATOS's own coarse view of the database, emails, Google sign-in and the face engine. That is every 5 minutes from 06:00 to 22:00 WAT and every 30 at night, so the free database can sleep. While anything is wrong, it reads it every minute. Each failed check is retried once, 4 seconds later, before it counts.
2. **Shows six parts in student words:** Website, Sign-in and accounts, Google sign-in, Attendance check-in, Face check, Emails. A part that LASUATOS has turned off (Google or face) is hidden. A worse state shows at once; getting better takes two good runs in a row, so nothing flickers.
3. **Opens an incident by itself.** After two bad runs it opens one GitHub issue (labels `status`, `auto`, `minor` or `major`, and `component: …`), widens it if more parts break, and closes it after three good runs. Without a GitHub token, or while GitHub is unreachable, the incident is kept on the page only.
4. **Shows your incidents and maintenance** from GitHub issues (below), with your comments as the timeline.
5. **Keeps 90 days of history** (minutes per part per day, maintenance not counted against uptime) and 24 hours of response times.

Pages:

| Path | What |
| --- | --- |
| `/` | The status page (no JavaScript needed; refreshes itself when something changes). |
| `/incidents/gh-123` | One incident or maintenance with its timeline. |
| `/history` | The last 90 days of incidents. |
| `/feed.atom` | Atom feed, for anyone who wants to follow updates. |
| `/api/status.json` | Overall state, each part, open incidents. |
| `/api/summary.json` | Everything the page shows. |
| `/api/notices.json` | Notices for the banner in the app (read by LASUATOS's API, `StatusNoticesSchema`). |
| `/badge.svg` | A small status badge. |

It writes about 8 database rows a minute (about 11,500 a day, against the free plan's 100,000). A page view reads one row, however many people look during an outage.

## Set it up (about 15 minutes, once)

You need a free Cloudflare account and Node 22. Run these from this `status/` folder.

1. **Sign in to Cloudflare**

   ```sh
   npx wrangler login
   ```

2. **Create the database**

   ```sh
   npx wrangler d1 create lasuatos-status
   ```

   Copy the `database_id` it prints into `wrangler.toml`, replacing the zeros. The tables are created automatically on the first run.

3. **Check the settings in `wrangler.toml`**
   - `TARGET_URL`: the LASUATOS address (`https://lasuatos.vercel.app`).
   - `GITHUB_REPO`: where incidents live (`ctrotech-tutor/LASUATOS`). It works the same when the repository is private.

4. **Give it a GitHub token (for automatic incidents and your updates)**

   On GitHub, go to Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
   - Repository access: **Only select repositories** → the LASUATOS repository.
   - Permissions: **Issues: Read and write**. Nothing else.
   - Expiry: up to a year. Put a reminder in your calendar. When it expires, the page keeps working, but automatic incidents are only shown on the page and your issues stop updating.

   ```sh
   npx wrangler secret put GITHUB_TOKEN
   ```

   Paste the token when asked. Issues opened with it show as yours, so they count as a maintainer's.

5. **Deploy**

   ```sh
   npx wrangler deploy
   ```

   It prints the address, for example `https://lasuatos-status.<your-subdomain>.workers.dev`. The first check runs within a minute. Open the address: the parts turn green and the bars start filling from today.

6. **Connect LASUATOS to it**

   In Vercel → the LASUATOS project → Settings → Environment Variables, add `STATUS_PAGE_URL` with that address and redeploy. Then:
   - the banner in the app shows the status page's incidents and planned maintenance;
   - `https://lasuatos.vercel.app/status` opens the status page.

7. **Optional: your own address.** In Cloudflare → Workers → lasuatos-status → Settings → Domains & Routes, add a custom domain such as `status.yourdomain`. Then set `PUBLIC_URL` in `wrangler.toml` to that address, deploy again, and update `STATUS_PAGE_URL` in Vercel.

Tell students the status page's own address (or `…/status`) in the announcement: bookmarking it is what helps when LASUATOS itself will not open.

## Posting an incident or maintenance

Everything is a GitHub issue with the **`status`** label, opened by an owner, member or collaborator. Issues from anyone else never appear.

**An incident**

- Title: what students notice, for example *Check-in is failing for some classes*.
- Labels: `status`, plus `major` or `minor`, plus the parts, such as `component: attendance` or `component: face`.
- Body: the first update.

**Updates**

Comment on the issue, starting with a stage:

```
Identified: the database ran out of connections after the 8am rush. A fix is going out now.
```

The stages are `Investigating`, `Identified`, `Monitoring`, `Update` and `Resolved`.
- A comment starting with **Resolved** ends the incident on the page. So does closing the issue.
- Text inside `<!-- … -->` stays private, so you can keep notes for yourself in the same issue.
- Comments from people who are not maintainers are ignored.

**Planned maintenance**

Use the labels `status` and `maintenance`, plus parts if only some are affected (with none, it means all of them). Put the window in the body, in WAT:

```
Starts: 2026-11-21 22:00
Ends: 2026-11-21 23:30

LASUATOS may pause for a few minutes while the database is upgraded. Attendance already marked is safe.
```

- It shows under *Planned maintenance* straight away.
- The app banner shows it from a day before.
- It shows as *In progress* during the window and *Completed* after it, even if you forget to close the issue.
- While it runs, those parts show as maintenance, their minutes do not count against uptime, and no automatic incident is opened for them.

**The automatic incident**

You can comment on it like any other issue; your comments become its updates. If you close it while something is still failing, the checker leaves it closed and stays quiet until everything recovers.

## Development

```sh
pnpm vitest run status            # unit and end-to-end tests (Node's built-in SQLite stands in for D1)
pnpm exec tsc --noEmit -p status  # types
npx wrangler dev --test-scheduled # local run; trigger a check at /__scheduled
```

The rules are in `src/model.ts` (states, incidents, timing), the page in `src/render.ts`, and the GitHub sync in `src/checker.ts`.
