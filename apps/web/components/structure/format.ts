import { STRUCTURE_ACTIVITY_DAYS, type InstitutionStructure, type StructureChange } from '@lasuatos/contracts';

/* Pure helpers for the academic structure page: where today falls, what needs a look, the address bar. */

export const PATH = '/admin/structure';
export const STRUCTURE_KEY = 'admin:structure';
export const ACTIVITY_DAYS = STRUCTURE_ACTIVITY_DAYS;
/** Warn about the next session once the current one ends within this many days. */
export const NEXT_SESSION_DAYS = 90;
export const YEARS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export type Faculty = InstitutionStructure['faculties'][number];
export type Department = Faculty['departments'][number];
export type AcademicSession = InstitutionStructure['academicSessions'][number];
export type Semester = AcademicSession['semesters'][number];
export type DepartmentRow = Department & { readonly faculty: Faculty };

/* ---------- words ---------- */

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? word : many}`;
}

export function yearsLabel(years: number): string {
  return plural(years, 'year');
}

/** "100–500 level": the levels a programme of this length has. */
export function levelsLabel(years: number): string {
  return years <= 1 ? '100 level' : `100–${years * 100} level`;
}

/** "Department of Computer Science" stays; "Computer Science" stays. Used for the short name in rows. */
export function shortName(name: string): string {
  return name.replace(/^(Department|Faculty) of /i, '');
}

const lagosDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const weekdayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Africa/Lagos' });

/** The Lagos calendar day (YYYY-MM-DD) of an instant. */
export function lagosDay(value: string | number): string {
  return lagosDayFormat.format(new Date(value));
}

/** Lagos is UTC+1 all year (no daylight saving). */
export const startOfDay = (date: string) => `${date}T00:00:00+01:00`;
export const endOfDay = (date: string) => `${date}T23:59:00+01:00`;

/** Whole Lagos calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string | number, to: string | number): number {
  return Math.round((Date.parse(lagosDay(to)) - Date.parse(lagosDay(from))) / DAY);
}

/** "14 Sept", or "14 Sept 2025" in another year than `now`. */
export function dateLabel(iso: string, now: number): string {
  return (lagosDay(iso).slice(0, 4) === lagosDay(now).slice(0, 4) ? dayMonth : dayMonthYear).format(new Date(iso));
}

export function fullDate(iso: string): string {
  return dayMonthYear.format(new Date(iso));
}

/** "14 Sept 2026 – 22 Jan 2027". */
export function rangeLabel(startsAt: string, endsAt: string): string {
  return `${fullDate(startsAt)} – ${fullDate(endsAt)}`;
}

/** "Today", "Yesterday", "Monday", "14 Oct"; "Never" for null. */
export function whenLabel(iso: string | null, now: number): string {
  if (!iso) return 'Never';
  const days = daysBetween(iso, now);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekdayFormat.format(new Date(iso));
  return dateLabel(iso, now);
}

/** "in 3 days", "tomorrow", "today", "3 days ago". */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} ago`;
}

/** How long ago a change was: "Just now", "3 h ago", "Yesterday", "4 days ago", then a date. */
export function agoLabel(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const days = daysBetween(iso, now);
  if (days === 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return dateLabel(iso, now);
}

/** Weeks a semester runs, counting a part week as one. */
export function semesterWeeks(semester: Pick<Semester, 'startsAt' | 'endsAt'>): number {
  return Math.max(1, Math.ceil((daysBetween(semester.startsAt, semester.endsAt) + 1) / 7));
}

/* ---------- where today falls ---------- */

export type Today =
  | { readonly kind: 'none' }
  | { readonly kind: 'not_started'; readonly session: AcademicSession; readonly startsIn: number }
  | { readonly kind: 'ended'; readonly session: AcademicSession; readonly endedAgo: number }
  | { readonly kind: 'in_semester'; readonly session: AcademicSession; readonly semester: Semester; readonly week: number; readonly weeks: number; readonly daysLeft: number }
  | { readonly kind: 'between'; readonly session: AcademicSession; readonly next: Semester | null; readonly startsIn: number | null };

export function currentSession(sessions: readonly AcademicSession[]): AcademicSession | null {
  return sessions.find((session) => session.isCurrent) ?? null;
}

/** Where `now` falls in the current session: in a semester (and which week), between semesters, or outside it. */
export function todayIn(sessions: readonly AcademicSession[], now: number): Today {
  const session = currentSession(sessions);
  if (!session) return { kind: 'none' };
  if (now < Date.parse(session.startsAt)) return { kind: 'not_started', session, startsIn: daysBetween(now, session.startsAt) };
  if (now > Date.parse(session.endsAt)) return { kind: 'ended', session, endedAgo: daysBetween(session.endsAt, now) };
  const semester = session.semesters.find((item) => now >= Date.parse(item.startsAt) && now <= Date.parse(item.endsAt));
  if (semester) {
    const weeks = semesterWeeks(semester);
    const week = Math.min(weeks, Math.floor((Date.parse(lagosDay(now)) - Date.parse(lagosDay(semester.startsAt))) / WEEK) + 1);
    return { kind: 'in_semester', session, semester, week, weeks, daysLeft: daysBetween(now, semester.endsAt) };
  }
  const next = session.semesters.find((item) => Date.parse(item.startsAt) > now) ?? null;
  return { kind: 'between', session, next, startsIn: next ? daysBetween(now, next.startsAt) : null };
}

/** One line for the header: "2026/2027 · First Semester, week 10 of 19". */
export function todayLine(today: Today): string {
  switch (today.kind) {
    case 'none': return 'No current academic session';
    case 'not_started': return `${today.session.code} starts ${relativeDays(today.startsIn)}`;
    case 'ended': return `${today.session.code} ended ${relativeDays(-today.endedAgo)}`;
    case 'in_semester': return `${today.session.code} · ${today.semester.name}, week ${today.week} of ${today.weeks}`;
    case 'between': return today.next
      ? `${today.session.code} · between semesters, ${today.next.name} starts ${relativeDays(today.startsIn ?? 0)}`
      : `${today.session.code} · no more semesters this session`;
  }
}

/** Where a moment sits along a span, 0 to 1. */
export function fraction(startsAt: string, endsAt: string, at: number): number {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (at - start) / (end - start)));
}

/** The session that follows `session` by start date, if any. */
export function sessionAfter(sessions: readonly AcademicSession[], session: AcademicSession): AcademicSession | null {
  return [...sessions]
    .filter((item) => Date.parse(item.startsAt) > Date.parse(session.startsAt))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
}

/* ---------- what needs a look ---------- */

export type Check =
  | { readonly kind: 'no_session' }
  | { readonly kind: 'session_ended'; readonly session: AcademicSession; readonly next: AcademicSession | null }
  | { readonly kind: 'next_session'; readonly session: AcademicSession; readonly endsIn: number }
  | { readonly kind: 'no_semesters'; readonly session: AcademicSession }
  | { readonly kind: 'empty_faculty'; readonly faculty: Faculty }
  | { readonly kind: 'no_lecturers'; readonly department: DepartmentRow }
  | { readonly kind: 'no_class_list'; readonly department: DepartmentRow }
  | { readonly kind: 'quiet'; readonly department: DepartmentRow };

export function departmentRows(faculties: readonly Faculty[]): DepartmentRow[] {
  return faculties.flatMap((faculty) => faculty.departments.map((department) => ({ ...department, faculty })));
}

/** Problems with one department: no lecturers, no class list, or (in a semester) no classes lately. */
export function departmentChecks(department: DepartmentRow, today: Today): Check[] {
  if (!department.isActive || !department.faculty.isActive) return [];
  const checks: Check[] = [];
  if (department.lecturerCount === 0) checks.push({ kind: 'no_lecturers', department });
  if (department.classListCount === 0) checks.push({ kind: 'no_class_list', department });
  if (today.kind === 'in_semester' && today.week > 2 && department.lecturerCount > 0 && department.recentSessions === 0) {
    checks.push({ kind: 'quiet', department });
  }
  return checks;
}

/**
 * Everything worth a look, most serious first: the session (none, ended, next one missing, no
 * semesters), then empty faculties, then departments. Session checks only for those who manage
 * sessions; a department administrator can't fix them.
 */
export function checksFor(structure: InstitutionStructure, now: number): Check[] {
  const checks: Check[] = [];
  const today = todayIn(structure.academicSessions, now);
  if (structure.permissions.manageSessions) {
    const session = currentSession(structure.academicSessions);
    if (!session) checks.push({ kind: 'no_session' });
    else {
      const next = sessionAfter(structure.academicSessions, session);
      if (today.kind === 'ended') checks.push({ kind: 'session_ended', session, next });
      else {
        const endsIn = daysBetween(now, session.endsAt);
        if (!next && endsIn <= NEXT_SESSION_DAYS) checks.push({ kind: 'next_session', session, endsIn });
      }
      if (!session.semesters.length) checks.push({ kind: 'no_semesters', session });
    }
  }
  if (structure.permissions.manageFaculties) {
    for (const faculty of structure.faculties) {
      if (faculty.isActive && !faculty.departments.some((department) => department.isActive)) checks.push({ kind: 'empty_faculty', faculty });
    }
  }
  for (const department of departmentRows(structure.faculties)) checks.push(...departmentChecks(department, today));
  return checks;
}

export function checkText(check: Check): { readonly title: string; readonly detail: string } {
  switch (check.kind) {
    case 'no_session':
      return { title: 'No current academic session', detail: 'Students’ levels are worked out from the current session. Start one, or make an existing one current.' };
    case 'session_ended':
      return check.next
        ? { title: `${check.session.code} has ended`, detail: `Make ${check.next.code} current so students’ levels move up.` }
        : { title: `${check.session.code} has ended`, detail: 'Start the next session and make it current so students’ levels move up.' };
    case 'next_session':
      return { title: `Set up the session after ${check.session.code}`, detail: `${check.session.code} ends ${relativeDays(check.endsIn)}. Add the next one now so it’s ready to switch to.` };
    case 'no_semesters':
      return { title: `${check.session.code} has no semesters`, detail: 'Add its semesters so the page can tell which week it is.' };
    case 'empty_faculty':
      return { title: `${shortName(check.faculty.name)} has no departments`, detail: 'Add its departments so staff and students can be placed in them.' };
    case 'no_lecturers':
      return { title: `No lecturers in ${shortName(check.department.name)}`, detail: 'Invite its lecturers so they can take attendance.' };
    case 'no_class_list':
      return { title: `No class list for ${shortName(check.department.name)}`, detail: 'Add its students so they can set up their accounts and check in.' };
    case 'quiet':
      return { title: `No classes in ${shortName(check.department.name)} lately`, detail: `Nobody has taken attendance there in ${ACTIVITY_DAYS} days, though it’s mid-semester.` };
  }
}

/** A few words for a department row: "No lecturers", "No class list", "No classes in 30 days". */
export function checkShort(check: Check): string {
  switch (check.kind) {
    case 'no_lecturers': return 'No lecturers';
    case 'no_class_list': return 'No class list';
    case 'quiet': return `No classes in ${ACTIVITY_DAYS} days`;
    default: return checkText(check).title;
  }
}

export function checkKey(check: Check): string {
  switch (check.kind) {
    case 'no_session': return 'no_session';
    case 'session_ended':
    case 'next_session':
    case 'no_semesters': return `${check.kind}:${check.session.id}`;
    case 'empty_faculty': return `${check.kind}:${check.faculty.id}`;
    default: return `${check.kind}:${check.department.id}`;
  }
}

/* ---------- counting ---------- */

export type Counts = {
  readonly faculties: number;
  readonly departments: number;
  readonly inactive: number;
  readonly lecturers: number;
  readonly classList: number;
  readonly sessions: number;
};

/** Active faculties and departments, and what the active departments hold. */
export function countStructure(faculties: readonly Faculty[]): Counts {
  let departments = 0; let inactive = 0; let lecturers = 0; let classList = 0; let sessions = 0;
  for (const department of departmentRows(faculties)) {
    if (!department.isActive || !department.faculty.isActive) { inactive += 1; continue; }
    departments += 1;
    lecturers += department.lecturerCount;
    classList += department.classListCount;
    sessions += department.recentSessions;
  }
  return { faculties: faculties.filter((faculty) => faculty.isActive).length, departments, inactive, lecturers, classList, sessions };
}

/* ---------- finding ---------- */

export type Tab = 'departments' | 'sessions' | 'history';
export const TABS: readonly Tab[] = ['departments', 'sessions', 'history'];
export type Show = 'all' | 'attention' | 'inactive';
export const SHOWS: readonly Show[] = ['all', 'attention', 'inactive'];

export function matchesQuery(department: DepartmentRow, query: string): boolean {
  const words = query.toLocaleLowerCase('en-NG').split(/\s+/).filter(Boolean);
  const haystack = `${department.code} ${department.name} ${department.faculty.code} ${department.faculty.name}`.toLocaleLowerCase('en-NG');
  return words.every((word) => haystack.includes(word));
}

/* ---------- the address bar ---------- */

export type View = {
  readonly tab: Tab;
  readonly show: Show;
  readonly department: string | null;
  readonly faculty: string | null;
  readonly session: string | null;
};

const CODE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** `?tab=sessions&session=2026-2027`, `?department=ece`, `?faculty=eng`, `?show=attention`. */
export function readView(params: { get(name: string): string | null } | null): View {
  const tab = params?.get('tab');
  const show = params?.get('show');
  const clean = (name: string) => {
    const value = params?.get(name)?.trim().toLowerCase() ?? '';
    return CODE.test(value) ? value : null;
  };
  return {
    tab: TABS.includes(tab as Tab) ? (tab as Tab) : 'departments',
    show: SHOWS.includes(show as Show) ? (show as Show) : 'all',
    department: clean('department'),
    faculty: clean('faculty'),
    session: clean('session'),
  };
}

export function viewHref(path: string, view: View): string {
  const params = new URLSearchParams();
  if (view.tab !== 'departments') params.set('tab', view.tab);
  if (view.show !== 'all') params.set('show', view.show);
  if (view.department) params.set('department', view.department);
  if (view.faculty) params.set('faculty', view.faculty);
  if (view.session) params.set('session', view.session);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export const slug = (code: string) => code.toLowerCase();
/** "2026/2027" → "2026-2027". */
export const sessionSlug = (code: string) => code.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/* ---------- history ---------- */

export function changesFor(changes: readonly StructureChange[], targetId: string): StructureChange[] {
  return changes.filter((change) => change.targetId === targetId);
}

/** What a change was made to, by name, from the structure in hand ("ECE · Electronic and Computer Engineering"). */
export function targetName(change: StructureChange, structure: InstitutionStructure): string {
  if (change.targetType === 'academic_session') {
    return structure.academicSessions.find((session) => session.id === change.targetId)?.code ?? 'A session';
  }
  if (change.targetType === 'faculty') {
    const faculty = structure.faculties.find((item) => item.id === change.targetId);
    return faculty ? shortName(faculty.name) : 'A faculty';
  }
  const department = departmentRows(structure.faculties).find((item) => item.id === change.targetId);
  return department ? `${department.code} · ${shortName(department.name)}` : 'A department';
}

/* ---------- new sessions ---------- */

export const SESSION_CODE = /^(\d{4})\/(\d{4})$/;

function shiftYear(day: string, years: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  // 29 Feb moves to 28 Feb in a common year.
  const last = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return `${year + years}-${String(month).padStart(2, '0')}-${String(Math.min(date, last)).padStart(2, '0')}`;
}

export type SessionDraft = {
  readonly code: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly semesters: readonly { readonly name: string; readonly startsOn: string; readonly endsOn: string }[];
};

/**
 * A new session one year on from the latest: "2027/2028" with every date a year later and the
 * same semester names. Empty when there is no session to follow.
 */
export function suggestNextSession(sessions: readonly AcademicSession[]): SessionDraft {
  const latest = [...sessions].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
  const match = latest?.code.match(SESSION_CODE);
  if (!latest || !match) {
    return { code: '', startsOn: '', endsOn: '', semesters: [{ name: 'First Semester', startsOn: '', endsOn: '' }, { name: 'Second Semester', startsOn: '', endsOn: '' }] };
  }
  const code = `${Number(match[1]) + 1}/${Number(match[2]) + 1}`;
  return {
    code: sessions.some((session) => session.code === code) ? '' : code,
    startsOn: shiftYear(lagosDay(latest.startsAt), 1),
    endsOn: shiftYear(lagosDay(latest.endsAt), 1),
    semesters: latest.semesters.length
      ? latest.semesters.map((semester) => ({ name: semester.name, startsOn: shiftYear(lagosDay(semester.startsAt), 1), endsOn: shiftYear(lagosDay(semester.endsAt), 1) }))
      : [{ name: 'First Semester', startsOn: '', endsOn: '' }, { name: 'Second Semester', startsOn: '', endsOn: '' }],
  };
}

/** Why a session draft can't be saved yet, or null. Dates are YYYY-MM-DD. */
export function sessionProblem(draft: SessionDraft): string | null {
  const match = draft.code.trim().match(SESSION_CODE);
  if (!match) return 'Write the session as two years, like 2027/2028.';
  if (Number(match[2]) !== Number(match[1]) + 1) return 'The second year should follow the first, like 2027/2028.';
  if (!draft.startsOn || !draft.endsOn) return 'Choose when the session starts and ends.';
  if (draft.endsOn <= draft.startsOn) return 'The session must end after it starts.';
  if (!draft.semesters.length) return 'Add at least one semester.';
  const names = new Set<string>();
  let previousEnd = '';
  for (const [index, semester] of draft.semesters.entries()) {
    const label = semester.name.trim() || `Semester ${index + 1}`;
    if (!semester.name.trim()) return `Name semester ${index + 1}.`;
    if (names.has(semester.name.trim().toLowerCase())) return `Two semesters are called ${label}.`;
    names.add(semester.name.trim().toLowerCase());
    if (!semester.startsOn || !semester.endsOn) return `Choose when ${label} starts and ends.`;
    if (semester.endsOn <= semester.startsOn) return `${label} must end after it starts.`;
    if (semester.startsOn < draft.startsOn || semester.endsOn > draft.endsOn) return `${label} must fall within the session’s dates.`;
    if (previousEnd && semester.startsOn <= previousEnd) return `${label} must start after the semester before it ends.`;
    previousEnd = semester.endsOn;
  }
  return null;
}

/* ---------- sessions in lists ---------- */

export type SessionState = 'current' | 'upcoming' | 'past' | 'open';

export function sessionState(session: AcademicSession, now: number): SessionState {
  if (session.isCurrent) return 'current';
  if (Date.parse(session.startsAt) > now) return 'upcoming';
  if (Date.parse(session.endsAt) < now) return 'past';
  return 'open';
}

export const SESSION_BADGE: Readonly<Record<SessionState, { readonly label: string; readonly tone: 'success' | 'tint' | 'neutral' | 'warning' }>> = {
  current: { label: 'Current', tone: 'success' },
  upcoming: { label: 'Upcoming', tone: 'tint' },
  past: { label: 'Past', tone: 'neutral' },
  open: { label: 'Not current', tone: 'warning' },
};

/** "19 weeks · 14 Sept – 22 Jan". */
export function semesterLine(semester: AcademicSession['semesters'][number], now: number): string {
  return `${plural(semesterWeeks(semester), 'week')} · ${dateLabel(semester.startsAt, now)} – ${dateLabel(semester.endsAt, now)}`;
}

/* ---------- errors ---------- */

/** structure-api throws `{ status, message }` (server problems) or a ZodError (bad input). */
export function failure(caught: unknown, fallback: string): string {
  const value = caught as { status?: number; message?: string; issues?: { message?: unknown }[] } | null;
  if (value?.status === 403) return 'You can’t change this part of the structure.';
  if (Array.isArray(value?.issues)) {
    const first = value.issues[0]?.message;
    return typeof first === 'string' ? first : 'Check the values and try again.';
  }
  return typeof value?.message === 'string' && value.message ? value.message : fallback;
}
