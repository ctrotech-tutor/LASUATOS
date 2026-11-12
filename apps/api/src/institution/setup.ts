import { z } from 'zod';

/**
 * Institution structure setup for a fresh production database: the
 * institution itself, faculties and departments, campuses and buildings, and
 * academic sessions with their semesters. Nothing else in the product can
 * create these rows, and lecturers cannot create course offerings until a
 * semester exists. Students, courses, enrollments and attendance are NOT set
 * up here; they are created by people using the app.
 *
 * The configuration file is the source of truth for the rows it names: names,
 * dates and active flags are updated to match on every run. Rows that are not
 * in the file are never deleted or changed.
 */

const code = (max: number) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Use letters, digits, dots, dashes, underscores or slashes.');
const name = (max: number) => z.string().trim().min(1).max(max);
const instant = z.iso.datetime({ offset: true });

const DepartmentSchema = z.object({
  code: code(40),
  name: name(160),
  active: z.boolean().default(true),
  /**
   * Length of the department's undergraduate programme in years (4 by
   * default; 5 for engineering, law and similar; 6 for medicine). Caps the
   * level derived from students' matric numbers. Left unchanged on re-run
   * when omitted.
   */
  programmeYears: z.number().int().min(1).max(8).optional(),
}).strict();
const FacultySchema = z.object({
  code: code(40),
  name: name(160),
  active: z.boolean().default(true),
  departments: z.array(DepartmentSchema).max(200).default([]),
}).strict();
const BuildingSchema = z.object({ code: code(40), name: name(160), active: z.boolean().default(true) }).strict();
const CampusSchema = z.object({
  code: code(40),
  name: name(160),
  address: z.string().trim().max(500).nullable().default(null),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  active: z.boolean().default(true),
  buildings: z.array(BuildingSchema).max(500).default([]),
}).strict();
const SemesterSchema = z.object({ name: name(80), startsAt: instant, endsAt: instant }).strict();
const AcademicSessionSchema = z.object({
  code: code(32),
  startsAt: instant,
  endsAt: instant,
  current: z.boolean().default(false),
  semesters: z.array(SemesterSchema).max(6).default([]),
}).strict();

export const InstitutionSetupSchema = z.object({
  institution: z.object({
    slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single dashes.'),
    name: name(200),
    timezone: z.string().trim().min(1).max(64).default('Africa/Lagos'),
  }).strict(),
  faculties: z.array(FacultySchema).max(100).default([]),
  campuses: z.array(CampusSchema).max(50).default([]),
  academicSessions: z.array(AcademicSessionSchema).max(20).default([]),
}).strict().superRefine((config, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });

  try {
    new Intl.DateTimeFormat('en', { timeZone: config.institution.timezone });
  } catch {
    issue(['institution', 'timezone'], 'Use an IANA time zone such as Africa/Lagos.');
  }

  const facultyCodes = new Set<string>();
  const departmentCodes = new Set<string>();
  config.faculties.forEach((faculty, facultyIndex) => {
    const facultyKey = faculty.code.toUpperCase();
    if (facultyCodes.has(facultyKey)) issue(['faculties', facultyIndex, 'code'], `Faculty code ${faculty.code} is listed twice.`);
    facultyCodes.add(facultyKey);
    faculty.departments.forEach((department, departmentIndex) => {
      // Staff invitations and bootstrap look departments up by code across the institution.
      const key = department.code.toUpperCase();
      if (departmentCodes.has(key)) {
        issue(['faculties', facultyIndex, 'departments', departmentIndex, 'code'], `Department code ${department.code} is used more than once; codes must be unique across the institution.`);
      }
      departmentCodes.add(key);
    });
  });

  const campusCodes = new Set<string>();
  config.campuses.forEach((campus, campusIndex) => {
    const key = campus.code.toUpperCase();
    if (campusCodes.has(key)) issue(['campuses', campusIndex, 'code'], `Campus code ${campus.code} is listed twice.`);
    campusCodes.add(key);
    if ((campus.latitude === null) !== (campus.longitude === null)) {
      issue(['campuses', campusIndex], 'Give both latitude and longitude, or neither.');
    }
    const buildingCodes = new Set<string>();
    campus.buildings.forEach((building, buildingIndex) => {
      const buildingKey = building.code.toUpperCase();
      if (buildingCodes.has(buildingKey)) issue(['campuses', campusIndex, 'buildings', buildingIndex, 'code'], `Building code ${building.code} is listed twice on this campus.`);
      buildingCodes.add(buildingKey);
    });
  });

  const sessionCodes = new Set<string>();
  let currentSessions = 0;
  config.academicSessions.forEach((session, sessionIndex) => {
    if (sessionCodes.has(session.code)) issue(['academicSessions', sessionIndex, 'code'], `Session ${session.code} is listed twice.`);
    sessionCodes.add(session.code);
    if (session.current) currentSessions += 1;
    const sessionStart = Date.parse(session.startsAt);
    const sessionEnd = Date.parse(session.endsAt);
    if (sessionEnd <= sessionStart) issue(['academicSessions', sessionIndex, 'endsAt'], 'The session must end after it starts.');
    const semesterNames = new Set<string>();
    session.semesters.forEach((semester, semesterIndex) => {
      const path = ['academicSessions', sessionIndex, 'semesters', semesterIndex];
      if (semesterNames.has(semester.name)) issue([...path, 'name'], `Semester ${semester.name} is listed twice in this session.`);
      semesterNames.add(semester.name);
      const start = Date.parse(semester.startsAt);
      const end = Date.parse(semester.endsAt);
      if (end <= start) issue([...path, 'endsAt'], 'The semester must end after it starts.');
      if (start < sessionStart || end > sessionEnd) issue(path, 'The semester must fall inside its academic session.');
    });
  });
  if (currentSessions > 1) issue(['academicSessions'], 'At most one academic session can be current.');
});

export type InstitutionSetup = z.infer<typeof InstitutionSetupSchema>;

/** The subset of node-postgres / PGlite used here, so tests can run against embedded PostgreSQL. */
export interface SqlClient {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface InstitutionSetupSummary {
  readonly institutionId: string;
  readonly faculties: number;
  readonly departments: number;
  readonly campuses: number;
  readonly buildings: number;
  readonly academicSessions: number;
  readonly semesters: number;
  readonly currentSession: string | null;
}

async function single(client: SqlClient, text: string, params: unknown[]): Promise<string> {
  const { rows } = await client.query<{ id: string }>(text, params);
  const id = rows[0]?.id;
  if (!id) throw new Error('A setup row could not be written.');
  return id;
}

/** Applies the configuration. Call inside a transaction; it is safe to run repeatedly. */
export async function applyInstitutionSetup(client: SqlClient, config: InstitutionSetup): Promise<InstitutionSetupSummary> {
  const institutionId = await single(client,
    `INSERT INTO institutions (slug, name, timezone) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone, updated_at = now()
     RETURNING id`,
    [config.institution.slug, config.institution.name, config.institution.timezone]);

  let departmentCount = 0;
  for (const faculty of config.faculties) {
    const facultyId = await single(client,
      `INSERT INTO faculties (institution_id, code, name, is_active) VALUES ($1, $2, $3, $4)
       ON CONFLICT (institution_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active, updated_at = now()
       RETURNING id`,
      [institutionId, faculty.code, faculty.name, faculty.active]);
    for (const department of faculty.departments) {
      const existing = await client.query<{ id: string; faculty_id: string }>(
        'SELECT id, faculty_id FROM departments WHERE institution_id = $1 AND upper(code) = upper($2) LIMIT 1',
        [institutionId, department.code]);
      const row = existing.rows[0];
      if (row && row.faculty_id !== facultyId) {
        throw new Error(`Department ${department.code} already belongs to a different faculty; move it by hand if that is intended.`);
      }
      if (row) {
        await client.query(
          `UPDATE departments SET name = $2, is_active = $3, programme_years = COALESCE($4, programme_years), updated_at = now()
           WHERE id = $1`,
          [row.id, department.name, department.active, department.programmeYears ?? null]);
      } else {
        await single(client,
          `INSERT INTO departments (institution_id, faculty_id, code, name, is_active, programme_years)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6, 4))
           RETURNING id`,
          [institutionId, facultyId, department.code, department.name, department.active, department.programmeYears ?? null]);
      }
      departmentCount += 1;
    }
  }

  let buildingCount = 0;
  for (const campus of config.campuses) {
    const campusId = await single(client,
      `INSERT INTO campuses (institution_id, code, name, address, latitude, longitude, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (institution_id, code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address,
         latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, is_active = EXCLUDED.is_active, updated_at = now()
       RETURNING id`,
      [institutionId, campus.code, campus.name, campus.address, campus.latitude, campus.longitude, campus.active]);
    for (const building of campus.buildings) {
      await single(client,
        `INSERT INTO buildings (institution_id, campus_id, code, name, is_active) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (campus_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active, updated_at = now()
         RETURNING id`,
        [institutionId, campusId, building.code, building.name, building.active]);
      buildingCount += 1;
    }
  }

  const current = config.academicSessions.find((session) => session.current);
  if (current) {
    // Clear first: one current session per institution is enforced by a partial unique index.
    await client.query(
      'UPDATE academic_sessions SET is_current = false, updated_at = now() WHERE institution_id = $1 AND is_current = true AND code <> $2',
      [institutionId, current.code]);
  }
  let semesterCount = 0;
  for (const session of config.academicSessions) {
    const sessionId = await single(client,
      `INSERT INTO academic_sessions (institution_id, code, starts_at, ends_at, is_current) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (institution_id, code) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
         is_current = EXCLUDED.is_current, updated_at = now()
       RETURNING id`,
      [institutionId, session.code, session.startsAt, session.endsAt, session.current]);
    for (const semester of session.semesters) {
      await single(client,
        `INSERT INTO semesters (institution_id, academic_session_id, name, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (academic_session_id, name) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
         RETURNING id`,
        [institutionId, sessionId, semester.name, semester.startsAt, semester.endsAt]);
      semesterCount += 1;
    }
  }

  return {
    institutionId,
    faculties: config.faculties.length,
    departments: departmentCount,
    campuses: config.campuses.length,
    buildings: buildingCount,
    academicSessions: config.academicSessions.length,
    semesters: semesterCount,
    currentSession: current?.code ?? null,
  };
}

export function formatSetupIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.length ? issue.path.join('.') : '(file)'}: ${issue.message}`)
    .join('\n');
}
