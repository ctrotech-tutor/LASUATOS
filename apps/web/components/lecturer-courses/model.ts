import { courseLevelFromCode, type LecturerCourseOffering, type LecturerSemester } from '@lasuatos/contracts';

/*
 * Course tools: the lecturer's course offerings grouped by semester, what each code can do,
 * and the words the page uses. Plain functions, so the page and its tests share them.
 */

export type Offering = LecturerCourseOffering;
export type Phase = 'current' | 'upcoming' | 'ended';

export type CourseGroup = {
  readonly key: string;
  readonly title: string;
  readonly aside: string | null;
  readonly phase: Phase;
  readonly offerings: readonly Offering[];
};

/** The levels a course can be offered at, as the server stores them. */
export const LEVELS = ['100', '200', '300', '400', '500', '600', '700'] as const;

const ZONE = 'Africa/Lagos';

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? word : many}`;
}

export function phaseOf(offering: Pick<Offering, 'semesterStartsAt' | 'semesterEndsAt'>, now: number): Phase {
  if (Date.parse(offering.semesterEndsAt) <= now) return 'ended';
  return Date.parse(offering.semesterStartsAt) > now ? 'upcoming' : 'current';
}

/** "31 Jan", or "31 Jan 2027" when the year is not this one. */
export function shortDate(iso: string, now: number): string {
  const date = new Date(iso);
  const sameYear = new Intl.DateTimeFormat('en-NG', { year: 'numeric', timeZone: ZONE }).format(date)
    === new Intl.DateTimeFormat('en-NG', { year: 'numeric', timeZone: ZONE }).format(new Date(now || Date.now()));
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: ZONE }).format(date);
}

/** "31 January 2027": for sentences that must not be misread. */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE }).format(new Date(iso));
}

/** "300 level" for the usual levels; anything else as stored. */
export function levelLabel(level: string): string {
  return /^\d{3}$/.test(level) ? `${level} level` : level;
}

export function unitsLabel(units: number): string | null {
  return units > 0 ? plural(units, 'unit') : null;
}

/** "7K9MPQ2R4XBD" → "7K9M-PQ2R-4XBD", as students see it in My courses. */
export function formatJoinCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** The level the course list gives, else the one its code points to (ECE 305 → "300"), if the server takes it. */
export function suggestedLevel(code: string, listed: number | null = null): string | null {
  const level = listed ?? courseLevelFromCode(code);
  return level !== null && (LEVELS as readonly string[]).includes(String(level)) ? String(level) : null;
}

/** The semester a new course most likely belongs to: the one running now, else the next to start. */
export function defaultSemester(semesters: readonly LecturerSemester[], now: number): LecturerSemester | null {
  const running = semesters.find((semester) => Date.parse(semester.startsAt) <= now && Date.parse(semester.endsAt) > now);
  if (running) return running;
  return [...semesters].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
}

function byCode(a: Offering, b: Offering): number {
  return a.courseCode.localeCompare(b.courseCode, 'en', { numeric: true }) || a.level.localeCompare(b.level, 'en', { numeric: true });
}

/**
 * This semester's courses first (one group per running semester, normally one), then semesters
 * still to start, then everything from semesters that have ended, newest first.
 */
export function groupOfferings(offerings: readonly Offering[], now: number): CourseGroup[] {
  const live = new Map<string, { phase: Phase; startsAt: string; endsAt: string; items: Offering[] }>();
  const ended: Offering[] = [];
  for (const offering of offerings) {
    const phase = phaseOf(offering, now);
    if (phase === 'ended') {
      ended.push(offering);
      continue;
    }
    const key = `${offering.semesterName}|${offering.semesterEndsAt}`;
    const group = live.get(key) ?? { phase, startsAt: offering.semesterStartsAt, endsAt: offering.semesterEndsAt, items: [] };
    group.items.push(offering);
    live.set(key, group);
  }
  const groups: CourseGroup[] = [...live.entries()]
    .sort(([, a], [, b]) => (a.phase === b.phase ? Date.parse(a.startsAt) - Date.parse(b.startsAt) : a.phase === 'current' ? -1 : 1))
    .map(([key, group]) => ({
      key,
      title: group.items[0]!.semesterName,
      aside: group.phase === 'current' ? `Ends ${shortDate(group.endsAt, now)}` : `Starts ${shortDate(group.startsAt, now)}`,
      phase: group.phase,
      offerings: [...group.items].sort(byCode),
    }));
  if (ended.length) {
    groups.push({
      key: 'ended',
      title: 'Earlier semesters',
      aside: null,
      phase: 'ended',
      offerings: [...ended].sort((a, b) => Date.parse(b.semesterEndsAt) - Date.parse(a.semesterEndsAt) || byCode(a, b)),
    });
  }
  return groups;
}

/** The line under the page title: what is running now, and how many students are on it. */
export function summaryLine(offerings: readonly Offering[], now: number): string | null {
  const current = offerings.filter((offering) => phaseOf(offering, now) === 'current');
  if (!current.length) return offerings.length ? 'No courses this semester yet' : null;
  const students = current.reduce((total, offering) => total + offering.students, 0);
  return `${plural(current.length, 'course')} this semester · ${plural(students, 'student')}`;
}

/** The facts under a course's title in its row. */
export function rowFacts(offering: Offering): string {
  return [
    levelLabel(offering.level),
    plural(offering.students, 'student'),
    offering.sessions ? plural(offering.sessions, 'class', 'classes') : null,
  ].filter(Boolean).join(' · ');
}

export type CodeState = 'on' | 'off' | 'closed';

/** Whether students can join now: a working code, none, or the semester has ended. */
export function codeState(offering: Offering, now: number): CodeState {
  if (phaseOf(offering, now) === 'ended') return 'closed';
  return offering.joinCodeActive ? 'on' : 'off';
}

/** The address a shared code opens: My courses with the code filled in, ready to join. */
export function joinLink(origin: string, code: string): string {
  return `${origin}/courses?code=${encodeURIComponent(formatJoinCode(code))}`;
}

/** What "Share" sends to a class group: the link first (it fills the code in), then the code. */
export function inviteText(offering: Pick<Offering, 'courseCode' | 'courseTitle' | 'semesterEndsAt'>, code: string, link: string): string {
  return [
    `Join ${offering.courseCode} (${offering.courseTitle}) on LASUATOS.`,
    `Open ${link}`,
    `or type this code in My courses: ${formatJoinCode(code)}`,
    `It works until ${longDate(offering.semesterEndsAt)}.`,
  ].join('\n');
}

/** Puts a changed course in the list. Title and units belong to the code, so every offering of it changes. */
export function withUpdated(offerings: readonly Offering[], updated: Offering): Offering[] {
  return offerings.map((item) => (
    item.courseOfferingId === updated.courseOfferingId
      ? updated
      : item.courseCode === updated.courseCode ? { ...item, courseTitle: updated.courseTitle, creditUnits: updated.creditUnits } : item
  ));
}

/** A typed-in course title, tidied the way the server stores it. */
export function tidyTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** The message in a failed request (course-api throws `{ status, message }`), or the fallback. */
export function problemText(caught: unknown, fallback: string): string {
  if (caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string' && caught.message) return caught.message;
  return fallback;
}
