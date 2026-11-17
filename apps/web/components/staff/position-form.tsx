'use client';

import { STAFF_ROLE_LABELS, type StaffMember, type StaffPositionChangeResult, type StaffRole, type StaffScopeOptions } from '@lasuatos/contracts';
import { AlertTriangle, ArrowDown, Info, Repeat2 } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { firstName } from '../../lib/current-account';
import { departmentOptions } from '../../lib/department-options';
import { changeStaffPosition } from '../../lib/staff-api';
import { Badge, Button, EmptyState, List, ListRow, SkeletonLines } from '../ds';
import { Select } from '../ui/select';
import { plural, POSITION_REASONS, positionConsequences, problem, REASON_MIN, ROLE_HINTS } from './format';

export interface PositionChanged {
  readonly role: StaffRole;
  readonly scopeLabel: string;
  readonly facultyId: string | null;
  readonly departmentId: string | null;
  readonly emailSent: boolean;
}

/**
 * Changing what a staff member does, or where, without inviting them again. Two steps: choose,
 * then review what the server says will happen (courses they stop teaching, disputes waiting,
 * a new workspace) before anything changes.
 */
export function PositionForm({ member, options, optionsError, onRetryOptions, onCancel, onDone }: Readonly<{
  member: StaffMember;
  options: StaffScopeOptions | undefined;
  optionsError: string | undefined;
  onRetryOptions: () => void;
  onCancel: () => void;
  onDone: (next: PositionChanged) => void;
}>) {
  if (!options) {
    return optionsError
      ? <EmptyState error title="The roles did not load" message={optionsError} action={<Button variant="tinted" onClick={onRetryOptions}>Try again</Button>} />
      : <SkeletonLines lines={5} label="Loading roles and areas" />;
  }
  return <Choose member={member} options={options} onCancel={onCancel} onDone={onDone} />;
}

function Choose({ member, options, onCancel, onDone }: Readonly<{
  member: StaffMember;
  options: StaffScopeOptions;
  onCancel: () => void;
  onDone: (next: PositionChanged) => void;
}>) {
  const roles = options.allowedRoles;
  const known = (id: string | null, list: readonly { id: string }[]) => (id && list.some((item) => item.id === id) ? id : '');
  const [role, setRole] = useState<StaffRole>(member.role);
  const [departmentId, setDepartmentId] = useState(known(member.departmentId, options.departments) || (options.departments.length === 1 ? options.departments[0]!.id : ''));
  const [facultyId, setFacultyId] = useState(known(member.facultyId, options.faculties) || (options.faculties.length === 1 ? options.faculties[0]!.id : ''));
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<StaffPositionChangeResult | null>(null);
  const roleName = useId();
  const reasonName = useId();
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const person = firstName(member.displayName);

  const needsDepartment = role === 'lecturer' || role === 'department_administrator';
  const needsFaculty = role === 'faculty_administrator';
  const text = reason === 'other' ? other.trim().replace(/\s+/g, ' ') : reason;
  const unchanged = role === member.role
    && (needsDepartment ? departmentId === member.departmentId : needsFaculty ? facultyId === member.facultyId : true);
  const problems = {
    place: needsDepartment && !departmentId ? 'Choose a department.' : needsFaculty && !facultyId ? 'Choose a faculty.' : '',
    same: unchanged ? `${person} already has that role and area. Choose what changes.` : '',
    reason: !reason ? 'Choose why. It goes in the audit log and in their email.' : text.length < REASON_MIN ? `Say why in at least ${REASON_MIN} characters.` : '',
  };
  const shown = (key: keyof typeof problems) => (tried ? problems[key] : '');
  const request = (apply: boolean) => ({
    role,
    facultyId: needsFaculty ? facultyId : null,
    departmentId: needsDepartment ? departmentId : null,
    reason: text,
    apply,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    setError('');
    if (Object.values(problems).some(Boolean)) {
      if (problems.reason && reason === 'other') otherRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      setReview(await changeStaffPosition(member.userId, request(false)));
    } catch (caught) {
      setError(problem(caught, 'The change could not be checked. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const result = await changeStaffPosition(member.userId, request(true));
      onDone({
        role: result.to.role,
        scopeLabel: result.to.scopeLabel,
        facultyId: needsFaculty ? facultyId : null,
        departmentId: needsDepartment ? departmentId : null,
        emailSent: result.emailSent,
      });
    } catch (caught) {
      setError(problem(caught, 'The change could not be made. Try again.'));
      setBusy(false);
    }
  }

  if (review) {
    return (
      <Review
        person={person}
        result={review}
        busy={busy}
        error={error}
        onBack={() => { setReview(null); setError(''); }}
        onConfirm={() => void confirm()}
      />
    );
  }

  return (
    <form className="sf-form" onSubmit={(event) => void submit(event)} noValidate>
      <p className="sf-form-note">
        Now: <strong>{STAFF_ROLE_LABELS[member.role]}</strong>, {member.scopeLabel}. {person} keeps the same account and password.
      </p>

      {roles.length > 1 ? (
        <fieldset className="sf-reasons sf-roles">
          <legend className="sf-legend">Role</legend>
          {roles.map((value) => (
            <label key={value} className="sf-reason sf-role">
              <input type="radio" name={roleName} value={value} checked={role === value} onChange={() => setRole(value)} />
              <span>
                <strong>{STAFF_ROLE_LABELS[value]}{value === member.role ? <Badge tone="neutral">Now</Badge> : null}</strong>
                <small>{ROLE_HINTS[value]}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {needsDepartment && options.departments.length > 1 ? (
        <label className="account-field">
          <span>Department</span>
          <Select value={departmentId} onValueChange={setDepartmentId} placeholder="Choose a department" options={departmentOptions(options.departments)} />
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
      {needsDepartment && options.departments.length === 1 ? <p className="sf-form-note">In {options.departments[0]!.name}.</p> : null}
      {needsFaculty && options.faculties.length === 1 ? <p className="sf-form-note">In {options.faculties[0]!.name}.</p> : null}

      <fieldset className="sf-reasons">
        <legend className="sf-legend">Why</legend>
        {[...POSITION_REASONS, 'other'].map((value) => (
          <label key={value} className="sf-reason">
            <input
              type="radio"
              name={reasonName}
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value);
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
              placeholder="For example: acting HOD from 1 December"
            />
          </label>
        ) : null}
        {shown('reason') ? <small className="sf-field-error">{shown('reason')}</small> : null}
      </fieldset>

      {shown('same') ? <p className="sf-error" role="alert">{shown('same')}</p> : null}
      {error ? <p className="sf-error" role="alert">{error}</p> : null}
      <div className="sf-actions">
        <Button variant="gray" type="button" onClick={onCancel}>Back</Button>
        <Button type="submit" busy={busy}>{busy ? 'Checking…' : 'Review change'}</Button>
      </div>
    </form>
  );
}

function Review({ person, result, busy, error, onBack, onConfirm }: Readonly<{
  person: string;
  result: StaffPositionChangeResult;
  busy: boolean;
  error: string;
  onBack: () => void;
  onConfirm: () => void;
}>) {
  const notes = positionConsequences(result, person);
  const courses = result.coursesLeaving;
  return (
    <div className="sf-form">
      <ol className="sf-move" aria-label="The change">
        <li className="sf-move-from">
          <small>Before</small>
          <strong>{STAFF_ROLE_LABELS[result.from.role]}</strong>
          <span>{result.from.scopeLabel}</span>
        </li>
        <li className="sf-move-arrow" aria-hidden="true"><ArrowDown size={18} strokeWidth={2.1} /></li>
        <li className="sf-move-to">
          <small>After</small>
          <strong>{STAFF_ROLE_LABELS[result.to.role]}</strong>
          <span>{result.to.scopeLabel}</span>
        </li>
      </ol>

      {result.teachingNow ? (
        <p className="sf-note is-warning" role="alert">
          <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
          {person} is taking attendance right now. Make the change after the class closes, so the register stays theirs to finish.
        </p>
      ) : null}

      {courses.length ? (
        <List label={`Stops teaching ${plural(courses.length, 'course')}`}>
          {courses.map((course) => (
            <ListRow
              key={`${course.courseCode}-${course.semesterName}`}
              title={<span className="ds-mono">{course.courseCode}</span>}
              subtitle={`${course.courseTitle} · ${course.semesterName}`}
              trailing={course.otherLecturers
                ? <Badge tone="neutral">{course.otherLecturers === 1 ? '1 other lecturer' : `${course.otherLecturers} other lecturers`}</Badge>
                : <Badge tone="warning">Nobody else</Badge>}
            />
          ))}
        </List>
      ) : null}

      {notes.map((note) => (
        <p key={note.text} className={`sf-note${note.tone === 'warning' ? ' is-warning' : ''}`} role="note">
          {note.tone === 'warning' ? <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" /> : <Info size={16} strokeWidth={2.1} aria-hidden="true" />}
          {note.text}
        </p>
      ))}
      {courses.length ? <p className="sf-form-note">Past semesters stay as they were: their registers and reports keep {person}’s name.</p> : null}
      <p className="sf-form-note">{person} gets an email saying what changed and why. It goes in the audit log.</p>

      {error ? <p className="sf-error" role="alert">{error}</p> : null}
      <div className="sf-actions">
        <Button variant="gray" type="button" onClick={onBack}>Back</Button>
        <Button
          busy={busy}
          disabled={result.teachingNow}
          icon={<Repeat2 size={18} strokeWidth={2.1} aria-hidden="true" />}
          onClick={onConfirm}
        >
          {busy ? 'Changing…' : result.from.role === result.to.role ? 'Change area' : 'Change role'}
        </Button>
      </div>
    </div>
  );
}
