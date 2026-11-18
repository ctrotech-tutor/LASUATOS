#!/usr/bin/env node
// Opening backups with the private key, on your own computer.
//
//   pnpm backup:check   <file.dump.age> [--key <key file>]
//       The monthly drill. Proves the key opens the backup and that what comes out is the very
//       dump the nightly job restored and verified (same SHA-256 as in manifest.json). Nothing
//       is written to disk.
//
//   pnpm backup:decrypt <file.dump.age> [--key <key file>] [--out <file.dump>]
//       Writes the dump, for a real restore (docs/BACKUPS.md). It holds personal data: delete
//       it when done.
//
// The key file defaults to BACKUP_KEY_FILE, then lasuatos-backup-key.txt in your home folder.
// manifest.json is read from the same folder as the backup (download both from the release).

import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Decrypter } from 'age-encryption';
import { formatBytes } from './policy.mjs';

/** Every AGE-SECRET-KEY in a key file (comments and blank lines ignored). */
export function identitiesIn(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('AGE-SECRET-KEY-1'));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function openBackup({ file, keyFile, out = null }) {
  const identities = identitiesIn(readFileSync(keyFile, 'utf8'));
  if (identities.length === 0) throw new Error(`${keyFile} holds no private key (a line starting AGE-SECRET-KEY-1).`);

  const manifestFile = path.join(path.dirname(file), 'manifest.json');
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;
  if (manifest && manifest.file !== path.basename(file)) {
    throw new Error(`manifest.json beside it describes ${manifest.file}, not ${path.basename(file)}. Download the manifest of the same release.`);
  }
  if (manifest && (await sha256(file)) !== manifest.encryptedSha256) {
    throw new Error('The file is not the one the backup job stored (its SHA-256 differs from manifest.json): the download is incomplete or the file was changed.');
  }

  const decrypter = new Decrypter();
  for (const identity of identities) decrypter.addIdentity(identity);
  let plain;
  try {
    plain = await decrypter.decrypt(Readable.toWeb(createReadStream(file)));
  } catch (error) {
    throw new Error(`This key cannot open the backup (${error.message}). It was encrypted to: ${manifest?.encryption?.recipients?.join(', ') ?? 'see its manifest'}.`, { cause: error });
  }

  const hash = createHash('sha256');
  let bytes = 0;
  let head = Buffer.alloc(0);
  const measure = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      if (head.length < 5) head = Buffer.concat([head, chunk.subarray(0, 5 - head.length)]);
      callback(null, out ? chunk : undefined);
    },
  });
  const sink = out
    ? createWriteStream(out, { mode: 0o600, flags: 'wx' })
    : new Writable({ write: (_chunk, _encoding, callback) => callback() });
  try {
    await pipeline(Readable.fromWeb(plain), measure, sink);
  } catch (error) {
    // Never leave half a dump behind: it is personal data, and it would not restore anyway.
    if (out) await rm(out, { force: true }).catch(() => undefined);
    throw new Error(`The backup could not be decrypted to the end (${error.message}): it is damaged or incomplete.`, { cause: error });
  }

  const digest = hash.digest('hex');
  if (head.toString('latin1') !== 'PGDMP') throw new Error('It decrypted, but what came out is not a PostgreSQL dump.');
  if (manifest && digest !== manifest.dumpSha256) throw new Error('It decrypted, but the dump differs from the one the nightly job verified.');
  return { bytes, digest, manifest };
}

const commands = { check: false, decrypt: true };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (!(command in commands)) fail('Use: pnpm backup:check <file.dump.age> or pnpm backup:decrypt <file.dump.age>');
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const file = args.find((arg, index) => !arg.startsWith('--') && !['--key', '--out'].includes(args[index - 1]));
  if (!file || !existsSync(file)) fail('Give the backup file (lasuatos-….dump.age), downloaded from the backups repository with its manifest.json.');
  const keyFile = path.resolve(option('--key') ?? process.env.BACKUP_KEY_FILE ?? path.join(os.homedir(), 'lasuatos-backup-key.txt'));
  if (!existsSync(keyFile)) fail(`No key file at ${keyFile}. Point to it with --key.`);
  const out = commands[command] ? path.resolve(option('--out') ?? file.replace(/\.age$/, '')) : null;
  if (out && existsSync(out)) fail(`${out} already exists; choose another name with --out.`);

  try {
    const { bytes, manifest } = await openBackup({ file: path.resolve(file), keyFile, out });
    console.log(`OK: the key opens it, and it is a ${formatBytes(bytes)} PostgreSQL dump.`);
    if (manifest) {
      console.log(`It is the backup of ${manifest.createdAt} that was restored and verified the night it was made`);
      console.log(`(${manifest.verified.tables} tables, ${manifest.verified.rows} rows, PostgreSQL ${manifest.postgres}).`);
    } else {
      console.log('No manifest.json beside it, so it was not compared with what the nightly job verified.');
    }
    if (out) console.log(`\nDump written to ${out}. It holds personal data: delete it when the restore is done.`);
  } catch (error) {
    if (out) await rm(out, { force: true });
    fail(`Not OK: ${error.message}`);
  }
}
