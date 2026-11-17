'use client';

import { STAFF_ACTIVITY_DAYS, STAFF_ROLE_LABELS, type StaffDirectory, type StaffMember, type StaffScopeOptions } from '@lasuatos/contracts';
import { AlertTriangle, Copy, PencilLine, Repeat2, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { firstName } from '../../lib/current-account';
import { changeStaffStatus, updateStaffMember } from '../../lib/staff-api';
import { Badge, Button, List, ListRow, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { PositionForm } from './position-form';
import { initials, isQuiet, plural, problem, REACTIVATE_REASONS, REASON_MIN, shortDate, SUSPEND_REASONS, whenLabel } from './format';

type Mode = 'view' | 'edit' | 'status' | 'position';

interface RoleOptions {
  readonly options: StaffScopeOptions | undefined;
  readonly optionsError: string | undefined;
  readonly onRetryOptions: () => void;
}

/** One staff member: what they do, how they use the app, and what an administrator can change. */
export function PersonSheet({ member, now, onClose, onChanged, roles }: Readonly<{
  member: StaffMember | null;
  now: number;
  onClose: () => void;
  onChanged: (change: (current: StaffDirectory) => StaffDirectory) => void;
  roles: RoleOptions;
}>) {
  return (
    <Sheet open={member !== null} onClose={onClose} title={member?.displayName ?? ''}>
      {member ? <Person key={member.userId} member={member} now={now} onChanged={onChanged} roles={roles} /> : null}
    </Sheet>
  );
}

function Person({ member, now, onChanged, roles }: Readonly<{
  member: StaffMember;
  now: number;
  onChanged: (change: (current: StaffDirectory) => StaffDirectory) => void;
  roles: RoleOptions;
}>) {
  const [mode, setMode] = useState<Mode>('view');
  const feedback = useFeedback();
  const back = () => setMode('view');
  const replace = (next: Partial<StaffMember>) => onChanged((current) => ({
    ...current,
    members: current.members.map((item) => (item.userId === member.userId ? { ...item, ...next } : item)),
  }));

  if (mode === 'edit') {
    return <EditForm member={member} onDone={(next) => { if (next) { replace(next); feedback.toast('Details saved.'); } back(); }} />;
  }
  if (mode === 'position') {
    return (
      <PositionForm
        member={member}
        options={roles.options}
        optionsError={roles.optionsError}
        onRetryOptions={roles.onRetryOptions}
        onCancel={back}
        onDone={({ emailSent, ...next }) => {
          replace(next);
          feedback.toast(`${member.displayName} is now ${STAFF_ROLE_LABELS[next.role].toLowerCase()}, ${next.scopeLabel}.${emailSent ? ' They were emailed.' : ''}`);
          back();
        }}
      />
    );
  }
  if (mode === 'status') {
    return (
      <StatusForm
        member={member}
        onCancel={back}
        onDone={(status) => {
          replace({ status });
          feedback.toast(status === 'suspended' ? `${member.displayName} was suspended and signed out.` : `${member.displayName} can sign in again.`);
          back();
        }}
      />
    );
  }

  const lecturer = member.role === 'lecturer';
  const suspended = member.status === 'suspended';
  const copy = () => {
    void navigator.clipboard?.writeText(member.email).then(
      () => feedback.toast('Email copied.'),
      () => feedback.toast('The email could not be copied.', 'error'),
    );
  };

  return (
    <div className="sf-person">
      <div className="sf-person-head">
        <span className={`sf-avatar is-large${suspended ? ' is-off' : ''}`} aria-hidden="true">{initials(member.displayName)}</span>
        <div className="sf-person-who">
          <p className="sf-person-role">{STAFF_ROLE_LABELS[member.role]}</p>
          <p className="sf-person-area">{member.scopeLabel}</p>
          {suspended || member.isSelf ? (
            <p className="sf-person-badges">
              {suspended ? <Badge tone="danger">Suspended</Badge> : null}
              {member.isSelf ? <Badge tone="neutral">You</Badge> : null}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="sf-figures">
        <div>
          <dt>Last active</dt>
          <dd>{whenLabel(member.lastActiveAt, now)}</dd>
        </div>
        {lecturer || member.recentSessions || member.lastSessionAt ? (
          <>
            <div className={isQuiet(member, now) ? 'is-warning' : member.recentSessions ? 'is-good' : ''}>
              <dt>Sessions</dt>
              <dd>{member.recentSessions}<small className="sf-figure-note">in {STAFF_ACTIVITY_DAYS} days</small></dd>
            </div>
            <div>
              <dt>Last session</dt>
              <dd>{member.lastSessionAt ? whenLabel(member.lastSessionAt, now) : 'None yet'}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {isQuiet(member, now) ? (
        <p className="sf-note is-warning" role="note">
          <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
          {member.lastSessionAt
            ? `No attendance taken since ${shortDate(member.lastSessionAt, now)}.`
            : `Joined ${plural(Math.floor((now - Date.parse(member.joinedAt)) / 86_400_000), 'day')} ago and hasn’t taken attendance yet.`}
        </p>
      ) : null}

      <List label="Details">
        <ListRow
          title="Email"
          subtitle={<a className="sf-link" href={`mailto:${member.email}`}>{member.email}</a>}
          trailing={(
            <button className="ds-icon-btn" type="button" onClick={copy} aria-label="Copy email" data-tip="Copy email">
              <Copy size={16} strokeWidth={2.1} aria-hidden="true" />
            </button>
          )}
        />
        {lecturer ? <ListRow title="Staff number" detail={member.staffNumber ? <span className="ds-mono">{member.staffNumber}</span> : 'Not recorded'} /> : null}
        <ListRow title="Joined" detail={shortDate(member.joinedAt, now)} />
      </List>

      {member.manageable || member.isSelf ? (
        <div className="sf-actions">
          <Button variant="tinted" icon={<PencilLine size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setMode('edit')}>
            Edit details
          </Button>
          {member.manageable ? (
            <Button variant="tinted" className="sf-span" icon={<Repeat2 size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setMode('position')}>
              Change role or area
            </Button>
          ) : null}
          {member.manageable ? (
            suspended ? (
              <Button variant="tinted" icon={<ShieldCheck size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setMode('status')}>Reactivate</Button>
            ) : (
              <Button variant="gray" className="sf-danger-text" icon={<ShieldOff size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setMode('status')}>Suspend</Button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EditForm({ member, onDone }: Readonly<{ member: StaffMember; onDone: (next: Partial<StaffMember> | null) => void }>) {
  const lecturer = member.role === 'lecturer';
  const [name, setName] = useState(member.displayName);
  const [number, setNumber] = useState(member.staffNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = name.trim().replace(/\s+/g, ' ');
    const staffNumber = number.trim().replace(/\s+/g, ' ').toUpperCase();
    if (displayName.length < 2) {
      setError('Enter their full name.');
      return;
    }
    const changes = {
      ...(displayName !== member.displayName ? { displayName } : {}),
      // Emptying the field removes a wrong number.
      ...(lecturer && staffNumber !== (member.staffNumber ?? '') ? { staffNumber: staffNumber || null } : {}),
    };
    if (!Object.keys(changes).length) {
      onDone(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await updateStaffMember(member.userId, changes);
      onDone(changes);
    } catch (caught) {
      setError(problem(caught, 'The change could not be saved. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="sf-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span>Full name</span>
        <input ref={first} value={name} onChange={(event) => setName(event.target.value)} maxLength={160} autoComplete="off" />
      </label>
      {lecturer ? (
        <label className="account-field">
          <span>Staff number</span>
          <input
            className="ds-mono"
            value={number}
            onChange={(event) => setNumber(event.target.value.toUpperCase())}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            placeholder="Not recorded"
          />
          <small>The number the university issued. Clear it to remove a wrong one.</small>
        </label>
      ) : null}
      <p className="sf-form-note">Their email, role and area stay as they are.</p>
      {error ? <p className="sf-error" role="alert">{error}</p> : null}
      <div className="sf-actions">
        <Button variant="gray" type="button" onClick={() => onDone(null)}>Cancel</Button>
        <Button type="submit" busy={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}

function StatusForm({ member, onCancel, onDone }: Readonly<{
  member: StaffMember;
  onCancel: () => void;
  onDone: (status: StaffMember['status']) => void;
}>) {
  const suspend = member.status === 'active';
  const reasons: readonly string[] = suspend ? SUSPEND_REASONS : REACTIVATE_REASONS;
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = useId();
  const errorId = useId();
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const reasonsRef = useRef<HTMLFieldSetElement>(null);
  const text = reason === 'other' ? other.trim() : reason;
  const ready = text.length >= REASON_MIN;
  const person = firstName(member.displayName);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason) {
      setError('Choose a reason. It goes in the audit log.');
      reasonsRef.current?.querySelector('input')?.focus();
      return;
    }
    if (!ready) {
      setError(`Say why in at least ${REASON_MIN} characters.`);
      otherRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await changeStaffStatus(member.userId, suspend ? 'suspend' : 'reactivate', text);
      onDone(suspend ? 'suspended' : 'active');
    } catch (caught) {
      setError(problem(caught, 'That change could not be made. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="sf-form" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset ref={reasonsRef} className="sf-reasons" aria-describedby={error ? errorId : undefined}>
        <legend>{suspend ? `Why suspend ${person}?` : `Why reactivate ${person}?`}</legend>
        {[...reasons, 'other'].map((value) => (
          <label key={value} className={`sf-reason${suspend ? ' is-danger' : ''}`}>
            <input
              type="radio"
              name={name}
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value);
                setError('');
                if (value === 'other') window.setTimeout(() => otherRef.current?.focus());
              }}
            />
            <span>{value === 'other' ? 'Something else' : value}</span>
          </label>
        ))}
        {reason === 'other' ? (
          <label className="account-field">
            <span className="sr-only">The reason</span>
            <textarea
              ref={otherRef}
              className="sf-textarea"
              value={other}
              onChange={(event) => setOther(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="A few words for the audit log"
            />
          </label>
        ) : null}
      </fieldset>
      <p className={`sf-note${suspend ? ' is-warning' : ''}`} role="note">
        {suspend ? <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" /> : <ShieldCheck size={16} strokeWidth={2.1} aria-hidden="true" />}
        {suspend
          ? 'They are signed out on every device at once and can’t sign in until reactivated. Their sessions and records stay.'
          : 'They can sign in again with their usual password.'}
      </p>
      {error ? <p className="sf-error" id={errorId} role="alert">{error}</p> : null}
      <div className="sf-actions">
        <Button variant="gray" type="button" onClick={onCancel}>Back</Button>
        <Button type="submit" variant={suspend ? 'destructive' : 'filled'} busy={busy}>
          {suspend ? (busy ? 'Suspending…' : 'Suspend') : (busy ? 'Reactivating…' : 'Reactivate')}
        </Button>
      </div>
    </form>
  );
}
