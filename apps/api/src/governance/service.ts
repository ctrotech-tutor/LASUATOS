import type {
  AuditCategory,
  AuditCategoryCounts,
  AuditLogEntry,
  AuditLogPage,
  AuditSummary,
  RetentionPolicy,
  RetentionPreview,
  RetentionRunResult,
  RetentionRunSummary,
  RetentionSet,
  RetentionSetDetail,
  RetentionStudent,
} from '@lasuatos/contracts';
import { academicSetLabel, AUDIT_ENTRY_ID_PATTERN, AUDIT_EXPORT_MAX, AUDIT_PAGE_SIZE, AUDIT_SUMMARY_DAYS, RETENTION_LOOKAHEAD_MONTHS, RETENTION_RUNS_SHOWN } from '@lasuatos/contracts';
import type { AdministratorSessionAccount, AuthenticatedAccount } from '../auth/repository.js';
import { studentAuditSummary } from '../students/service.js';
import { describe, referencesOf } from './describe.js';
import { ATTENDANCE_ACTIONS, FACE_ACTIONS, type AuditCountRow, type AuditFilter, type AuditRow, type AuditScope, type GovernanceRepository, type RetentionRunRecord, type RetentionSetRow } from './repository.js';

export class GovernanceError extends Error {
  readonly exposeDetail = true;
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'GovernanceError';
  }
}

const PAGE_SIZE = AUDIT_PAGE_SIZE;
const DAY = 86_400_000;
/** Students listed for one set (RetentionSetDetailSchema allows 3000). */
const SET_STUDENTS_MAX = 3000;
/** Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET = '+01:00';

const OTHER_SUMMARIES: Record<string, string> = {
  attendee_added_by_hand: 'Added a student to a lecture by hand',
  attendee_removed: 'Removed a student from a lecture',
  attendance_appeal_sent: 'Took an attendance dispute to the department',
  attendance_appeal_upheld: 'Accepted an attendance appeal',
  attendance_appeal_rejected: 'Turned down an attendance appeal',
  invitation_created: 'Invited a staff member',
  invitation_resent: 'Resent a staff invitation',
  invitation_revoked: 'Withdrew a staff invitation',
  invitation_accepted: 'Accepted a staff invitation',
  staff_suspended: 'Suspended a staff account',
  staff_reactivated: 'Reactivated a staff account',
  staff_updated: 'Edited a staff member',
  staff_role_changed: 'Changed a staff member’s role or area',
  faculty_created: 'Added a faculty',
  faculty_updated: 'Edited a faculty',
  department_created: 'Added a department',
  department_updated: 'Edited a department',
  academic_session_created: 'Added an academic session',
  academic_session_updated: 'Edited an academic session',
  academic_session_made_current: 'Made an academic session current',
  building_created: 'Added a building',
  building_updated: 'Edited a building',
  venue_created: 'Added a venue',
  venue_updated: 'Edited a venue',
  venue_activated: 'Activated a venue',
  venue_deactivated: 'Made a venue inactive',
  venue_location_registered: 'Registered a venue’s location',
  venue_location_updated: 'Updated a venue’s location',
  venue_location_cleared: 'Cleared a venue’s location',
};

const faceActions = new Set<string>(FACE_ACTIONS);
const attendanceActions = new Set<string>(ATTENDANCE_ACTIONS);

function categoryOf(row: AuditRow): AuditCategory {
  if (row.source === 'venue') return 'venues';
  if (row.source === 'staff') return 'staff';
  if (row.source === 'structure') return /^(building|venue)_/.test(row.action) ? 'venues' : 'structure';
  if (row.action === 'retention_run') return 'retention';
  if (faceActions.has(row.action)) return 'faces';
  if (attendanceActions.has(row.action) || row.action.startsWith('attendee_') || row.action.startsWith('attendance_appeal_')) return 'attendance';
  return 'students';
}

/** The stored record as text; long JSON outlines (venue shapes) are dropped. */
function storedDetails(details: string): string {
  const text = details.trim();
  if (!text.startsWith('{')) return text.slice(0, 2000);
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !/outline|polygon|secret|hash|token/i.test(key)))).slice(0, 2000);
  } catch {
    return text.slice(0, 2000);
  }
}

function emptyCounts(): { -readonly [K in keyof AuditCategoryCounts]: number } {
  return { students: 0, faces: 0, attendance: 0, staff: 0, structure: 0, venues: 0, retention: 0 };
}

/** One CSV cell: quoted, with formula-looking text defused for spreadsheets. */
function csvCell(value: string | null | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const csvTime = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });

function encodeCursor(row: Pick<AuditRow, 'createdAt' | 'id'>): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [at, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const id = rest.join('|');
  const date = new Date(at ?? '');
  if (Number.isNaN(date.getTime()) || !AUDIT_ENTRY_ID_PATTERN.test(id)) return null;
  return { at: date, id };
}

function lagosDayStart(date: string, addDays = 0): Date {
  const start = new Date(`${date}T00:00:00${LAGOS_OFFSET}`);
  return new Date(start.getTime() + addDays * 86_400_000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const result = new Date(Date.UTC(year, month - 1 + months, day));
  return isoDate(result);
}

type AuditQuery = {
  readonly category?: AuditCategory | undefined;
  readonly q?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly actor?: string | undefined;
  readonly notable?: 'true' | undefined;
};

export interface GovernanceServiceOptions {
  readonly repository: GovernanceRepository;
  readonly policy: RetentionPolicy;
  /** True when a scheduled run is configured (CRON_SECRET). */
  readonly scheduled: boolean;
  readonly now?: () => Date;
}

/**
 * The administrator's audit log (one list over every audit trail) and data
 * retention (deleting the face data of sets that have graduated).
 */
export class GovernanceService {
  readonly #repository: GovernanceRepository;
  readonly #policy: RetentionPolicy;
  readonly #scheduled: boolean;
  readonly #now: () => Date;

  constructor(options: GovernanceServiceOptions) {
    this.#repository = options.repository;
    this.#policy = options.policy;
    this.#scheduled = options.scheduled;
    this.#now = options.now ?? (() => new Date());
  }

  #admin(account: AuthenticatedAccount): AdministratorSessionAccount {
    if (account.accountType !== 'administrator') throw new GovernanceError(403, 'Only administrators can open this page.');
    return account;
  }

  #scope(account: AdministratorSessionAccount): AuditScope {
    const scope = account.scope;
    if (scope.type === 'institution') return { type: 'institution', institutionId: account.institutionId };
    if (scope.type === 'faculty') return { type: 'faculty', institutionId: account.institutionId, facultyId: scope.id, actorUserId: account.id };
    return { type: 'department', institutionId: account.institutionId, departmentId: scope.id, actorUserId: account.id };
  }

  #filter(query: AuditQuery): Omit<AuditFilter, 'limit' | 'before' | 'id'> {
    if (query.from && query.to && query.from > query.to) throw new GovernanceError(400, 'The “from” date is after the “to” date.');
    return {
      category: query.category,
      query: query.q?.trim() || undefined,
      actorId: query.actor,
      notableOnly: query.notable === 'true' || undefined,
      from: query.from ? lagosDayStart(query.from) : undefined,
      to: query.to ? lagosDayStart(query.to, 1) : undefined,
    };
  }

  async auditLog(account: AuthenticatedAccount, query: AuditQuery & { readonly cursor?: string | undefined }): Promise<AuditLogPage> {
    const admin = this.#admin(account);
    const scope = this.#scope(admin);
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !before) throw new GovernanceError(400, 'That page link is not valid. Reload the audit log.');
    const filter = this.#filter(query);
    const rows = await this.#repository.listAudit(scope, { ...filter, before: before ?? undefined, limit: PAGE_SIZE + 1 });
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    let counts: AuditCategoryCounts | null = null;
    let actor: AuditLogPage['actor'] = null;
    if (!before) {
      const counted = await this.#repository.countAudit(scope, { ...filter, category: undefined }, this.#now());
      counts = this.#byCategory(counted.rows, 'count');
      if (query.actor) {
        const refs = await this.#repository.resolveReferences(admin.institutionId, { departments: [], sessions: [], users: [query.actor] });
        const name = refs.users.get(query.actor)?.name ?? page.find((row) => row.actorId === query.actor)?.actorName ?? null;
        actor = name ? { id: query.actor, name: name.slice(0, 160) } : null;
      }
    }
    return {
      entries: await this.#entries(admin.institutionId, page),
      nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
      scopeLabel: admin.scope.label,
      limitedToScope: scope.type !== 'institution',
      counts,
      actor,
    };
  }

  /** The last AUDIT_SUMMARY_DAYS days against the span before, and the newest notable entries. */
  async auditSummary(account: AuthenticatedAccount): Promise<AuditSummary> {
    const admin = this.#admin(account);
    const scope = this.#scope(admin);
    const now = this.#now();
    const since = new Date(now.getTime() - AUDIT_SUMMARY_DAYS * DAY);
    const counted = await this.#repository.countAudit(scope, { from: new Date(since.getTime() - AUDIT_SUMMARY_DAYS * DAY) }, since);
    const notableCounts = await this.#repository.countAudit(scope, { from: since, notableOnly: true }, since);
    const notableRows = await this.#repository.listAudit(scope, { from: since, notableOnly: true, limit: 5 });
    const notable = await this.#entries(admin.institutionId, notableRows);
    return {
      since: since.toISOString(),
      total: counted.rows.reduce((sum, row) => sum + row.recent, 0),
      previousTotal: counted.rows.reduce((sum, row) => sum + row.count - row.recent, 0),
      byCategory: this.#byCategory(counted.rows, 'recent'),
      people: counted.people,
      notableCount: notableCounts.rows.reduce((sum, row) => sum + row.count, 0),
      notable,
      scopeLabel: admin.scope.label,
      limitedToScope: scope.type !== 'institution',
    };
  }

  async auditEntry(account: AuthenticatedAccount, id: string): Promise<AuditLogEntry> {
    const admin = this.#admin(account);
    if (!AUDIT_ENTRY_ID_PATTERN.test(id)) throw new GovernanceError(400, 'That is not an audit log entry.');
    const [row] = await this.#repository.listAudit(this.#scope(admin), { id: id.toLowerCase(), limit: 1 });
    if (!row) throw new GovernanceError(404, 'That entry is not in your audit log.');
    const [entry] = await this.#entries(admin.institutionId, [row]);
    return entry!;
  }

  /** Up to AUDIT_EXPORT_MAX entries under the filters as CSV (UTF-8 with a BOM, for Excel). */
  async auditExport(account: AuthenticatedAccount, query: AuditQuery): Promise<{ readonly csv: string; readonly rows: number; readonly truncated: boolean }> {
    const admin = this.#admin(account);
    const rows = await this.#repository.listAudit(this.#scope(admin), { ...this.#filter(query), limit: AUDIT_EXPORT_MAX + 1 });
    const entries = await this.#entries(admin.institutionId, rows.slice(0, AUDIT_EXPORT_MAX));
    const lines = [['When (Lagos)', 'What', 'Category', 'By', 'About', 'Facts', 'Note', 'Worth a look', 'Entry'].map(csvCell).join(',')];
    for (const entry of entries) {
      const facts = entry.facts.map((item) => `${item.label}: ${item.previous !== null ? `${item.previous} to ${item.value}` : item.value}`).join('; ');
      lines.push([
        csvTime.format(new Date(entry.at)).replace(',', ''),
        entry.summary,
        entry.category,
        entry.actorName ?? 'System',
        entry.subject,
        facts,
        entry.note,
        entry.notable ? 'Yes' : '',
        entry.id,
      ].map(csvCell).join(','));
    }
    return { csv: `\uFEFF${lines.join('\r\n')}\r\n`, rows: entries.length, truncated: rows.length > AUDIT_EXPORT_MAX };
  }

  #byCategory(rows: readonly AuditCountRow[], field: 'count' | 'recent'): AuditCategoryCounts {
    const counts = emptyCounts();
    for (const row of rows) {
      const category = categoryOf({ source: row.source, action: row.action } as AuditRow);
      counts[category] += row[field];
    }
    return counts;
  }

  async #entries(institutionId: string, rows: readonly AuditRow[]): Promise<AuditLogEntry[]> {
    const wanted = { departments: new Set<string>(), sessions: new Set<string>(), users: new Set<string>() };
    for (const row of rows) {
      const refs = referencesOf(row);
      refs.departments.forEach((id) => wanted.departments.add(id));
      refs.sessions.forEach((id) => wanted.sessions.add(id));
      refs.users.forEach((id) => wanted.users.add(id));
    }
    const refs = await this.#repository.resolveReferences(institutionId, {
      departments: [...wanted.departments],
      sessions: [...wanted.sessions],
      users: [...wanted.users],
    });
    return rows.map((row) => this.#entry(row, describe(row, refs)));
  }

  #entry(row: AuditRow, described: ReturnType<typeof describe>): AuditLogEntry {
    const summary = row.source === 'student' && !row.action.startsWith('attendee_') && !row.action.startsWith('attendance_appeal_')
      ? (row.action === 'retention_run' && !row.subjectName && !row.matricNumber ? 'Ran data retention' : studentAuditSummary(row.action))
      : OTHER_SUMMARIES[row.action] ?? row.action.replace(/_/g, ' ');
    return {
      id: row.id.slice(0, 80),
      category: categoryOf(row),
      action: row.action.slice(0, 64),
      summary: summary.slice(0, 200),
      actorName: row.actorName ? row.actorName.slice(0, 160) : row.action === 'retention_run' ? 'Scheduled clean-up' : null,
      actorId: row.actorId,
      subject: described.subject,
      subjectSearch: described.subjectSearch,
      facts: described.facts,
      note: described.note,
      links: described.links,
      notable: described.notable,
      details: storedDetails(row.details),
      at: row.createdAt.toISOString(),
    };
  }

  /* ---------------- data retention ---------------- */

  get policy(): RetentionPolicy {
    return this.#policy;
  }

  #run(record: RetentionRunRecord): RetentionRunSummary {
    const read = (key: string) => Number(new RegExp(`(?:^|\\s)${key}=(\\d+)`).exec(record.details)?.[1] ?? 0);
    return {
      at: record.at.toISOString(),
      actorName: record.actorName,
      scheduled: /scheduled=true/.test(record.details),
      facesDeleted: read('faces'),
      checkPhotosDeleted: read('check_photos'),
    };
  }

  #set(row: RetentionSetRow): RetentionSet {
    const finishedOn = `${row.entryYear + row.programmeYears}-09-01`;
    return {
      departmentId: row.departmentId,
      departmentCode: row.departmentCode,
      departmentName: row.departmentName,
      entryYear: row.entryYear,
      setLabel: academicSetLabel(row.entryYear),
      programmeYears: row.programmeYears,
      finishedOn,
      dueOn: addMonths(finishedOn, this.#policy.graceMonths),
      students: row.students,
      faces: row.faces,
      dueFaces: row.dueFaces,
      keptActive: row.keptActive,
    };
  }

  async retentionPreview(account: AuthenticatedAccount): Promise<RetentionPreview> {
    const admin = this.#admin(account);
    const scope = this.#scope(admin);
    const now = this.#now();
    const until = new Date(now);
    until.setUTCMonth(until.getUTCMonth() + RETENTION_LOOKAHEAD_MONTHS);
    const [sets, holding, runs] = await Promise.all([
      this.#repository.listRetentionSets(scope, this.#policy, now, until),
      this.#repository.retentionHolding(scope, this.#policy, now),
      this.#repository.listRetentionRuns(admin.institutionId, RETENTION_RUNS_SHOWN),
    ]);
    const summaries = runs.map((run) => this.#run(run));
    return {
      policy: this.#policy,
      generatedAt: now.toISOString(),
      sets: sets.map((set) => this.#set(set)),
      due: { faces: sets.reduce((total, set) => total + set.dueFaces, 0), checkPhotos: holding.dueCheckPhotos },
      holding: {
        faces: holding.faces,
        facesUnlisted: holding.facesUnlisted,
        checkPhotos: holding.checkPhotos,
        oldestCheckPhotoAt: holding.oldestCheckPhotoAt?.toISOString() ?? null,
      },
      lastRun: summaries[0] ?? null,
      runs: summaries,
      scopeLabel: admin.scope.label,
      limitedToScope: scope.type !== 'institution',
      scheduled: this.#scheduled,
      canRun: admin.scope.type === 'institution',
    };
  }

  /** One set's students: whose face goes at the next run, who keeps it for now, and why. */
  async retentionSet(account: AuthenticatedAccount, departmentId: string, entryYear: number): Promise<RetentionSetDetail> {
    const admin = this.#admin(account);
    if (!/^[0-9a-f-]{36}$/i.test(departmentId) || !Number.isInteger(entryYear) || entryYear < 1950 || entryYear > 2200) {
      throw new GovernanceError(400, 'That is not a set.');
    }
    const found = await this.#repository.listSetStudents(this.#scope(admin), departmentId.toLowerCase(), entryYear, SET_STUDENTS_MAX + 1);
    if (!found || found.students.length === 0) throw new GovernanceError(404, 'That set is not in your area, or its class list is empty.');
    const now = this.#now();
    const finishedOn = `${entryYear + found.department.programmeYears}-09-01`;
    const dueOn = addMonths(finishedOn, this.#policy.graceMonths);
    const isDue = Date.parse(`${dueOn}T00:00:00Z`) <= now.getTime();
    const activeSince = now.getTime() - this.#policy.activeWithinDays * DAY;
    const shown = found.students.slice(0, SET_STUDENTS_MAX);
    const students = shown.map((row): RetentionStudent => {
      const active = row.lastCheckInAt !== null && row.lastCheckInAt.getTime() > activeSince;
      const state = row.faceRegisteredAt === null ? 'no_face' : !isDue ? 'waiting' : active ? 'keeping' : 'due';
      const listed = [row.firstName, row.middleName, row.surname].filter(Boolean).join(' ');
      return {
        matricNumber: row.matricNumber,
        name: (row.displayName?.trim() || listed).slice(0, 240),
        hasAccount: row.userId !== null,
        state,
        faceRegisteredAt: row.faceRegisteredAt?.toISOString() ?? null,
        lastCheckInAt: row.lastCheckInAt?.toISOString() ?? null,
        checkPhotos: row.checkPhotos,
      };
    });
    const count = (state: RetentionStudent['state']) => students.filter((student) => student.state === state).length;
    return {
      set: {
        departmentId: found.department.id,
        departmentCode: found.department.code,
        departmentName: found.department.name,
        entryYear,
        setLabel: academicSetLabel(entryYear),
        programmeYears: found.department.programmeYears,
        finishedOn,
        dueOn,
        students: students.length,
        faces: students.filter((student) => student.state !== 'no_face').length,
        dueFaces: count('due'),
        keptActive: count('keeping'),
      },
      students,
      truncated: found.students.length > SET_STUDENTS_MAX,
    };
  }

  async runRetention(account: AuthenticatedAccount): Promise<RetentionRunResult> {
    const admin = this.#admin(account);
    if (admin.scope.type !== 'institution') throw new GovernanceError(403, 'Only institution administrators can delete face data.');
    const now = this.#now();
    const result = await this.#repository.runRetention({ institutionId: admin.institutionId, policy: this.#policy, now, actorUserId: admin.id });
    return { ...result, ranAt: now.toISOString() };
  }

  /** The daily run (Vercel Cron): every institution, no actor. */
  async runScheduled(): Promise<{ readonly institutions: number; readonly facesDeleted: number; readonly checkPhotosDeleted: number }> {
    const now = this.#now();
    let facesDeleted = 0;
    let checkPhotosDeleted = 0;
    const institutions = await this.#repository.listInstitutionIds();
    for (const institutionId of institutions) {
      const result = await this.#repository.runRetention({ institutionId, policy: this.#policy, now, actorUserId: null });
      facesDeleted += result.facesDeleted;
      checkPhotosDeleted += result.checkPhotosDeleted;
    }
    return { institutions: institutions.length, facesDeleted, checkPhotosDeleted };
  }
}
