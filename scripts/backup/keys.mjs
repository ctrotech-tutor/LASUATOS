#!/usr/bin/env node
// pnpm backup:keygen: makes the key pair backups are encrypted with (age, X25519).
//
// The PUBLIC key (age1…) goes to GitHub as the variable BACKUP_AGE_RECIPIENTS; it can only
// lock backups. The PRIVATE key stays in the file this writes, on your computer, and is the
// only thing that can open a backup. GitHub never sees it, so nobody who gets into GitHub
// (or the backups) can read them. Lose it and every backup is unreadable: keep two copies.
//
//   pnpm backup:keygen                     writes lasuatos-backup-key.txt in your home folder
//   pnpm backup:keygen --out D:\keys\k.txt writes it there (a USB stick is a good second copy)

import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';

const args = process.argv.slice(2);
const index = args.indexOf('--out');
const file = path.resolve(index === -1 ? path.join(os.homedir(), 'lasuatos-backup-key.txt') : args[index + 1] ?? '');

if (existsSync(file)) {
  console.error(`${file} already exists, so nothing was changed.`);
  console.error('A new key would not open the backups made with the old one. To make one anyway, choose another file with --out.');
  process.exit(1);
}
const inside = path.relative(process.cwd(), file);
if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
  console.error('Keep the private key outside the repository folder, so it can never be committed. Choose another place with --out.');
  process.exit(1);
}

const identity = await generateX25519Identity();
const recipient = await identityToRecipient(identity);
writeFileSync(file, [
  '# LASUATOS backup key: the PRIVATE key that opens database backups.',
  `# created: ${new Date().toISOString()}`,
  `# public key: ${recipient}`,
  '# Keep two copies (for example a password manager and a USB stick). Never share it,',
  '# never put it in GitHub, chat or email. Without it the backups cannot be opened.',
  identity,
  '',
].join('\n'), { mode: 0o600, flag: 'wx' });

console.log(`Private key saved to ${file}`);
console.log('\nPublic key (safe to share; GitHub variable BACKUP_AGE_RECIPIENTS):\n');
console.log(`  ${recipient}\n`);
console.log('Next:');
console.log('  1. Copy the private key file somewhere else too (password manager, USB stick).');
console.log('  2. Add the public key above to GitHub: Settings → Secrets and variables → Actions → Variables.');
console.log('  3. Once the first backup exists, prove the key opens it: pnpm backup:check <file>.');
