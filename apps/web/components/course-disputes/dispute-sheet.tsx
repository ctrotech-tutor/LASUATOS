'use client';

import { ArrowRight, CalendarDays, UserCheck, UserX } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { resolveAttendanceDispute } from '../../lib/attendance-api';
import { formatClock } from '../../lib/lecture-api';
import { haptic } from '../../lib/use-live';
import { Badge, Button, rateTone, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { Mark, markLabel } from '../course-reports/grid';
import { CELL } from '../course-reports/model';
import { useThreshold } from '../registers/threshold';
import { afterDecision } from './data';
import {
  canUphold,
  currentMark,
  inCourse,
  nextOpen,
  NOTE_MAX,
  noteProblem,
  noteSuggestions,
  OUTCOME,
  plural,
  problemText,
  reportHref,
  standingOf,
  waitedLabel,
  when,
  type Decision,
  type Dispute,
  type DisputeList,
  type Figure,
} from './model';

/**
 * One dispute: the class and the student's mark in it, what they say happened, where they
 * stand in the course (and where upholding would put them), then the decision with a note to
 * the student. After a decision the next waiting dispute opens, as mail moves to the next message.
 */
export function DisputeSheet({ selectedId, lists, openList, course, today, onSelect, onClose, onStale }: Readonly<{
  selectedId: string | null;
  lists: readonly DisputeList[];
  openList: DisputeList | undefined;
  course: string;
  today: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onStale: () => void;
}>) {
  // Kept while the sheet animates closed, and after a decision takes it out of the open list.
  const [shown, setShown] = useState<Dispute | null>(null);
  const live = selectedId ? lists.flatMap((list) => list.disputes).find((dispute) => dispute.id === selectedId) ?? null : null;
  if (live && live !== shown) setShown(live);
  const dispute = live ?? shown;
  // The open list refreshes by itself: a waiting dispute that drops out of it while it is on
  // screen was decided by another lecturer or withdrawn by the student in the meantime.
  const settledElsewhere = Boolean(selectedId && !live && shown?.id === selectedId && shown.status === 'open' && openList);
  const body = useRef<HTMLDivElement>(null);

  function decided(result: Dispute) {
    afterDecision(openList, result);
    const next = openList ? nextOpen(inCourse(openList.disputes, course), result.id) : null;
    if (next) {
      onSelect(next.id);
      body.current?.closest('.ds-sheet-body')?.scrollTo({ top: 0 });
    } else {
      setShown(result);
      onClose();
    }
  }

  return (
    <Sheet open={Boolean(selectedId && dispute)} onClose={onClose} title={dispute?.student.displayName ?? 'Dispute'}>
      <div ref={body}>
        {dispute ? <DisputeDetail key={dispute.id} dispute={dispute} today={today} settledElsewhere={settledElsewhere} onDecided={decided} onStale={onStale} /> : null}
      </div>
    </Sheet>
  );
}

function DisputeDetail({ dispute, today, settledElsewhere, onDecided, onStale }: Readonly<{
  dispute: Dispute;
  today: string;
  settledElsewhere: boolean;
  onDecided: (result: Dispute) => void;
  onStale: () => void;
}>) {
  const threshold = useThreshold();
  const cell = currentMark(dispute);
  // Like the report, a student who left the course is not counted, so has no figure.
  const standing = dispute.student.enrollmentStatus === 'withdrawn' ? null : standingOf(dispute);
  const first = dispute.student.displayName.split(/\s+/)[0] ?? dispute.student.displayName;
  const enrolled = canUphold(dispute);

  return (
    <div className="rg-person dp-detail">
      <p className="rg-person-id">
        <span className="ds-mono">{dispute.student.studentNumber}</span>
        {dispute.student.studentNumberVerified ? null : <span> · matric not verified</span>}
        <span> · {dispute.courseCode}</span>
      </p>
      {settledElsewhere ? (
        // First thing on screen: nothing here can be decided any more.
        <p className="rp-note dp-settled" role="status">
          No longer waiting: another lecturer decided it, or {first} withdrew it, a moment ago. It is under Decided.
        </p>
      ) : null}
      {enrolled || dispute.status !== 'open' || settledElsewhere ? null : (
        <p className="rp-note">
          {dispute.student.enrollmentStatus === 'withdrawn' ? 'They have left this course' : dispute.student.enrollmentStatus === 'completed' ? 'This course is over' : 'They are no longer on this course'}
          , so they cannot be marked present. You can still reject it with a note.
        </p>
      )}

      {dispute.status === 'open' ? null : <Outcome dispute={dispute} today={today} />}

      <section className="dp-block" aria-label="The class">
        <div className="rp-mark-head">
          <span className={`rp-mark-badge is-${CELL[cell].tone}`}><Mark cell={cell} /></span>
          <span>
            <strong>{markLabel(cell, false)}</strong>
            <span>{dispute.sessionTitle} · {when(dispute.sessionStartsAt, today)}{dispute.venueName ? ` · ${dispute.venueName}` : ''}</span>
          </span>
        </div>
        <RecordFacts dispute={dispute} today={today} />
      </section>

      <section className="dp-block" aria-labelledby={`dp-says-${dispute.id}`}>
        <h3 className="dp-block-title" id={`dp-says-${dispute.id}`}>What {first} says</h3>
        <blockquote className="dp-statement">{dispute.statement}</blockquote>
        <p className="dp-meta">
          Sent {when(dispute.createdAt, today)}
          {dispute.status === 'open' && !settledElsewhere && today ? ` · waiting ${waitedLabel(dispute.createdAt, today).toLowerCase()}` : ''}
        </p>
      </section>

      {standing ? (
        <section className="dp-block" aria-labelledby={`dp-standing-${dispute.id}`}>
          <h3 className="dp-block-title" id={`dp-standing-${dispute.id}`}>In {dispute.courseCode} so far</h3>
          <div className="dp-figures">
            <FigureView figure={standing.now} threshold={threshold} label="Now" />
            {standing.ifUpheld ? (
              <>
                <ArrowRight className="dp-arrow" size={18} strokeWidth={2.2} aria-hidden="true" />
                <FigureView figure={standing.ifUpheld} threshold={threshold} label="If upheld" />
              </>
            ) : null}
          </div>
          <StandingNote now={standing.now} ifUpheld={standing.ifUpheld} threshold={threshold} />
        </section>
      ) : null}

      {settledElsewhere ? null : dispute.status === 'open' ? <Decide dispute={dispute} first={first} onDecided={onDecided} onStale={onStale} /> : null}

      <div className="rp-actions dp-links">
        <Button variant="gray" block href={reportHref(dispute)}>See in the report</Button>
        <Button variant="gray" block href={`/lecturer/attendance/${dispute.attendanceSessionId}`} icon={<CalendarDays size={18} strokeWidth={2.1} aria-hidden="true" />}>Open the class</Button>
      </div>
    </div>
  );
}

/** What the record shows: no check-in; or the check-in, and the last change to it with its reason. */
function RecordFacts({ dispute, today }: Readonly<{ dispute: Dispute; today: string }>) {
  const { record, lastCorrection: change } = dispute;
  if (!record) return <div className="dp-facts"><p>No check-in from them for this class.</p></div>;
  const removed = record.status === 'revoked';
  // The change that explains today's mark, if the last one does.
  const explains = change && (removed ? change.action === 'revoke' : change.action === 'mark_present');
  return (
    <div className="dp-facts">
      {record.method === 'manual' && !explains ? <p>Marked present by a lecturer.</p> : null}
      {record.method !== 'manual' ? <p>Checked in at {formatClock(record.checkedInAt)}.</p> : null}
      {explains ? (
        <p className="dp-change">
          <span>{removed ? 'Removed' : 'Marked present'} by {change.actorName}, {when(change.createdAt, today)}:</span>
          <q>{change.reason}</q>
        </p>
      ) : removed && record.revokedAt ? <p>Removed {when(record.revokedAt, today)}.</p> : null}
    </div>
  );
}

function FigureView({ figure, threshold, label }: Readonly<{ figure: Figure; threshold: number; label: string }>) {
  const tone = rateTone(figure.rate, threshold);
  return (
    <div className="dp-figure">
      <span className="dp-figure-label">{label}</span>
      <strong className={`dp-figure-rate is-${tone}`}>{figure.rate === null ? '–' : `${Math.round(figure.rate)}%`}</strong>
      <span className="dp-figure-of">{figure.attended} of {plural(figure.eligible, 'class', 'classes')}</span>
    </div>
  );
}

function StandingNote({ now, ifUpheld, threshold }: Readonly<{ now: Figure; ifUpheld: Figure | null; threshold: number }>) {
  const below = (figure: Figure) => figure.rate !== null && figure.rate < threshold;
  let text: string | null = null;
  if (ifUpheld && below(now) && !below(ifUpheld)) text = `Upholding takes them back to ${threshold}% or above.`;
  else if (ifUpheld && below(now)) text = `Below ${threshold}% either way.`;
  else if (below(now)) text = `Below ${threshold}%.`;
  return text ? <p className="dp-meta">{text}</p> : null;
}

function Decide({ dispute, first, onDecided, onStale }: Readonly<{
  dispute: Dispute;
  first: string;
  onDecided: (result: Dispute) => void;
  onStale: () => void;
}>) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const enrolled = canUphold(dispute);
  const alreadyPresent = dispute.record?.status === 'present';

  if (decision) {
    return <DecisionForm dispute={dispute} first={first} decision={decision} onCancel={() => setDecision(null)} onDecided={onDecided} onStale={onStale} />;
  }
  return (
    <div className="dp-decide">
      <div className="rp-actions">
        <Button variant="gray" block icon={<UserX size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setDecision('reject')}>Reject</Button>
        <Button block disabled={!enrolled} icon={<UserCheck size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setDecision('uphold')}>Uphold</Button>
      </div>
      <p className="dp-meta">
        {alreadyPresent
          ? 'They are already marked present, so upholding changes nothing in the register.'
          : enrolled ? 'Upholding marks them present for this class. Rejecting keeps the mark as it is.' : 'Rejecting keeps the mark as it is.'}
        {' '}Either way {first} sees your note, and the decision is final.
      </p>
    </div>
  );
}

function DecisionForm({ dispute, first, decision, onCancel, onDecided, onStale }: Readonly<{
  dispute: Dispute;
  first: string;
  decision: Decision;
  onCancel: () => void;
  onDecided: (result: Dispute) => void;
  onStale: () => void;
}>) {
  const feedback = useFeedback();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const hintId = `dp-note-hint-${dispute.id}`;
  useEffect(() => { field.current?.focus({ preventScroll: true }); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = noteProblem(note);
    if (problem) {
      setError(problem);
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await resolveAttendanceDispute(dispute.id, { decision, note: note.trim() });
      haptic(14);
      feedback.toast(decision === 'reject'
        ? `Rejected. ${first} can read your note.`
        : result.correction === 'applied'
          ? `Upheld. ${dispute.student.displayName} is marked present for ${dispute.sessionTitle}.`
          : `Upheld. ${first} was already marked present.`);
      onDecided(result.dispute);
    } catch (caught) {
      setBusy(false);
      const status = caught && typeof caught === 'object' && 'status' in caught ? caught.status : null;
      if (status === 409 || status === 404) {
        setError('This dispute was decided by another lecturer or withdrawn by the student. The list has been refreshed.');
        onStale();
      } else {
        setError(problemText(caught, 'That did not save. Check your connection and try again.'));
      }
    }
  }

  return (
    <form className="rp-reason dp-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span className="rp-label-row">
          <span>{decision === 'uphold' ? `Why uphold? ${first} sees this` : `Why reject? ${first} sees this`}</span>
          <span className="rp-label-aside">{note.trim().length}/{NOTE_MAX}</span>
        </span>
        <textarea
          ref={field}
          value={note}
          onChange={(event) => { setNote(event.target.value); setError(''); }}
          rows={3}
          maxLength={NOTE_MAX}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
        />
        <small id={hintId}>
          {decision === 'uphold' ? 'Also kept with their record as the reason they were marked present.' : 'Their mark stays as it is.'} Decisions are final.
        </small>
      </label>
      <div className="ui-dialog-chips">
        {noteSuggestions(decision, dispute.kind).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={`lx-chip-button${note === suggestion ? ' is-selected' : ''}`}
            onClick={() => { setNote(suggestion); setError(''); }}
          >
            {suggestion}
          </button>
        ))}
      </div>
      {error ? <p className="rp-error" role="alert">{error}</p> : null}
      <div className="rp-actions">
        <Button variant="gray" block disabled={busy} onClick={onCancel}>Back</Button>
        <Button type="submit" variant={decision === 'reject' ? 'destructive' : 'filled'} block busy={busy}>
          {decision === 'reject' ? 'Reject' : dispute.record?.status === 'present' ? 'Uphold' : 'Uphold and mark present'}
        </Button>
      </div>
    </form>
  );
}

function Outcome({ dispute, today }: Readonly<{ dispute: Dispute; today: string }>) {
  if (dispute.status === 'open') return null;
  const outcome = OUTCOME[dispute.status];
  return (
    <section className="dp-block dp-outcome" aria-label="Decision">
      <p className="dp-outcome-head">
        <Badge tone={outcome.tone}>{outcome.label}</Badge>
        <span>
          {dispute.status === 'withdrawn' ? 'by the student' : `by ${dispute.resolvedByName ?? 'a lecturer'}`}
          {dispute.resolvedAt ? `, ${when(dispute.resolvedAt, today)}` : ''}
        </span>
      </p>
      {dispute.resolutionNote ? <blockquote className="dp-statement is-note">{dispute.resolutionNote}</blockquote> : null}
    </section>
  );
}
