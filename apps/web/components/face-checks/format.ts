/** Wording and grouping for face checks. */

import { FACE_MATCH, type FaceReviewItem } from '@lasuatos/contracts';
import { formatClock } from '../../lib/lecture-api';

/**
 * Where a score sits between the pass line and a clear match, 0 to 1. Every check here passed
 * (at least `pass`) without being clear (below `clear`).
 */
export function closeness(score: number): number {
  return Math.min(1, Math.max(0, (score - FACE_MATCH.pass) / (FACE_MATCH.clear - FACE_MATCH.pass)));
}

/** A weak match sits in the lower third, nearest the pass line: look closer. */
export function isWeak(score: number): boolean {
  return closeness(score) < 1 / 3;
}

export const REJECT_REASONS = ['Not the same person', 'Photo of a photo or a screen', 'Face hidden or unclear'] as const;

export const STATUS_LABEL: Readonly<Record<FaceReviewItem['status'], string>> = {
  pending: 'To review',
  approved: 'Same person',
  rejected: 'Removed',
  removed: 'Removed another way',
};

export type SessionGroup = { readonly sessionId: string; readonly items: FaceReviewItem[] };

/**
 * Checks by session, sessions in the order they first appear (newest first). Two
 * sessions held at the same time interleave by check-in time; they still get one
 * group each.
 */
export function groupBySession(items: readonly FaceReviewItem[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const item of items) {
    const group = groups.get(item.sessionId);
    if (group) group.items.push(item);
    else groups.set(item.sessionId, { sessionId: item.sessionId, items: [item] });
  }
  return [...groups.values()];
}

const dayFormat = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const lagosDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });

/** "Today", "Yesterday" or "Mon, 9 Nov", in Lagos. */
export function dayLabel(iso: string, now: number): string {
  const day = lagosDate.format(new Date(iso));
  if (day === lagosDate.format(new Date(now))) return 'Today';
  if (day === lagosDate.format(new Date(now - 86_400_000))) return 'Yesterday';
  return dayFormat.format(new Date(iso));
}

/** "ECE 305 · Today, 08:00". */
export function sessionLine(item: FaceReviewItem, now: number): string {
  return `${item.courseCode} · ${dayLabel(item.sessionStartsAt, now)}, ${formatClock(item.sessionStartsAt)}`;
}
