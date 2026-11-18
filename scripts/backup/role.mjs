#!/usr/bin/env node
// pnpm prod:backup:role: makes (or renews) the read-only database login the nightly backup
// uses, and prints its connection string for the GitHub secret BACKUP_DATABASE_URL.
//
// Run with the OWNER connection string in .env.production (DATABASE_URL). The new login can
// read every table and sequence, including tables added by later migrations, and nothing
// else: it cannot change or delete data, so a leaked backup secret cannot damage LASUATOS.
//
// Neon does not allow granting pg_read_all_data, so read access is granted schema by schema
// with default privileges for future tables. Running this again gives a new password (the
// old one stops working) and re-applies the grants, which is also the fix if a backup ever
// fails with "permission denied".
//
// Options:
//   --role <name>          Login name (default lasuatos_backup).
//   --set-github-secret    Store the connection string straight in the GitHub secret with the
//                          gh CLI (signed in, in this repository), instead of printing it.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { directConnectionString } from './policy.mjs';
import { canWrite, readInventory } from './inventory.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const role = option('--role') ?? 'lasuatos_backup';
const setSecret = args.includes('--set-github-secret');

if (!/^[a-z_][a-z0-9_]{2,62}$/.test(role)) {
  console.error('The login name may use lowercase letters, digits and _ only.');
  process.exit(1);
}
const ownerUrl = process.env.DATABASE_URL?.trim();
if (!ownerUrl) {
  console.error('DATABASE_URL is not set. Put the owner connection string in .env.production and run pnpm prod:backup:role.');
  process.exit(1);
}

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const owner = new pg.Client({ connectionString: directConnectionString(ownerUrl).url, connectionTimeoutMillis: 30_000 });
await owner.connect();

let backupUrl;
try {
  const { rows: [me] } = await owner.query('select current_user as name, current_database() as database');
  if (me.name === role) throw new Error(`DATABASE_URL already signs in as ${role}. Use the owner connection string.`);
  // Neon asks for at least 60 bits of entropy; this is 192.
  const password = randomBytes(24).toString('base64url');
  const schemas = (await owner.query(`
    select nspname from pg_namespace
    where nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and nspname not like 'pg_temp_%' and nspname not like 'pg_toast_temp_%'
    order by nspname`)).rows.map((row) => row.nspname);

  await owner.query('begin');
  const exists = (await owner.query('select 1 from pg_roles where rolname = $1', [role])).rowCount > 0;
  // Passwords cannot be bound parameters in CREATE/ALTER ROLE; it is base64url, so it holds no quote.
  // Renewing names only what the owner may change on an existing login (PostgreSQL 16 refuses
  // to restate attributes such as NOREPLICATION); the check below still proves it cannot write.
  await owner.query(exists
    ? `ALTER ROLE ${quote(role)} WITH LOGIN CONNECTION LIMIT 3 PASSWORD '${password}'`
    : `CREATE ROLE ${quote(role)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 3 PASSWORD '${password}'`);
  // A second lock: every transaction this login starts is read-only.
  await owner.query(`ALTER ROLE ${quote(role)} SET default_transaction_read_only = on`);
  await owner.query(`ALTER ROLE ${quote(role)} SET idle_in_transaction_session_timeout = '30min'`);
  await owner.query(`GRANT CONNECT ON DATABASE ${quote(me.database)} TO ${quote(role)}`);
  for (const schema of schemas) {
    await owner.query(`GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(role)}`);
    await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${quote(schema)} TO ${quote(role)}`);
    await owner.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA ${quote(schema)} TO ${quote(role)}`);
    await owner.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(me.name)} IN SCHEMA ${quote(schema)} GRANT SELECT ON TABLES TO ${quote(role)}`);
    await owner.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(me.name)} IN SCHEMA ${quote(schema)} GRANT SELECT ON SEQUENCES TO ${quote(role)}`);
  }
  // Schemas made later (by a migration) can be read too.
  await owner.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(me.name)} GRANT USAGE ON SCHEMAS TO ${quote(role)}`);
  await owner.query('commit');

  const url = new URL(directConnectionString(ownerUrl).url);
  url.username = role;
  url.password = password;
  backupUrl = url.toString();
  console.log(`${exists ? 'Renewed' : 'Created'} the read-only login ${role} on ${me.database} (${schemas.length} schemas).`);
} catch (error) {
  await owner.query('rollback').catch(() => undefined);
  console.error(`Could not set up the backup login: ${error.message}`);
  process.exit(1);
} finally {
  await owner.end();
}

// Prove it: the new login reads everything a backup needs, and cannot write.
const check = new pg.Client({ connectionString: backupUrl, connectionTimeoutMillis: 30_000 });
try {
  await check.connect();
  await check.query('begin isolation level repeatable read, read only');
  const inventory = await readInventory(check);
  await check.query('select pg_export_snapshot()');
  await check.query('commit');
  if (await canWrite(check)) throw new Error('the login can still change data');
  const refused = await check.query('create temporary table lasuatos_backup_probe (id int)').then(() => false, () => true);
  if (!refused) throw new Error('the login could create a table');
  console.log(`Checked: it reads all ${inventory.tables.length} tables and ${inventory.sequences.length} sequences, and cannot change anything.`);
} catch (error) {
  console.error(`The new login does not work as it should: ${error.message}`);
  process.exit(1);
} finally {
  await check.end().catch(() => undefined);
}

if (setSecret) {
  const result = spawnSync('gh', ['secret', 'set', 'BACKUP_DATABASE_URL'], { input: backupUrl, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.status === 0) {
    console.log('Saved as the GitHub secret BACKUP_DATABASE_URL.');
    process.exit(0);
  }
  console.error('gh could not save the secret (is it installed and signed in?). Here it is to paste instead:');
}
console.log('\nPaste this as the GitHub secret BACKUP_DATABASE_URL (Settings → Secrets and variables → Actions).');
console.log('It is a password: do not put it in chat, email or a file in the repository.\n');
console.log(backupUrl);
