import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDatabase } from '@lasuatos/database';
import { loadEnvironment } from '../env.js';
import { applyInstitutionSetup, formatSetupIssues, InstitutionSetupSchema, type SqlClient } from './setup.js';

const USAGE = `Usage: pnpm institution:setup [path/to/institution.json]
  Creates or updates the institution, faculties, departments, campuses, buildings,
  academic sessions and semesters named in the file (default: config/institution.json).
  Rows not in the file are left alone. Safe to run again after editing the file.`;

const argument = process.argv.slice(2).find((value) => value !== '--');
if (argument === '--help' || argument === '-h') {
  console.log(USAGE);
  process.exit(0);
}
// pnpm --filter runs this from apps/api; resolve relative paths from the repository root.
const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const file = path.resolve(repositoryRoot, argument ?? 'config/institution.json');

const environment = loadEnvironment();
if (!environment.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Put the production connection string in .env (or the shell) first.');
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  console.error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Copy config/institution.example.json to config/institution.json and edit it.');
  process.exit(2);
}
const parsed = InstitutionSetupSchema.safeParse(raw);
if (!parsed.success) {
  console.error(`${file} has problems:\n${formatSetupIssues(parsed.error)}`);
  process.exit(2);
}

if (parsed.data.institution.slug !== environment.SELF_REGISTRATION_INSTITUTION_SLUG) {
  console.warn(
    `Note: SELF_REGISTRATION_INSTITUTION_SLUG is "${environment.SELF_REGISTRATION_INSTITUTION_SLUG}" but this file sets up ` +
    `"${parsed.data.institution.slug}". Student sign-up and admin:bootstrap use SELF_REGISTRATION_INSTITUTION_SLUG, so set it to match.`,
  );
}

const database = createDatabase(environment.DATABASE_URL, {
  maxConnections: 1,
  connectionTimeoutMillis: environment.DATABASE_CONNECT_TIMEOUT_MS,
});
try {
  const summary = await database.transaction((client) => applyInstitutionSetup(client as unknown as SqlClient, parsed.data));
  console.log(`Institution "${parsed.data.institution.name}" (${parsed.data.institution.slug}) is set up:`);
  console.log(`  ${summary.faculties} faculties, ${summary.departments} departments`);
  console.log(`  ${summary.campuses} campuses, ${summary.buildings} buildings`);
  console.log(`  ${summary.academicSessions} academic sessions, ${summary.semesters} semesters` +
    (summary.currentSession ? ` (current: ${summary.currentSession})` : ''));
  console.log('Nothing outside the file was changed.');
} catch (error) {
  console.error(`Setup failed and nothing was saved: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
