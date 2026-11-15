import { academicSetLabel, type ClassList, type ClassListEntry, type ClassListEntryStage, type ClassListSummary } from '@lasuatos/contracts';
import { shortDepartmentName } from '../../lib/department-options';

/**
 * Pure helpers for Class lists: stage wording, counts, filters, addresses and the reminder a
 * HOC shares with the class. Nothing here touches the network or the DOM.
 */

/** Lists this long get a search field. */
export const SEARCH_FROM = 8;

export const STAGE_ORDER: readonly ClassListEntryStage[] = ['not_joined', 'joined', 'email_confirmed', 'ready'];

/** The words for each stage. `ready` reads "Face registered" only to explain the step in the sheet. */
export const STAGE: Record<ClassListEntryStage, { readonly label: string; readonly param: string; readonly tone: 'neutral' | 'warning' | 'tint' | 'success' }> = {
  not_joined: { label: 'Not opened', param: 'not-opened', tone: 'neutral' },
  joined: { label: 'Opened', param: 'opened', tone: 'warning' },
  email_confirmed: { label: 'Email confirmed', param: 'confirmed', tone: 'tint' },
  ready: { label: 'Ready', param: 'ready', tone: 'success' },
};

export type StageFilter = 'all' | ClassListEntryStage;

export function stageFromParam(value: string | null | undefined): StageFilter {
  return STAGE_ORDER.find((stage) => STAGE[stage].param === value) ?? 'all';
}

type Counts = ClassList['counts'];

/** The API's counts are cumulative ("joined" includes everyone further on); this splits them by stage. */
export function stageCounts(counts: Counts): Record<ClassListEntryStage, number> {
  return {
    not_joined: counts.total - counts.joined,
    joined: counts.joined - counts.emailConfirmed,
    email_confirmed: counts.emailConfirmed - counts.ready,
    ready: counts.ready,
  };
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** "ADEBAYO Tolulope Abraham": the surname first and in capitals, as LASU lists write it. */
export function displayName(entry: Pick<ClassListEntry, 'surname' | 'firstName' | 'middleName'>): string {
  return [entry.surname.toUpperCase(), entry.firstName, entry.middleName ?? ''].filter(Boolean).join(' ');
}

/** "Tolulope Adebayo", for sentences. */
export function plainName(entry: Pick<ClassListEntry, 'surname' | 'firstName'>): string {
  const surname = entry.surname.charAt(0).toUpperCase() + entry.surname.slice(1).toLowerCase();
  return `${entry.firstName} ${surname}`;
}

export function initials(entry: Pick<ClassListEntry, 'surname' | 'firstName'>): string {
  return `${entry.surname.charAt(0)}${entry.firstName.charAt(0)}`.toUpperCase();
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Matches name parts in any order, the matric number (spaces ignored) or the email. */
export function matches(entry: ClassListEntry, query: string): boolean {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const squashed = fold(query).replace(/\s+/g, '');
  if (/^\d{3,}$/.test(squashed) && entry.matricNumber.includes(squashed)) return true;
  const haystack = fold(`${entry.surname} ${entry.firstName} ${entry.middleName ?? ''} ${entry.matricNumber} ${entry.lasuEmail ?? ''}`);
  return words.every((word) => haystack.includes(word));
}

export function filterEntries(entries: readonly ClassListEntry[], stage: StageFilter, query: string): ClassListEntry[] {
  return entries.filter((entry) => (stage === 'all' || entry.stage === stage) && matches(entry, query));
}

/** The next thing that has to happen for this student, in a sentence. */
export function nextStep(entry: Pick<ClassListEntry, 'stage' | 'setupCodeUsed'>, faceRequired: boolean): string {
  switch (entry.stage) {
    case 'not_joined':
      return 'They open their account on LASUATOS with their matric number.';
    case 'joined':
      return entry.setupCodeUsed
        ? 'They opened it with a setup code. Next they confirm their LASU email from their account.'
        : 'Next they confirm their LASU email from their account.';
    case 'email_confirmed':
      return faceRequired ? 'Next they register their face from their account.' : 'Nothing left to do.';
    default:
      return 'Ready to check in.';
  }
}

/* ---------------- addresses ---------------- */

export interface Place {
  /** A department code in lower case ("ece"), or null for the overview. */
  readonly department: string | null;
  /** An entry year, 'all' for every set, or null when not chosen. */
  readonly set: number | 'all' | null;
}

export function readPlace(params: { get: (name: string) => string | null } | null): Place {
  const department = params?.get('department')?.trim().toLowerCase() || null;
  const rawSet = params?.get('set') ?? null;
  const year = rawSet && /^\d{4}$/.test(rawSet) ? Number(rawSet) : null;
  return { department: department && /^[a-z0-9-]{1,20}$/.test(department) ? department : null, set: rawSet === 'all' ? 'all' : year };
}

export function placeHref(pathname: string, place: Place, extra: Record<string, string | null> = {}): string {
  const search = new URLSearchParams();
  if (place.department) search.set('department', place.department);
  if (place.set !== null) search.set('set', String(place.set));
  for (const [key, value] of Object.entries(extra)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `${pathname}?${text}` : pathname;
}

/** The resource key for one place, so each list is cached on its own. */
export function placeKey(place: Place): string {
  return `class-list:${place.department ?? '-'}:${place.set ?? '-'}`;
}

/** The last eight sets, newest first, for choosing where a list goes. */
export function setOptions(now: number): { value: string; label: string }[] {
  const year = new Date(now || Date.now()).getFullYear();
  return Array.from({ length: 8 }, (_unused, index) => year - index).map((entryYear) => ({ value: String(entryYear), label: academicSetLabel(entryYear) }));
}

/* ---------------- the overview ---------------- */

export interface OverviewRow {
  readonly key: string;
  readonly departmentId: string;
  readonly code: string;
  readonly title: string;
  readonly subtitle: string;
  readonly summary: ClassListSummary | null;
}

export interface OverviewGroup {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly OverviewRow[];
}

/**
 * The lists in the viewer's area, grouped by faculty (or, inside one department, a single
 * group of its sets). Departments without any list are listed after the others so they are
 * not forgotten.
 */
export function overviewGroups(list: Pick<ClassList, 'departments' | 'lists' | 'fixedDepartmentId'>): OverviewGroup[] {
  const byDepartment = new Map<string, ClassListSummary[]>();
  for (const summary of list.lists) {
    const items = byDepartment.get(summary.departmentId) ?? [];
    items.push(summary);
    byDepartment.set(summary.departmentId, items);
  }
  const oneDepartment = list.fixedDepartmentId !== null || list.departments.length === 1;
  const groups = new Map<string, { title: string; withLists: OverviewRow[]; without: OverviewRow[] }>();
  for (const department of list.departments) {
    const key = oneDepartment ? department.id : department.facultyName;
    const group = groups.get(key) ?? { title: oneDepartment ? shortDepartmentName(department.name) : department.facultyName, withLists: [], without: [] };
    const summaries = (byDepartment.get(department.id) ?? []).slice().sort((a, b) => b.entryYear - a.entryYear);
    if (summaries.length === 0) {
      group.without.push({ key: department.id, departmentId: department.id, code: department.code, title: shortDepartmentName(department.name), subtitle: 'No list yet', summary: null });
    }
    for (const summary of summaries) {
      group.withLists.push({
        key: `${department.id}-${summary.entryYear}`,
        departmentId: department.id,
        code: department.code,
        title: oneDepartment ? summary.setLabel : shortDepartmentName(department.name),
        subtitle: oneDepartment ? `${summary.total} ${summary.total === 1 ? 'student' : 'students'}` : `${summary.setLabel} · ${summary.total} ${summary.total === 1 ? 'student' : 'students'}`,
        summary,
      });
    }
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, title: group.title, rows: [...group.withLists, ...group.without] }));
}

export function overviewTotals(lists: readonly ClassListSummary[]): { students: number; ready: number; notOpened: number; lists: number } {
  return lists.reduce(
    (sum, item) => ({ students: sum.students + item.total, ready: sum.ready + item.ready, notOpened: sum.notOpened + (item.total - item.joined), lists: sum.lists + 1 }),
    { students: 0, ready: 0, notOpened: 0, lists: 0 },
  );
}

/* ---------------- the reminder ---------------- */

function shortName(entry: ClassListEntry): string {
  return `${entry.surname.toUpperCase()} ${entry.firstName} (${entry.matricNumber})`;
}

/**
 * A message for the class group chat: what to do, then who still has to do it, by step.
 * Names are capped so the message stays readable; the rest are counted.
 */
export function reminderText(entries: readonly ClassListEntry[], faceRequired: boolean, origin: string, cap = 40): string {
  const steps: { stage: ClassListEntryStage; heading: string }[] = [
    { stage: 'not_joined', heading: 'Still to open their account' },
    { stage: 'joined', heading: 'Still to confirm their LASU email' },
    ...(faceRequired ? [{ stage: 'email_confirmed' as const, heading: 'Still to register their face' }] : []),
  ];
  const lines = [
    'Please get your LASUATOS account ready before the next class.',
    `Go to ${origin}/sign-up and type your matric number. Then confirm your LASU email${faceRequired ? ' and register your face' : ''} from your account.`,
  ];
  let named = 0;
  for (const step of steps) {
    const people = entries.filter((entry) => entry.stage === step.stage);
    if (people.length === 0) continue;
    const room = Math.max(0, cap - named);
    const shown = people.slice(0, room);
    named += shown.length;
    lines.push('', `${step.heading} (${people.length}):`, ...shown.map(shortName));
    if (people.length > shown.length) lines.push(`and ${people.length - shown.length} more`);
  }
  return lines.join('\n');
}

/* ---------------- times ---------------- */

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });
const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });

/** "Today, 09:12", "Yesterday, 18:20", "12 Oct". */
export function whenLabel(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const day = lagosDay.format(time);
  if (now && day === lagosDay.format(now)) return `Today, ${clock.format(time)}`;
  if (now && day === lagosDay.format(now - 86_400_000)) return `Yesterday, ${clock.format(time)}`;
  return dayMonth.format(time);
}

/** "today", "3 days ago", "5 Oct": how fresh a list is. */
export function updatedLabel(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time) || !now) return '';
  const days = Math.floor((Date.parse(lagosDay.format(now)) - Date.parse(lagosDay.format(time))) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return dayMonth.format(time);
}
