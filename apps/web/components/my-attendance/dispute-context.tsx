'use client';

import type { StudentAttendanceDispute, StudentDisputableSession } from '@lasuatos/contracts';
import { CheckCircle2, Clock3, MessageSquareWarning, Undo2, XCircle } from 'lucide-react';
import { createContext, useContext } from 'react';
import { day, timeLeft } from './dispute-model';

/** What a class's row can say about a dispute: one can be sent, or one was. */
export type LectureDisputeState =
  | { readonly kind: 'can'; readonly session: StudentDisputableSession }
  | { readonly kind: 'sent'; readonly dispute: StudentAttendanceDispute };

export type DisputeActions = {
  readonly now: number;
  readonly forSession: (sessionId: string) => LectureDisputeState | null;
  readonly compose: (sessionId: string) => void;
  readonly view: (disputeId: string) => void;
};

/** Given by the page once disputes have loaded; rows say nothing about disputes without it. */
export const DisputeContext = createContext<DisputeActions | null>(null);

const SENT: Record<StudentAttendanceDispute['status'], { readonly label: string; readonly tone: string; readonly Icon: typeof Clock3 }> = {
  open: { label: 'Dispute waiting for your lecturer', tone: 'waiting', Icon: Clock3 },
  upheld: { label: 'Dispute accepted', tone: 'accepted', Icon: CheckCircle2 },
  rejected: { label: 'Dispute not accepted', tone: 'declined', Icon: XCircle },
  withdrawn: { label: 'Dispute withdrawn', tone: 'withdrawn', Icon: Undo2 },
};

/**
 * Under a missed or removed class of a joined course: "Dispute · 9 days left" while it can be
 * disputed, or where the dispute stands once sent. Tapping opens the form or the dispute.
 */
export function LectureDispute({ sessionId, present, context }: Readonly<{ sessionId: string; present: boolean; context: string }>) {
  const actions = useContext(DisputeContext);
  const state = actions?.forSession(sessionId) ?? null;
  if (!actions || !state) return null;
  // On an attended class, only an accepted dispute is worth a word (it is why they are present).
  if (present && !(state.kind === 'sent' && state.dispute.status === 'upheld')) return null;
  if (state.kind === 'can') {
    const left = timeLeft(state.session.disputeDeadline, actions.now);
    if (left.over) return null;
    return (
      <button
        type="button"
        className={`ma-lecture-act is-can${left.urgent ? ' is-urgent' : ''}`}
        onClick={() => actions.compose(sessionId)}
        aria-label={`Dispute · ${left.label}, ${context}`}
      >
        <MessageSquareWarning size={14} strokeWidth={2.3} aria-hidden="true" />
        Dispute<span className="ma-lecture-act-left"> · {left.label}</span>
      </button>
    );
  }
  const sent = SENT[state.dispute.status];
  return (
    <button
      type="button"
      className={`ma-lecture-act is-${sent.tone}`}
      onClick={() => actions.view(state.dispute.id)}
      aria-label={`${sent.label}, ${context}, sent ${day(state.dispute.createdAt)}`}
    >
      <sent.Icon size={14} strokeWidth={2.3} aria-hidden="true" />
      {sent.label}
    </button>
  );
}
