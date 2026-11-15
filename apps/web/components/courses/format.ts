import { canonicalCourseCode, courseCodeKey, type LectureCatalogCourse } from '@lasuatos/contracts';

/* Pure helpers for the course list page: what each course is, what needs a look, the address bar. */

export const PATH = '/admin/courses';
export const COURSES_KEY = 'admin:courses';
/** "Taught lately" means a session in this many days. */
export const RECENT_DAYS = 30;
/** Search shows from this many courses (the built-in list alone has more). */
export const SEARCH_FROM = 8;

const DAY = 86_400_000;

export type Kind = 'built_in' | 'changed' | 'added';

/** Built-in and untouched, a built-in changed here (recoded, retitled, units set), or added here. */
export function kindOf(course: LectureCatalogCourse): Kind {
  if (course.id === null) return 'built_in';
  return course.builtInCode ? 'changed' : 'added';
}

/** The letters before the number: "ECE 305" → "ECE". */
export function prefixOf(code: string): string {
  return canonicalCourseCode(code).split(' ')[0] ?? code;
}

/** A built-in course that now goes by another code ("Was GET 201"). */
export function wasCode(course: LectureCatalogCourse): string | null {
  return course.builtInCode && courseCodeKey(course.builtInCode) !== courseCodeKey(course.code) ? course.builtInCode : null;
}

/* ---------- what needs a look ---------- */

export type Check =
  | { readonly kind: 'no_units' }
  | { readonly kind: 'same_title'; readonly others: readonly string[] };

/** Titles compared without case, punctuation or extra spaces. */
export function titleKey(title: string): string {
  return title.toLocaleLowerCase('en-NG').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Problems a person should look at, per course code key. Hidden courses raise nothing (nobody
 * can pick them) and don't count as a clash. Two courses with the same title are often the same
 * course added twice under different codes; registers then split between them.
 */
export function checksFor(courses: readonly LectureCatalogCourse[]): Map<string, Check[]> {
  const byTitle = new Map<string, LectureCatalogCourse[]>();
  for (const course of courses) {
    if (course.hidden) continue;
    const key = titleKey(course.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), course]);
  }
  const result = new Map<string, Check[]>();
  for (const course of courses) {
    if (course.hidden) continue;
    const checks: Check[] = [];
    if (course.units == null) checks.push({ kind: 'no_units' });
    const twins = (byTitle.get(titleKey(course.title)) ?? []).filter((other) => other !== course);
    if (twins.length) checks.push({ kind: 'same_title', others: twins.map((other) => other.code) });
    if (checks.length) result.set(courseCodeKey(course.code), checks);
  }
  return result;
}

export function checkText(check: Check): { readonly title: string; readonly detail: string } {
  if (check.kind === 'no_units') {
    return { title: 'Units not set', detail: 'Sources disagree on this course’s units, so they were left blank. Set them from the department’s course list.' };
  }
  const list = joinWords(check.others);
  return {
    title: `Same title as ${list}`,
    detail: 'If they are the same course, sessions are split between two registers. Keep one: hide the other, or change its code to match.',
  };
}

export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ---------- labels ---------- */

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? word : many}`;
}

export function unitsLabel(units: number | null): string {
  return units == null ? 'Units not set' : plural(units, 'unit');
}

export function semesterLabel(semester: 1 | 2 | null): string | null {
  return semester === 1 ? '1st semester' : semester === 2 ? '2nd semester' : null;
}

export function levelLabel(level: number | null): string {
  return level ? `${level} level` : 'Other courses';
}

/** Where the course comes from, in a few words. */
export function originLine(course: LectureCatalogCourse): string {
  const kind = kindOf(course);
  if (kind === 'built_in') return 'Built-in';
  if (kind === 'changed') {
    const was = wasCode(course);
    return was ? `Was ${was}` : 'Built-in, changed here';
  }
  return course.addedByName ? `Added by ${course.addedByName}` : 'Added here';
}

const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Africa/Lagos' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const fullDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

/** "Today", "Yesterday", "Monday", "14 Oct", "14 Oct 2025"; "Never" when the course was never taught. */
export function taughtLabel(iso: string | null, now: number): string {
  if (!iso) return 'Never';
  const at = new Date(iso);
  const days = Math.round((Date.parse(lagosDay.format(new Date(now))) - Date.parse(lagosDay.format(at))) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekday.format(at);
  return (lagosDay.format(at).slice(0, 4) === lagosDay.format(new Date(now)).slice(0, 4) ? dayMonth : dayMonthYear).format(at);
}

/** "Sat, 14 Nov 2026, 09:00": the exact start of the last session. */
export function exactTime(iso: string): string {
  return fullDate.format(new Date(iso));
}

export function isRecent(course: LectureCatalogCourse, now: number): boolean {
  return course.lastSessionAt != null && now - Date.parse(course.lastSessionAt) < RECENT_DAYS * DAY;
}

/* ---------- finding ---------- */

export type Show = 'all' | 'check' | 'added' | 'changed' | 'hidden';
export const SHOWS: readonly Show[] = ['all', 'check', 'added', 'changed', 'hidden'];

export function matchesShow(show: Show, course: LectureCatalogCourse, checks: readonly Check[]): boolean {
  switch (show) {
    case 'all': return true;
    case 'check': return checks.length > 0;
    case 'hidden': return course.hidden;
    case 'added': return !course.hidden && kindOf(course) === 'added';
    case 'changed': return !course.hidden && kindOf(course) === 'changed';
  }
}

/**
 * Every word must appear in the code, title, group, old code or adder's name; or the query,
 * spaces dropped, is part of the code ("ece3" finds ECE 305).
 */
export function matchesQuery(course: LectureCatalogCourse, query: string): boolean {
  const words = query.toLocaleLowerCase('en-NG').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${course.code} ${course.title} ${course.group} ${course.builtInCode ?? ''} ${course.addedByName ?? ''}`.toLocaleLowerCase('en-NG');
  if (words.every((word) => haystack.includes(word))) return true;
  return courseCodeKey(course.code).toLocaleLowerCase('en-NG').includes(words.join(''));
}

export type Counts = {
  readonly pickable: number;
  readonly builtIn: number;
  readonly added: number;
  readonly changed: number;
  readonly hidden: number;
  readonly check: number;
  readonly recent: number;
  readonly total: number;
};

export function countCourses(courses: readonly LectureCatalogCourse[], checks: ReadonlyMap<string, readonly Check[]>, now: number): Counts {
  let pickable = 0; let builtIn = 0; let added = 0; let changed = 0; let hidden = 0; let check = 0; let recent = 0;
  for (const course of courses) {
    if (course.hidden) { hidden += 1; continue; }
    pickable += 1;
    const kind = kindOf(course);
    if (kind === 'built_in') builtIn += 1;
    else if (kind === 'added') added += 1;
    else changed += 1;
    if (checks.has(courseCodeKey(course.code))) check += 1;
    if (isRecent(course, now)) recent += 1;
  }
  return { pickable, builtIn, added, changed, hidden, check, recent, total: courses.length };
}

/** Prefixes in use, most courses first, with how many visible courses each has. */
export function prefixCounts(courses: readonly LectureCatalogCourse[]): Array<{ readonly prefix: string; readonly count: number }> {
  const counts = new Map<string, number>();
  for (const course of courses) {
    if (course.hidden) continue;
    const prefix = prefixOf(course.code);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()].map(([prefix, count]) => ({ prefix, count })).sort((a, b) => a.prefix.localeCompare(b.prefix));
}

export type LevelGroup = { readonly key: string; readonly title: string; readonly courses: readonly LectureCatalogCourse[] };

/** Sections by level (100 level first), courses by code within each. */
export function groupByLevel(courses: readonly LectureCatalogCourse[]): LevelGroup[] {
  const groups = new Map<number, LectureCatalogCourse[]>();
  for (const course of courses) {
    const level = course.level ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), course]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a || 999) - (b || 999))
    .map(([level, items]) => ({
      key: String(level),
      title: levelLabel(level || null),
      courses: [...items].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true })),
    }));
}

/* ---------- the address bar ---------- */

export type View = { readonly show: Show; readonly prefix: string | null; readonly course: string | null };

/** `?show=check&prefix=ece&course=ece305`; anything unknown falls back quietly. */
export function readView(params: { get(name: string): string | null } | null): View {
  const show = params?.get('show');
  const prefix = params?.get('prefix')?.trim().toLowerCase() ?? '';
  const course = params?.get('course')?.trim().toLowerCase() ?? '';
  return {
    show: SHOWS.includes(show as Show) ? (show as Show) : 'all',
    prefix: /^[a-z]{2,5}$/.test(prefix) ? prefix : null,
    course: /^[a-z]{2,5}\d{3}[a-z]?$/.test(course) ? course : null,
  };
}

export function viewHref(path: string, view: View): string {
  const params = new URLSearchParams();
  if (view.show !== 'all') params.set('show', view.show);
  if (view.prefix) params.set('prefix', view.prefix);
  if (view.course) params.set('course', view.course);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** "ECE 305" → "ece305", the course's name in the address bar. */
export function courseSlug(code: string): string {
  return courseCodeKey(code).toLowerCase();
}

export function findBySlug(slug: string | null, courses: readonly LectureCatalogCourse[]): LectureCatalogCourse | null {
  if (!slug) return null;
  return courses.find((course) => courseSlug(course.code) === slug) ?? null;
}

/* ---------- renaming a prefix ---------- */

export const PREFIX_PATTERN = /^[A-Z]{2,5}$/;

/** Why a rename can't be previewed yet, or null when it can. */
export function renameProblem(from: string, to: string): string | null {
  if (!from) return 'Choose the prefix to rename.';
  if (!PREFIX_PATTERN.test(to)) return 'Type the new prefix: 2 to 5 letters, e.g. MEE.';
  if (from === to) return 'The new prefix is the same as the old one.';
  return null;
}
