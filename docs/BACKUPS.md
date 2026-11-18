# Database backups

LASUATOS keeps an encrypted copy of its whole database every night, away from Neon, and tells you when that stops working. This guide sets it up once, shows how to check a backup every month, and walks through a restore. The design and its reasons are in [ADR 035](DECISIONS.md#adr-035-nightly-encrypted-backups-that-are-proven-before-they-are-kept).

**Why it matters.** Neon Free can roll back only the last 6 hours. A bad migration noticed the next morning, data deleted by mistake, or a lost Neon project could not be undone without these copies.

## What happens every night

At about 2:30 am Lagos time (01:30 UTC), the **Database backup** workflow in GitHub Actions runs `scripts/backup/run.mjs`:

| Step | What it does |
| --- | --- |
| connect | Opens one read-only transaction and exports its snapshot, so the copy is the database at a single instant. It uses a login that can read but never change data. |
| dump | `pg_dump` of that snapshot (custom format, compressed), with the same PostgreSQL version as Neon. |
| restore | Restores the dump into a brand-new, empty PostgreSQL in the runner, in one transaction that stops at the first error. |
| verify | Compares the restored copy with the snapshot: every table and its exact row count, every sequence, and the number of indexes, constraints, triggers, functions, views and types. **Any difference fails the night.** |
| encrypt | Encrypts the dump with [age](https://age-encryption.org) to your public key. Only your private key, which never leaves your computer, can open it. The unencrypted dump is deleted. |
| upload | Stores the encrypted file and a `manifest.json` (sizes, SHA-256 checksums, what was verified) as a release of a **private** GitHub repository. It refuses to upload to a public one. |
| prune | Deletes copies the keep rules no longer need. |
| report | Tells LASUATOS how it went, with a token GitHub signs for this workflow (no shared secret). |

**Which copies are kept:** every night for 14 days, then one a week (Sunday's) up to 8 weeks, and always the newest three within those 8 weeks. That is 20 to 22 copies. **Nothing older than 8 weeks is ever kept**, even while backups are failing, so data deleted from LASUATOS (a withdrawn face, an expired check-in photo) is gone from backups within 8 weeks too. The privacy notice promises this.

**Where you see it:** **System health → Backups** shows the last verified copy, what it holds, how many good nights in the last 7, and the last failure in words with a link to its run. An email goes to `ALERT_EMAIL` when a run fails (at most every 6 hours), and once a day while no good backup has arrived for 30 hours. That second email also catches a workflow that stopped running, or reports that never arrive.

## Set it up (once, about 20 minutes)

You need: the repository cloned with `corepack pnpm install` done, `.env.production` with the owner `DATABASE_URL` (as for `pnpm prod:migrate`), and the [GitHub CLI](https://cli.github.com) signed in (`gh auth login`). The commands work in PowerShell.

### 1. Make your key pair

```powershell
pnpm backup:keygen
```

This writes `lasuatos-backup-key.txt` to your home folder and prints a **public key** (`age1…`).

- The **private key** in that file is the only thing that can open a backup. GitHub, Vercel and Neon never see it, so someone who gets into any of them still cannot read the backups.
- **If you lose it, every backup is unreadable.** Keep a second copy away from your computer: a USB stick in a safe place, or a password manager's secure note. `pnpm backup:keygen --out E:\lasuatos-backup-key.txt` writes another file if you prefer to start on the stick.
- Never put the private key in the repository, a chat, an email or a GitHub secret.
- If the path has a space in it, put quotes around it, or PowerShell splits it in two: `pnpm backup:keygen --out "G:\My Drive\lasuatos-backup\lasuatos-backup-key.txt"`. A missing folder is created for you.
- A cloud-synced folder such as Google Drive is fine as one copy, because it survives a lost laptop. Anyone who gets into that account can then open backups they download from GitHub, so turn on 2-Step Verification for it. Keep the USB copy as well.

Two people can each hold their own key: run `backup:keygen` on each computer and give the workflow both public keys (step 5). Either key then opens every backup.

### 2. Create the private backup repository

On GitHub, create a new repository, for example `lasuatos-backups`:

- **Private.** The workflow checks and refuses anything else.
- Tick **Add a README file**, so the repository has a first commit for releases to point at.

Releases there have no total size limit (each file must be under 2 GiB; today's backup is a few MB).

### 3. Give the workflow a token for that repository only

GitHub → your picture → **Settings → Developer settings → Fine-grained tokens → Generate new token**:

- **Repository access:** Only select repositories → `lasuatos-backups`.
- **Permissions → Repository permissions → Contents:** Read and write (releases need this). Nothing else.
- **Expiration:** one year. Put a reminder in your calendar a week before; when it expires the night fails at *checking its settings* and you get an email.

Store it as a secret of the **app** repository. `gh` asks for the value without showing it, so it never lands in a file or your history:

```powershell
gh secret set BACKUP_GITHUB_TOKEN --repo ctrotech-tutor/LASUATOS
```

### 4. Make the read-only database login

```powershell
pnpm prod:backup:role --set-github-secret
```

This connects with the owner login from `.env.production`, creates (or renews) the login `lasuatos_backup`, which can read every table, including tables added by later migrations, and nothing else, checks that it really cannot write, and stores its connection string straight in the GitHub secret `BACKUP_DATABASE_URL`. Running it again changes the password (the old one stops working) and re-applies the grants. That is also the fix if a night ever fails with "permission denied".

### 5. Set the workflow's variables

These are not secret:

```powershell
gh variable set BACKUP_AGE_RECIPIENTS --repo ctrotech-tutor/LASUATOS --body "age1…your public key…"
gh variable set BACKUP_REPOSITORY --repo ctrotech-tutor/LASUATOS --body "ctrotech-tutor/lasuatos-backups"
gh variable set BACKUP_REPORT_URL --repo ctrotech-tutor/LASUATOS --body "https://lasuatos.vercel.app"
```

For two keys, put both in `BACKUP_AGE_RECIPIENTS` separated by a space. `BACKUP_REPORT_URL` must be the same address as the app's `PUBLIC_APP_URL`: GitHub signs the report for that address, and LASUATOS accepts only reports signed for itself. Change both together when the custom domain arrives.

The workflow stays skipped (not failed) until `BACKUP_REPOSITORY` is set.

### 6. Tell LASUATOS to expect backups

In Vercel → the project → **Settings → Environment Variables**, add for Production:

| Name | Value |
| --- | --- |
| `BACKUP_SOURCE_REPOSITORY` | `ctrotech-tutor/LASUATOS` |

Then redeploy. LASUATOS then accepts reports only from `.github/workflows/backup.yml` on `main` of that repository, from scheduled or manual runs, and System health starts expecting a backup every night. The late check runs with the nightly clean-up, so `CRON_SECRET` must be set too (it already is if System health shows the clean-up running).

### 7. Run it once now

```powershell
gh workflow run backup.yml --repo ctrotech-tutor/LASUATOS
gh run watch --repo ctrotech-tutor/LASUATOS
```

Or GitHub → **Actions → Database backup → Run workflow**. It takes 2 to 4 minutes. Then:

- the backup repository has a release named `Backup <date>`;
- **System health → Backups** says *Up to date*;
- do the drill below once, so you know your key works before you ever need it.

## The monthly drill (5 minutes)

A backup you have never opened is a hope, not a backup. Once a month:

```powershell
gh release download --repo ctrotech-tutor/lasuatos-backups --dir $HOME\Downloads\lasuatos-drill
pnpm backup:check $HOME\Downloads\lasuatos-drill\lasuatos-<date>.dump.age
```

`gh release download` without a tag takes the newest release. `backup:check` decrypts in memory with your key file and proves three things, writing nothing to disk:

- your key opens it;
- the encrypted file is the one uploaded (its SHA-256 matches `manifest.json`);
- what comes out is the very dump that was restored and verified that night (same SHA-256 again) and a valid PostgreSQL archive.

It starts with `OK: the key opens it` and names the night it was verified. Then delete the downloaded folder. If your key file is elsewhere, add `--key E:\lasuatos-backup-key.txt` or set `BACKUP_KEY_FILE`.

## Restoring

Stay calm and do not overwrite anything yet. The safest restore is into a **new** Neon branch, checked before the app is pointed at it. The current database stays as it is, so you can always go back.

### First, is Neon's own 6-hour restore enough?

If the problem happened in the last 6 hours, Neon's built-in restore is faster and loses less: Neon console → the project → **Branches → Restore**, then pick a time just before the mistake. Use the backups below for anything older, or when the Neon project itself is gone.

### 1. Get the backup and decrypt it

Pick the release from just before the problem (each title has the UTC time). Download both files:

```powershell
gh release download db-20261120-013012 --repo ctrotech-tutor/lasuatos-backups --dir $HOME\restore
pnpm backup:check   $HOME\restore\lasuatos-20261120-013012.dump.age
pnpm backup:decrypt $HOME\restore\lasuatos-20261120-013012.dump.age --out $HOME\restore\lasuatos.dump
```

`lasuatos.dump` now holds personal data unencrypted. Keep it on your computer only, and delete it when done (step 5).

### 2. Make an empty database to restore into

In Neon: **Branches → New branch** from `main`, then empty it. Or, if the project is gone, create a new project in the same region (Frankfurt). Copy its **direct** connection string (without `-pooler`).

To empty a new branch (it starts as a copy of `main`), open the branch's **SQL Editor** and run:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
DROP SCHEMA IF EXISTS drizzle CASCADE;
```

Check you are on the new branch, not `main`, before running it.

### 3. Restore

Use the PostgreSQL major version in the release's `manifest.json` (`"postgres": 17`), through Docker:

```powershell
docker run --rm -v "${HOME}\restore:/restore" postgres:17-alpine `
  pg_restore --no-owner --no-privileges --exit-on-error --single-transaction `
  --dbname "<direct connection string of the new branch>" /restore/lasuatos.dump
```

It either restores everything or nothing. If it stops with an error, nothing was half-restored; the message says why.

### 4. Check it, then switch

1. Put the new connection string in a copy of `.env.production` and run `pnpm prod:check`. It should report the database up with the schema current.
2. Re-apply deletions made since the backup. Faces withdrawn or reset, and accounts released after the backup's time, are back in the restored copy. In the restored database, compare `student_audit_events` with the old database (if it is still readable) and repeat those actions. Expired faces and photos are deleted again automatically by the next nightly clean-up.
3. In Vercel, set `DATABASE_URL` (Production) to the new branch's **pooled** connection string and redeploy.
4. Run `pnpm prod:backup:role --set-github-secret` against the new database (with its owner string in `.env.production`), so tonight's backup reads the new branch.
5. Sign in and check a few things you know: a recent session, a student, a course.

### 5. Clean up

Delete `lasuatos.dump` and the downloaded files:

```powershell
Remove-Item -Recurse $HOME\restore
```

Keep the old branch for a few days in case something is missing, then delete it. Write down what happened and when, for the incident record.

### Getting back a few rows only

To recover something deleted by mistake without replacing the whole database, restore into a new, empty branch as above, then copy just those rows across with SQL (`INSERT … SELECT` through `dblink`, or export and import a CSV in the Neon SQL Editor). Leave the live database's audit tables alone.

## When something goes wrong

The failure email and System health name the step that failed. The run itself says why, and what to check first, in three places, none of which shows passwords or tokens:

- under **ANNOTATIONS** in `gh run watch` and on the run's page in GitHub;
- in the run's summary (**Actions → Database backup →** the run);
- in the log: `gh run view <run id> --repo ctrotech-tutor/LASUATOS --log-failed | Select-String "\[backup\]"`.

| Failed while… | Usually | Fix |
| --- | --- | --- |
| checking its settings | A secret or variable is missing, the token expired, or the backup repository is public or empty. | Repeat the step of this guide that sets it. A new token goes in with `gh secret set BACKUP_GITHUB_TOKEN`. |
| connecting to the database | Neon was waking (retried 4 times), its compute hours are used up, or the backup login's password changed. | Check Neon → Usage. Run `pnpm prod:backup:role --set-github-secret` again. |
| copying the database | "permission denied" on a new table. | Run `pnpm prod:backup:role --set-github-secret` again: it re-applies the grants. |
| test-restoring / checking the restored copy | The copy is not identical to the database. This is what the check is for. | Run the workflow again: a one-off is usually a runner problem. If it repeats, the message names the table; open an issue. The previous copies are still good. |
| encrypting the copy | `BACKUP_AGE_RECIPIENTS` holds something that is not an `age1…` public key. A private key pasted by mistake is refused. | Set it again (step 5). If a private key was ever pasted anywhere, make a new pair. |
| storing the copy | The token cannot write releases, or GitHub was down. | Check the token's repository and Contents permission. Run again. |
| removing old copies | GitHub refused a delete. The night's copy **was** stored. | Usually passes the next night. |

**The "backups stopped" email, but no failed run?** GitHub turns off scheduled workflows in a public repository after 60 days without a commit. Open **Actions → Database backup**, press **Enable workflow**, then run it. Also check that `BACKUP_SOURCE_REPOSITORY` in Vercel and `BACKUP_REPORT_URL` in GitHub are right; the run log says "LASUATOS refused the report" when they are not.

## Changing or adding a key

To replace a key (a new laptop, or someone leaves):

1. `pnpm backup:keygen --out <new file>` and add the new public key to `BACKUP_AGE_RECIPIENTS` **beside** the old one.
2. Copies made from now on open with either key. Older copies open with the old key only.
3. After 8 weeks every kept copy opens with the new key. Remove the old public key from the variable, and destroy the old private key if it was exposed.

If a private key may have been seen by someone else, do this at once, and consider deleting the older releases early.

## Costs

Nothing on the current plans. While the app repository is public, Actions minutes are free. Once it is private, a night takes 3 to 5 of the 2,000 free minutes a month (about 120 a month). Release files have no total storage limit.

## Running it yourself

`pnpm backup:run` runs the same steps on your own computer with the same variables. Add `BACKUP_OUTPUT_DIR=<folder>` to keep copies in a folder instead of GitHub. Without Docker, set `BACKUP_TOOLS=native`, `BACKUP_PG_BIN` (the PostgreSQL `bin` folder) and `BACKUP_SCRATCH_URL` (a PostgreSQL server where a scratch database may be made and dropped). The keep rules are tested in `scripts/backup/policy.test.ts`.
