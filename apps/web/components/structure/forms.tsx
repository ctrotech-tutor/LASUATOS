'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createAcademicSession, createDepartment, createFaculty, updateAcademicSession, updateDepartment, updateFaculty } from '../../lib/structure-api';
import { Button, Sheet } from '../ds';
import { DatePicker } from '../ui/date-picker';
import { formText } from '../ui/edit-dialog';
import { Select } from '../ui/select';
import {
  endOfDay, failure, lagosDay, levelsLabel, sessionProblem, shortName, startOfDay, suggestNextSession, YEARS, yearsLabel,
  type AcademicSession, type Department, type Faculty, type SessionDraft,
} from './format';

const CODE_PATTERN = '[A-Za-z0-9][A-Za-z0-9._\\/\\-]*';
const CODE_MESSAGE = 'Use letters and numbers, with . _ / or - between, like ECE.';
const YEAR_OPTIONS = YEARS.map((years) => ({ value: String(years), label: yearsLabel(years), description: levelsLabel(years) }));
const SEMESTER_NAMES = ['First Semester', 'Second Semester', 'Third Semester'];
const MAX_SEMESTERS = 3;

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

/** Saves, then waits for the page's fresh copy of the structure before the sheet closes. */
type Saved = (message: string, after?: { readonly department?: string; readonly faculty?: string; readonly session?: string }) => Promise<void>;

function Actions({ busy, label, onCancel }: Readonly<{ busy: boolean; label: string; onCancel: () => void }>) {
  return (
    <div className="str-form-actions">
      <Button variant="gray" onClick={onCancel}>Cancel</Button>
      <Button type="submit" busy={busy}>{label}</Button>
    </div>
  );
}

function ErrorLine({ error }: Readonly<{ error: string }>) {
  return error ? <p className="str-field-error" role="alert">{error}</p> : null;
}

/* ---------- faculties ---------- */

export function FacultyFormSheet({ open, faculty, onClose, onSaved }: Readonly<{
  open: boolean;
  /** Rename this faculty, or add a new one when null. */
  faculty: Faculty | null;
  onClose: () => void;
  onSaved: Saved;
}>) {
  return (
    <Sheet open={open} onClose={onClose} title={faculty ? `Rename ${faculty.code}` : 'Add a faculty'}>
      {open ? <FacultyForm key={faculty?.id ?? 'new'} faculty={faculty} onCancel={onClose} onSaved={onSaved} /> : null}
    </Sheet>
  );
}

function FacultyForm({ faculty, onCancel, onSaved }: Readonly<{ faculty: Faculty | null; onCancel: () => void; onSaved: Saved }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = tidy(formText(form, 'name'));
    setBusy(true);
    setError('');
    try {
      if (faculty) {
        if (name === faculty.name) { onCancel(); return; }
        await updateFaculty(faculty.id, { name });
        await onSaved(`Renamed to ${name}.`);
      } else {
        const code = formText(form, 'code').toUpperCase();
        await createFaculty({ code, name });
        await onSaved(`${name} was added. Add its departments next.`, { faculty: code.toLowerCase() });
      }
    } catch (caught) {
      setError(failure(caught, faculty ? 'The faculty was not renamed. Try again.' : 'The faculty was not added. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="str-form" onSubmit={(event) => void submit(event)}>
      {faculty ? (
        <p className="str-form-note">Its code, {faculty.code}, stays the same.</p>
      ) : (
        <label className="account-field">
          <span>Code</span>
          <input name="code" required maxLength={40} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="SCI"
            pattern={CODE_PATTERN} data-pattern-message={CODE_MESSAGE} className="str-upper" />
          <small className="str-hint">Permanent, and unique in the institution.</small>
        </label>
      )}
      <label className="account-field">
        <span>Name</span>
        <input name="name" required minLength={2} maxLength={160} autoComplete="off" defaultValue={faculty?.name ?? ''} placeholder="Faculty of Science" />
      </label>
      <ErrorLine error={error} />
      <Actions busy={busy} label={faculty ? 'Save' : 'Add faculty'} onCancel={onCancel} />
    </form>
  );
}

/* ---------- departments ---------- */

export function DepartmentFormSheet({ open, department, faculties, facultyId, onClose, onSaved }: Readonly<{
  open: boolean;
  /** Edit this department, or add one when null. */
  department: Department | null;
  /** Faculties a department can be added to. */
  faculties: readonly Faculty[];
  facultyId: string | null;
  onClose: () => void;
  onSaved: Saved;
}>) {
  return (
    <Sheet open={open} onClose={onClose} title={department ? `Edit ${department.code}` : 'Add a department'}>
      {open ? (
        <DepartmentForm key={department?.id ?? `new-${facultyId ?? ''}`} department={department} faculties={faculties} facultyId={facultyId} onCancel={onClose} onSaved={onSaved} />
      ) : null}
    </Sheet>
  );
}

function DepartmentForm({ department, faculties, facultyId, onCancel, onSaved }: Readonly<{
  department: Department | null;
  faculties: readonly Faculty[];
  facultyId: string | null;
  onCancel: () => void;
  onSaved: Saved;
}>) {
  const choices = faculties.filter((faculty) => faculty.canAddDepartment && faculty.isActive);
  const [faculty, setFaculty] = useState(facultyId ?? (choices.length === 1 ? choices[0]!.id : ''));
  const [years, setYears] = useState(String(department?.programmeYears ?? 4));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shorter = department && Number(years) < department.programmeYears;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = tidy(formText(form, 'name'));
    const programmeYears = Number(years);
    setBusy(true);
    setError('');
    try {
      if (department) {
        const change = {
          ...(name !== department.name ? { name } : {}),
          ...(programmeYears !== department.programmeYears ? { programmeYears } : {}),
        };
        if (!Object.keys(change).length) { onCancel(); return; }
        await updateDepartment(department.id, change);
        await onSaved(`${department.code} was saved.`);
      } else {
        if (!faculty) { setError('Choose its faculty.'); setBusy(false); return; }
        const code = formText(form, 'code').toUpperCase();
        await createDepartment({ facultyId: faculty, code, name, programmeYears });
        await onSaved(`${code} was added. Invite its lecturers and add its class list next.`, { department: code.toLowerCase() });
      }
    } catch (caught) {
      setError(failure(caught, department ? 'The department was not saved. Try again.' : 'The department was not added. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="str-form" onSubmit={(event) => void submit(event)}>
      {department ? <p className="str-form-note">Its code, {department.code}, stays the same.</p> : null}
      {!department && (choices.length > 1 || !faculty) ? (
        <label className="account-field">
          <span>Faculty</span>
          <Select
            value={faculty}
            required
            placeholder="Choose a faculty"
            onValueChange={setFaculty}
            options={choices.map((item) => ({ value: item.id, label: shortName(item.name), description: item.code }))}
          />
        </label>
      ) : null}
      {!department ? (
        <label className="account-field">
          <span>Code</span>
          <input name="code" required maxLength={40} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="CVE"
            pattern={CODE_PATTERN} data-pattern-message={CODE_MESSAGE} className="str-upper" />
          <small className="str-hint">Permanent, and unique in the institution.</small>
        </label>
      ) : null}
      <label className="account-field">
        <span>Name</span>
        <input name="name" required minLength={2} maxLength={160} autoComplete="off" defaultValue={department?.name ?? ''} placeholder="Civil Engineering" />
      </label>
      <label className="account-field">
        <span>Programme length</span>
        <Select value={years} onValueChange={setYears} options={YEAR_OPTIONS} />
        <small className="str-hint">Sets the levels students can choose: {levelsLabel(Number(years))}.</small>
      </label>
      {shorter && (department.studentCount > 0 || department.classListCount > 0) ? (
        <p className="str-form-warning" role="status">
          Students past year {years} will show as {Number(years) * 100} Level, extra year. Each set’s faces and check-in photos are also deleted sooner, as that follows the programme’s last year.
        </p>
      ) : null}
      <ErrorLine error={error} />
      <Actions busy={busy} label={department ? 'Save' : 'Add department'} onCancel={onCancel} />
    </form>
  );
}

/* ---------- sessions ---------- */

type SemesterRow = { readonly key: string; readonly id?: string; readonly name: string; readonly startsOn: string; readonly endsOn: string };

export function SessionFormSheet({ open, session, sessions, onClose, onSaved }: Readonly<{
  open: boolean;
  /** Correct this session, or start a new one when null. */
  session: AcademicSession | null;
  sessions: readonly AcademicSession[];
  onClose: () => void;
  onSaved: Saved;
}>) {
  return (
    <Sheet open={open} onClose={onClose} title={session ? `Edit ${session.code}` : 'Start a new session'} size="wide">
      {open ? <SessionForm key={session?.id ?? 'new'} session={session} sessions={sessions} onCancel={onClose} onSaved={onSaved} /> : null}
    </Sheet>
  );
}

let rowKey = 0;
const nextKey = () => `row-${(rowKey += 1)}`;

function SessionForm({ session, sessions, onCancel, onSaved }: Readonly<{
  session: AcademicSession | null;
  sessions: readonly AcademicSession[];
  onCancel: () => void;
  onSaved: Saved;
}>) {
  const [initial] = useState<SessionDraft>(() => (session
    ? {
      code: session.code,
      startsOn: lagosDay(session.startsAt),
      endsOn: lagosDay(session.endsAt),
      semesters: session.semesters.map((semester) => ({ name: semester.name, startsOn: lagosDay(semester.startsAt), endsOn: lagosDay(semester.endsAt) })),
    }
    : suggestNextSession(sessions)));
  const [code, setCode] = useState(initial.code);
  const [startsOn, setStartsOn] = useState(initial.startsOn);
  const [endsOn, setEndsOn] = useState(initial.endsOn);
  const [semesters, setSemesters] = useState<SemesterRow[]>(() => initial.semesters.map((semester, index) => ({
    key: session?.semesters[index]?.id ?? nextKey(),
    ...(session?.semesters[index] ? { id: session.semesters[index].id } : {}),
    ...semester,
  })));
  const [makeCurrent, setMakeCurrent] = useState(() => !session && !sessions.some((item) => item.isCurrent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const suggested = !session && Boolean(initial.code);

  const update = (key: string, patch: Partial<SemesterRow>) =>
    setSemesters((current) => current.map((semester) => (semester.key === key ? { ...semester, ...patch } : semester)));

  function addSemester() {
    setSemesters((current) => {
      const taken = new Set(current.map((semester) => semester.name.trim().toLowerCase()));
      const name = SEMESTER_NAMES.find((candidate) => !taken.has(candidate.toLowerCase())) ?? '';
      return [...current, { key: nextKey(), name, startsOn: '', endsOn: '' }];
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft: SessionDraft = { code: code.trim(), startsOn, endsOn, semesters };
    const problem = sessionProblem(draft);
    if (problem) { setError(problem); return; }
    const taken = sessions.find((item) => item.code === draft.code && item.id !== session?.id);
    if (taken) { setError(`${draft.code} already exists. Open it from the list instead.`); return; }
    setBusy(true);
    setError('');
    const body = {
      code: draft.code,
      startsAt: startOfDay(startsOn),
      endsAt: endOfDay(endsOn),
      semesters: semesters.map((semester) => ({
        ...(semester.id ? { id: semester.id } : {}),
        name: tidy(semester.name),
        startsAt: startOfDay(semester.startsOn),
        endsAt: endOfDay(semester.endsOn),
      })),
    };
    try {
      if (session) {
        await updateAcademicSession(session.id, body);
        await onSaved(`${draft.code} was saved.`, { session: draft.code });
      } else {
        await createAcademicSession({ ...body, semesters: body.semesters.map(({ name, startsAt, endsAt }) => ({ name, startsAt, endsAt })), makeCurrent });
        await onSaved(makeCurrent ? `${draft.code} was added and is now the current session.` : `${draft.code} was added. Make it current when it begins.`, { session: draft.code });
      }
    } catch (caught) {
      setError(failure(caught, session ? 'The session was not saved. Try again.' : 'The session was not added. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="str-form" onSubmit={(event) => void submit(event)} noValidate>
      {suggested ? <p className="str-form-note">Filled in one year on from the latest session. Check the dates against the approved calendar.</p> : null}
      {session && session.semesters.length ? <p className="str-form-note">Semesters can be renamed and moved, or one added, but not removed.</p> : null}
      <div className="str-trio">
        <label className="account-field">
          <span>Session</span>
          <input value={code} required inputMode="numeric" autoComplete="off" placeholder="2027/2028" onChange={(event) => setCode(event.target.value)} />
        </label>
        <label className="account-field">
          <span>Starts on</span>
          <DatePicker value={startsOn} required onChange={setStartsOn} />
        </label>
        <label className="account-field">
          <span>Ends on</span>
          <DatePicker value={endsOn} required min={startsOn || undefined} onChange={setEndsOn} />
        </label>
      </div>

      <fieldset className="str-semesters">
        <legend className="str-legend">Semesters</legend>
        {semesters.map((semester, index) => (
          <div className="str-semester" key={semester.key} role="group" aria-label={`Semester ${index + 1}`}>
            <div className="str-trio">
              <label className="account-field">
                <span>Name</span>
                <input value={semester.name} required minLength={2} maxLength={80} autoComplete="off" placeholder={SEMESTER_NAMES[index] ?? 'Semester'}
                  onChange={(event) => update(semester.key, { name: event.target.value })} />
              </label>
              <label className="account-field">
                <span>Starts</span>
                <DatePicker value={semester.startsOn} required min={semesters[index - 1]?.endsOn || startsOn || undefined} max={endsOn || undefined}
                  onChange={(next) => update(semester.key, { startsOn: next })} />
              </label>
              <label className="account-field">
                <span>Ends</span>
                <DatePicker value={semester.endsOn} required min={semester.startsOn || startsOn || undefined} max={endsOn || undefined}
                  onChange={(next) => update(semester.key, { endsOn: next })} />
              </label>
            </div>
            {!semester.id && index > 0 ? (
              <button className="str-remove" type="button" onClick={() => setSemesters((current) => current.filter((item) => item.key !== semester.key))}>
                <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" /> Remove {semester.name.trim() || `semester ${index + 1}`}
              </button>
            ) : null}
          </div>
        ))}
        {semesters.length < MAX_SEMESTERS ? (
          <Button variant="tinted" size="sm" onClick={addSemester} icon={<Plus size={16} strokeWidth={2.2} aria-hidden="true" />}>Add a semester</Button>
        ) : null}
      </fieldset>

      {!session ? (
        <label className="str-tick">
          <input type="checkbox" checked={makeCurrent} onChange={(event) => setMakeCurrent(event.target.checked)} />
          <span>
            <strong>Make it the current session</strong>
            <small>Students’ levels move up as soon as it’s current. Leave this off to switch later.</small>
          </span>
        </label>
      ) : null}
      <ErrorLine error={error} />
      <Actions busy={busy} label={session ? 'Save' : 'Add session'} onCancel={onCancel} />
    </form>
  );
}
