'use client';

import { STAFF_ROLE_LABELS, type StaffDirectory, type StaffInvitation, type StaffRole, type StaffScopeOptions } from '@lasuatos/contracts';
import { AlertTriangle, MailCheck, Send } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { departmentOptions } from '../../lib/department-options';
import { inviteStaff } from '../../lib/staff-api';
import { Button, EmptyState, Sheet, SkeletonLines } from '../ds';
import { Select } from '../ui/select';
import { problem } from './format';

const ROLE_HINTS: Readonly<Record<StaffRole, string>> = {
  lecturer: 'Takes attendance for their own courses',
  department_administrator: 'Runs one department: staff, class lists and reports',
  faculty_administrator: 'Runs every department in a faculty',
  institution_administrator: 'Runs the whole university',
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const until = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

/** Inviting someone: who, what they do, and where. The form starts fresh each time it opens. */
export function InviteSheet({ open, focusOnOpen = true, onClose, options, optionsError, onRetryOptions, directory, onInvited, onOpenInvitation, onOpenPerson }: Readonly<{
  open: boolean;
  /** False when a link opened the sheet: the keyboard waits until they tap a field. */
  focusOnOpen?: boolean;
  onClose: () => void;
  options: StaffScopeOptions | undefined;
  optionsError: string | undefined;
  onRetryOptions: () => void;
  directory: StaffDirectory;
  onInvited: (invitation: StaffInvitation) => void;
  onOpenInvitation: (id: string) => void;
  onOpenPerson: (id: string) => void;
}>) {
  const [round, setRound] = useState(0);
  return (
    <Sheet open={open} onClose={onClose} title="Invite staff">
      {!open ? null : options ? (
        <InviteForm
          key={round}
          focusName={focusOnOpen || round > 0}
          options={options}
          directory={directory}
          onInvited={onInvited}
          onAnother={() => setRound((value) => value + 1)}
          onClose={onClose}
          onOpenInvitation={onOpenInvitation}
          onOpenPerson={onOpenPerson}
        />
      ) : optionsError ? (
        <EmptyState error title="The invite form did not load" message={optionsError} action={<Button variant="tinted" onClick={onRetryOptions}>Try again</Button>} />
      ) : <SkeletonLines lines={5} label="Loading the invite form" />}
    </Sheet>
  );
}

function InviteForm({ focusName, options, directory, onInvited, onAnother, onClose, onOpenInvitation, onOpenPerson }: Readonly<{
  focusName: boolean;
  options: StaffScopeOptions;
  directory: StaffDirectory;
  onInvited: (invitation: StaffInvitation) => void;
  onAnother: () => void;
  onClose: () => void;
  onOpenInvitation: (id: string) => void;
  onOpenPerson: (id: string) => void;
}>) {
  const roles = options.allowedRoles;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Lecturers are who most invitations are for.
  const [role, setRole] = useState<StaffRole | ''>(roles.includes('lecturer') ? 'lecturer' : roles.length === 1 ? roles[0]! : '');
  const [departmentId, setDepartmentId] = useState(options.departments.length === 1 ? options.departments[0]!.id : '');
  const [facultyId, setFacultyId] = useState(options.faculties.length === 1 ? options.faculties[0]!.id : '');
  const [staffNumber, setStaffNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState<{ invitation: StaffInvitation; emailSent: boolean } | null>(null);
  const roleName = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  // A frame later, so it lands after the dialog's own showModal() focus.
  useEffect(() => {
    if (!focusName) return undefined;
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusName]);

  const needsDepartment = role === 'lecturer' || role === 'department_administrator';
  const needsFaculty = role === 'faculty_administrator';
  const address = email.trim().toLowerCase();
  const member = address ? directory.members.find((item) => item.email.toLowerCase() === address) : undefined;
  const pending = address ? directory.invitations.find((item) => item.email.toLowerCase() === address) : undefined;
  const problems = {
    name: name.trim() ? '' : 'Enter their full name.',
    email: EMAIL.test(address) ? '' : 'Enter an email address that works.',
    role: role ? '' : 'Choose what they do.',
    place: needsDepartment && !departmentId ? 'Choose a department.' : needsFaculty && !facultyId ? 'Choose a faculty.' : '',
  };
  const shown = (key: keyof typeof problems) => (tried ? problems[key] : '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    setError('');
    if (Object.values(problems).some(Boolean) || member || pending || !role) return;
    setBusy(true);
    try {
      const issued = await inviteStaff({
        email: address,
        displayName: name.trim().replace(/\s+/g, ' '),
        role,
        facultyId: needsFaculty ? facultyId : null,
        departmentId: needsDepartment ? departmentId : null,
        staffNumber: role === 'lecturer' && staffNumber.trim() ? staffNumber.trim() : null,
      });
      onInvited(issued.invitation);
      setSent(issued);
    } catch (caught) {
      setError(problem(caught, 'The invitation could not be sent. Try again.'));
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="sf-done" role="status">
        <span className={`sf-done-icon${sent.emailSent ? '' : ' is-warning'}`} aria-hidden="true">
          {sent.emailSent ? <MailCheck size={28} strokeWidth={1.9} /> : <AlertTriangle size={28} strokeWidth={1.9} />}
        </span>
        <h3 className="sf-done-title">{sent.emailSent ? 'Invitation sent' : 'Saved, but the email didn’t send'}</h3>
        <p className="sf-done-text">
          {sent.emailSent
            ? `${sent.invitation.displayName} gets a link at ${sent.invitation.email}. It works once, until ${until.format(new Date(sent.invitation.expiresAt))}.`
            : 'Check the email settings, then send a new link from Invited.'}
        </p>
        <div className="sf-actions">
          <Button variant="gray" onClick={onAnother}>Invite another</Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form className="sf-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span>Full name</span>
        <input
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={160}
          autoComplete="off"
          placeholder="As it should appear"
          aria-invalid={Boolean(shown('name'))}
          aria-describedby={shown('name') ? 'sf-invite-name-error' : undefined}
        />
        {shown('name') ? <small className="sf-field-error" id="sf-invite-name-error">{shown('name')}</small> : null}
      </label>

      <label className="account-field">
        <span>Email</span>
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={320}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@lasu.edu.ng"
          aria-invalid={Boolean(shown('email') || member || pending)}
          aria-describedby={shown('email') || member || pending ? 'sf-invite-email-note' : undefined}
        />
        {member ? (
          <small className="sf-field-error" id="sf-invite-email-note">
            {member.displayName} already has an account with this email.{' '}
            <button className="sf-inline-link" type="button" onClick={() => onOpenPerson(member.userId)}>Open</button>
          </small>
        ) : pending ? (
          <small className="sf-field-error" id="sf-invite-email-note">
            {pending.displayName} was already invited{pending.expired ? ', but the link expired' : ''}.{' '}
            <button className="sf-inline-link" type="button" onClick={() => onOpenInvitation(pending.id)}>{pending.expired ? 'Send a new link' : 'Open'}</button>
          </small>
        ) : shown('email') ? <small className="sf-field-error" id="sf-invite-email-note">{shown('email')}</small> : null}
      </label>

      {roles.length > 1 ? (
        <fieldset className="sf-reasons sf-roles" aria-describedby={shown('role') ? 'sf-invite-role-error' : undefined}>
          <legend className="sf-legend">Role</legend>
          {roles.map((value) => (
            <label key={value} className="sf-reason sf-role">
              <input type="radio" name={roleName} value={value} checked={role === value} onChange={() => setRole(value)} />
              <span>
                <strong>{STAFF_ROLE_LABELS[value]}</strong>
                <small>{ROLE_HINTS[value]}</small>
              </span>
            </label>
          ))}
          {shown('role') ? <small className="sf-field-error" id="sf-invite-role-error">{shown('role')}</small> : null}
        </fieldset>
      ) : null}

      {needsDepartment && options.departments.length > 1 ? (
        <label className="account-field">
          <span>Department</span>
          <Select
            value={departmentId}
            onValueChange={setDepartmentId}
            placeholder="Choose a department"
            options={departmentOptions(options.departments)}
          />
          {shown('place') ? <small className="sf-field-error">{shown('place')}</small> : null}
        </label>
      ) : null}
      {needsFaculty && options.faculties.length > 1 ? (
        <label className="account-field">
          <span>Faculty</span>
          <Select
            value={facultyId}
            onValueChange={setFacultyId}
            placeholder="Choose a faculty"
            options={options.faculties.map((faculty) => ({ value: faculty.id, label: faculty.name, tag: faculty.code }))}
          />
          {shown('place') ? <small className="sf-field-error">{shown('place')}</small> : null}
        </label>
      ) : null}
      {needsDepartment && options.departments.length === 1 ? (
        <p className="sf-form-note">In {options.departments[0]!.name}.</p>
      ) : null}
      {needsFaculty && options.faculties.length === 1 ? (
        <p className="sf-form-note">In {options.faculties[0]!.name}.</p>
      ) : null}

      {role === 'lecturer' ? (
        <label className="account-field">
          <span>Staff number <small className="field-optional">optional</small></span>
          <input
            className="ds-mono"
            value={staffNumber}
            onChange={(event) => setStaffNumber(event.target.value.toUpperCase())}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            placeholder="They can add it themselves"
          />
        </label>
      ) : null}

      {error ? <p className="sf-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} icon={<Send size={20} strokeWidth={2.1} aria-hidden="true" />}>
        {busy ? 'Sending…' : 'Send invitation'}
      </Button>
    </form>
  );
}
