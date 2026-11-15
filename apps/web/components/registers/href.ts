import { canonicalCourseCode, courseCodeKey } from '@lasuatos/contracts';

/** A course's register (/registers/ECE305), optionally filtered to one student (?q=matric). */
export function registerHref(courseCode: string, matricNumber?: string): string {
  return `/registers/${encodeURIComponent(courseCodeKey(canonicalCourseCode(courseCode)))}${matricNumber ? `?q=${encodeURIComponent(matricNumber)}` : ''}`;
}
