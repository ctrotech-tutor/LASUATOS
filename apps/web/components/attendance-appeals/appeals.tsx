'use client';

import { ATTENDANCE_APPEAL_WINDOW_DAYS } from '@lasuatos/contracts';
import { ArrowRight, CheckCircle2, Scale, UserCheck, UserX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { APPEALS_CHANGED_EVENT, decideAttendanceAppeal, loadAttendanceAppeals } from '../../lib/attendance-api';
import { primeResource, revalidate, staleResources, useResource } from '../../lib/resource';
import { arrivalsSentence, useArrivals } from '../../lib/use-arrivals';
import { haptic } from '../../lib/use-live';
import { Badge, Button, EmptyState, List, ListRow, PageHeader, SegmentedControl, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { Mark, markLabel } from '../course-reports/grid';
import { CELL } from '../course-reports/model';
import { FigureView, RecordFacts, StandingNote } from '../course-disputes/dispute-sheet';
import { useThreshold } from '../registers/threshold';
import { GuideButton } from '../shell/guide-button';
import { useToday } from '../take-attendance/hooks';
import { LiveAnnouncer, LiveLag } from '../ui/live-status';
import {
  APPEAL_OUTCOME,
  appealNoteSuggestions,
  appealStanding,
  blocker,
  canUphold,
  currentMark,
  daysSince,
  decidedLine,
  decideHint,
  firstName,
  KIND_LABEL,
  nextOpenAppeal,
  NOTE_MAX,
  noteProblem,
  problemText,
  waitedLabel,
  waitingLine,
  when,
  type Appeal,
  type AppealList,
  type AppealTab,
  type Decision,
} from './model';
import '../registers/registers.css';
import '../course-reports/course-reports.css';
import '../course-disputes/course-disputes.css';
import './appeals.css';

const PATH = '/admin/appeals';
const listKey = (tab: AppealTab) => `attendance-appeals:${tab}`;

const loaders: Record<AppealTab, (signal: AbortSignal) => Promise<AppealList>> = {
  open: (signal) => loadAttendanceAppeals('open', signal).catch(rethrow),
  decided: (signal) => loadAttendanceAppeals('decided', signal).catch(rethrow),
};

function rethrow(caught: unknown): never {
  if (caught instanceof DOMException) throw caught;
  throw new Error(problemText(caught, 'Appeals did not load. Check your connection and try again.'));
}

const appealId = (appeal: Appeal) => appeal.id;

/**
 * Attendance appeals: disputes a course lecturer turned down that the student took to the
 * department. Oldest first; each opens in a sheet with the class and the record, both sides of
 * the story in order, and where the student stands, then the final decision with a note.
 */
export function AttendanceAppeals() {
  const today = useToday();
  const [tab, setTab] = useState<AppealTab>('open');
  const [selected, setSelected] = useState<string | null>(null);
  // Appeals are rare and not urgent to the minute: every 30 s in view, every 2 min once quiet.
  const open = useResource(listKey('open'), loaders.open, { maxAge: 0, poll: 30_000, pollQuiet: 120_000 });
  const decided = useResource(tab === 'decided' ? listKey('decided') : null, loaders.decided, { maxAge: 20_000 });
  const list = tab === 'open' ? open : decided;
  const shown = list.data?.appeals ?? null;
  const waiting = open.data ? open.data.openCount : null;
  const arrivals = useArrivals(open.data?.appeals, appealId);
  const arrivalNews = arrivalsSentence(arrivals.arrived.map((appeal) => appeal.dispute.student.displayName), arrivals.arrived.length === 1 ? 'sent an appeal' : 'sent appeals');

  return (
    <div className="rg rp dp ap-appeals">
      <PageHeader title="Appeals" subtitle={waitingLine(open.data)} actions={<GuideButton page={PATH} label="Appeals" />} />

      <div className="dp-bar">
        <SegmentedControl
          label="Show"
          block
          value={tab}
          onChange={setTab}
          segments={[
            { value: 'open', label: <>Waiting{waiting ? <span className="dp-count">{waiting}</span> : null}</> },
            { value: 'decided', label: 'Decided' },
          ]}
        />
      </div>

      {shown === null ? (
        list.error ? (
          <div className="ds-card">
            <EmptyState error title="Appeals did not load" message={list.error} action={<Button variant="tinted" onClick={list.reload}>Try again</Button>} />
          </div>
        ) : <ListBones />
      ) : shown.length === 0 ? (
        <div className="ds-card">
          {tab === 'open' ? (
            <EmptyState
              icon={<CheckCircle2 size={26} strokeWidth={1.9} aria-hidden="true" />}
              title="Nothing waiting"
              message={`When a lecturer turns down an attendance dispute, the student can ask the department to look again within ${ATTENDANCE_APPEAL_WINDOW_DAYS} days. Those appeals appear here, and the first one sends you an email.`}
            />
          ) : (
            <EmptyState
              icon={<Scale size={26} strokeWidth={1.9} aria-hidden="true" />}
              title="No decisions yet"
              message="Appeals you or another administrator decided, or the student withdrew, appear here."
            />
          )}
        </div>
      ) : (
        <>
          <LiveLag error={list.error} checkedAt={list.checkedAt} onRetry={list.reload} />
          <List leading className="dp-list" label={tab === 'open' ? 'Waiting, oldest first' : 'Decided, newest first'}>
            {shown.map((appeal) => (
              <AppealRow key={appeal.id} appeal={appeal} today={today} fresh={tab === 'open' && arrivals.fresh.has(appeal.id)} onOpen={() => setSelected(appeal.id)} />
            ))}
          </List>
          {tab === 'open' && shown.length > 1 ? <p className="rg-quiet">Oldest first, so no one waits longest.</p> : null}
        </>
      )}

      <LiveAnnouncer message={arrivalNews} round={arrivals.round} />

      <AppealSheet
        selectedId={selected}
        lists={[open.data, decided.data].filter((data): data is AppealList => Boolean(data))}
        openList={open.data}
        today={today}
        onSelect={setSelected}
        onClose={() => setSelected(null)}
        onStale={() => { open.reload(); decided.reload(); }}
      />
    </div>
  );
}

function AppealRow({ appeal, today, fresh, onOpen }: Readonly<{ appeal: Appeal; today: string; fresh: boolean; onOpen: () => void }>) {
  const { dispute } = appeal;
  const outcome = appeal.status === 'open' ? null : APPEAL_OUTCOME[appeal.status];
  const quote = appeal.status === 'withdrawn' ? 'Withdrawn by the student' : `“${appeal.status === 'open' ? appeal.statement : appeal.decisionNote ?? ''}”`;
  return (
    <ListRow
      onClick={onOpen}
      chevron
      highlight={fresh}
      leading={(
        <span className={`rp-mark-badge dp-kind is-${dispute.kind === 'revoked_check_in' ? 'removed' : 'absent'}`}>
          <Mark cell={dispute.kind === 'revoked_check_in' ? 'revoked' : 'absent'} />
        </span>
      )}
      title={(
        <span className="dp-row-title">
          <span className="dp-name">{dispute.student.displayName}</span>
          {appeal.status === 'open' && appeal.conflict ? <Badge>Your decision</Badge> : null}
        </span>
      )}
      subtitle={(
        <>
          <span className="dp-where">
            <span className="dp-fact">{dispute.courseCode}<span className="rp-sep"> ·</span></span>{' '}
            <span className="dp-fact dp-class">{dispute.sessionTitle}<span className="rp-sep"> ·</span></span>{' '}
            <span className="dp-fact">{appeal.departmentName}</span>
          </span>
          <span className="dp-quote">{quote}</span>
        </>
      )}
      trailing={(
        <span className="dp-trailing">
          {outcome ? <Badge tone={outcome.tone}>{outcome.label}</Badge> : (
            <span className={`dp-waited${today && daysSince(appeal.createdAt, today) >= 3 ? ' is-long' : ''}`}>
              {today ? waitedLabel(appeal.createdAt, today) : ''}
            </span>
          )}
          <span className="sr-only">{appeal.status === 'open' ? `, ${KIND_LABEL[dispute.kind].toLowerCase()}` : ''}</span>
        </span>
      )}
    />
  );
}

/** After a decision: the open list drops it at once; both lists, the reports and the menu badge read again. */
function afterDecision(open: AppealList | undefined, result: Appeal) {
  if (open) {
    primeResource<AppealList>(listKey('open'), {
      appeals: open.appeals.filter((appeal) => appeal.id !== result.id),
      openCount: Math.max(0, open.openCount - 1),
    });
  }
  revalidate(listKey('open'), loaders.open, 0);
  revalidate(listKey('decided'), loaders.decided, 0);
  staleResources('course-reports:');
  window.dispatchEvent(new Event(APPEALS_CHANGED_EVENT));
}

function AppealSheet({ selectedId, lists, openList, today, onSelect, onClose, onStale }: Readonly<{
  selectedId: string | null;
  lists: readonly AppealList[];
  openList: AppealList | undefined;
  today: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onStale: () => void;
}>) {
  // Kept while the sheet animates closed, and after a decision takes it out of the open list.
  const [shown, setShown] = useState<Appeal | null>(null);
  const live = selectedId ? lists.flatMap((list) => list.appeals).find((appeal) => appeal.id === selectedId) ?? null : null;
  if (live && live !== shown) setShown(live);
  const appeal = live ?? shown;
  // A waiting appeal that drops out of the refreshed open list was decided or withdrawn meanwhile.
  const settledElsewhere = Boolean(selectedId && !live && shown?.id === selectedId && shown.status === 'open' && openList);
  const body = useRef<HTMLDivElement>(null);

  function decided(result: Appeal) {
    afterDecision(openList, result);
    const next = openList ? nextOpenAppeal(openList.appeals, result.id) : null;
    if (next) {
      onSelect(next.id);
      body.current?.closest('.ds-sheet-body')?.scrollTo({ top: 0 });
    } else {
      setShown(result);
      onClose();
    }
  }

  return (
    <Sheet open={Boolean(selectedId && appeal)} onClose={onClose} title={appeal?.dispute.student.displayName ?? 'Appeal'}>
      <div ref={body}>
        {appeal ? <AppealDetail key={appeal.id} appeal={appeal} today={today} settledElsewhere={settledElsewhere} onDecided={decided} onStale={onStale} /> : null}
      </div>
    </Sheet>
  );
}

function AppealDetail({ appeal, today, settledElsewhere, onDecided, onStale }: Readonly<{
  appeal: Appeal;
  today: string;
  settledElsewhere: boolean;
  onDecided: (result: Appeal) => void;
  onStale: () => void;
}>) {
  const threshold = useThreshold();
  const { dispute } = appeal;
  const cell = currentMark(dispute);
  const standing = appealStanding(appeal);
  const first = firstName(dispute.student.displayName);
  const block = settledElsewhere ? 'decided' : blocker(appeal);
  const outcome = appeal.status === 'open' ? null : APPEAL_OUTCOME[appeal.status];
  const lecturer = dispute.resolvedByName ?? 'The lecturer';

  return (
    <div className="rg-person dp-detail">
      <p className="rg-person-id">
        <span className="ds-mono">{dispute.student.studentNumber}</span>
        {dispute.student.studentNumberVerified ? null : <span> · matric not verified</span>}
        <span> · {dispute.courseCode} · {appeal.departmentName}</span>
      </p>
      {settledElsewhere ? (
        <p className="rp-note dp-settled" role="status">
          No longer waiting: another administrator decided it, or {first} withdrew it, a moment ago. It is under Decided.
        </p>
      ) : null}
      {block === 'conflict' ? (
        <p className="rp-note" role="note">
          You turned this dispute down as the course’s lecturer, so another administrator decides the appeal. Nobody reviews their own decision.
        </p>
      ) : null}

      {outcome ? (
        <section className="dp-block dp-outcome" aria-label="Decision on the appeal">
          <p className="dp-outcome-head">
            <Badge tone={outcome.tone}>{outcome.label}</Badge>
            <span>{appeal.decidedAt ? when(appeal.decidedAt, today) : ''}</span>
          </p>
          <p className="ap-line">{decidedLine(appeal)}</p>
          {appeal.decisionNote ? <blockquote className="dp-statement is-note">{appeal.decisionNote}</blockquote> : null}
        </section>
      ) : null}

      <section className="dp-block" aria-label="The class">
        <div className="rp-mark-head">
          <span className={`rp-mark-badge is-${CELL[cell].tone}`}><Mark cell={cell} /></span>
          <span>
            <strong>{markLabel(cell, false)}</strong>
            <span>{dispute.courseCode} · {dispute.sessionTitle} · {when(dispute.sessionStartsAt, today)}{dispute.venueName ? ` · ${dispute.venueName}` : ''}</span>
          </span>
        </div>
        <RecordFacts dispute={dispute} today={today} />
      </section>

      <section className="dp-block" aria-labelledby={`ap-story-${appeal.id}`}>
        <h3 className="dp-block-title" id={`ap-story-${appeal.id}`}>What happened</h3>
        <ol className="ap-story">
          <li>
            <p className="ap-story-head"><strong>{first} disputed the mark</strong><span>{when(dispute.createdAt, today)}</span></p>
            <blockquote className="dp-statement">{dispute.statement}</blockquote>
          </li>
          <li>
            <p className="ap-story-head"><strong>{lecturer} turned it down</strong><span>{dispute.resolvedAt ? when(dispute.resolvedAt, today) : ''}</span></p>
            {dispute.resolutionNote ? <blockquote className="dp-statement is-note">{dispute.resolutionNote}</blockquote> : null}
          </li>
          <li>
            <p className="ap-story-head"><strong>{first} asked the department to look again</strong><span>{when(appeal.createdAt, today)}</span></p>
            <blockquote className="dp-statement is-appeal">{appeal.statement}</blockquote>
            {appeal.status === 'open' && !settledElsewhere && today ? <p className="dp-meta">Waiting {waitedLabel(appeal.createdAt, today).toLowerCase()}</p> : null}
          </li>
        </ol>
      </section>

      {standing ? (
        <section className="dp-block" aria-labelledby={`ap-standing-${appeal.id}`}>
          <h3 className="dp-block-title" id={`ap-standing-${appeal.id}`}>In {dispute.courseCode} so far</h3>
          <div className="dp-figures">
            <FigureView figure={standing.now} threshold={threshold} label="Now" />
            {standing.ifUpheld ? (
              <>
                <ArrowRight className="dp-arrow" size={18} strokeWidth={2.2} aria-hidden="true" />
                <FigureView figure={standing.ifUpheld} threshold={threshold} label="If marked present" />
              </>
            ) : null}
          </div>
          <StandingNote now={standing.now} ifUpheld={standing.ifUpheld} threshold={threshold} />
        </section>
      ) : null}

      {block === null ? <Decide appeal={appeal} onDecided={onDecided} onStale={onStale} /> : null}
    </div>
  );
}

function Decide({ appeal, onDecided, onStale }: Readonly<{ appeal: Appeal; onDecided: (result: Appeal) => void; onStale: () => void }>) {
  const [decision, setDecision] = useState<Decision | null>(null);
  if (decision) return <DecisionForm appeal={appeal} decision={decision} onCancel={() => setDecision(null)} onDecided={onDecided} onStale={onStale} />;
  return (
    <div className="dp-decide">
      <div className="rp-actions">
        <Button variant="gray" block icon={<UserX size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setDecision('reject')}>Keep decision</Button>
        <Button block disabled={!canUphold(appeal.dispute)} icon={<UserCheck size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setDecision('uphold')}>Mark present</Button>
      </div>
      <p className="dp-meta">{decideHint(appeal)}</p>
    </div>
  );
}

function DecisionForm({ appeal, decision, onCancel, onDecided, onStale }: Readonly<{
  appeal: Appeal;
  decision: Decision;
  onCancel: () => void;
  onDecided: (result: Appeal) => void;
  onStale: () => void;
}>) {
  const feedback = useFeedback();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const { dispute } = appeal;
  const first = firstName(dispute.student.displayName);
  const hintId = `ap-note-hint-${appeal.id}`;
  const suggestions = useMemo(() => appealNoteSuggestions(decision), [decision]);
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
      const result = await decideAttendanceAppeal(appeal.id, { decision, note: note.trim() });
      haptic(14);
      feedback.toast(decision === 'reject'
        ? `Decision kept. ${first} and the lecturer can read your note.`
        : result.correction === 'applied'
          ? `${dispute.student.displayName} is marked present for ${dispute.sessionTitle}.`
          : `Accepted. ${first} was already marked present.`);
      onDecided(result.appeal);
    } catch (caught) {
      setBusy(false);
      const status = caught && typeof caught === 'object' && 'status' in caught ? caught.status : null;
      if (status === 404 || (status === 409 && /already been decided/i.test(problemText(caught, '')))) {
        setError('This appeal was decided by another administrator or withdrawn by the student. The list has been refreshed.');
        onStale();
      } else if (status === 409) {
        // Something changed underneath (they left the course, or the dispute's lecturer is you).
        setError(problemText(caught, 'This appeal changed. The list has been refreshed.'));
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
          <span>{decision === 'uphold' ? 'Why mark them present?' : 'Why keep the decision?'}</span>
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
          {first} and the lecturer read this.{decision === 'uphold' ? ' It is also kept with the record as the reason for the change.' : ''} This is final.
        </small>
      </label>
      <div className="ui-dialog-chips">
        {suggestions.map((suggestion) => (
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
          {decision === 'reject' ? 'Keep decision' : dispute.record?.status === 'present' ? 'Accept' : 'Mark present'}
        </Button>
      </div>
    </form>
  );
}

function ListBones() {
  return (
    <ul className="ds-list has-leading dp-list" role="status" aria-label="Loading appeals">
      {[0, 1, 2].map((key) => (
        <li key={key}>
          <div className="ds-row">
            <span className="ds-row-leading"><span className="ds-skeleton dp-bone-icon" /></span>
            <span className="ds-row-body">
              <span className="ds-skeleton" style={{ width: '40%', height: 16 }} />
              <span className="ds-skeleton" style={{ width: '62%', height: 12 }} />
              <span className="ds-skeleton" style={{ width: '80%', height: 12 }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
