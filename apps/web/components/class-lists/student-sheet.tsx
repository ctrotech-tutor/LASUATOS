'use client';

import {
  academicSetLabel,
  checkMatricNumber,
  checkPersonName,
  isLasuStudentEmail,
  LASU_STUDENT_EMAIL_DOMAIN,
  type AccountReleased,
  type ClassList,
  type ClassListEntry,
  type SetupCodeIssued,
} from '@lasuatos/contracts';
import { AlertTriangle, ArrowRightLeft, Check, Copy, KeyRound, PencilLine, ScanFace, Trash2, UserRoundX } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { failureText } from '../../lib/lecture-api';
import { departmentOptions } from '../../lib/department-options';
import { classListPhotoUrl, issueSetupCode, moveClassListEntry, releaseClassListAccount, removeClassListEntry, resetClassListFace, updateClassListEntry } from '../../lib/student-api';
import { Badge, Button, List, ListRow, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { Select } from '../ui/select';
import { displayName, initials, nextStep, plainName, STAGE, STAGE_ORDER, whenLabel } from './format';

type Mode =
  | { readonly kind: 'view' }
  | { readonly kind: 'edit' }
  | { readonly kind: 'move' }
  | { readonly kind: 'release' }
  | { readonly kind: 'released'; readonly result: AccountReleased }
  | { readonly kind: 'code'; readonly issued: SetupCodeIssued };

/** One student on a class list: how far they have got, their details, and what can be done. */
export function StudentSheet({ entry, list, now, onClose, onChanged }: Readonly<{
  entry: ClassListEntry | null;
  list: ClassList;
  now: number;
  onClose: () => void;
  onChanged: (update?: (list: ClassList) => ClassList) => void;
}>) {
  // Keep the last student while the sheet animates closed.
  const [last, setLast] = useState(entry);
  if (entry && entry !== last) setLast(entry);
  const shown = entry ?? last;
  return (
    <Sheet open={entry !== null} onClose={onClose} title={shown ? displayName(shown) : ''}>
      {shown ? <Student key={shown.id} entry={shown} list={list} now={now} onClose={onClose} onChanged={onChanged} /> : null}
    </Sheet>
  );
}

function Student({ entry, list, now, onClose, onChanged }: Readonly<{
  entry: ClassListEntry;
  list: ClassList;
  now: number;
  onClose: () => void;
  onChanged: (update?: (list: ClassList) => ClassList) => void;
}>) {
  const feedback = useFeedback();
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [busy, setBusy] = useState<'code' | 'face' | 'remove' | null>(null);
  const view = () => setMode({ kind: 'view' });
  const admin = list.canResetFaces;
  const confirmed = entry.stage === 'email_confirmed' || entry.stage === 'ready';
  const canGiveCode = !confirmed && list.canGiveSetupCodes;
  const hasFace = list.faceRequired && entry.stage === 'ready';
  const person = plainName(entry);

  async function giveCode() {
    setBusy('code');
    try {
      const issued = await issueSetupCode(entry.id);
      setMode({ kind: 'code', issued });
      onChanged();
    } catch (caught) {
      feedback.toast(failureText(caught, 'A setup code could not be made. Try again.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function resetFace() {
    const sure = await feedback.confirm({
      title: `Reset ${person}’s face?`,
      body: 'They must register their face again before their next check-in. Do this when the photo is not them, or they asked for it to be deleted.',
      confirmLabel: 'Reset face',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy('face');
    try {
      await resetClassListFace(entry.id);
      feedback.toast('Face reset. They register it again from their account.');
      onChanged((current) => patchEntry(current, entry.id, { stage: 'email_confirmed' }));
    } catch (caught) {
      feedback.toast(failureText(caught, 'The face could not be reset.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const sure = await feedback.confirm({
      title: `Remove ${person}?`,
      body: `${entry.matricNumber} can no longer open an account from this list. You can add them back by uploading the list again.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy('remove');
    try {
      await removeClassListEntry(entry.id);
      feedback.toast(`${person} was removed from the list.`);
      onClose();
      onChanged((current) => ({ ...current, entries: current.entries.filter((item) => item.id !== entry.id) }));
    } catch (caught) {
      feedback.toast(failureText(caught, 'They could not be removed.'), 'error');
      setBusy(null);
    }
  }

  if (mode.kind === 'edit') {
    return (
      <EditForm
        entry={entry}
        canChangeMatric={admin || !entry.userId}
        onCancel={view}
        onSaved={(saved) => {
          feedback.toast('Details saved.');
          onChanged((current) => patchEntry(current, entry.id, saved));
          view();
        }}
      />
    );
  }
  if (mode.kind === 'move') {
    return (
      <MoveForm
        entry={entry}
        list={list}
        onCancel={view}
        onMoved={(moved) => {
          feedback.toast(`${person} moved to ${moved.departmentName}. Their account and attendance are kept.`);
          onClose();
          onChanged((current) => ({ ...current, entries: current.entries.filter((item) => item.id !== entry.id) }));
        }}
      />
    );
  }
  if (mode.kind === 'release') {
    return <ReleaseForm entry={entry} onCancel={view} onReleased={(result) => { onChanged(); setMode({ kind: 'released', result }); }} />;
  }
  if (mode.kind === 'released') {
    const { result } = mode;
    return (
      <div className="cls-person">
        <div className="cls-done">
          <span className="cls-done-icon" aria-hidden="true"><Check size={28} strokeWidth={2.4} /></span>
          <p className="cls-done-title">Account released</p>
          <p className="cls-done-text">
            {person} can open it again: on LASUATOS they choose Open your account, type {result.matricNumber}, and get a code at <strong>{result.listedEmail}</strong>.
          </p>
        </div>
        <ul className="cls-facts">
          {result.signedOutSessions > 0 ? <li>{result.signedOutSessions} signed-in {result.signedOutSessions === 1 ? 'device was' : 'devices were'} signed out.</li> : null}
          {result.faceDeleted ? <li>The face registered on it was deleted.</li> : null}
          <li>{result.previousEmail} was told by email.</li>
        </ul>
        <p className="cls-form-note">Can’t they get into that mailbox? Give them a setup code instead.</p>
        <div className="cls-actions">
          <Button variant="gray" onClick={onClose}>Done</Button>
          <Button variant="tinted" busy={busy === 'code'} onClick={() => void giveCode()}>Give setup code</Button>
        </div>
      </div>
    );
  }
  if (mode.kind === 'code') return <CodeView issued={mode.issued} person={person} onDone={view} />;

  const stageIndex = STAGE_ORDER.indexOf(entry.stage);
  const steps = [
    { done: stageIndex >= 1, label: 'Opened their account' },
    { done: stageIndex >= 2, label: 'Confirmed their LASU email' },
    ...(list.faceRequired ? [{ done: stageIndex >= 3, label: 'Registered their face' }] : []),
  ];

  return (
    <div className="cls-person">
      <div className="cls-person-head">
        <span className={`cls-avatar is-large is-${STAGE[entry.stage].param}`} aria-hidden="true">{initials(entry)}</span>
        <div className="cls-person-who">
          <p className="cls-person-matric ds-mono">{entry.matricNumber}</p>
          <p className="cls-person-level">{entry.levelLabel}</p>
          <p className="cls-person-badges">
            <Badge tone={STAGE[entry.stage].tone}>{STAGE[entry.stage].label}</Badge>
            {entry.isRep ? <Badge tone="accent">Class rep</Badge> : null}
            {entry.entryLevel !== 100 ? <Badge>Direct entry</Badge> : null}
          </p>
        </div>
      </div>

      <div className="cls-steps-card">
        <ol className="cls-steps" aria-label="Getting their account ready">
          {steps.map((step) => (
            <li key={step.label} className={step.done ? 'is-done' : ''}>
              <span className="cls-step-mark" aria-hidden="true">{step.done ? <Check size={14} strokeWidth={3} /> : null}</span>
              <span>{step.label}<span className="sr-only">{step.done ? ': done' : ': not yet'}</span></span>
            </li>
          ))}
        </ol>
        <p className="cls-next">{nextStep(entry, list.faceRequired)}</p>
      </div>

      {hasFace ? (
        <div className="cls-face">
          <img src={classListPhotoUrl(entry.id)} alt={`The face ${person} registered`} width={96} height={96} loading="lazy" />
          <div className="cls-face-text">
            <p className="cls-face-title">Registered face</p>
            <p className="cls-form-note">Check-ins are compared with this photo.</p>
            {admin ? (
              <Button size="sm" variant="gray" className="cls-danger-text" busy={busy === 'face'} onClick={() => void resetFace()} icon={<ScanFace size={16} strokeWidth={2.1} aria-hidden="true" />}>
                Reset face
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <List label="Details">
        <ListRow title="LASU email" subtitle={entry.lasuEmail ? <span className="cls-wrap">{entry.lasuEmail}</span> : 'Not on the list. They give it when they open their account.'} />
        <ListRow title="Set" detail={academicSetLabel(entry.entryYear)} />
        {list.departmentId === null ? <ListRow title="Department" detail={entry.departmentName} /> : null}
        <ListRow title="Last changed" detail={whenLabel(entry.updatedAt, now)} />
        {entry.addedByName ? <ListRow title="Added by" detail={entry.addedByName} /> : null}
      </List>

      <div className="cls-actions">
        {canGiveCode ? (
          <Button variant="tinted" busy={busy === 'code'} onClick={() => void giveCode()} icon={<KeyRound size={18} strokeWidth={2.1} aria-hidden="true" />}>
            Give setup code
          </Button>
        ) : null}
        <Button variant="tinted" onClick={() => setMode({ kind: 'edit' })} icon={<PencilLine size={18} strokeWidth={2.1} aria-hidden="true" />}>
          Correct details
        </Button>
        {list.moveDepartments.some((department) => department.id !== entry.departmentId) ? (
          <Button variant="gray" onClick={() => setMode({ kind: 'move' })} icon={<ArrowRightLeft size={18} strokeWidth={2.1} aria-hidden="true" />}>
            Wrong department?
          </Button>
        ) : null}
      </div>
      {(admin && confirmed) || !entry.userId ? (
        <div className="cls-actions">
          {admin && confirmed ? (
            <Button variant="gray" className="cls-danger-text" onClick={() => setMode({ kind: 'release' })} icon={<UserRoundX size={18} strokeWidth={2.1} aria-hidden="true" />}>
              Release account
            </Button>
          ) : null}
          {!entry.userId ? (
            <Button variant="gray" className="cls-danger-text" busy={busy === 'remove'} onClick={() => void remove()} icon={<Trash2 size={18} strokeWidth={2.1} aria-hidden="true" />}>
              Remove from list
            </Button>
          ) : null}
        </div>
      ) : null}
      {canGiveCode ? <p className="cls-form-note">A setup code lets them open their account without the emailed code. It works once, for 30 minutes.</p> : null}
    </div>
  );
}

function patchEntry(list: ClassList, id: string, next: Partial<ClassListEntry>): ClassList {
  return { ...list, entries: list.entries.map((item) => (item.id === id ? { ...item, ...next } : item)) };
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });

function CodeView({ issued, person, onDone }: Readonly<{ issued: SetupCodeIssued; person: string; onDone: () => void }>) {
  const feedback = useFeedback();
  const copy = () => {
    void navigator.clipboard?.writeText(issued.code).then(
      () => feedback.toast('Setup code copied.'),
      () => feedback.toast(`Copy did not work. The code is ${issued.code}.`, 'info'),
    );
  };
  return (
    <div className="cls-person">
      <div className="cls-code-card">
        <p className="cls-code-label">Setup code for {person}</p>
        <p className="cls-code ds-mono" aria-label={`Setup code: ${issued.code.split('').join(' ')}`}>{issued.code}</p>
        <p className="cls-code-until">Works once, until {clock.format(Date.parse(issued.expiresAt))}</p>
      </div>
      <ol className="cls-facts is-numbered">
        <li>Give it to {person.split(' ')[0]} yourself, face to face or by direct message. Never in a group chat.</li>
        <li>On LASUATOS they choose Open your account, type {issued.matricNumber}, then Use a setup code from your HOC.</li>
      </ol>
      {issued.takesOver ? (
        <p className="cls-note is-warning" role="note">
          <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
          An account already uses this matric number without a confirmed LASU email. The code moves it to {person} and resets its password. Its attendance is kept.
        </p>
      ) : null}
      <p className="cls-form-note">Making another code replaces this one.</p>
      <div className="cls-actions">
        <Button variant="gray" onClick={onDone}>Done</Button>
        <Button onClick={copy} icon={<Copy size={18} strokeWidth={2.1} aria-hidden="true" />}>Copy code</Button>
      </div>
    </div>
  );
}

/**
 * Moves a student who is on the wrong department's list. Within the viewer's faculty
 * (an administrator's area); same set. Nothing is lost: the account, attendance,
 * courses and face stay, and both lists' history records the move.
 */
function MoveForm({ entry, list, onCancel, onMoved }: Readonly<{
  entry: ClassListEntry;
  list: ClassList;
  onCancel: () => void;
  onMoved: (moved: ClassListEntry) => void;
}>) {
  const [departmentId, setDepartmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const person = plainName(entry);
  const targets = list.moveDepartments.filter((department) => department.id !== entry.departmentId);
  const target = targets.find((department) => department.id === departmentId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) {
      setError('Choose the department they belong to.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onMoved(await moveClassListEntry(entry.id, target.id));
    } catch (caught) {
      setError(failureText(caught, 'They could not be moved. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="cls-form" onSubmit={(event) => void submit(event)} noValidate>
      <p className="cls-form-note">
        Move {person} to the right department’s list for the {academicSetLabel(entry.entryYear)}. Their account, attendance, courses and face stay; only their department changes.
      </p>
      <label className="account-field">
        <span>Move to</span>
        <Select
          value={departmentId}
          onValueChange={(value) => { setDepartmentId(value); setError(''); }}
          placeholder="Choose the department"
          options={departmentOptions(targets)}
          searchPlaceholder="Search departments…"
        />
      </label>
      {target ? (
        <p className="cls-note" role="note">
          {person} leaves the {entry.departmentName} list and joins {target.name}’s. Its HOC can then manage them.
        </p>
      ) : null}
      <p className="cls-form-note">Another faculty? Ask an administrator to move them.</p>
      {error ? <p className="cls-error" role="alert">{error}</p> : null}
      <div className="cls-actions">
        <Button variant="gray" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" busy={busy} disabled={!target}>Move</Button>
      </div>
    </form>
  );
}

const LEVELS = [
  { value: '100', label: '100 Level', description: 'UTME' },
  { value: '200', label: '200 Level', description: 'Direct entry' },
  { value: '300', label: '300 Level', description: 'Direct entry' },
];

function EditForm({ entry, canChangeMatric, onCancel, onSaved }: Readonly<{
  entry: ClassListEntry;
  canChangeMatric: boolean;
  onCancel: () => void;
  onSaved: (saved: ClassListEntry) => void;
}>) {
  const emailLocked = entry.stage === 'email_confirmed' || entry.stage === 'ready';
  const [form, setForm] = useState({
    matricNumber: entry.matricNumber,
    surname: entry.surname,
    firstName: entry.firstName,
    middleName: entry.middleName ?? '',
    lasuEmail: entry.lasuEmail ?? '',
    entryLevel: String(entry.entryLevel),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => first.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const set = (name: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [name]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The server's own rules, so mistakes show before anything is sent.
    const matric = checkMatricNumber(form.matricNumber);
    const surname = checkPersonName(form.surname, 'surname');
    const firstName = checkPersonName(form.firstName, 'first name');
    const middle = form.middleName.trim() ? checkPersonName(form.middleName, 'middle name', 'several') : null;
    const email = form.lasuEmail.trim().toLowerCase();
    const problem = !matric.ok ? matric.message
      : !surname.ok ? surname.message
        : !firstName.ok ? firstName.message
          : middle && !middle.ok ? middle.message
            : !emailLocked && email && !isLasuStudentEmail(email) ? `A LASU student email ends in @${LASU_STUDENT_EMAIL_DOMAIN}.`
              : '';
    if (problem || !matric.ok || !surname.ok || !firstName.ok || (middle && !middle.ok)) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await updateClassListEntry(entry.id, {
        ...(canChangeMatric ? { matricNumber: matric.value } : {}),
        surname: surname.value,
        firstName: firstName.value,
        middleName: middle ? middle.value : null,
        ...(emailLocked ? {} : { lasuEmail: email || null }),
        entryLevel: Number(form.entryLevel) as 100 | 200 | 300,
      });
      onSaved(saved);
    } catch (caught) {
      setError(failureText(caught, 'The change could not be saved. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="cls-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span>Matric number</span>
        <input
          ref={canChangeMatric ? first : undefined}
          className="ds-mono"
          value={form.matricNumber}
          onChange={(event) => set('matricNumber')(event.target.value)}
          inputMode="numeric"
          maxLength={20}
          readOnly={!canChangeMatric}
          autoComplete="off"
        />
        {!canChangeMatric ? <small>They have opened their account, so only an administrator can change it.</small> : null}
      </label>
      <div className="cls-form-pair">
        <label className="account-field">
          <span>Surname</span>
          <input ref={canChangeMatric ? undefined : first} value={form.surname} onChange={(event) => set('surname')(event.target.value)} maxLength={80} autoComplete="off" />
        </label>
        <label className="account-field">
          <span>First name</span>
          <input value={form.firstName} onChange={(event) => set('firstName')(event.target.value)} maxLength={80} autoComplete="off" />
        </label>
      </div>
      <label className="account-field">
        <span>Middle name <em className="cls-optional">optional</em></span>
        <input value={form.middleName} onChange={(event) => set('middleName')(event.target.value)} maxLength={120} autoComplete="off" />
      </label>
      <label className="account-field">
        <span>LASU email {emailLocked ? null : <em className="cls-optional">optional</em>}</span>
        <input
          type="email"
          value={form.lasuEmail}
          onChange={(event) => set('lasuEmail')(event.target.value)}
          maxLength={320}
          readOnly={emailLocked}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={`name@${LASU_STUDENT_EMAIL_DOMAIN}`}
        />
        {emailLocked ? <small>They confirmed it, so it can’t be changed here.</small> : null}
      </label>
      <label className="account-field">
        <span>Entry</span>
        <Select value={form.entryLevel} onValueChange={set('entryLevel')} options={LEVELS} />
      </label>
      {entry.userId ? <p className="cls-form-note">They have an account, so the new details show everywhere at once.</p> : null}
      {error ? <p className="cls-error" role="alert">{error}</p> : null}
      <div className="cls-actions">
        <Button variant="gray" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}

function ReleaseForm({ entry, onCancel, onReleased }: Readonly<{
  entry: ClassListEntry;
  onCancel: () => void;
  onReleased: (result: AccountReleased) => void;
}>) {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = email.trim().toLowerCase();
    const address = typed.includes('@') ? typed : `${typed}@${LASU_STUDENT_EMAIL_DOMAIN}`;
    if (!typed || !isLasuStudentEmail(address)) {
      setError(`Enter the real student’s LASU email, ending in @${LASU_STUDENT_EMAIL_DOMAIN}.`);
      return;
    }
    if (address === entry.lasuEmail?.toLowerCase()) {
      setError('That is the email already confirmed on the account. Enter the real student’s LASU email.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Say briefly why. It goes in the record.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onReleased(await releaseClassListAccount(entry.id, address, reason.trim()));
    } catch (caught) {
      setError(failureText(caught, 'The account could not be released. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="cls-form" onSubmit={(event) => void submit(event)} noValidate>
      <p className="cls-note is-warning" role="note">
        <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
        <span>Only when <strong className="cls-wrap">{entry.lasuEmail}</strong> is not this student’s email: the list had the wrong address, or someone else got in. Check their ID card first.</span>
      </p>
      <ul className="cls-facts">
        <li>Whoever uses the account now is signed out everywhere and told by email.</li>
        <li>Its registered face is deleted. Attendance already marked stays: check it in the registers.</li>
        <li>The student opens it again with a code to the email below, or a setup code.</li>
      </ul>
      <label className="account-field">
        <span>The real student’s LASU email</span>
        <input
          type="text"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={320}
          placeholder={`name@${LASU_STUDENT_EMAIL_DOMAIN}`}
        />
        <small>It replaces the wrong one on the list.</small>
      </label>
      <label className="account-field">
        <span>Reason</span>
        <textarea className="cls-textarea" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={300} placeholder="e.g. Wrong email on the list; student came with ID card" />
        <small>Kept in the list’s history and the audit log.</small>
      </label>
      {error ? <p className="cls-error" role="alert">{error}</p> : null}
      <div className="cls-actions">
        <Button variant="gray" type="button" onClick={onCancel}>Back</Button>
        <Button type="submit" variant="destructive" busy={busy}>{busy ? 'Releasing…' : 'Release account'}</Button>
      </div>
    </form>
  );
}
