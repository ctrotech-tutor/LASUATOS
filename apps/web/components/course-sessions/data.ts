'use client';

import type { LecturerActiveVenue } from '@lasuatos/contracts';
import { loadLecturerAttendanceSession, loadLecturerAttendanceSessions } from '../../lib/attendance-api';
import { loadLecturerOfferings } from '../../lib/course-api';
import { primeResource, staleResources } from '../../lib/resource';
import { loadLecturerActiveVenues } from '../../lib/venue-api';
import { problemText, type CourseSession, type Offering, type SessionDetail } from './model';

/* Cached reads for course sessions (lib/resource), and the typed codes shown once. */

export const SESSIONS_KEY = 'course-sessions:list';
/** The same key Course tools uses, so both pages share one copy of the courses. */
export const OFFERINGS_KEY = 'lecturer:offerings';
export const VENUES_KEY = 'course-sessions:venues';
export const detailKey = (id: string) => `course-sessions:session:${id}`;

function friendly<T>(load: () => Promise<T>, fallback: string): Promise<T> {
  return load().catch((caught: unknown) => {
    if (caught instanceof DOMException) throw caught;
    throw new Error(problemText(caught, fallback));
  });
}

export const loadSessions = (signal: AbortSignal): Promise<readonly CourseSession[]> =>
  friendly(async () => (await loadLecturerAttendanceSessions(undefined, signal)).sessions, 'Your sessions did not load. Check your connection and try again.');

export const loadOfferings = (signal: AbortSignal): Promise<readonly Offering[]> =>
  friendly(async () => (await loadLecturerOfferings(signal)).offerings, 'Your courses did not load. Check your connection and try again.');

export const loadVenues = (signal: AbortSignal): Promise<readonly LecturerActiveVenue[]> =>
  friendly(async () => (await loadLecturerActiveVenues(signal)).venues, 'Venues did not load.');

export const loadDetail = (id: string) => (signal: AbortSignal): Promise<SessionDetail> =>
  friendly(() => loadLecturerAttendanceSession(id, signal), 'This session did not load. Check your connection and try again.');

/** After a change: the session page and the list both show it at once, then refresh. */
export function primeSession(detail: SessionDetail) {
  primeResource(detailKey(detail.session.id), detail);
  staleResources(SESSIONS_KEY);
  // Course tools counts classes held per course.
  staleResources(OFFERINGS_KEY);
}

/*
 * A typed code exists only when the server hands it over (opening a class, or a new code): it
 * keeps a fingerprint, not the code. Kept here for the life of the tab so leaving the session
 * and coming back still shows it.
 */
export type TypedCode = { readonly code: string; readonly expiresAt: string };
const typedCodes = new Map<string, TypedCode>();
export const rememberCode = (sessionId: string, code: TypedCode) => { typedCodes.set(sessionId, code); };
export const recalledCode = (sessionId: string): TypedCode | null => typedCodes.get(sessionId) ?? null;
