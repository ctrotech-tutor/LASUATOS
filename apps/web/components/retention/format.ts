import type { RetentionPolicy, RetentionRunSummary, RetentionSet, RetentionStudent, RetentionStudentState } from '@lasuatos/contracts';

/* Pure helpers for the data retention page: reading the address, sorting sets into groups,
   dates and plain-language lines. Kept free of React so they can be tested directly. */

export const PATH = '/admin/retention';
export const PREVIEW_KEY = 'admin:retention';
export const SET_PREFIX = 'admin:retention-set:';

const DAY = 86_400_000;

/** Where a set stands today. */
export type SetStatus = 'due' | 'kept' | 'coming' | 'cleared';
export type Show = 'all' | SetStatus;
export const SHOWS: readonly Show[] = ['all', 'due', 'kept', 'coming', 'cleared'];

export type View = {
  readonly show: Show;
  /** A set as `CODE-YEAR`, for example `ECE-2019`. */
  readonly set: string | null;
  readonly q: string;
};

export function readView(params: { get(name: string): string | null } | null): View {
  const show = params?.get('show') ?? '';
  const set = params?.get('set')?.trim() ?? '';
  return {
    show: (SHOWS as readonly string[]).includes(show) ? (show as Show) : 'all',
    set: /^[A-Za-z0-9 ._&/-]{1,40}-\d{4}$/.test(set) ? set : null,
    q: (params?.get('q') ?? '').slice(0, 80),
  };
}

export function viewHref(path: string, view: View): string {
  const params = new URLSearchParams();
  if (view.show !== 'all') params.set('show', view.show);
  if (view.q.trim()) params.set('q', view.q.trim());
  if (view.set) params.set('set', view.set);
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

/** The set's name in the address: department code and entry year. */
export const setSlug = (set: Pick<RetentionSet, 'departmentCode' | 'entryYear'>) => `${set.departmentCode}-${set.entryYear}`;
export const setKey = (departmentId: string, entryYear: number) => `${SET_PREFIX}${departmentId}:${entryYear}`;

export function findSet(sets: readonly RetentionSet[], slug: string | null): RetentionSet | null {
  if (!slug) return null;
  const lower = slug.toLowerCase();
  return sets.find((set) => setSlug(set).toLowerCase() === lower) ?? null;
}

/** Today's date (UTC, as the server dates a set's deadline). */
export const dayOf = (iso: string) => iso.slice(0, 10);

export function setStatus(set: RetentionSet, today: string): SetStatus {
  if (set.dueOn > today) return 'coming';
  if (set.faces === 0) return 'cleared';
  return set.dueFaces > 0 ? 'due' : 'kept';
}

export const STATUS_LABEL: Readonly<Record<SetStatus, string>> = {
  due: 'Due now',
  kept: 'Kept for now',
  coming: 'Coming up',
  cleared: 'Cleared',
};

export const SHOW_LABEL: Readonly<Record<Show, string>> = { all: 'All sets', ...STATUS_LABEL };

export const STATUS_TONE: Readonly<Record<SetStatus, 'danger' | 'tint' | 'neutral' | 'success'>> = {
  due: 'danger',
  kept: 'tint',
  coming: 'neutral',
  cleared: 'success',
};

const ORDER: readonly SetStatus[] = ['due', 'kept', 'coming', 'cleared'];

export type SetGroup = { readonly status: SetStatus; readonly sets: readonly RetentionSet[] };

/**
 * Sets grouped by where they stand: due now (oldest first), kept for now, coming up (soonest
 * first), then cleared (newest first, since old cleared sets matter least).
 */
export function groupSets(sets: readonly RetentionSet[], today: string, view: Pick<View, 'show' | 'q'>): SetGroup[] {
  const words = view.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (set: RetentionSet) => {
    if (!words.length) return true;
    const text = `${set.departmentCode} ${set.departmentName} ${set.entryYear} ${set.setLabel}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const byStatus = new Map<SetStatus, RetentionSet[]>();
  for (const set of sets) {
    if (!matches(set)) continue;
    const status = setStatus(set, today);
    if (view.show !== 'all' && view.show !== status) continue;
    byStatus.set(status, [...(byStatus.get(status) ?? []), set]);
  }
  const byDue = (a: RetentionSet, b: RetentionSet) => a.dueOn.localeCompare(b.dueOn) || a.departmentCode.localeCompare(b.departmentCode);
  return ORDER.filter((status) => byStatus.has(status)).map((status) => {
    const list = [...byStatus.get(status)!].sort(byDue);
    return { status, sets: status === 'cleared' ? list.reverse() : list };
  });
}

export function countByStatus(sets: readonly RetentionSet[], today: string): Readonly<Record<Show, number>> {
  const counts: Record<Show, number> = { all: sets.length, due: 0, kept: 0, coming: 0, cleared: 0 };
  for (const set of sets) counts[setStatus(set, today)] += 1;
  return counts;
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? word : many}`;
}

/** "ECE 2019/2020" */
export const setTitle = (set: Pick<RetentionSet, 'departmentCode' | 'setLabel'>) => `${set.departmentCode} ${set.setLabel.replace(/\s*set$/i, '')}`;

const dayFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-NG', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const lagosStamp = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const lagosShort = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const lagosTime = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' });
const lagosDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Lagos' });

/** A calendar date ("1 Sept 2025"), from YYYY-MM-DD. */
export const formatDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));
export const formatMonth = (day: string) => monthFormat.format(new Date(`${day}T00:00:00Z`));
/** A moment in Lagos time ("13 Nov 2026"). */
export const formatStamp = (iso: string) => lagosStamp.format(new Date(iso));
export const formatClock = (iso: string) => lagosTime.format(new Date(iso)).replace(/\s/g, ' ').toLowerCase();

/** "in 10 months", "in 3 weeks", "tomorrow", "today", or "2 months ago". */
export function relativeDay(day: string, today: string): string {
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const size = Math.abs(days);
  const span = size < 14 ? plural(size, 'day') : size < 60 ? plural(Math.round(size / 7), 'week') : size < 730 ? plural(Math.round(size / 30.44), 'month') : plural(Math.round(size / 365.25), 'year');
  return days > 0 ? `in ${span}` : `${span} ago`;
}

/** How long ago a moment was, in words. */
export function ago(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30.44)} months ago`;
  return `${Math.round(days / 365.25)} years ago`;
}

/**
 * The next nightly clean-up (Vercel Cron at 02:30 UTC, 3:30 am in Lagos), as an instant
 * and a phrase: "tonight at 3:30 am" (after 4 am) or "today at 3:30 am" (in the small hours).
 */
export function nextRun(now: number): { readonly at: string; readonly phrase: string } {
  const at = new Date(now);
  at.setUTCHours(2, 30, 0, 0);
  if (at.getTime() <= now) at.setUTCDate(at.getUTCDate() + 1);
  const sameDay = lagosDay.format(at) === lagosDay.format(now);
  const time = formatClock(at.toISOString());
  return { at: at.toISOString(), phrase: sameDay ? `today at ${time}` : `tonight at ${time}` };
}

/** When a student kept for checking in loses their face: activeWithinDays after the last check-in. */
export function keptUntil(lastCheckInAt: string, policy: Pick<RetentionPolicy, 'activeWithinDays'>): string {
  return new Date(Date.parse(lastCheckInAt) + policy.activeWithinDays * DAY).toISOString().slice(0, 10);
}

/**
 * Where today falls on a set's timeline, drawn as two equal halves: the programme (start to
 * finish) and the grace period (finish to faces due). Fractions 0–1; past the deadline stays at 1.
 */
export function setTimeline(set: Pick<RetentionSet, 'entryYear' | 'finishedOn' | 'dueOn'>, today: string) {
  const start = Date.parse(`${set.entryYear}-09-01T00:00:00Z`);
  const finish = Date.parse(`${set.finishedOn}T00:00:00Z`);
  const due = Date.parse(`${set.dueOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const position = now < finish
    ? 0.5 * clamp((now - start) / Math.max(1, finish - start))
    : 0.5 + 0.5 * clamp((now - finish) / Math.max(1, due - finish));
  return { finished: 0.5, today: position, started: `${set.entryYear}-09-01` };
}

export const STATE_LABEL: Readonly<Record<RetentionStudentState, string>> = {
  due: 'Goes next run',
  keeping: 'Kept, checking in',
  waiting: 'Kept until due',
  no_face: 'No face',
};
export const STATE_SHORT: Readonly<Record<RetentionStudentState, string>> = {
  due: 'Going',
  keeping: 'Kept',
  waiting: 'Waiting',
  no_face: 'No face',
};
export const STATE_TONE: Readonly<Record<RetentionStudentState, 'danger' | 'tint' | 'neutral'>> = {
  due: 'danger',
  keeping: 'tint',
  waiting: 'neutral',
  no_face: 'neutral',
};
export const STATE_ORDER: readonly RetentionStudentState[] = ['due', 'keeping', 'waiting', 'no_face'];

/** One plain line on why a student is where they are. */
export function studentLine(student: RetentionStudent, policy: RetentionPolicy, now: number): string {
  const checkIn = student.lastCheckInAt ? `last check-in ${ago(student.lastCheckInAt, now)}` : 'never checked in';
  switch (student.state) {
    case 'due':
      return `${capitalise(checkIn)}`;
    case 'keeping':
      return `Checked in ${ago(student.lastCheckInAt ?? new Date(now).toISOString(), now)} · kept until ${formatDay(keptUntil(student.lastCheckInAt ?? new Date(now).toISOString(), policy))} without another`;
    case 'waiting':
      return student.faceRegisteredAt ? `Face registered ${formatMonth(dayOf(student.faceRegisteredAt))} · ${checkIn}` : capitalise(checkIn);
    default:
      return student.hasAccount ? 'Has an account, never registered a face' : 'Has not opened an account';
  }
}

export function countStates(students: readonly RetentionStudent[]): Readonly<Record<RetentionStudentState, number>> {
  const counts: Record<RetentionStudentState, number> = { due: 0, keeping: 0, waiting: 0, no_face: 0 };
  for (const student of students) counts[student.state] += 1;
  return counts;
}

export function filterStudents(students: readonly RetentionStudent[], state: RetentionStudentState | 'all', q: string): RetentionStudent[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const order = (state: RetentionStudentState) => STATE_ORDER.indexOf(state);
  return students
    .filter((student) => state === 'all' || student.state === state)
    .filter((student) => words.every((word) => `${student.name} ${student.matricNumber}`.toLowerCase().includes(word)))
    .sort((a, b) => order(a.state) - order(b.state) || a.name.localeCompare(b.name));
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What a run did, in words. */
export function runResult(run: Pick<RetentionRunSummary, 'facesDeleted' | 'checkPhotosDeleted'>): string {
  if (!run.facesDeleted && !run.checkPhotosDeleted) return 'Nothing was due';
  const parts = [run.facesDeleted ? plural(run.facesDeleted, 'face') : '', run.checkPhotosDeleted ? plural(run.checkPhotosDeleted, 'check-in photo') : ''].filter(Boolean);
  return `${parts.join(' and ')} deleted`;
}

export type RunRow =
  | { readonly kind: 'run'; readonly run: RetentionRunSummary }
  | { readonly kind: 'quiet'; readonly count: number; readonly from: string; readonly to: string };

/** Runs newest first, with back-to-back nightly runs that deleted nothing folded into one row. */
export function foldRuns(runs: readonly RetentionRunSummary[]): RunRow[] {
  const rows: RunRow[] = [];
  let quiet: RetentionRunSummary[] = [];
  const flush = () => {
    if (quiet.length === 1) rows.push({ kind: 'run', run: quiet[0]! });
    else if (quiet.length > 1) rows.push({ kind: 'quiet', count: quiet.length, from: quiet[quiet.length - 1]!.at, to: quiet[0]!.at });
    quiet = [];
  };
  for (const run of runs) {
    if (run.scheduled && !run.facesDeleted && !run.checkPhotosDeleted) quiet.push(run);
    else {
      flush();
      rows.push({ kind: 'run', run });
    }
  }
  flush();
  return rows;
}

/** "3 – 9 Nov" for folded quiet runs. */
export const runSpan = (from: string, to: string) => `${lagosShort.format(new Date(from))} to ${lagosShort.format(new Date(to))}`;

/** The class list for a set (and one student on it). */
export function classListHref(set: Pick<RetentionSet, 'departmentCode' | 'entryYear'>, matric?: string): string {
  const params = new URLSearchParams({ department: set.departmentCode.toLowerCase(), set: String(set.entryYear) });
  if (matric) params.set('student', matric);
  return `/class-list?${params.toString()}`;
}

export function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}
