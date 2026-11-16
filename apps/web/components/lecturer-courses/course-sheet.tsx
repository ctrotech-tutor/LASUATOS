'use client';

import {
  BarChart3,
  CalendarClock,
  Check,
  Copy,
  KeyRound,
  MessageSquareWarning,
  MoreHorizontal,
  Pencil,
  Presentation,
  RefreshCw,
  Share2,
  ShieldOff,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { issueCourseJoinCode, revokeCourseJoinCode, updateCourseOffering } from '../../lib/course-api';
import { haptic } from '../../lib/use-live';
import { Badge, Button, List, ListRow, Menu, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { NumberField } from '../ui/number-field';
import { Select } from '../ui/select';
import {
  codeState,
  formatJoinCode,
  inviteText,
  joinLink,
  LEVELS,
  levelLabel,
  longDate,
  phaseOf,
  plural,
  problemText,
  shortDate,
  tidyTitle,
  unitsLabel,
  type Offering,
} from './model';
import { PresentCode } from './present';

/** A code as it came back from the server: shown once, kept by the page until it is left. */
export type IssuedCode = { readonly code: string; readonly issuedAt: string; readonly expiresAt: string };

type SheetProps = Readonly<{
  offering: Offering | null;
  now: number;
  issued: IssuedCode | null;
  onClose: () => void;
  onIssued: (offering: Offering, code: IssuedCode) => void;
  onRevoked: (offering: Offering) => void;
  onSaved: (offering: Offering) => void;
}>;

/** One course: who is on it, its join code, where to go next, and its details. */
export function CourseSheet({ offering, ...rest }: SheetProps) {
  // Keep the last course while the sheet animates closed.
  const [last, setLast] = useState(offering);
  if (offering && offering !== last) setLast(offering);
  const shown = offering ?? last;
  return (
    <Sheet open={offering !== null} onClose={rest.onClose} title={shown?.courseCode ?? ''}>
      {shown ? <CourseDetail key={shown.courseOfferingId} offering={shown} {...rest} /> : null}
    </Sheet>
  );
}

function CourseDetail({ offering, now, issued, onIssued, onRevoked, onSaved }: Omit<SheetProps, 'offering' | 'onClose'> & { offering: Offering }) {
  const [editing, setEditing] = useState(false);
  const ended = phaseOf(offering, now) === 'ended';
  const facts = [levelLabel(offering.level), unitsLabel(offering.creditUnits), offering.semesterName].filter(Boolean).join(' · ');

  if (editing) {
    return <EditCourse offering={offering} onCancel={() => setEditing(false)} onSaved={(updated) => { setEditing(false); onSaved(updated); }} />;
  }

  return (
    <div className="lct-detail">
      <div className="lct-detail-head">
        <h3 className="lct-detail-title">{offering.courseTitle}</h3>
        <p className="lct-detail-facts">{facts}</p>
      </div>

      <div className="lct-figures">
        <div><strong>{offering.students.toLocaleString('en-NG')}</strong><span>{offering.students === 1 ? 'student' : 'students'}</span></div>
        <div><strong>{offering.sessions.toLocaleString('en-NG')}</strong><span>{offering.sessions === 1 ? 'class held' : 'classes held'}</span></div>
        <div className={offering.openDisputes ? 'is-warning' : undefined}>
          <strong>{offering.openDisputes.toLocaleString('en-NG')}</strong><span>{offering.openDisputes === 1 ? 'dispute open' : 'disputes open'}</span>
        </div>
      </div>

      <JoinCode offering={offering} now={now} issued={issued} onIssued={onIssued} onRevoked={onRevoked} />

      <List leading label={`More for ${offering.courseCode}`}>
        <ListRow
          href={`/lecturer/attendance?courseOfferingId=${offering.courseOfferingId}`}
          leading={<CalendarClock size={19} strokeWidth={2.1} />}
          title="Sessions and roster"
          subtitle={ended ? 'Classes from this course' : 'Open a class for enrolled students'}
        />
        <ListRow
          href={`/lecturer/reports?courseOfferingId=${offering.courseOfferingId}`}
          leading={<BarChart3 size={19} strokeWidth={2.1} />}
          title="Attendance report"
          subtitle="Every class, who is below the line, export"
        />
        <ListRow
          href={`/lecturer/disputes?courseOfferingId=${offering.courseOfferingId}`}
          leading={<MessageSquareWarning size={19} strokeWidth={2.1} />}
          title="Disputes"
          detail={offering.openDisputes ? <span className="lct-count-pill">{offering.openDisputes}</span> : null}
          subtitle={offering.openDisputes ? `${plural(offering.openDisputes, 'student')} waiting for your answer` : 'Nothing waiting'}
        />
      </List>

      <div className="lct-detail-foot">
        <Button variant="gray" onClick={() => setEditing(true)} icon={<Pencil size={17} aria-hidden="true" />}>Edit details</Button>
        <p className="lct-fine">{offering.departmentName}</p>
      </div>
    </div>
  );
}

/**
 * The join code. A new code shows once, big, with copy, share and "show to the class"; after
 * that only its date shows (the server keeps a fingerprint, not the code), so a lost code is
 * replaced. Students who joined stay on the course whatever happens to the code.
 */
function JoinCode({ offering, now, issued, onIssued, onRevoked }: Readonly<{
  offering: Offering;
  now: number;
  issued: IssuedCode | null;
  onIssued: (offering: Offering, code: IssuedCode) => void;
  onRevoked: (offering: Offering) => void;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState<'issue' | 'revoke' | null>(null);
  const [presenting, setPresenting] = useState(false);
  const state = codeState(offering, now);
  const fresh = issued && state === 'on' ? issued : null;

  async function issue(replacing: boolean) {
    if (busy) return;
    if (replacing) {
      const sure = await feedback.confirm({
        title: 'Get a new join code?',
        body: `The code students have now stops working.${offering.students ? ` The ${plural(offering.students, 'student')} already on ${offering.courseCode} stay on it.` : ''}`,
        confirmLabel: 'Get new code',
      });
      if (!sure) return;
    }
    setBusy('issue');
    try {
      const result = await issueCourseJoinCode(offering.courseOfferingId);
      haptic(18);
      onIssued(offering, { code: result.code, issuedAt: new Date().toISOString(), expiresAt: result.expiresAt });
    } catch (caught) {
      feedback.toast(problemText(caught, 'No code was made. Check your connection and try again.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (busy) return;
    const sure = await feedback.confirm({
      title: 'Turn off the join code?',
      body: `Nobody can join ${offering.courseCode} until you get a new code.${offering.students ? ` The ${plural(offering.students, 'student')} already on it stay.` : ''}`,
      confirmLabel: 'Turn off',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy('revoke');
    try {
      await revokeCourseJoinCode(offering.courseOfferingId);
      onRevoked(offering);
      feedback.toast(`Students can no longer join ${offering.courseCode}.`);
    } catch (caught) {
      feedback.toast(problemText(caught, 'The code is still on. Check your connection and try again.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  if (state === 'closed') {
    return (
      <section className="lct-code-card is-closed" aria-labelledby="lct-code-title">
        <h4 className="lct-block-title" id="lct-code-title">Join code</h4>
        <p className="lct-code-note">The semester ended on {longDate(offering.semesterEndsAt)}, so students can no longer join.</p>
      </section>
    );
  }

  if (fresh) {
    return (
      <section className="lct-code-card is-fresh" aria-labelledby="lct-code-title">
        <div className="lct-code-head">
          <h4 className="lct-block-title" id="lct-code-title">Join code</h4>
          <Badge tone="success" dot>Students can join</Badge>
        </div>
        <p className="lct-code-value" aria-label={`Join code ${fresh.code.split('').join(' ')}`}>
          {formatJoinCode(fresh.code).split('-').map((part, index) => <span key={index}>{part}</span>)}
        </p>
        <CodeActions offering={offering} code={fresh.code} onPresent={() => setPresenting(true)} />
        <p className="lct-code-note">
          Students type it in My courses, or open the link you share. It shows only now: LASUATOS keeps a fingerprint of it, not the code. Works until {longDate(fresh.expiresAt)}.
        </p>
        <div className="lct-code-more">
          <Menu
            label={`More for the ${offering.courseCode} code`}
            title={`${offering.courseCode} join code`}
            icon={<MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
            items={[
              { label: 'Get a new code', icon: <RefreshCw size={18} aria-hidden="true" />, onSelect: () => void issue(true) },
              { label: 'Turn off the code', icon: <ShieldOff size={18} aria-hidden="true" />, destructive: true, onSelect: () => void revoke() },
            ]}
          />
        </div>
        {presenting ? <PresentCode offering={offering} code={fresh.code} onClose={() => setPresenting(false)} /> : null}
      </section>
    );
  }

  if (state === 'on') {
    return (
      <section className="lct-code-card" aria-labelledby="lct-code-title">
        <div className="lct-code-head">
          <h4 className="lct-block-title" id="lct-code-title">Join code</h4>
          <Badge tone="success" dot>Students can join</Badge>
        </div>
        <p className="lct-code-note">
          {offering.joinCodeIssuedAt ? `Made ${shortDate(offering.joinCodeIssuedAt, now)}. ` : ''}
          It was shown when you made it. Lost it? Get a new one: the old one stops working, and nobody leaves the course.
        </p>
        <div className="lct-code-actions">
          <Button variant="tinted" busy={busy === 'issue'} onClick={() => void issue(true)} icon={<RefreshCw size={17} aria-hidden="true" />}>Get a new code</Button>
          <Button variant="gray" busy={busy === 'revoke'} onClick={() => void revoke()} icon={<ShieldOff size={17} aria-hidden="true" />}>Turn off</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="lct-code-card is-off" aria-labelledby="lct-code-title">
      <div className="lct-code-head">
        <h4 className="lct-block-title" id="lct-code-title">Join code</h4>
        <Badge tone="warning">No code</Badge>
      </div>
      <p className="lct-code-note">Students can’t join {offering.courseCode} until you give them a code. They type it in My courses.</p>
      <Button block busy={busy === 'issue'} onClick={() => void issue(false)} icon={<KeyRound size={18} aria-hidden="true" />}>
        {busy === 'issue' ? 'Making a code…' : 'Get a join code'}
      </Button>
    </section>
  );
}

/** Copy, share (the phone's share sheet, else copy the whole invitation) and show to the class. */
function CodeActions({ offering, code, onPresent }: Readonly<{ offering: Offering; code: string; onPresent: () => void }>) {
  const feedback = useFeedback();
  const [copied, setCopied] = useState<'code' | 'invite' | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(what: 'code' | 'invite') {
    const link = joinLink(window.location.origin, code);
    try {
      await navigator.clipboard.writeText(what === 'code' ? formatJoinCode(code) : inviteText(offering, code, link));
      setCopied(what);
      haptic(12);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1800);
    } catch {
      feedback.toast('Copying is blocked here. Select the code and copy it yourself.', 'error');
    }
  }

  async function share() {
    const link = joinLink(window.location.origin, code);
    try {
      await navigator.share({ title: `Join ${offering.courseCode} on LASUATOS`, text: inviteText(offering, code, link) });
    } catch (caught) {
      // Closing the share sheet is not a failure.
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      void copy('invite');
    }
  }

  return (
    <div className="lct-code-actions is-three">
      <Button variant="tinted" onClick={() => void copy('code')} icon={copied === 'code' ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}>
        {copied === 'code' ? 'Copied' : 'Copy'}
      </Button>
      {canShare ? (
        <Button variant="tinted" onClick={() => void share()} icon={<Share2 size={17} aria-hidden="true" />}>Share</Button>
      ) : (
        <Button variant="tinted" onClick={() => void copy('invite')} icon={copied === 'invite' ? <Check size={17} aria-hidden="true" /> : <Share2 size={17} aria-hidden="true" />}>
          {copied === 'invite' ? 'Copied' : 'Copy invite'}
        </Button>
      )}
      <Button variant="tinted" onClick={onPresent} icon={<Presentation size={17} aria-hidden="true" />}>Show class</Button>
      <span className="sr-only" aria-live="polite">{copied === 'code' ? 'Code copied' : copied === 'invite' ? 'Invitation copied' : ''}</span>
    </div>
  );
}

/**
 * Title and units belong to the course on the course list: the person who added it there can
 * correct them (for every offering of the code); otherwise an administrator does, in Course
 * list. The level is this offering's own.
 */
function EditCourse({ offering, onCancel, onSaved }: Readonly<{ offering: Offering; onCancel: () => void; onSaved: (offering: Offering) => void }>) {
  const feedback = useFeedback();
  const [level, setLevel] = useState(offering.level);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const levelOptions = ((LEVELS as readonly string[]).includes(offering.level) ? [...LEVELS] : [offering.level, ...LEVELS])
    .map((value) => ({ value, label: levelLabel(value) }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const courseTitle = offering.canEditCourse ? tidyTitle(String(form.get('courseTitle') ?? '')) : offering.courseTitle;
    const creditUnits = offering.canEditCourse ? Number(form.get('creditUnits')) : offering.creditUnits;
    if (offering.canEditCourse && courseTitle.length < 2) {
      setError('Write the course title.');
      return;
    }
    if (offering.canEditCourse && (!Number.isInteger(creditUnits) || creditUnits < 1 || creditUnits > 30)) {
      setError('Units are a whole number from 1 to 30.');
      return;
    }
    const changes = {
      ...(courseTitle !== offering.courseTitle ? { courseTitle } : {}),
      ...(creditUnits !== offering.creditUnits ? { creditUnits } : {}),
      ...(level !== offering.level ? { level } : {}),
    };
    if (!Object.keys(changes).length) {
      onCancel();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await updateCourseOffering(offering.courseOfferingId, changes);
      feedback.toast(`${offering.courseCode} was updated.`);
      onSaved(result.offering);
    } catch (caught) {
      setError(problemText(caught, 'Nothing was saved. Check your connection and try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="lct-edit" onSubmit={(event) => void save(event)} noValidate>
      {offering.canEditCourse ? (
        <>
          <label className="account-field">
            <span>Course title</span>
            <input name="courseTitle" defaultValue={offering.courseTitle} maxLength={200} required autoComplete="off" />
          </label>
          <label className="account-field">
            <span>Units</span>
            <NumberField name="creditUnits" defaultValue={offering.creditUnits || ''} min={1} max={30} step={1} required />
          </label>
          <p className="lct-fine">You added {offering.courseCode} to the course list, so the title and units change everywhere it is used: every session, register and offering of it.</p>
        </>
      ) : (
        <div className="lct-locked">
          <strong>{offering.courseTitle}</strong>
          <span>{[unitsLabel(offering.creditUnits), 'from the course list'].filter(Boolean).join(' · ')}</span>
          <p>The title and units are on the course list for everyone. If they are wrong, an administrator can correct them in Course list.</p>
        </div>
      )}
      <label className="account-field">
        <span>Level</span>
        <Select value={level} onValueChange={setLevel} options={levelOptions} aria-label="Level" />
      </label>
      {error ? <p className="lct-error" role="alert">{error}</p> : null}
      <div className="lct-edit-actions">
        <Button variant="gray" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" busy={busy}>Save</Button>
      </div>
    </form>
  );
}
