'use client';

import type { AttendanceCorrectionEntry } from '@lasuatos/contracts';
import { loadAttendanceCorrections, loadAttendanceReportOverview, loadOfferingAttendanceReport } from '../../lib/attendance-api';
import { staleResources } from '../../lib/resource';
import { detailKey, SESSIONS_KEY } from '../course-sessions/data';
import { problemText, type Report, type Standing } from './model';

/* Cached reads for attendance reports (lib/resource). */

/** Course tools and Course sessions read the courses through the same key, so the pages share one copy. */
export { loadOfferings, OFFERINGS_KEY } from '../course-sessions/data';
export const overviewKey = (threshold: number) => `course-reports:overview:${threshold}`;
export const reportKey = (courseOfferingId: string) => `course-reports:report:${courseOfferingId}`;
export const changesKey = (sessionId: string) => `course-reports:changes:${sessionId}`;

function friendly<T>(load: () => Promise<T>, fallback: string): Promise<T> {
  return load().catch((caught: unknown) => {
    if (caught instanceof DOMException) throw caught;
    const status = caught && typeof caught === 'object' && 'status' in caught ? caught.status : null;
    if (status === 404) throw new Error('This course is not one of yours, or it no longer exists.');
    throw new Error(problemText(caught, fallback));
  });
}

// One loader per key, so useResource sees a stable function.
function memo<A extends string | number, T>(make: (arg: A) => (signal: AbortSignal) => Promise<T>) {
  const made = new Map<A, (signal: AbortSignal) => Promise<T>>();
  return (arg: A) => {
    let loader = made.get(arg);
    if (!loader) {
      loader = make(arg);
      made.set(arg, loader);
    }
    return loader;
  };
}

export const overviewLoader = memo((threshold: number) => (signal: AbortSignal): Promise<readonly Standing[]> =>
  friendly(async () => (await loadAttendanceReportOverview(threshold, signal)).courses, 'Attendance figures did not load.'));

/** The report is read without a threshold: the line is applied on the device, so changing it needs no new request. */
export const reportLoader = memo((courseOfferingId: string) => (signal: AbortSignal): Promise<Report> =>
  friendly(() => loadOfferingAttendanceReport(courseOfferingId, undefined, signal), 'This report did not load. Check your connection and try again.'));

export const changesLoader = memo((sessionId: string) => (signal: AbortSignal): Promise<readonly AttendanceCorrectionEntry[]> =>
  friendly(async () => (await loadAttendanceCorrections(sessionId, signal)).corrections, 'The changes did not load.'));

/** After a correction: every report figure and the class's own page read again. */
export function afterCorrection(sessionId: string) {
  staleResources('course-reports:');
  staleResources(detailKey(sessionId));
  staleResources(SESSIONS_KEY);
}
