import type {
  AuditCategory,
  AuditLogEntry,
  AuditLogPage,
  RetentionPolicy,
  RetentionPreview,
  RetentionRunResult,
  RetentionRunSummary,
} from '@lasuatos/contracts';
import { academicSetLabel } from '@lasuatos/contracts';
import type { AdministratorSessionAccount, AuthenticatedAccount } from '../auth/repository.js';
import { studentAuditSummary } from '../students/service.js';
import { ATTENDANCE_ACTIONS, FACE_ACTIONS, type AuditRow, type AuditScope, type GovernanceRepository } from './repository.js';

export class GovernanceError extends Error {
  readonly exposeDetail = true;
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'GovernanceError';
  }
}

const PAGE_SIZE = 50;
/** Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET = '+01:00';

const OTHER_SUMMARIES: Record<string, string> = {
  attendee_added_by_hand: 'Added a student to a lecture by hand',
  attendee_removed: 'Removed a student from a lecture',
  invitation_created: 'Invited a staff member',
  invitation_resent: 'Resent a staff invitation',
  invitation_revoked: 'Withdrew a staff invitation',
  invitation_accepted: 'Accepted a staff invitation',
  staff_suspended: 'Suspended a staff account',
  staff_reactivated: 'Reactivated a staff account',
  staff_updated: 'Edited a staff member',
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
  if (attendanceActions.has(row.action) || row.action.startsWith('attendee_')) return 'attendance';
  return 'students';
}

/** Structure events keep a JSON diff; show it as "field: value" pairs. Never shows photos or face data (none are stored here). */
function readableDetails(details: string): string {
  const text = details.trim();
  if (!text.startsWith('{')) return text.slice(0, 2000);
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return Object.entries(value)
      .filter(([key]) => !/outline|polygon|secret|hash|token/i.test(key))
      .map(([key, item]) => {
        if (item && typeof item === 'object' && 'from' in item && 'to' in item) {
          const change = item as { from: unknown; to: unknown };
          return `${key}: ${String(change.from ?? '—')} → ${String(change.to ?? '—')}`;
        }
        return `${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`;
      })
      .join(' · ')
      .slice(0, 2000);
  } catch {
    return text.slice(0, 2000);
  }
}

function encodeCursor(row: Pick<AuditRow, 'createdAt' | 'id'>): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [at, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const id = rest.join('|');
  const date = new Date(at ?? '');
  if (Number.isNaN(date.getTime()) || !/^(student|manual|removal|staff|structure|venue):[0-9a-f-]{36}$/i.test(id)) return null;
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

  async auditLog(
    account: AuthenticatedAccount,
    query: { readonly category?: AuditCategory | undefined; readonly q?: string | undefined; readonly from?: string | undefined; readonly to?: string | undefined; readonly cursor?: string | undefined },
  ): Promise<AuditLogPage> {
    const admin = this.#admin(account);
    const scope = this.#scope(admin);
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !before) throw new GovernanceError(400, 'That page link is not valid. Reload the audit log.');
    if (query.from && query.to && query.from > query.to) throw new GovernanceError(400, 'The “from” date is after the “to” date.');
    const rows = await this.#repository.listAudit(scope, {
      category: query.category,
      query: query.q?.trim() || undefined,
      from: query.from ? lagosDayStart(query.from) : undefined,
      to: query.to ? lagosDayStart(query.to, 1) : undefined,
      before: before ?? undefined,
      limit: PAGE_SIZE + 1,
    });
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      entries: page.map((row) => this.#entry(row)),
      nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
      scopeLabel: admin.scope.label,
      limitedToScope: scope.type !== 'institution',
    };
  }

  #entry(row: AuditRow): AuditLogEntry {
    const person = row.subjectName ?? null;
    const subject = [person, row.matricNumber, row.targetLabel].filter((part): part is string => Boolean(part)).join(' · ') || null;
    const summary = row.source === 'student' && !row.action.startsWith('attendee_')
      ? (row.action === 'retention_run' && !row.subjectName && !row.matricNumber ? 'Ran data retention' : studentAuditSummary(row.action))
      : OTHER_SUMMARIES[row.action] ?? row.action.replace(/_/g, ' ');
    return {
      id: row.id.slice(0, 80),
      category: categoryOf(row),
      action: row.action.slice(0, 64),
      summary: summary.slice(0, 200),
      actorName: row.actorName ? row.actorName.slice(0, 160) : row.action === 'retention_run' ? 'Scheduled clean-up' : null,
      subject: subject ? subject.slice(0, 240) : null,
      details: readableDetails(row.details),
      at: row.createdAt.toISOString(),
    };
  }

  /* ---------------- data retention ---------------- */

  get policy(): RetentionPolicy {
    return this.#policy;
  }

  #lastRun(record: Awaited<ReturnType<GovernanceRepository['lastRetentionRun']>>): RetentionRunSummary | null {
    if (!record) return null;
    const read = (key: string) => Number(new RegExp(`(?:^|\\s)${key}=(\\d+)`).exec(record.details)?.[1] ?? 0);
    return {
      at: record.at.toISOString(),
      actorName: record.actorName,
      scheduled: /scheduled=true/.test(record.details),
      facesDeleted: read('faces'),
      checkPhotosDeleted: read('check_photos'),
    };
  }

  async retentionPreview(account: AuthenticatedAccount): Promise<RetentionPreview> {
    const admin = this.#admin(account);
    const now = this.#now();
    const [sets, checkPhotos, lastRun] = await Promise.all([
      this.#repository.listFinishedSets(admin.institutionId, this.#policy, now),
      this.#repository.countDueCheckPhotos(admin.institutionId, this.#policy, now),
      this.#repository.lastRetentionRun(admin.institutionId),
    ]);
    return {
      policy: this.#policy,
      generatedAt: now.toISOString(),
      sets: sets.map((set) => {
        const finishedOn = `${set.entryYear + set.programmeYears}-09-01`;
        return {
          departmentName: set.departmentName,
          entryYear: set.entryYear,
          setLabel: academicSetLabel(set.entryYear),
          programmeYears: set.programmeYears,
          finishedOn,
          dueOn: addMonths(finishedOn, this.#policy.graceMonths),
          students: set.students,
          faces: set.faces,
          dueFaces: set.dueFaces,
          keptActive: set.keptActive,
        };
      }),
      due: { faces: sets.reduce((total, set) => total + set.dueFaces, 0), checkPhotos },
      lastRun: this.#lastRun(lastRun),
      scheduled: this.#scheduled,
      canRun: admin.scope.type === 'institution',
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
