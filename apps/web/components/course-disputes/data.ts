'use client';

import { DISPUTES_CHANGED_EVENT, loadLecturerAttendanceDisputes } from '../../lib/attendance-api';
import { primeResource, revalidate, staleResources } from '../../lib/resource';
import { detailKey, OFFERINGS_KEY, SESSIONS_KEY } from '../course-sessions/data';
import { problemText, type Dispute, type DisputeList, type Tab } from './model';

/* Cached reads for attendance disputes (lib/resource). */

export { loadOfferings, OFFERINGS_KEY } from '../course-sessions/data';

/** One list per tab, for every course: the course filter is applied on the device, so switching it is instant. */
export const listKey = (tab: Tab) => `course-disputes:${tab}`;

const loaders = new Map<Tab, (signal: AbortSignal) => Promise<DisputeList>>();
export function listLoader(tab: Tab) {
  let loader = loaders.get(tab);
  if (!loader) {
    loader = (signal: AbortSignal) => loadLecturerAttendanceDisputes({ status: tab }, signal).catch((caught: unknown) => {
      if (caught instanceof DOMException) throw caught;
      throw new Error(problemText(caught, 'Disputes did not load. Check your connection and try again.'));
    });
    loaders.set(tab, loader);
  }
  return loader;
}

/**
 * After a decision: the open list drops it and the decided list gains it at once; then the
 * lists, the course reports, the class's own page, the course list's counts and the menu badge
 * all read again.
 */
export function afterDecision(open: DisputeList | undefined, decided: Dispute) {
  if (open) {
    primeResource<DisputeList>(listKey('open'), {
      disputes: open.disputes.filter((dispute) => dispute.id !== decided.id),
      openCount: Math.max(0, open.openCount - 1),
    });
  }
  revalidate(listKey('open'), listLoader('open'), 0);
  revalidate(listKey('resolved'), listLoader('resolved'), 0);
  staleResources('course-reports:');
  staleResources(OFFERINGS_KEY);
  staleResources(SESSIONS_KEY);
  staleResources(detailKey(decided.attendanceSessionId));
  window.dispatchEvent(new Event(DISPUTES_CHANGED_EVENT));
}
