import type { AttendanceDisputeKind, AttendanceDisputeStatus, StudentAttendanceDispute, StudentAttendanceDisputes, StudentDisputableSession } from '@lasuatos/contracts';

/**
 * Disputes as the student sees them: a class whose mark they think is wrong (no check-in, or a
 * check-in that was removed), what they told the lecturer, and what the lecturer decided. Pure
 * helpers, so the rules on screen are tested.
 */

export const STATEMENT_MIN = 20;
export const STATEMENT_MAX = 1000;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LAGOS = 'Africa/Lagos';
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: LAGOS });
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: LAGOS });

/** "Thu 22 Oct, 09:00" */
export function when(iso: string): string {
  return `${day(iso)}, ${timeFormat.format(new Date(iso))}`;
}

/** "Thu 22 Oct" */
export function day(iso: string): string {
  return dayFormat.format(new Date(iso));
}

export const KIND_LABEL: Record<AttendanceDisputeKind, string> = {
  missing_check_in: 'No check-in recorded',
  revoked_check_in: 'Check-in removed',
};

export type StatusTone = 'waiting' | 'accepted' | 'declined' | 'withdrawn';

/** The words the student reads; "accepted" matches the decision email. */
export const STATUS: Record<AttendanceDisputeStatus, { readonly label: string; readonly tone: StatusTone }> = {
  open: { label: 'Waiting', tone: 'waiting' },
  upheld: { label: 'Accepted', tone: 'accepted' },
  rejected: { label: 'Not accepted', tone: 'declined' },
  withdrawn: { label: 'Withdrawn', tone: 'withdrawn' },
};

/** Time left to send a dispute: "9 days left", "Last day", "5 h left", "40 min left". */
export function timeLeft(deadline: string, now: number): { readonly label: string; readonly urgent: boolean; readonly over: boolean } {
  const left = Date.parse(deadline) - now;
  if (left <= 0) return { label: 'Closed', urgent: true, over: true };
  if (left < HOUR) return { label: `${Math.max(1, Math.floor(left / 60_000))} min left`, urgent: true, over: false };
  if (left < DAY) return { label: `${Math.floor(left / HOUR)} h left`, urgent: true, over: false };
  const days = Math.floor(left / DAY);
  return { label: days === 1 ? '1 day left' : `${days} days left`, urgent: days <= 2, over: false };
}

/** "today", "yesterday", "3 days ago", "2 weeks ago" */
export function ago(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

const RANK: Record<AttendanceDisputeStatus, number> = { open: 3, upheld: 2, rejected: 2, withdrawn: 1 };

/**
 * The dispute that speaks for each class: one awaiting a decision, else the final decision, else
 * the latest withdrawn one (a withdrawn dispute can be sent again).
 */
export function disputeBySession(disputes: readonly StudentAttendanceDispute[]): Map<string, StudentAttendanceDispute> {
  const result = new Map<string, StudentAttendanceDispute>();
  for (const dispute of disputes) {
    const current = result.get(dispute.attendanceSessionId);
    if (!current || RANK[dispute.status] > RANK[current.status] || (RANK[dispute.status] === RANK[current.status] && dispute.createdAt > current.createdAt)) {
      result.set(dispute.attendanceSessionId, dispute);
    }
  }
  return result;
}

export type DisputeGroups = {
  /** Classes the student can still dispute, the closest deadline first. */
  readonly canDispute: readonly StudentDisputableSession[];
  /** Waiting for the lecturer, oldest first (the one waiting longest leads). */
  readonly waiting: readonly StudentAttendanceDispute[];
  /** Accepted, not accepted or withdrawn, the latest first; a withdrawn one that was sent again is left out. */
  readonly decided: readonly StudentAttendanceDispute[];
  readonly openCount: number;
  readonly atLimit: boolean;
};

export function groupDisputes(data: StudentAttendanceDisputes): DisputeGroups {
  const canDispute = [...data.disputableSessions].sort((a, b) => a.disputeDeadline.localeCompare(b.disputeDeadline));
  const waiting = data.disputes.filter((dispute) => dispute.status === 'open').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = disputeBySession(data.disputes);
  const decided = data.disputes
    .filter((dispute) => dispute.status !== 'open' && latest.get(dispute.attendanceSessionId)?.id === dispute.id)
    .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt));
  return { canDispute, waiting, decided, openCount: waiting.length, atLimit: waiting.length >= data.openLimit };
}

/** Why a statement can't be sent yet, or null when it can. */
export function statementProblem(text: string): string | null {
  const length = text.trim().length;
  if (length === 0) return 'Say what happened. Your lecturer reads this before deciding.';
  if (length < STATEMENT_MIN) return `Add a little more: at least ${STATEMENT_MIN} characters (${STATEMENT_MIN - length} to go).`;
  if (length > STATEMENT_MAX) return `Keep it under ${STATEMENT_MAX} characters.`;
  return null;
}

/** The counter under the box: what is still needed, then how much room is left. */
export function statementCount(text: string): { readonly label: string; readonly ready: boolean } {
  const length = text.trim().length;
  if (length < STATEMENT_MIN) return { label: `${STATEMENT_MIN - length} more to go`, ready: false };
  return { label: `${length}/${STATEMENT_MAX}`, ready: true };
}

/** Sentence starters for a phone keyboard; the student finishes them in their own words. */
export function starters(kind: AttendanceDisputeKind): readonly { readonly label: string; readonly text: string }[] {
  return kind === 'revoked_check_in'
    ? [
        { label: 'I was in the hall', text: 'I was in the hall for the whole class when I checked in. I sat ' },
        { label: 'Location was off indoors', text: 'I checked in from inside the hall, but my phone’s location was off because I was indoors. ' },
        { label: 'It was my own phone', text: 'I checked in on my own phone, in person. ' },
      ]
    : [
        { label: 'My phone died', text: 'I was in class, but my phone’s battery died before I could check in. ' },
        { label: 'The QR code wouldn’t scan', text: 'I was in class, but the QR code would not scan on my phone. ' },
        { label: 'Location wouldn’t work', text: 'I was in class, but my phone could not get my location to check in. ' },
        { label: 'No data or network', text: 'I was in class, but I had no data or network to check in. ' },
      ];
}

/** Adds a starter to what they wrote, on its own line if they already wrote something. */
export function addStarter(current: string, text: string): string {
  const trimmed = current.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n${text}` : text;
}

/** The sentence under a dispute's status, from the student's side. */
export function outcomeLine(dispute: StudentAttendanceDispute, now: number): string {
  const by = dispute.resolvedByName ?? 'Your lecturer';
  const on = dispute.resolvedAt ? ` on ${day(dispute.resolvedAt)}` : '';
  switch (dispute.status) {
    case 'open': return `Sent ${ago(dispute.createdAt, now)}. You get an email when your lecturer decides.`;
    case 'upheld': return `${by} accepted it${on}. You are marked present for this class.`;
    case 'rejected': return `${by} did not accept it${on}. Your mark stays as it is, and the decision is final.`;
    case 'withdrawn': return `You withdrew it${on}.`;
  }
}
