import type { StudentAttendanceCourseSummary, StudentAttendanceHistoryEntry, StudentLectureHistory, StudentMissedClass } from '@lasuatos/contracts';

/**
 * A student's attendance as one picture: every lecture (attended, missed or removed) and every
 * course with its rate against the exam line. Lecture QR attendance and the older course
 * check-ins (students with enrolled courses) come together here, by course code.
 */

export type LectureStatus = 'present' | 'missed' | 'removed';

export type Lecture = {
  readonly id: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  /** When they checked in, or when the lecture started for a missed one. */
  readonly at: string;
  readonly status: LectureStatus;
  /** How it was marked ("QR scan"), for attended and removed lectures. */
  readonly method: string | null;
  readonly venueName: string | null;
  /** Why it was removed, when recorded. */
  readonly reason: string | null;
  /**
   * The class's session, for classes of a course the student joined with a code: those can be
   * disputed on this page. Null for lectures taken by a lecturer or class rep from a class list.
   */
  readonly sessionId: string | null;
  /** The location reading was imprecise; it still counts. */
  readonly imprecise: boolean;
};

export type Course = {
  readonly slug: string;
  readonly code: string;
  readonly title: string;
  readonly held: number;
  readonly attended: number;
  /** Percentage, or null before any lecture was held. */
  readonly rate: number | null;
  readonly missed: number;
  readonly removed: number;
  /** Newest first. */
  readonly lectures: readonly Lecture[];
};

export type Tone = 'good' | 'edge' | 'warning' | 'danger' | 'none';

export type Standing = { readonly tone: Tone; readonly line: string };

const LAGOS = 'Africa/Lagos';
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: LAGOS });
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: LAGOS });
const dayLabelFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: LAGOS });
const dayLongFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: LAGOS });
const yearFormat = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: LAGOS });

/** "ECE 401" → "ece-401", for the address. */
export function courseSlug(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function courseKey(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

export function lectureMethod(method: 'qr' | 'code' | 'manual' | 'qr_code'): string {
  if (method === 'manual') return 'Added by the lecturer';
  return method === 'code' ? 'Typed code' : 'QR scan';
}

/** Every lecture, newest first. */
export function buildLectures(
  history: StudentLectureHistory | null,
  records: readonly StudentAttendanceHistoryEntry[],
  missedClasses: readonly StudentMissedClass[] = [],
): Lecture[] {
  const lectures: Lecture[] = [];
  for (const entry of history?.entries ?? []) {
    lectures.push({
      id: entry.id,
      courseCode: entry.courseCode,
      courseTitle: entry.courseTitle,
      at: entry.checkedInAt,
      status: entry.removed ? 'removed' : 'present',
      method: lectureMethod(entry.method),
      venueName: entry.venueName,
      reason: entry.removed ? entry.removedReason ?? null : null,
      sessionId: null,
      imprecise: false,
    });
  }
  for (const missed of history?.missed ?? []) {
    lectures.push({
      id: missed.id,
      courseCode: missed.courseCode,
      courseTitle: missed.courseTitle,
      at: missed.startsAt,
      status: 'missed',
      method: null,
      venueName: missed.venueName,
      reason: null,
      sessionId: null,
      imprecise: false,
    });
  }
  for (const record of records) {
    const removed = record.status === 'revoked';
    lectures.push({
      id: record.attendanceSessionId,
      courseCode: record.courseCode,
      courseTitle: record.courseTitle,
      at: record.checkedInAt,
      status: removed ? 'removed' : 'present',
      method: lectureMethod(record.method),
      venueName: record.venueName,
      reason: removed ? record.removedReason : null,
      sessionId: record.attendanceSessionId,
      imprecise: record.venueOutcome === 'inconclusive',
    });
  }
  for (const missed of missedClasses) {
    lectures.push({
      id: missed.attendanceSessionId,
      courseCode: missed.courseCode,
      courseTitle: missed.courseTitle,
      at: missed.startsAt,
      status: 'missed',
      method: null,
      venueName: missed.venueName,
      reason: null,
      sessionId: missed.attendanceSessionId,
      imprecise: false,
    });
  }
  return lectures.sort((a, b) => b.at.localeCompare(a.at));
}

/** One row per course code, in code order. */
export function buildCourses(
  history: StudentLectureHistory | null,
  summary: readonly StudentAttendanceCourseSummary[],
  lectures: readonly Lecture[],
): Course[] {
  const byKey = new Map<string, { code: string; title: string; held: number; attended: number }>();
  const add = (code: string, title: string, held: number, attended: number) => {
    const key = courseKey(code);
    const current = byKey.get(key);
    if (current) {
      current.held += held;
      current.attended += attended;
    } else {
      byKey.set(key, { code, title, held, attended });
    }
  };
  for (const course of history?.courses ?? []) add(course.courseCode, course.courseTitle, course.held, course.attended);
  for (const course of summary) add(course.courseCode, course.courseTitle, course.sessionsHeld, course.attended);
  // A course whose only entries were removed still shows, at 0 of what was held.
  for (const lecture of lectures) if (!byKey.has(courseKey(lecture.courseCode))) add(lecture.courseCode, lecture.courseTitle, 0, 0);

  const lecturesByKey = new Map<string, Lecture[]>();
  for (const lecture of lectures) {
    const key = courseKey(lecture.courseCode);
    const list = lecturesByKey.get(key) ?? [];
    list.push(lecture);
    lecturesByKey.set(key, list);
  }

  return [...byKey.entries()]
    .map(([key, course]) => {
      const own = lecturesByKey.get(key) ?? [];
      const removed = own.filter((lecture) => lecture.status === 'removed').length;
      // Held always covers what was attended, even if a list was cut short.
      const held = Math.max(course.held, course.attended);
      return {
        slug: courseSlug(course.code),
        code: course.code,
        title: course.title,
        held,
        attended: course.attended,
        rate: held ? Math.round((course.attended / held) * 1000) / 10 : null,
        missed: Math.max(0, held - course.attended - removed),
        removed,
        lectures: own,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

/** Lectures they could still miss in a row and stay at or above the line (none held: 0). */
export function canMiss(attended: number, held: number, threshold: number): number {
  if (!held) return 0;
  const line = threshold / 100;
  return Math.max(0, Math.floor(attended / line - held + 1e-9));
}

/** Lectures in a row they need to attend to reach the line again. */
export function toReach(attended: number, held: number, threshold: number): number {
  const line = threshold / 100;
  if (line >= 1) return attended < held ? Infinity : 0;
  return Math.max(0, Math.ceil((line * held - attended) / (1 - line) - 1e-9));
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

/** Where a course stands against the line, in one short sentence. */
export function standing(course: Pick<Course, 'held' | 'attended' | 'rate'>, threshold: number): Standing {
  if (!course.held || course.rate === null) return { tone: 'none', line: 'No lectures held yet' };
  if (course.rate >= threshold) {
    const spare = canMiss(course.attended, course.held, threshold);
    if (spare === 0) return { tone: 'edge', line: `On the line: missing the next one takes you under ${threshold}%` };
    return { tone: 'good', line: `Can miss ${spare} more and stay at ${threshold}%` };
  }
  const need = toReach(course.attended, course.held, threshold);
  const tone: Tone = course.rate >= threshold - 25 ? 'warning' : 'danger';
  return { tone, line: `Attend the next ${need} in a row to reach ${threshold}%` };
}

/** The hero's call to action for a course under the line: "Attend the next 12 ECE 405 lectures to reach 75%". */
export function catchUp(course: Pick<Course, 'code' | 'held' | 'attended'>, threshold: number): string {
  const need = toReach(course.attended, course.held, threshold);
  return `Attend the next ${need === 1 ? `${course.code} lecture` : `${need} ${course.code} lectures`} to reach ${threshold}%`;
}

export function overall(courses: readonly Course[]): { held: number; attended: number; rate: number | null } {
  const held = courses.reduce((sum, course) => sum + course.held, 0);
  const attended = courses.reduce((sum, course) => sum + course.attended, 0);
  return { held, attended, rate: held ? Math.round((attended / held) * 1000) / 10 : null };
}

/** The headline over everything: on track, or which courses are under the line. */
export function verdict(courses: readonly Course[], threshold: number): { tone: 'good' | 'warning' | 'danger' | 'none'; title: string; below: readonly Course[] } {
  const counted = courses.filter((course) => course.rate !== null);
  if (counted.length === 0) return { tone: 'none', title: 'No lectures held yet', below: [] };
  const below = counted.filter((course) => (course.rate ?? 0) < threshold);
  if (below.length === 0) return { tone: 'good', title: 'On track for exams', below };
  const worst = Math.min(...below.map((course) => course.rate ?? 0));
  const tone = worst < threshold - 25 ? 'danger' : 'warning';
  return { tone, title: below.length === 1 ? `${below[0]!.code} is under ${threshold}%` : `${below.length} courses are under ${threshold}%`, below };
}

/** The latest lectures held, oldest first, for the row of dots. Removed ones count as not attended. */
export function recentForm(lectures: readonly Lecture[], count: number): Lecture[] {
  return lectures.slice(0, count).reverse();
}

export type Filter = 'all' | 'missed' | 'removed';

export function filterLectures(lectures: readonly Lecture[], filter: Filter): Lecture[] {
  return filter === 'all' ? [...lectures] : lectures.filter((lecture) => lecture.status === filter);
}

export function counts(lectures: readonly Lecture[]): Record<LectureStatus, number> {
  const result: Record<LectureStatus, number> = { present: 0, missed: 0, removed: 0 };
  for (const lecture of lectures) result[lecture.status] += 1;
  return result;
}

export function dayLabel(iso: string, now: number): string {
  const key = dayKeyFormat.format(new Date(iso));
  if (key === dayKeyFormat.format(new Date(now))) return 'Today';
  if (key === dayKeyFormat.format(new Date(now - 86_400_000))) return 'Yesterday';
  const label = dayLabelFormat.format(new Date(iso));
  return yearFormat.format(new Date(iso)) === yearFormat.format(new Date(now)) ? label : `${label} ${yearFormat.format(new Date(iso))}`;
}

export function longDay(iso: string): string {
  return dayLongFormat.format(new Date(iso));
}

export function clock(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** Consecutive lectures on the same day, under one heading. */
export function groupByDay(lectures: readonly Lecture[], now: number): { label: string; key: string; items: Lecture[] }[] {
  const groups: { label: string; key: string; items: Lecture[] }[] = [];
  for (const lecture of lectures) {
    const key = dayKeyFormat.format(new Date(lecture.at));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(lecture);
    else groups.push({ key, label: dayLabel(lecture.at, now), items: [lecture] });
  }
  return groups;
}

export function formatRate(rate: number | null): string {
  if (rate === null) return '–';
  return `${Math.round(rate)}%`;
}

export const STATUS_LABEL: Record<LectureStatus, string> = { present: 'Present', missed: 'Missed', removed: 'Removed' };

/** The line under a lecture: when, how and where. */
export function lectureLine(lecture: Lecture): string {
  const parts = [lecture.status === 'missed' ? `Class at ${clock(lecture.at)}` : clock(lecture.at)];
  if (lecture.method) parts.push(lecture.method);
  if (lecture.venueName) parts.push(lecture.venueName);
  return parts.join(' · ');
}
