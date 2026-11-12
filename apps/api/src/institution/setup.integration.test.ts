import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../e2e/harness.js';
import { applyInstitutionSetup, InstitutionSetupSchema, type SqlClient } from './setup.js';

const examplePath = path.resolve(import.meta.dirname, '../../../../config/institution.example.json');

async function example() {
  return InstitutionSetupSchema.parse(JSON.parse(await readFile(examplePath, 'utf8')));
}

describe('institution setup', () => {
  it('accepts the shipped example configuration', async () => {
    const config = await example();
    expect(config.institution.slug).toBe('lasu');
    expect(config.academicSessions.filter((session) => session.current)).toHaveLength(1);
  });

  it('rejects duplicate department codes, inverted dates and two current sessions', () => {
    const result = InstitutionSetupSchema.safeParse({
      institution: { slug: 'lasu', name: 'Lagos State University' },
      faculties: [
        { code: 'SCI', name: 'Science', departments: [{ code: 'CSC', name: 'Computer Science' }] },
        { code: 'ENG', name: 'Engineering', departments: [{ code: 'csc', name: 'Duplicate' }] },
      ],
      academicSessions: [
        { code: 'A', startsAt: '2026-09-01T00:00:00+01:00', endsAt: '2026-08-01T00:00:00+01:00', current: true },
        { code: 'B', startsAt: '2026-09-01T00:00:00+01:00', endsAt: '2027-08-01T00:00:00+01:00', current: true,
          semesters: [{ name: 'First', startsAt: '2026-08-01T00:00:00+01:00', endsAt: '2027-01-01T00:00:00+01:00' }] },
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message).join('\n') ?? '';
    expect(messages).toContain('unique across the institution');
    expect(messages).toContain('must end after it starts');
    expect(messages).toContain('inside its academic session');
    expect(messages).toContain('At most one academic session can be current');
  });

  it('creates the structure once, updates it on re-run, and leaves other rows alone', async () => {
    const client = new PGlite();
    try {
      await applyMigrations(client);
      const sql = client as unknown as SqlClient;
      const config = await example();

      const first = await applyInstitutionSetup(sql, config);
      expect(first).toMatchObject({ faculties: 1, departments: 6, campuses: 1, academicSessions: 1, semesters: 2, currentSession: '2026/2027' });

      // An unrelated session that was current must stop being current; nothing is deleted.
      await client.query(
        `INSERT INTO academic_sessions (institution_id, code, starts_at, ends_at, is_current)
         VALUES ($1, 'OLD', '2020-01-01', '2020-12-31', false)`,
        [first.institutionId],
      );
      await client.query("UPDATE academic_sessions SET is_current = false WHERE code = '2026/2027'");
      await client.query("UPDATE academic_sessions SET is_current = true WHERE code = 'OLD'");

      const renamed = structuredClone(config);
      renamed.faculties[0]!.departments[0]!.name = 'Department of Electronic and Computer Engineering (renamed)';
      const second = await applyInstitutionSetup(sql, renamed);
      expect(second.institutionId).toBe(first.institutionId);

      const departments = await client.query<{ code: string; name: string }>('SELECT code, name FROM departments ORDER BY code');
      expect(departments.rows).toEqual([
        { code: 'AAE', name: 'Department of Aeronautical and Astronautical Engineering' },
        { code: 'CPE', name: 'Department of Chemical and Polymer Engineering' },
        { code: 'CVE', name: 'Department of Civil Engineering' },
        { code: 'ECE', name: 'Department of Electronic and Computer Engineering (renamed)' },
        { code: 'ISE', name: 'Department of Industrial and Systems Engineering' },
        { code: 'MEE', name: 'Department of Mechanical Engineering' },
      ]);
      // Programme length comes from the file; omitting it on a re-run keeps the stored value.
      const lengths = await client.query<{ code: string; programme_years: number }>('SELECT code, programme_years FROM departments ORDER BY code');
      expect(lengths.rows.map((row) => row.programme_years)).toEqual([5, 5, 5, 5, 5, 5]);
      const withoutLength = structuredClone(config);
      delete withoutLength.faculties[0]!.departments[0]!.programmeYears;
      withoutLength.faculties[0]!.departments[1]!.programmeYears = 4;
      await applyInstitutionSetup(sql, withoutLength);
      const relengthed = await client.query<{ code: string; programme_years: number }>('SELECT code, programme_years FROM departments ORDER BY code');
      expect(relengthed.rows).toEqual([
        { code: 'AAE', programme_years: 5 },
        { code: 'CPE', programme_years: 5 },
        { code: 'CVE', programme_years: 5 },
        { code: 'ECE', programme_years: 5 },
        { code: 'ISE', programme_years: 5 },
        { code: 'MEE', programme_years: 4 },
      ]);

      const sessions = await client.query<{ code: string; is_current: boolean }>('SELECT code, is_current FROM academic_sessions ORDER BY code');
      expect(sessions.rows).toEqual([
        { code: '2026/2027', is_current: true },
        { code: 'OLD', is_current: false },
      ]);
      const semesters = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM semesters');
      expect(semesters.rows[0]?.count).toBe(2);
    } finally {
      await client.close();
    }
  });

  it('refuses to move an existing department to another faculty', async () => {
    const client = new PGlite();
    try {
      await applyMigrations(client);
      const sql = client as unknown as SqlClient;
      const config = await example();
      await applyInstitutionSetup(sql, config);
      const moved = structuredClone(config);
      moved.faculties.push({ code: 'SCI', name: 'Faculty of Science', active: true, departments: moved.faculties[0]!.departments.splice(0, 1) });
      await expect(applyInstitutionSetup(sql, moved)).rejects.toThrow('belongs to a different faculty');
    } finally {
      await client.close();
    }
  });
});
