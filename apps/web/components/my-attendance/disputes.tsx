'use client';

import type { StudentAttendanceDispute, StudentAttendanceDisputes, StudentDisputableSession } from '@lasuatos/contracts';
import { Ban, CheckCircle2, ChevronRight, Clock3, Minus, Undo2, XCircle } from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  appealAttendanceDispute, DISPUTES_CHANGED_EVENT, submitAttendanceDispute, withdrawAttendanceAppeal, withdrawAttendanceDispute,
} from '../../lib/attendance-api';
import { primeResource } from '../../lib/resource';
import { haptic } from '../../lib/use-live';
import { Badge, Button, EmptyState, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { DisputeContext, type DisputeActions, type LectureDisputeState } from './dispute-context';
import {
  addStarter, ago, appealLine, appealOpenUntil, appealProblem, APPEAL_STARTERS, day, decidedAt, disputeBySession, groupDisputes, isWaiting, KIND_LABEL,
  outcomeLine, starters, statementCount, statementProblem, STATEMENT_MAX, STATUS, disputeStatus, timeLeft, when, type StatusTone,
} from './dispute-model';

export const DISPUTES_KEY = 'student:attendance-disputes';
const SHOW = 4;

function problemText(caught: unknown, fallback: string): string {
  if (caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string' && caught.message) return caught.message;
  return fallback;
}

function statusOf(caught: unknown): number | null {
  return caught && typeof caught === 'object' && 'status' in caught && typeof caught.status === 'number' ? caught.status : null;
}

const TONE_BADGE: Record<StatusTone, 'warning' | 'success' | 'danger' | 'neutral'> = {
  waiting: 'warning',
  accepted: 'success',
  declined: 'danger',
  withdrawn: 'neutral',
};

const TONE_ICON: Record<StatusTone, ReactNode> = {
  waiting: <Clock3 size={16} strokeWidth={2.4} />,
  accepted: <CheckCircle2 size={16} strokeWidth={2.4} />,
  declined: <XCircle size={16} strokeWidth={2.4} />,
  withdrawn: <Undo2 size={16} strokeWidth={2.4} />,
};

type Open = { readonly kind: 'compose'; readonly sessionId: string } | { readonly kind: 'view'; readonly disputeId: string } | null;

/**
 * Disputes on My attendance. Gives every class row its dispute state (so "Dispute" sits right
 * under the class it is about), and owns the two sheets: the form, and one dispute with the
 * lecturer's decision. What a student writes is kept, per class, until it is sent.
 */
export function DisputeProvider({ data, now, onChanged, children }: Readonly<{
  data: StudentAttendanceDisputes | undefined;
  now: number;
  onChanged: () => void;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState<Open>(null);
  // Keep the last sheet's content on screen while it slides away.
  const [last, setLast] = useState<Open>(null);
  if (open && open !== last) setLast(open);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());

  const bySession = useMemo(() => disputeBySession(data?.disputes ?? []), [data]);
  const disputable = useMemo(() => new Map((data?.disputableSessions ?? []).map((session) => [session.attendanceSessionId, session])), [data]);

  const actions = useMemo<DisputeActions | null>(() => (data ? {
    now,
    forSession: (sessionId): LectureDisputeState | null => {
      const session = disputable.get(sessionId);
      if (session) return { kind: 'can', session };
      const dispute = bySession.get(sessionId);
      return dispute ? { kind: 'sent', dispute } : null;
    },
    compose: (sessionId) => setOpen({ kind: 'compose', sessionId }),
    view: (disputeId) => setOpen({ kind: 'view', disputeId }),
  } : null), [data, now, disputable, bySession]);

  const shown = open ?? last;
  const session = shown?.kind === 'compose' ? disputable.get(shown.sessionId) ?? null : null;
  const dispute = shown?.kind === 'view' ? data?.disputes.find((item) => item.id === shown.disputeId) ?? null : null;
  const atLimit = data ? groupDisputes(data).atLimit : false;
  const close = useCallback(() => setOpen(null), []);

  function sent(result: StudentAttendanceDispute) {
    if (data) {
      primeResource<StudentAttendanceDisputes>(DISPUTES_KEY, {
        ...data,
        disputes: [result, ...data.disputes],
        disputableSessions: data.disputableSessions.filter((item) => item.attendanceSessionId !== result.attendanceSessionId),
      });
    }
    setDrafts((current) => {
      const next = new Map(current);
      next.delete(result.attendanceSessionId);
      return next;
    });
    setOpen(null);
    window.dispatchEvent(new Event(DISPUTES_CHANGED_EVENT));
    onChanged();
  }

  /** A dispute that changed in place: withdrawn, or taken to (or withdrawn from) the department. */
  function changed(result: StudentAttendanceDispute) {
    if (data) primeResource<StudentAttendanceDisputes>(DISPUTES_KEY, { ...data, disputes: data.disputes.map((item) => (item.id === result.id ? result : item)) });
    window.dispatchEvent(new Event(DISPUTES_CHANGED_EVENT));
    onChanged();
  }

  return (
    <DisputeContext.Provider value={actions}>
      {children}
      <Sheet open={open?.kind === 'compose'} onClose={close} title="Dispute a mark">
        {session ? (
          <ComposeForm
            key={session.attendanceSessionId}
            session={session}
            now={now}
            atLimit={atLimit}
            openLimit={data?.openLimit ?? 10}
            draft={drafts.get(session.attendanceSessionId) ?? ''}
            onDraft={(text) => setDrafts((current) => new Map(current).set(session.attendanceSessionId, text))}
            onSent={sent}
            onStale={onChanged}
          />
        ) : shown?.kind === 'compose' ? (
          <EmptyState
            icon={<Clock3 size={26} strokeWidth={1.9} />}
            title="This class can’t be disputed now"
            message="Its 14 days may have passed, or a dispute was already sent for it."
            action={<Button variant="tinted" onClick={close}>Close</Button>}
          />
        ) : null}
      </Sheet>
      <Sheet open={open?.kind === 'view'} onClose={close} title="Your dispute">
        {dispute ? (
          <DisputeDetail
            key={dispute.id}
            dispute={dispute}
            now={now}
            again={disputable.get(dispute.attendanceSessionId) ?? null}
            onAgain={(sessionId) => setOpen({ kind: 'compose', sessionId })}
            onChanged={changed}
            onStale={onChanged}
          />
        ) : shown?.kind === 'view' ? (
          <EmptyState title="That dispute isn’t here any more" action={<Button variant="tinted" onClick={close}>Close</Button>} />
        ) : null}
      </Sheet>
    </DisputeContext.Provider>
  );
}

/** The class a dispute is about: course, class, when, and what the mark says. */
function ClassCard({ courseCode, courseTitle, sessionTitle, startsAt, kind, revocation }: Readonly<{
  courseCode: string;
  courseTitle: string;
  sessionTitle: string;
  startsAt: string;
  kind: StudentDisputableSession['kind'];
  revocation?: StudentDisputableSession['revocation'];
}>) {
  const removed = kind === 'revoked_check_in';
  return (
    <div className="ma-dp-class">
      <p className="ma-dp-class-code">{courseCode}</p>
      <p className="ma-dp-class-title">{sessionTitle}</p>
      <p className="ma-dp-class-line">{courseTitle} · {when(startsAt)}</p>
      <p className={`ma-dp-mark is-${removed ? 'removed' : 'missed'}`}>
        <span className={`ma-glyph is-${removed ? 'removed' : 'missed'}`} aria-hidden="true">
          {removed ? <Ban size={14} strokeWidth={2.6} /> : <Minus size={14} strokeWidth={3} />}
        </span>
        {KIND_LABEL[kind]}
      </p>
      {revocation ? (
        <blockquote className="ma-dp-quote is-reason">
          <span className="ma-dp-quote-by">Reason given · {day(revocation.revokedAt)}</span>
          {revocation.reason}
        </blockquote>
      ) : null}
    </div>
  );
}

function ComposeForm({ session, now, atLimit, openLimit, draft, onDraft, onSent, onStale }: Readonly<{
  session: StudentDisputableSession;
  now: number;
  atLimit: boolean;
  openLimit: number;
  draft: string;
  onDraft: (text: string) => void;
  onSent: (result: StudentAttendanceDispute) => void;
  onStale: () => void;
}>) {
  const feedback = useFeedback();
  const [text, setText] = useState(draft);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const left = timeLeft(session.disputeDeadline, now);
  const count = statementCount(text);

  function change(next: string) {
    setText(next);
    onDraft(next);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = statementProblem(text);
    if (problem) {
      setError(problem);
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { dispute } = await submitAttendanceDispute({ attendanceSessionId: session.attendanceSessionId, statement: text.trim() });
      haptic([16, 60, 24]);
      feedback.toast(`Sent to your lecturer. You get an email when they decide.`);
      onSent(dispute);
    } catch (caught) {
      setBusy(false);
      setError(problemText(caught, 'That did not send. Check your connection and try again.'));
      const status = statusOf(caught);
      if (status === 409 || status === 404 || status === 422) onStale();
    }
  }

  return (
    <div className="ma-dp-sheet">
      <ClassCard {...session} />
      <p className={`ma-dp-deadline${left.urgent ? ' is-urgent' : ''}`}>
        <Clock3 size={15} strokeWidth={2.3} aria-hidden="true" />
        <span>Send by {when(session.disputeDeadline)} · <strong>{left.label}</strong></span>
      </p>
      {atLimit ? (
        <p className="ma-dp-limit" role="note">
          You have {openLimit} disputes waiting for a decision. Withdraw one, or wait for your lecturer to decide one, before you send another.
        </p>
      ) : (
        <form className="ma-dp-form" onSubmit={(event) => void submit(event)} noValidate>
          <div className="ma-dp-label-row">
            <label className="ma-dp-label" htmlFor="ma-dp-statement">What happened?</label>
            <span className={`ma-dp-count${count.ready ? ' is-ready' : ''}`} aria-hidden="true">{count.label}</span>
          </div>
          <textarea
            ref={field}
            id="ma-dp-statement"
            className="ma-dp-textarea"
            value={text}
            onChange={(event) => change(event.target.value)}
            rows={5}
            maxLength={STATEMENT_MAX}
            data-autofocus
            aria-describedby={error ? 'ma-dp-error ma-dp-hint' : 'ma-dp-hint'}
            aria-invalid={error ? true : undefined}
            placeholder={session.kind === 'revoked_check_in' ? 'Where you sat, and why the check-in was yours' : 'Where you sat, and why you couldn’t check in'}
          />
          <p className="ma-dp-hint" id="ma-dp-hint">Your lecturer reads this and decides. Keep to the facts; leave out passwords and medical details.</p>
          {text.trim() === '' ? (
            <div className="ma-dp-starters" role="group" aria-label="Start with">
              {starters(session.kind).map((starter) => (
                <button key={starter.label} type="button" className="ma-dp-starter" onClick={() => { change(addStarter(text, starter.text)); field.current?.focus(); }}>
                  {starter.label}
                </button>
              ))}
            </div>
          ) : null}
          {error ? <p className="ma-dp-error" id="ma-dp-error" role="alert">{error}</p> : null}
          <Button type="submit" variant="filled" block busy={busy} disabled={busy}>{busy ? 'Sending…' : 'Send to your lecturer'}</Button>
          <p className="ma-dp-foot">You can withdraw it while it waits. Their decision is final.</p>
        </form>
      )}
    </div>
  );
}

function DisputeDetail({ dispute, now, again, onAgain, onChanged, onStale }: Readonly<{
  dispute: StudentAttendanceDispute;
  now: number;
  again: StudentDisputableSession | null;
  onAgain: (sessionId: string) => void;
  onChanged: (result: StudentAttendanceDispute) => void;
  onStale: () => void;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const status = STATUS[dispute.status];
  const appealUntil = appealOpenUntil(dispute, now);

  async function withdraw() {
    const sure = await feedback.confirm({
      title: 'Withdraw this dispute?',
      body: `Your lecturer won’t see it any more. You can send it again until ${again ? when(again.disputeDeadline) : 'the 14 days after the class are up'}.`,
      confirmLabel: 'Withdraw',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy(true);
    try {
      const { dispute: result } = await withdrawAttendanceDispute(dispute.id);
      haptic(14);
      feedback.toast('Dispute withdrawn');
      onChanged(result);
    } catch (caught) {
      feedback.toast(problemText(caught, 'That did not withdraw. Check your connection and try again.'), 'error');
      const code = statusOf(caught);
      if (code === 409 || code === 404) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ma-dp-sheet">
      <ClassCard courseCode={dispute.courseCode} courseTitle={dispute.courseTitle} sessionTitle={dispute.sessionTitle} startsAt={dispute.sessionStartsAt} kind={dispute.kind} />
      {/* Newest first: the department's answer, then the lecturer's, then what the student wrote. */}
      {dispute.appeal ? <AppealCard dispute={dispute} appeal={dispute.appeal} now={now} onChanged={onChanged} onStale={onStale} /> : null}
      <div className={`ma-dp-outcome is-${status.tone}`}>
        <p className="ma-dp-outcome-head">
          <Badge tone={TONE_BADGE[status.tone]} dot={status.tone === 'waiting'}>{status.label}</Badge>
        </p>
        <p className="ma-dp-outcome-line">{outcomeLine(dispute, now)}</p>
        {dispute.resolutionNote ? (
          <blockquote className="ma-dp-quote is-decision">
            <span className="ma-dp-quote-by">{dispute.resolvedByName ?? 'Your lecturer'} wrote</span>
            {dispute.resolutionNote}
          </blockquote>
        ) : null}
      </div>
      <blockquote className="ma-dp-quote is-yours">
        <span className="ma-dp-quote-by">You wrote · {day(dispute.createdAt)}</span>
        {dispute.statement}
      </blockquote>
      {!dispute.appeal && appealUntil ? (
        <AppealForm dispute={dispute} until={appealUntil} now={now} onSent={onChanged} onStale={onStale} />
      ) : null}
      {dispute.status === 'open' ? (
        <Button variant="gray" block busy={busy} disabled={busy} icon={<Undo2 size={18} aria-hidden="true" />} onClick={() => void withdraw()}>Withdraw dispute</Button>
      ) : dispute.status === 'withdrawn' && again ? (
        <div className="ma-dp-again">
          <Button variant="filled" block onClick={() => onAgain(again.attendanceSessionId)}>Dispute again</Button>
          <p className="ma-dp-foot">You can until {when(again.disputeDeadline)} · {timeLeft(again.disputeDeadline, now).label}.</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Take it higher": after a lecturer says no, one request for the department to look again,
 * within a week. Folded until asked for, so a rejection reads as a decision first.
 */
function AppealForm({ dispute, until, now, onSent, onStale }: Readonly<{
  dispute: StudentAttendanceDispute;
  until: string;
  now: number;
  onSent: (result: StudentAttendanceDispute) => void;
  onStale: () => void;
}>) {
  const feedback = useFeedback();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const left = timeLeft(until, now);
  const count = statementCount(text);

  function change(next: string) {
    setText(next);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = appealProblem(text);
    if (problem) {
      setError(problem);
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { dispute: result } = await appealAttendanceDispute(dispute.id, { statement: text.trim() });
      haptic([16, 60, 24]);
      feedback.toast('Sent to your department. You get an email when they decide.');
      onSent(result);
    } catch (caught) {
      setBusy(false);
      setError(problemText(caught, 'That did not send. Check your connection and try again.'));
      const code = statusOf(caught);
      if (code === 409 || code === 404) onStale();
    }
  }

  if (!writing) {
    return (
      <div className="ma-dp-appeal is-offer">
        <p className="ma-dp-appeal-title">Think this is wrong?</p>
        <p className="ma-dp-appeal-line">
          Ask your department (the HOD’s office) to look again. They see what you and your lecturer wrote, and their decision is final.
        </p>
        <Button variant="tinted" block onClick={() => { setWriting(true); requestAnimationFrame(() => field.current?.focus()); }}>Take it to your department</Button>
        <p className={`ma-dp-foot${left.urgent ? ' is-urgent' : ''}`}>Once, until {when(until)} · {left.label}.</p>
      </div>
    );
  }

  return (
    <form className="ma-dp-appeal ma-dp-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="ma-dp-label-row">
        <label className="ma-dp-label" htmlFor="ma-dp-appeal-statement">Why should the decision change?</label>
        <span className={`ma-dp-count${count.ready ? ' is-ready' : ''}`} aria-hidden="true">{count.label}</span>
      </div>
      <textarea
        ref={field}
        id="ma-dp-appeal-statement"
        className="ma-dp-textarea"
        value={text}
        onChange={(event) => change(event.target.value)}
        rows={4}
        maxLength={STATEMENT_MAX}
        aria-describedby={error ? 'ma-dp-appeal-error ma-dp-appeal-hint' : 'ma-dp-appeal-hint'}
        aria-invalid={error ? true : undefined}
        placeholder="What your lecturer may have missed"
      />
      <p className="ma-dp-hint" id="ma-dp-appeal-hint">Add something new: a classmate who saw you, or what the note gets wrong. Leave out passwords and medical details.</p>
      {text.trim() === '' ? (
        <div className="ma-dp-starters" role="group" aria-label="Start with">
          {APPEAL_STARTERS.map((starter) => (
            <button key={starter.label} type="button" className="ma-dp-starter" onClick={() => { change(addStarter(text, starter.text)); field.current?.focus(); }}>
              {starter.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="ma-dp-error" id="ma-dp-appeal-error" role="alert">{error}</p> : null}
      <Button type="submit" variant="filled" block busy={busy} disabled={busy}>{busy ? 'Sending…' : 'Send to your department'}</Button>
      <Button type="button" variant="plain" block disabled={busy} onClick={() => { setWriting(false); setError(''); }}>Not now</Button>
    </form>
  );
}

/** The appeal once sent: where it stands, what the student wrote, and the department's answer. */
function AppealCard({ dispute, appeal, now, onChanged, onStale }: Readonly<{
  dispute: StudentAttendanceDispute;
  appeal: NonNullable<StudentAttendanceDispute['appeal']>;
  now: number;
  onChanged: (result: StudentAttendanceDispute) => void;
  onStale: () => void;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const tone: StatusTone = appeal.status === 'open' ? 'waiting' : appeal.status === 'upheld' ? 'accepted' : appeal.status === 'rejected' ? 'declined' : 'withdrawn';
  const label = appeal.status === 'open' ? 'Waiting for your department' : appeal.status === 'upheld' ? 'Appeal accepted' : appeal.status === 'rejected' ? 'Appeal not accepted' : 'Appeal withdrawn';

  async function withdraw() {
    const sure = await feedback.confirm({
      title: 'Withdraw your appeal?',
      body: 'Your department won’t see it any more, and you can’t send another one for this class. The lecturer’s decision will stand.',
      confirmLabel: 'Withdraw',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy(true);
    try {
      const { dispute: result } = await withdrawAttendanceAppeal(dispute.id);
      haptic(14);
      feedback.toast('Appeal withdrawn');
      onChanged(result);
    } catch (caught) {
      feedback.toast(problemText(caught, 'That did not withdraw. Check your connection and try again.'), 'error');
      const code = statusOf(caught);
      if (code === 409 || code === 404) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`ma-dp-appeal is-${tone}`} aria-label="Your appeal to the department">
      <p className="ma-dp-outcome-head">
        <Badge tone={TONE_BADGE[tone]} dot={tone === 'waiting'}>{label}</Badge>
      </p>
      <p className="ma-dp-outcome-line">{appealLine(appeal, now)}</p>
      {appeal.decisionNote ? (
        <blockquote className="ma-dp-quote is-decision">
          <span className="ma-dp-quote-by">{appeal.decidedByName ?? appeal.departmentName} wrote</span>
          {appeal.decisionNote}
        </blockquote>
      ) : null}
      <blockquote className="ma-dp-quote is-yours">
        <span className="ma-dp-quote-by">You wrote to {appeal.departmentName} · {day(appeal.createdAt)}</span>
        {appeal.statement}
      </blockquote>
      {appeal.status === 'open' ? (
        <Button variant="gray" block busy={busy} disabled={busy} icon={<Undo2 size={18} aria-hidden="true" />} onClick={() => void withdraw()}>Withdraw appeal</Button>
      ) : null}
    </section>
  );
}

/**
 * The Disputes section: classes that can still be disputed (the closest deadline first), those
 * waiting for the lecturer, and the decided ones with the lecturer's note. Hidden when there is
 * nothing to show; a class row's own "Dispute" is the way in.
 */
export function DisputesSection({ data, error, onRetry }: Readonly<{
  data: StudentAttendanceDisputes | undefined;
  error: string | undefined;
  onRetry: () => void;
}>) {
  const [all, setAll] = useState({ can: false, decided: false });
  const actions = useContext(DisputeContext);
  if (!data || !actions) {
    if (!error) return null;
    return (
      <section className="ma-section ma-dp" id="attendance-disputes" aria-labelledby="ma-dp-title">
        <div className="ma-section-head"><h2 className="ma-section-title" id="ma-dp-title">Disputes</h2></div>
        <div className="ds-card"><EmptyState error title="Your disputes did not load" message={error} action={<Button variant="tinted" onClick={onRetry}>Try again</Button>} /></div>
      </section>
    );
  }
  const { now, compose, view } = actions;
  const groups = groupDisputes(data);
  const live = groups.canDispute.filter((session) => !timeLeft(session.disputeDeadline, now).over);
  if (!live.length && !groups.waiting.length && !groups.decided.length) return null;
  const can = all.can ? live : live.slice(0, SHOW);
  const decided = all.decided ? groups.decided : groups.decided.slice(0, SHOW - 1);
  return (
    <section className="ma-section ma-dp" id="attendance-disputes" aria-labelledby="ma-dp-title">
      <div className="ma-section-head">
        <h2 className="ma-section-title" id="ma-dp-title">Disputes</h2>
        <span className="ma-section-meta">{groups.openCount ? `${groups.openCount} waiting` : `Within ${data.windowDays} days of a class`}</span>
      </div>
      {groups.atLimit ? (
        <p className="ma-dp-limit" role="note">You have {data.openLimit} disputes waiting, the most at once. Withdraw one, or wait for a decision, before you send another.</p>
      ) : null}
      <div className="ma-dp-groups">
        {live.length ? (
          <DisputeGroup title="You can dispute" id="ma-dp-can" more={live.length - can.length} onMore={() => setAll((value) => ({ ...value, can: true }))}>
            {can.map((session) => {
              const left = timeLeft(session.disputeDeadline, now);
              const removed = session.kind === 'revoked_check_in';
              return (
                <DisputeRow
                  key={session.attendanceSessionId}
                  icon={removed ? <Ban size={15} strokeWidth={2.6} /> : <Minus size={16} strokeWidth={3} />}
                  tone={removed ? 'removed' : 'missed'}
                  code={session.courseCode}
                  title={session.sessionTitle}
                  line={`${day(session.startsAt)} · ${KIND_LABEL[session.kind]}`}
                  badge={<span className={`ma-dp-left${left.urgent ? ' is-urgent' : ''}`}>{left.label}</span>}
                  onOpen={() => compose(session.attendanceSessionId)}
                />
              );
            })}
          </DisputeGroup>
        ) : null}
        {groups.waiting.length ? (
          <DisputeGroup title={groups.waiting.some((dispute) => dispute.appeal) ? 'Waiting for a decision' : 'Waiting for your lecturer'} id="ma-dp-waiting">
            {groups.waiting.map((dispute) => (
              <DisputeRow
                key={dispute.id}
                icon={TONE_ICON.waiting}
                tone="waiting"
                code={dispute.courseCode}
                title={dispute.sessionTitle}
                line={dispute.appeal
                  ? `${day(dispute.sessionStartsAt)} · with ${dispute.appeal.departmentName} since ${ago(dispute.appeal.createdAt, now)}`
                  : `${day(dispute.sessionStartsAt)} · sent ${ago(dispute.createdAt, now)}`}
                badge={<Badge tone="warning" dot>{dispute.appeal ? 'Department' : 'Waiting'}</Badge>}
                onOpen={() => view(dispute.id)}
              />
            ))}
          </DisputeGroup>
        ) : null}
        {groups.decided.length ? (
          <DisputeGroup title="Decided" id="ma-dp-decided" more={groups.decided.length - decided.length} onMore={() => setAll((value) => ({ ...value, decided: true }))}>
            {decided.map((dispute) => {
              const status = disputeStatus(dispute);
              const until = appealOpenUntil(dispute, now);
              return (
                <DisputeRow
                  key={dispute.id}
                  icon={TONE_ICON[status.tone]}
                  tone={status.tone}
                  code={dispute.courseCode}
                  title={dispute.sessionTitle}
                  line={`${day(dispute.sessionStartsAt)} · ${dispute.status === 'withdrawn'
                    ? 'you withdrew it'
                    : until
                      ? `you can appeal · ${timeLeft(until, now).label}`
                      : `decided ${ago(decidedAt(dispute), now)}`}`}
                  note={dispute.appeal?.decisionNote ?? dispute.resolutionNote}
                  badge={<Badge tone={TONE_BADGE[status.tone]}>{status.label}</Badge>}
                  onOpen={() => view(dispute.id)}
                />
              );
            })}
          </DisputeGroup>
        ) : null}
      </div>
    </section>
  );
}

function DisputeGroup({ title, id, more = 0, onMore, children }: Readonly<{ title: string; id: string; more?: number; onMore?: () => void; children: ReactNode }>) {
  return (
    <div className="ma-dp-group">
      <h3 className="ma-dp-h" id={id}>{title}</h3>
      <ul className="ma-dp-list" aria-labelledby={id}>{children}</ul>
      {more > 0 && onMore ? (
        <button className="ma-dp-more" type="button" onClick={onMore}>Show {more} more</button>
      ) : null}
    </div>
  );
}

function DisputeRow({ icon, tone, code, title, line, note, badge, onOpen }: Readonly<{
  icon: ReactNode;
  tone: string;
  code: string;
  title: string;
  line: string;
  note?: string | null;
  badge: ReactNode;
  onOpen: () => void;
}>) {
  return (
    <li>
      <button type="button" className="ma-dp-row" onClick={onOpen}>
        <span className={`ma-dp-icon is-${tone}`} aria-hidden="true">{icon}</span>
        <span className="ma-dp-text">
          <span className="ma-dp-title"><strong>{code}</strong> {title}</span>
          <span className="ma-dp-line">{line}</span>
          {note ? <span className="ma-dp-note">“{note}”</span> : null}
        </span>
        <span className="ma-dp-badge">{badge}</span>
        <ChevronRight className="ma-dp-chevron" size={17} strokeWidth={2.3} aria-hidden="true" />
      </button>
    </li>
  );
}

/** Polls while a dispute (or an appeal) waits, so a decision shows without a reload. */
export function waitingOn(data: StudentAttendanceDisputes): boolean {
  return data.disputes.some(isWaiting);
}

/** Scrolls to the disputes once they are on screen when the address asks for them (#attendance-disputes). */
export function useDisputesHash(ready: boolean) {
  useEffect(() => {
    if (!ready || typeof window === 'undefined' || window.location.hash !== '#attendance-disputes') return;
    const target = document.getElementById('attendance-disputes');
    target?.scrollIntoView({ block: 'start' });
  }, [ready]);
}
