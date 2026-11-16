import type { StudentAttendanceCourseSummary, StudentEnrollment } from '@lasuatos/contracts';
import { courseSlug } from '../my-attendance/model';

/** A course code from a lecturer: 12 characters, shown in three groups of four. */
export const JOIN_CODE_LENGTH = 12;
/** Codes never use 0, O, 1 or I, so they can't be misread. */
const JOIN_CODE_ALPHABET = /^[A-HJ-NP-Z2-9]$/;

export type JoinCodeInput = {
  /** What the server is sent: letters and digits only, upper case. */
  readonly code: string;
  /** What the field shows: ABCD-EFGH-JKLM. */
  readonly display: string;
  /** Characters a code never has, in the order typed (each once). */
  readonly misread: readonly string[];
  /** Twelve characters, all of them possible in a code. */
  readonly complete: boolean;
};

/**
 * Reads what was typed or pasted: spaces, dashes and lower case are fine,
 * anything past twelve characters is dropped. Characters a code never uses stay
 * in place (so the student sees what they typed) and are reported.
 */
export function readJoinCode(raw: string): JoinCodeInput {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, JOIN_CODE_LENGTH);
  const misread = [...new Set([...code].filter((char) => !JOIN_CODE_ALPHABET.test(char)))];
  return { code, display: groupJoinCode(code), misread, complete: code.length === JOIN_CODE_LENGTH && misread.length === 0 };
}

export function groupJoinCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? '';
}

/**
 * Where the caret goes after the field is reformatted: after the same number of
 * code characters as before it, so typing or deleting mid-code doesn't jump to the end.
 */
export function caretAfter(display: string, charsBefore: number): number {
  if (charsBefore <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < display.length; index += 1) {
    if (display[index] !== '-') seen += 1;
    if (seen === charsBefore) return index + 1;
  }
  return display.length;
}

/** How many code characters sit before `position` in what was typed. */
export function codeCharsBefore(raw: string, position: number): number {
  return raw.slice(0, position).replace(/[^A-Za-z0-9]/g, '').length;
}

/**
 * Backspace just behind a dash deletes only the dash, which the field puts straight back, so
 * nothing would seem to happen. In that case the character before the dash goes instead.
 * Returns the code and how many characters stay before the caret, or null for any other edit.
 */
export function backspacedDash(previous: string, typed: string, position: number): { code: string; before: number } | null {
  const was = readJoinCode(previous).code;
  if (typed.length >= previous.length || readJoinCode(typed).code !== was) return null;
  const before = codeCharsBefore(typed, position);
  if (before === 0) return null;
  return { code: was.slice(0, before - 1) + was.slice(before), before: before - 1 };
}

/** The hint under the field for characters a code never has. */
export function misreadHint(misread: readonly string[]): string {
  const looksLike: Readonly<Record<string, string>> = { '0': 'O', O: '0', '1': 'I', I: '1' };
  const listed = misread.map((char) => `“${char}”`).join(' and ');
  const mixed = misread.filter((char) => char in looksLike);
  return mixed.length
    ? `Codes never use ${listed}. Check that character with your lecturer: it may be a different letter or number.`
    : `${listed} can’t be in a course code. Check the code with your lecturer.`;
}

export type JoinFailure = { readonly title: string; readonly message: string };

/** Why a join was refused, in words a student can act on. */
export function joinFailure(caught: unknown): JoinFailure {
  const status = caught && typeof caught === 'object' && 'status' in caught && typeof caught.status === 'number' ? caught.status : 0;
  switch (status) {
    case 400:
    case 404:
      return { title: 'That code didn’t work', message: 'Check each character. Codes stop working when the lecturer replaces them and at the end of the semester, so ask for the current one.' };
    case 409:
      return { title: 'This course isn’t taking new students', message: 'Joining it is closed. Ask its lecturer if you should be on it.' };
    case 403:
      return { title: 'Only students can join courses', message: 'Sign in with your student account to join.' };
    case 429:
      return { title: 'Too many tries', message: 'Wait a minute, then try again.' };
    case 503:
      return { title: 'Courses are unavailable', message: 'The service is not set up yet. Try again later.' };
    default:
      return status >= 500
        ? { title: 'Something went wrong', message: 'The course could not be joined. Try again.' }
        : { title: 'No connection', message: 'Check your internet connection and try again.' };
  }
}

export type CourseItem = StudentEnrollment & {
  /** The course's address in My attendance (/attendance?course=ece-405). */
  readonly slug: string;
  readonly held: number;
  readonly attended: number;
  readonly rate: number | null;
};

export type CourseGroups = { readonly current: readonly CourseItem[]; readonly earlier: readonly CourseItem[] };

/**
 * Courses whose semester is still running come first, in code order; the rest
 * (newest semester first) go under Earlier. Each carries its attendance so far.
 */
export function groupCourses(
  enrollments: readonly StudentEnrollment[],
  summary: readonly StudentAttendanceCourseSummary[],
  now: number,
): CourseGroups {
  const byOffering = new Map(summary.map((course) => [course.courseOfferingId, course]));
  const items = enrollments.map((enrollment): CourseItem => {
    const own = byOffering.get(enrollment.courseOfferingId);
    const held = Math.max(own?.sessionsHeld ?? 0, own?.attended ?? 0);
    const attended = own?.attended ?? 0;
    return { ...enrollment, slug: courseSlug(enrollment.courseCode), held, attended, rate: held ? Math.round((attended / held) * 1000) / 10 : null };
  });
  const byCode = (a: CourseItem, b: CourseItem) => a.courseCode.localeCompare(b.courseCode, 'en', { numeric: true });
  return {
    current: items.filter((item) => Date.parse(item.semesterEndsAt) > now).sort(byCode),
    earlier: items
      .filter((item) => Date.parse(item.semesterEndsAt) <= now)
      .sort((a, b) => Date.parse(b.semesterEndsAt) - Date.parse(a.semesterEndsAt) || byCode(a, b)),
  };
}

/** "400 level · First semester": the level as stored may already say "level". */
export function courseLine(course: Pick<StudentEnrollment, 'level' | 'semesterName'>): string {
  const level = /level/i.test(course.level) ? course.level : `${course.level} level`;
  const semester = /semester/i.test(course.semesterName) ? course.semesterName : `${course.semesterName} semester`;
  return `${level} · ${semester}`;
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
