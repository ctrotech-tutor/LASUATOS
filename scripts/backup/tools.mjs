// The PostgreSQL command-line tools and where backups are stored, behind small interfaces so
// the same nightly job runs on GitHub (Docker images, GitHub releases) and in tests (local
// binaries, a folder).

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redact } from './policy.mjs';

/** Runs a command; resolves with its output, rejects with its last error lines (redacted). */
export function run(command, args, { env, input, cwd, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(redact(String(chunk)) + '\n');
    });
    child.on('error', (error) => reject(new Error(`${command} could not start: ${redact(error.message)}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else {
        // The first line usually says what went wrong and the last ones where; keep both.
        const lines = stderr.split('\n').map((line) => line.trim()).filter(Boolean);
        const tail = (lines.length <= 3 ? lines : [lines[0], '…', ...lines.slice(-2)]).join(' ');
        reject(new Error(`${path.basename(command)} ${args[0] ?? ''} failed (exit ${code}): ${redact(tail) || 'no details'}`));
      }
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function fileSize(file) {
  return (await stat(file)).size;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * PostgreSQL tools as Docker images (on GitHub): the client is always the server's own major
 * version, and the restore check gets a fresh, empty server that is thrown away afterwards.
 * The connection string reaches the container as an environment variable, never as an
 * argument, so it is not in any process list or log.
 */
export function dockerTools({ major, workDir }) {
  const image = `postgres:${major}-alpine`;
  const container = `lasuatos-restore-check-${process.pid}`;
  const port = 55_432;
  const password = createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 24);
  return {
    label: `Docker ${image}`,
    async dump({ url, snapshot, file }) {
      await run('docker', ['pull', '--quiet', image], { quiet: true });
      await run('docker', [
        'run', '--rm', '--network', 'host', '-e', 'LASUATOS_DATABASE', '-v', `${workDir}:/work`, image,
        'sh', '-c', `pg_dump --format=custom --no-sync --lock-wait-timeout=120000 --snapshot="$1" --file="/work/$2" --dbname="$LASUATOS_DATABASE"`, 'sh', snapshot, path.basename(file),
      ], { env: { LASUATOS_DATABASE: url } });
    },
    async version() {
      return (await run('docker', ['run', '--rm', image, 'pg_dump', '--version'], { quiet: true })).trim();
    },
    async startScratch() {
      await run('docker', [
        'run', '-d', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=restore_check',
        '-p', `127.0.0.1:${port}:5432`, '-v', `${workDir}:/work:ro`, image,
      ], { quiet: true });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
          await run('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'restore_check', '-h', '127.0.0.1'], { quiet: true });
          // pg_isready answers during the image's first-start restart; give it a moment to settle.
          await sleep(1_500);
          await run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-Atc', 'select 1'], { quiet: true });
          return `postgresql://postgres:${password}@127.0.0.1:${port}/restore_check`;
        } catch {
          await sleep(1_000);
        }
      }
      throw new Error('the throwaway PostgreSQL server for the restore check did not start');
    },
    async restore({ file }) {
      await run('docker', [
        'exec', container, 'pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction',
        '-U', 'postgres', '-d', 'restore_check', `/work/${path.basename(file)}`,
      ]);
    },
    async stopScratch() {
      await run('docker', ['rm', '--force', container], { quiet: true }).catch(() => undefined);
    },
  };
}

/**
 * Local PostgreSQL binaries (tests and a self-hosted machine). The restore check uses a
 * database on `scratchUrl`'s server, dropped and created fresh each run.
 */
export function nativeTools({ bin = '', scratchUrl }) {
  const tool = (name) => (bin ? path.join(bin, name) : name);
  const scratchName = 'lasuatos_restore_check';
  const scratch = new URL(scratchUrl);
  const admin = new URL(scratchUrl);
  scratch.pathname = `/${scratchName}`;
  return {
    label: 'local PostgreSQL tools',
    async dump({ url, snapshot, file }) {
      await run(tool('pg_dump'), ['--format=custom', '--no-sync', '--lock-wait-timeout=120000', `--snapshot=${snapshot}`, `--file=${file}`, `--dbname=${url}`]);
    },
    async version() {
      return (await run(tool('pg_dump'), ['--version'], { quiet: true })).trim();
    },
    async startScratch() {
      await run(tool('psql'), ['-X', '-q', '-d', admin.toString(), '-c', `drop database if exists ${scratchName}`, '-c', `create database ${scratchName}`], { quiet: true });
      return scratch.toString();
    },
    async restore({ file }) {
      await run(tool('pg_restore'), ['--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', '-d', scratch.toString(), file]);
    },
    async stopScratch() {
      await run(tool('psql'), ['-X', '-q', '-d', admin.toString(), '-c', `drop database if exists ${scratchName}`], { quiet: true }).catch(() => undefined);
    },
  };
}

/**
 * Backups as releases of a private GitHub repository: one release per backup, holding the
 * encrypted dump and its manifest. Release files have no total size limit (each must be
 * under 2 GiB), unlike Actions artifacts, which share 500 MB on a free private repository.
 */
export function githubReleaseStore({ repository, token }) {
  const env = { GH_TOKEN: token, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' };
  return {
    label: `GitHub releases of ${repository}`,
    async check() {
      // The REST API answers the same on every gh version (gh repo view --json fields vary).
      const ask = async (endpoint) => {
        try {
          return JSON.parse(await run('gh', ['api', endpoint], { env, quiet: true }));
        } catch (error) {
          if (/HTTP 401/.test(error.message)) throw new Error('BACKUP_GITHUB_TOKEN is not accepted by GitHub: it is wrong or has expired (docs/BACKUPS.md, step 3)', { cause: error });
          if (/HTTP 403/.test(error.message)) throw new Error(`the token is not allowed to read ${repository}: give it Contents read and write on that repository (docs/BACKUPS.md, step 3)`, { cause: error });
          if (/HTTP 404/.test(error.message)) throw new Error(`the token cannot see ${repository}: check the name, and that the token's Repository access includes it (docs/BACKUPS.md, step 3)`, { cause: error });
          throw error;
        }
      };
      const info = await ask(`repos/${repository}`);
      if (info.private !== true) throw new Error(`${repository} is public; backups go only to a private repository`);
      // A release needs a commit for its tag: a repository created without a README has none.
      const branches = await ask(`repos/${repository}/branches?per_page=1`);
      if (!Array.isArray(branches) || branches.length === 0) throw new Error(`${repository} is empty; add a README to it once (docs/BACKUPS.md, step 2)`);
    },
    async list() {
      const output = await run('gh', ['release', 'list', '--repo', repository, '--limit', '1000', '--json', 'tagName', '--jq', '.[].tagName'], { env, quiet: true });
      return output.split('\n').map((line) => line.trim()).filter(Boolean);
    },
    async put({ tag, title, notes, files }) {
      await run('gh', ['release', 'create', tag, ...files, '--repo', repository, '--title', title, '--notes', notes], { env, quiet: true });
    },
    async remove(tag) {
      await run('gh', ['release', 'delete', tag, '--repo', repository, '--yes', '--cleanup-tag'], { env, quiet: true });
    },
    url(tag) {
      return `https://github.com/${repository}/releases/tag/${tag}`;
    },
  };
}

/** Backups as folders (tests, or a copy on a machine you control). */
export function directoryStore({ directory }) {
  return {
    label: `folder ${directory}`,
    async check() {
      await mkdir(directory, { recursive: true });
    },
    async list() {
      return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    },
    async put({ tag, files }) {
      const target = path.join(directory, tag);
      await mkdir(target, { recursive: true });
      for (const file of files) await cp(file, path.join(target, path.basename(file)));
    },
    async remove(tag) {
      await rm(path.join(directory, tag), { recursive: true, force: true });
    },
    /** Only web addresses are reported to LASUATOS; a folder stays on this machine. */
    url() {
      return null;
    },
  };
}
