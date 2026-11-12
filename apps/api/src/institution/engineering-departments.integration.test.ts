import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * Migration 0016 adds the missing LASU engineering departments to databases that were
 * set up before them (production started with ECE, MEE and CPE).
 */
const migrationDirectory = path.resolve(import.meta.dirname, '../../../../packages/database/drizzle/migrations');
const TARGET = '0016_lasu_engineering_departments.sql';

async function runFile(client: PGlite, file: string) {
  const text = await readFile(path.join(migrationDirectory, file), 'utf8');
  for (const statement of text.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    await client.exec(statement);
  }
}

/** Schema as it was just before 0016. */
async function databaseBefore(): Promise<PGlite> {
  const client = new PGlite();
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    if (file === TARGET) break;
    await runFile(client, file);
  }
  return client;
}

async function institutionWith(client: PGlite, slug: string, faculty: { code: string; name: string }, departments: [string, string][]) {
  const institution = await client.query<{ id: string }>(
    `INSERT INTO institutions (slug, name) VALUES ($1, 'Lagos State University') RETURNING id`, [slug]);
  const institutionId = institution.rows[0]!.id;
  const created = await client.query<{ id: string }>(
    'INSERT INTO faculties (institution_id, code, name) VALUES ($1, $2, $3) RETURNING id', [institutionId, faculty.code, faculty.name]);
  for (const [code, name] of departments) {
    await client.query(
      'INSERT INTO departments (institution_id, faculty_id, code, name, programme_years) VALUES ($1, $2, $3, $4, 5)',
      [institutionId, created.rows[0]!.id, code, name]);
  }
  return institutionId;
}

const departmentsOf = (client: PGlite) =>
  client.query<{ code: string; name: string; programme_years: number; is_active: boolean }>(
    'SELECT code, name, programme_years, is_active FROM departments ORDER BY code').then((result) => result.rows);

describe('migration 0016: LASU engineering departments', () => {
  it('adds the three missing departments to a production-like database, keeping the existing ones untouched', async () => {
    const client = await databaseBefore();
    try {
      await institutionWith(client, 'lasu', { code: 'ENG', name: 'Faculty of Engineering' }, [
        ['ECE', 'Department of Electronic and Computer Engineering'],
        ['MEE', 'Mechanical Engineering (renamed by an admin)'],
        ['CPE', 'Department of Chemical and Polymer Engineering'],
      ]);
      await runFile(client, TARGET);
      await runFile(client, TARGET); // safe to run again
      expect(await departmentsOf(client)).toEqual([
        { code: 'AAE', name: 'Department of Aeronautical and Astronautical Engineering', programme_years: 5, is_active: true },
        { code: 'CPE', name: 'Department of Chemical and Polymer Engineering', programme_years: 5, is_active: true },
        { code: 'CVE', name: 'Department of Civil Engineering', programme_years: 5, is_active: true },
        { code: 'ECE', name: 'Department of Electronic and Computer Engineering', programme_years: 5, is_active: true },
        { code: 'ISE', name: 'Department of Industrial and Systems Engineering', programme_years: 5, is_active: true },
        { code: 'MEE', name: 'Mechanical Engineering (renamed by an admin)', programme_years: 5, is_active: true },
      ]);
    } finally {
      await client.close();
    }
  });

  it('does not duplicate a department an admin already added under another code', async () => {
    const client = await databaseBefore();
    try {
      await institutionWith(client, 'lasu', { code: 'FOE', name: 'Faculty of Engineering' }, [
        ['CVL', 'Civil Engineering'],
        ['IND', 'Department of Industrial & Systems Engineering'],
      ]);
      await runFile(client, TARGET);
      expect((await departmentsOf(client)).map((row) => row.code)).toEqual(['AAE', 'CPE', 'CVL', 'ECE', 'IND', 'MEE']);
    } finally {
      await client.close();
    }
  });

  it('does nothing without the LASU institution or its engineering faculty', async () => {
    const client = await databaseBefore();
    try {
      await institutionWith(client, 'lasuatos-local-demo', { code: 'ENG', name: 'Faculty of Engineering' }, [['CSC', 'Computer Science']]);
      await institutionWith(client, 'lasu', { code: 'SCI', name: 'Faculty of Science' }, [['PHY', 'Physics']]);
      await runFile(client, TARGET);
      expect((await departmentsOf(client)).map((row) => row.code)).toEqual(['CSC', 'PHY']);
    } finally {
      await client.close();
    }
  });
});
