#!/usr/bin/env node
// The nightly database backup (ADR 035). Run by .github/workflows/backup.yml.
//
//  1. connect   Open one read-only REPEATABLE READ transaction on the database and export its
//               snapshot, so everything below sees the database at one instant.
//  2. dump      pg_dump that snapshot (custom format, compressed).
//  3. restore   Restore the dump into a fresh, empty PostgreSQL server.
//  4. verify    Compare the restored copy with the snapshot: the same tables with the same
//               rows, sequences, indexes, constraints, triggers, functions, views and types.
//               Any difference fails the backup.
//  5. encrypt   Encrypt the dump with age to the public key(s) in BACKUP_AGE_RECIPIENTS. Only
//               the matching private key, which never leaves its owner, can open it.
//  6. upload    Store the encrypted dump and a manifest as a release of a private repository.
//  7. prune     Delete backups the keep rules (policy.mjs) no longer need.
//  8. report    Tell LASUATOS how it went (System health, and an email if it failed).
//
// Environment:
//   BACKUP_DATABASE_URL    Read-only connection string (pnpm prod:backup:role makes one). Secret.
//   BACKUP_AGE_RECIPIENTS  Public key(s) from pnpm backup:keygen (age1…). Not secret.
//   BACKUP_REPOSITORY      owner/name of the PRIVATE repository that keeps the backups.
//   BACKUP_GITHUB_TOKEN    Token that may write releases there. Secret.
//   BACKUP_REPORT_URL      The app, e.g. https://lasuatos.vercel.app (optional: no report).
//   BACKUP_TOOLS           docker (default) or native. native also reads BACKUP_PG_BIN and
//                          BACKUP_SCRATCH_URL (a server where a scratch database may be made).
//   BACKUP_OUTPUT_DIR      Store backups in this folder instead of GitHub (tests).

import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Encrypter } from 'age-encryption';
import {
  ageRecipientCount, backupTag, compareInventories, directConnectionString, formatBytes, inventoryTotals,
  parseRecipients, redact, selectBackups,
} from './policy.mjs';
import { appliedMigration, canWrite, readInventory } from './inventory.mjs';
import { directoryStore, dockerTools, fileSize, githubReleaseStore, nativeTools, sha256File } from './tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

class StageError extends Error {
  constructor(stage, message) {
    super(message);
    this.stage = stage;
  }
}

const log = (message) => console.log(`[backup] ${message}`);

function latestMigrationInCode() {
  const journal = JSON.parse(readFileSync(path.join(ROOT, 'packages/database/drizzle/migrations/meta/_journal.json'), 'utf8'));
  const last = journal.entries[journal.entries.length - 1];
  return { tag: last.tag, when: last.when };
}

function readConfig(env) {
  const missing = ['BACKUP_DATABASE_URL', 'BACKUP_AGE_RECIPIENTS'].filter((name) => !env[name]?.trim());
  if (!env.BACKUP_OUTPUT_DIR) missing.push(...['BACKUP_REPOSITORY', 'BACKUP_GITHUB_TOKEN'].filter((name) => !env[name]?.trim()));
  if (missing.length) throw new StageError('config', `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set (see docs/BACKUPS.md)`);
  if (env.BACKUP_REPOSITORY && !/^[\w.-]+\/[\w.-]+$/.test(env.BACKUP_REPOSITORY.trim())) {
    throw new StageError('config', 'BACKUP_REPOSITORY must look like owner/name');
  }
  const database = directConnectionString(env.BACKUP_DATABASE_URL.trim());
  return {
    databaseUrl: database.url,
    pooledAddressGiven: database.changed,
    recipients: parseRecipients(env.BACKUP_AGE_RECIPIENTS),
    repository: env.BACKUP_REPOSITORY?.trim(),
    token: env.BACKUP_GITHUB_TOKEN?.trim(),
    outputDir: env.BACKUP_OUTPUT_DIR?.trim(),
    reportUrl: env.BACKUP_REPORT_URL?.trim().replace(/\/+$/, '') || null,
    tools: env.BACKUP_TOOLS?.trim() || 'docker',
    pgBin: env.BACKUP_PG_BIN?.trim() || '',
    scratchUrl: env.BACKUP_SCRATCH_URL?.trim(),
  };
}

async function connect(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 30_000, application_name: 'lasuatos-backup' });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      // A Neon database asleep on the free plan takes a few seconds to wake.
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
  throw lastError;
}

/** Encrypts `input` to the recipients, streaming, and checks the result names every one of them. */
async function encrypt(input, output, recipients) {
  const encrypter = new Encrypter();
  for (const recipient of recipients) encrypter.addRecipient(recipient);
  const encrypted = await encrypter.encrypt(Readable.toWeb(createReadStream(input)));
  await pipeline(Readable.fromWeb(encrypted), createWriteStream(output, { mode: 0o600 }));
  const handle = await open(output, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4_096), 0, 4_096, 0);
    const count = ageRecipientCount(buffer.subarray(0, bytesRead));
    if (count !== recipients.length) throw new Error(`the encrypted file names ${count} keys, expected ${recipients.length}`);
  } finally {
    await handle.close();
  }
}

/** A short-lived token from GitHub that proves this run is the backup workflow of this repository. */
async function githubIdentityToken(audience, env) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, { headers: { authorization: `bearer ${token}` } });
  if (!response.ok) throw new Error(`GitHub did not issue an identity token (${response.status})`);
  return (await response.json()).value;
}

async function report(config, body, env) {
  if (!config?.reportUrl) {
    log('No BACKUP_REPORT_URL: LASUATOS is not told about this run.');
    return;
  }
  try {
    const identity = await githubIdentityToken(new URL(config.reportUrl).origin, env);
    if (!identity) {
      log('Not running in GitHub Actions with id-token permission: report skipped.');
      return;
    }
    const response = await fetch(`${config.reportUrl}/api/v1/ops/backups`, {
      method: 'POST',
      headers: { authorization: `Bearer ${identity}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) log(`LASUATOS refused the report (${response.status}): ${redact(await response.text())}`);
    else log('Reported to LASUATOS.');
  } catch (error) {
    // The backup itself is what matters; a report that fails is caught by the daily check
    // in LASUATOS, which alerts when no good backup has been reported for 30 hours.
    // fetch hides the reason (refused, DNS, TLS) in `cause`.
    const why = error.cause?.message ? `${error.message} (${error.cause.message})` : error.message;
    log(`Could not report to LASUATOS: ${redact(why)}`);
  }
}

export async function runBackup(env = process.env, now = () => new Date()) {
  const startedAt = now();
  let config = null;
  let stage = 'config';
  let workDir = null;
  let tools = null;
  let store = null;
  let storeReady = false;
  const result = { startedAt: startedAt.toISOString() };
  const runInfo = {
    runId: Number(env.GITHUB_RUN_ID) || null,
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT) || 1,
  };

  try {
    config = readConfig(env);
    store = config.outputDir
      ? directoryStore({ directory: config.outputDir })
      : githubReleaseStore({ repository: config.repository, token: config.token });
    if (config.pooledAddressGiven) log('BACKUP_DATABASE_URL is the pooled address; using the direct one, which pg_dump needs.');
    await store.check().catch((error) => { throw new StageError('config', `cannot use ${store.label}: ${redact(error.message)}`); });
    storeReady = true;

    stage = 'connect';
    const client = await connect(config.databaseUrl);
    let live;
    let snapshot;
    let leastPrivilege;
    let migration;
    let major;
    try {
      const version = Number((await client.query(`select current_setting('server_version_num') as v`)).rows[0].v);
      major = Math.floor(version / 10_000);
      leastPrivilege = !(await canWrite(client));
      if (!leastPrivilege) log('Warning: this login can change data. Use the read-only login from pnpm prod:backup:role.');
      await client.query('begin isolation level repeatable read, read only');
      snapshot = (await client.query('select pg_export_snapshot() as id')).rows[0].id;
      live = await readInventory(client);
      migration = await appliedMigration(client);
      workDir = await mkdtemp(path.join(os.tmpdir(), 'lasuatos-backup-'));
      tools = config.tools === 'native'
        ? nativeTools({ bin: config.pgBin, scratchUrl: config.scratchUrl ?? (() => { throw new StageError('config', 'BACKUP_TOOLS=native needs BACKUP_SCRATCH_URL'); })() })
        : dockerTools({ major, workDir });
      const totals = inventoryTotals(live);
      log(`PostgreSQL ${major}; ${totals.tables} tables, ${totals.rows} rows; dumping with ${tools.label}.`);

      stage = 'dump';
      const toolVersion = await tools.version();
      const toolMajor = Number(/(\d+)/.exec(toolVersion)?.[1]);
      if (toolMajor < major) throw new StageError('dump', `${toolVersion} cannot dump a PostgreSQL ${major} server`);
      result.dumpFile = path.join(workDir, 'lasuatos.dump');
      await tools.dump({ url: config.databaseUrl, snapshot, file: result.dumpFile });
      await client.query('commit');
    } finally {
      await client.end().catch(() => undefined);
    }
    const plainSize = await fileSize(result.dumpFile);
    const plainSha256 = await sha256File(result.dumpFile);
    log(`Dump: ${formatBytes(plainSize)}.`);

    stage = 'restore';
    const scratchUrl = await tools.startScratch();
    let restored;
    try {
      await tools.restore({ file: result.dumpFile });
      stage = 'verify';
      const scratch = await connect(scratchUrl);
      try {
        restored = await readInventory(scratch);
      } finally {
        await scratch.end().catch(() => undefined);
      }
    } finally {
      await tools.stopScratch();
    }
    const problems = compareInventories(live, restored);
    if (problems.length) {
      throw new StageError('verify', `the restored copy differs from the database: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}`);
    }
    log('Verified: the restored copy matches the database exactly.');

    stage = 'encrypt';
    const tag = backupTag(startedAt);
    const encryptedFile = path.join(workDir, `lasuatos-${tag.slice(3)}.dump.age`);
    await encrypt(result.dumpFile, encryptedFile, config.recipients);
    await rm(result.dumpFile, { force: true });
    const size = await fileSize(encryptedFile);
    const sha256 = await sha256File(encryptedFile);
    const code = latestMigrationInCode();
    const totals = inventoryTotals(live);
    const manifest = {
      format: 'lasuatos-backup/1',
      tag,
      createdAt: startedAt.toISOString(),
      file: path.basename(encryptedFile),
      encryptedBytes: size,
      encryptedSha256: sha256,
      dumpBytes: plainSize,
      dumpSha256: plainSha256,
      postgres: major,
      dumpedWith: await tools.version(),
      encryption: { scheme: 'age (X25519)', recipients: config.recipients },
      schema: { appliedMigrationAt: migration, latestInCode: code.tag, current: migration === code.when },
      verified: { restoredInto: `PostgreSQL ${major}`, ...totals, objects: live.objects },
      tables: live.tables,
      readOnlyLogin: leastPrivilege,
      run: runInfo.runId ? { id: runInfo.runId, attempt: runInfo.runAttempt, repository: env.GITHUB_REPOSITORY ?? null } : null,
    };
    const manifestFile = path.join(workDir, 'manifest.json');
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    stage = 'upload';
    const when = `${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    await store.put({
      tag,
      title: `Backup ${when}`,
      notes: [
        `Encrypted LASUATOS database backup, ${when}.`,
        '',
        `- ${formatBytes(size)} encrypted (${formatBytes(plainSize)} dump), PostgreSQL ${major}`,
        `- Verified by a full restore: ${totals.tables} tables, ${totals.rows} rows`,
        `- SHA-256 ${sha256}`,
        '',
        'Open it with your private key: pnpm backup:check <file> (see docs/BACKUPS.md).',
      ].join('\n'),
      files: [encryptedFile, manifestFile],
    });
    log(`Stored ${path.basename(encryptedFile)} (${formatBytes(size)}) in ${store.label}.`);

    stage = 'prune';
    let warning = null;
    let kept = null;
    let oldestKept = null;
    try {
      const existing = await store.list();
      const selection = selectBackups(existing.includes(tag) ? existing : [...existing, tag], now());
      for (const old of selection.remove) {
        await store.remove(old);
        log(`Removed old backup ${old}.`);
      }
      kept = selection.keep.length;
      oldestKept = selection.oldestKept?.toISOString() ?? null;
    } catch (error) {
      warning = `Old backups could not be removed: ${redact(error.message)}`;
      log(warning);
    }

    const body = {
      ...runInfo,
      status: 'ok',
      stage: 'done',
      message: (warning ?? (leastPrivilege ? null : 'The backup login can change data; switch to the read-only login (pnpm prod:backup:role).'))?.slice(0, 300) ?? null,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      tag,
      location: store.url(tag),
      sizeBytes: size,
      sha256,
      tables: totals.tables,
      rows: totals.rows,
      kept,
      oldestKeptAt: oldestKept,
      readOnlyLogin: leastPrivilege,
      schemaCurrent: migration === code.when,
    };
    await report(config, body, env);
    log(`Done in ${Math.round((now().getTime() - startedAt.getTime()) / 1_000)} s. ${kept ?? '?'} backups kept.`);
    return { ok: true, manifest, body };
  } catch (error) {
    const failedStage = error instanceof StageError ? error.stage : stage;
    const message = redact(String(error?.message ?? error)).slice(0, 300);
    console.error(`[backup] FAILED at ${failedStage}: ${message}`);
    if (storeReady && failedStage !== 'prune') {
      // A failed night still removes copies past the keep rules, so deleted data never outlives
      // the 8 weeks the privacy notice promises, even while backups are failing. Copies inside
      // the rules stay, and the daily "backups stopped" email keeps asking for a fix.
      try {
        const existing = await store.list();
        for (const old of selectBackups(existing, now()).remove) {
          await store.remove(old);
          log(`Removed old backup ${old}.`);
        }
      } catch (pruneError) {
        log(`Old backups could not be removed: ${redact(pruneError.message)}`);
      }
    }
    await report(config, {
      ...runInfo,
      status: 'failed',
      stage: failedStage,
      message,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
    }, env);
    return { ok: false, stage: failedStage, message };
  } finally {
    await tools?.stopScratch?.().catch(() => undefined);
    // The plain dump is personal data: it never outlives the run.
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outcome = await runBackup();
  process.exit(outcome.ok ? 0 : 1);
}
