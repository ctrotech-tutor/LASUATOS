'use client';

import type { InstitutionStructure } from '@lasuatos/contracts';
import { ArrowLeft, Building2, CalendarRange, Layers3, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { ApiFailure } from '../lib/course-api';
import { lookupAdministrator } from '../lib/current-account';
import {
  createAcademicSession,
  createDepartment,
  createFaculty,
  loadInstitutionStructure,
  setCurrentAcademicSession,
  updateDepartment,
  updateFaculty,
} from '../lib/structure-api';
import { useFeedback } from './feedback';

type Faculty = InstitutionStructure['faculties'][number];
type Department = Faculty['departments'][number];
type AcademicSession = InstitutionStructure['academicSessions'][number];

const dateFormat = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' });
const formatDate = (value: string) => dateFormat.format(new Date(value));
const YEARS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Lagos is UTC+1 all year (no daylight saving). */
const startOfDay = (date: string) => `${date}T00:00:00+01:00`;
const endOfDay = (date: string) => `${date}T23:59:00+01:00`;

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly adminName: string;
      readonly scopeLabel: string;
      readonly institutionName: string;
      readonly structure: InstitutionStructure;
    };

interface Feedback { readonly kind: 'success' | 'error'; readonly text: string }

function failureMessage(caught: unknown, fallback: string): string {
  if (caught && typeof caught === 'object' && 'issues' in caught && Array.isArray((caught as { issues: unknown[] }).issues)) {
    const first = (caught as { issues: { message?: unknown }[] }).issues[0];
    if (typeof first?.message === 'string') return first.message;
  }
  if (caught && typeof caught === 'object' && 'message' in caught && typeof (caught as ApiFailure).message === 'string') {
    return (caught as ApiFailure).message;
  }
  return fallback;
}

interface DepartmentDraft { readonly name: string; readonly programmeYears: number }
const emptyDepartment = { code: '', name: '', programmeYears: 4 };
const emptySession = {
  code: '',
  startsOn: '',
  endsOn: '',
  makeCurrent: false,
  firstName: 'First Semester',
  firstStarts: '',
  firstEnds: '',
  secondName: 'Second Semester',
  secondStarts: '',
  secondEnds: '',
};

export function StructureWorkspace() {
  const dialogs = useFeedback();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<{ readonly id: string; readonly draft: DepartmentDraft } | null>(null);
  const [renamingFaculty, setRenamingFaculty] = useState<{ readonly id: string; readonly name: string } | null>(null);
  const [newDepartment, setNewDepartment] = useState<{ readonly facultyId: string } & typeof emptyDepartment | null>(null);
  const [newFaculty, setNewFaculty] = useState({ code: '', name: '' });
  const [session, setSession] = useState(emptySession);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void lookupAdministrator('manage the academic structure')
      .then(async (session) => {
        if (session.kind === 'error') {
          if (!signal.aborted) setState({ kind: 'error', message: session.message });
          return;
        }
        const account = session.account;
        const structure = await loadInstitutionStructure(signal);
        if (signal.aborted) return;
        setState({
          kind: 'ready',
          adminName: account.displayName,
          scopeLabel: account.scope.label,
          institutionName: account.institutionName,
          structure,
        });
      })
      .catch((caught: unknown) => {
        if (signal.aborted) return;
        setState({ kind: 'error', message: failureMessage(caught, 'The academic structure is temporarily unavailable.') });
      });
    return () => controller.abort();
  }, [reloadKey]);

  const refresh = () => setReloadKey((key) => key + 1);

  async function act(key: string, run: () => Promise<string>): Promise<boolean> {
    setBusy(key);
    setFeedback(null);
    try {
      setFeedback({ kind: 'success', text: await run() });
      refresh();
      return true;
    } catch (caught) {
      setFeedback({ kind: 'error', text: failureMessage(caught, 'That change could not be saved. Refresh and try again.') });
      return false;
    } finally {
      setBusy('');
    }
  }

  async function saveDepartment(event: FormEvent<HTMLFormElement>, department: Department) {
    event.preventDefault();
    if (!editing) return;
    const { draft } = editing;
    const changed = {
      ...(draft.name.trim() !== department.name ? { name: draft.name } : {}),
      ...(draft.programmeYears !== department.programmeYears ? { programmeYears: draft.programmeYears } : {}),
    };
    if (!Object.keys(changed).length) {
      setEditing(null);
      return;
    }
    const saved = await act(`department:${department.id}`, async () => {
      await updateDepartment(department.id, changed);
      return `${draft.name.trim()} was saved. Student levels now use the new programme length.`;
    });
    if (saved) setEditing(null);
  }

  async function toggleDepartment(department: Department) {
    const deactivate = department.isActive;
    if (deactivate && !(await dialogs.confirm({
      title: `Deactivate ${department.name}?`,
      body: 'It disappears from student sign-up, staff invitations and new course offerings. Existing courses, students and attendance records are kept.',
      confirmLabel: 'Deactivate',
      tone: 'danger',
    }))) return;
    void act(`department:${department.id}`, async () => {
      await updateDepartment(department.id, { isActive: !deactivate });
      return deactivate ? `${department.name} was deactivated.` : `${department.name} is active again.`;
    });
  }

  async function submitDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newDepartment) return;
    const saved = await act('new-department', async () => {
      await createDepartment(newDepartment);
      return `${newDepartment.name.trim()} was added. Students can now choose it on their profile.`;
    });
    if (saved) setNewDepartment(null);
  }

  async function saveFacultyName(event: FormEvent<HTMLFormElement>, faculty: Faculty) {
    event.preventDefault();
    if (!renamingFaculty) return;
    const saved = await act(`faculty:${faculty.id}`, async () => {
      await updateFaculty(faculty.id, { name: renamingFaculty.name });
      return `${renamingFaculty.name.trim()} was saved.`;
    });
    if (saved) setRenamingFaculty(null);
  }

  async function toggleFaculty(faculty: Faculty) {
    const deactivate = faculty.isActive;
    if (deactivate && !(await dialogs.confirm({
      title: `Deactivate ${faculty.name}?`,
      body: 'Its departments must already be inactive.',
      confirmLabel: 'Deactivate',
      tone: 'danger',
    }))) return;
    void act(`faculty:${faculty.id}`, async () => {
      await updateFaculty(faculty.id, { isActive: !deactivate });
      return deactivate ? `${faculty.name} was deactivated.` : `${faculty.name} is active again.`;
    });
  }

  async function submitFaculty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await act('new-faculty', async () => {
      await createFaculty(newFaculty);
      return `${newFaculty.name.trim()} was added. Add its departments next.`;
    });
    if (saved) setNewFaculty({ code: '', name: '' });
  }

  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const semesters = [
      { name: session.firstName, startsAt: startOfDay(session.firstStarts), endsAt: endOfDay(session.firstEnds) },
      ...(session.secondStarts && session.secondEnds
        ? [{ name: session.secondName, startsAt: startOfDay(session.secondStarts), endsAt: endOfDay(session.secondEnds) }]
        : []),
    ];
    const saved = await act('new-session', async () => {
      await createAcademicSession({
        code: session.code,
        startsAt: startOfDay(session.startsOn),
        endsAt: endOfDay(session.endsOn),
        makeCurrent: session.makeCurrent,
        semesters,
      });
      return session.makeCurrent
        ? `${session.code} was created and is now the current session. Student levels move up accordingly.`
        : `${session.code} was created. Make it current when the new session begins.`;
    });
    if (saved) setSession(emptySession);
  }

  async function makeCurrent(target: AcademicSession) {
    if (!(await dialogs.confirm({
      title: `Make ${target.code} the current session?`,
      body: 'Every student’s level is worked out from the current session, and lecturers create course offerings in its semesters.',
      confirmLabel: 'Make current',
    }))) return;
    void act(`session:${target.id}`, async () => {
      await setCurrentAcademicSession(target.id);
      return `${target.code} is now the current academic session.`;
    });
  }

  if (state.kind === 'loading') {
    return <section className="workspace-message" aria-live="polite"><div><h2>Loading academic structure</h2><p>Checking your administrator access.</p></div></section>;
  }

  if (state.kind === 'error') {
    return (
      <section className="workspace-message" role="alert">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>The academic structure is unavailable</h2>
          <p>{state.message}</p>
          <div className="workspace-message-actions">
            <button className="button button-primary" type="button" onClick={() => { setState({ kind: 'loading' }); refresh(); }}>Try again</button>
            <Link className="button button-secondary" href="/admin">Back to administration overview</Link>
          </div>
        </div>
      </section>
    );
  }

  const { structure } = state;

  return (
    <div className="venue-workspace staff-workspace structure-workspace">
      <div className="venue-workspace-heading">
        <Link className="text-link" href="/admin"><ArrowLeft size={14} aria-hidden="true" /> Administration overview</Link>
        <div className="admin-overview-heading venue-heading-row">
          <div>
            <p className="section-kicker">FACULTIES · DEPARTMENTS · SESSIONS</p>
            <h2>Academic structure</h2>
            <p>
              Add and rename faculties and departments, set each programme&apos;s normal length, and start new
              academic sessions. Every change is recorded with your name. Nothing here deletes courses,
              students or attendance records.
            </p>
          </div>
          <span className="admin-live-indicator"><i aria-hidden="true" />Access verified</span>
        </div>
        <div className="admin-scope-card venue-scope-card" aria-label="Structure editing scope">
          <div className="admin-scope-symbol"><ShieldCheck size={23} strokeWidth={1.7} aria-hidden="true" /></div>
          <div className="admin-scope-copy">
            <p className="section-kicker">YOUR AREA</p>
            <h2>{state.scopeLabel}</h2>
            <p>
              {state.institutionName}
              {structure.permissions.manageFaculties
                ? ' · You can change every faculty, department and session.'
                : ' · You can change the departments in your area. Faculties and sessions are managed by institution administrators.'}
            </p>
          </div>
          <span className="admin-role-tag">{state.adminName}</span>
        </div>
      </div>

      {feedback ? <p className={`venue-feedback venue-feedback-${feedback.kind}`} role="status">{feedback.text}</p> : null}

      {structure.faculties.map((faculty) => (
        <section key={faculty.id} className="venue-panel" aria-labelledby={`faculty-${faculty.id}`}>
          <div className="structure-faculty-heading">
            <div className="venue-panel-heading">
              <Building2 size={16} aria-hidden="true" />
              <div>
                <h3 id={`faculty-${faculty.id}`}>
                  {faculty.name}{' '}
                  <span className={`venue-status ${faculty.isActive ? 'venue-status-active' : 'venue-status-inactive'}`}>
                    {faculty.isActive ? 'Active' : 'Inactive'}
                  </span>
                </h3>
                <p>Code {faculty.code} · {faculty.departments.length} department{faculty.departments.length === 1 ? '' : 's'}</p>
              </div>
            </div>
            {structure.permissions.manageFaculties ? (
              <div className="staff-row-actions">
                <button className="button button-secondary" type="button" disabled={Boolean(busy)}
                  onClick={() => setRenamingFaculty({ id: faculty.id, name: faculty.name })}>Rename</button>
                <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => toggleFaculty(faculty)}>
                  {faculty.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            ) : null}
          </div>

          {renamingFaculty?.id === faculty.id ? (
            <form className="venue-form structure-inline-form" onSubmit={(event) => void saveFacultyName(event, faculty)}>
              <label>
                Faculty name
                <input value={renamingFaculty.name} minLength={2} maxLength={160} required autoFocus
                  onChange={(event) => setRenamingFaculty({ id: faculty.id, name: event.target.value })} />
              </label>
              <div className="venue-form-actions">
                <button className="button button-primary" type="submit" disabled={busy === `faculty:${faculty.id}`}>Save name</button>
                <button className="button button-secondary" type="button" onClick={() => setRenamingFaculty(null)}>Cancel</button>
              </div>
            </form>
          ) : null}

          {faculty.departments.length ? (
            <ul className="staff-list">
              {faculty.departments.map((department) => (
                <li key={department.id} className="staff-row">
                  <div className="staff-row-main">
                    <strong>{department.name}</strong>
                    <span className={`venue-status ${department.isActive ? 'venue-status-active' : 'venue-status-inactive'}`}>
                      {department.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span className="venue-list-subtitle">
                      Code {department.code} · {department.programmeYears}-year programme
                      {' '}(levels 100–{department.programmeYears * 100})
                    </span>
                    <span className="venue-list-meta">
                      {department.studentCount} student{department.studentCount === 1 ? '' : 's'} chose this department
                      {' · '}{department.courseOfferingCount} course offering{department.courseOfferingCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {department.editable ? (
                    <div className="staff-row-actions">
                      <button className="button button-secondary" type="button" disabled={Boolean(busy)}
                        onClick={() => setEditing({ id: department.id, draft: { name: department.name, programmeYears: department.programmeYears } })}>
                        Edit
                      </button>
                      {department.canDeactivate ? (
                        <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => toggleDepartment(department)}>
                          {department.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {editing?.id === department.id ? (
                    <form className="venue-form structure-row-form" onSubmit={(event) => void saveDepartment(event, department)}>
                      <div className="venue-form-grid">
                        <label>
                          Department name
                          <input value={editing.draft.name} minLength={2} maxLength={160} required autoFocus
                            onChange={(event) => setEditing({ id: department.id, draft: { ...editing.draft, name: event.target.value } })} />
                        </label>
                        <label>
                          Programme length
                          <select value={editing.draft.programmeYears}
                            onChange={(event) => setEditing({ id: department.id, draft: { ...editing.draft, programmeYears: Number(event.target.value) } })}>
                            {YEARS.map((years) => <option key={years} value={years}>{years} year{years === 1 ? '' : 's'}</option>)}
                          </select>
                          <span className="venue-field-hint">Caps the level worked out from a matric number. Engineering and law are usually 5, medicine 6.</span>
                        </label>
                      </div>
                      <div className="venue-form-actions">
                        <button className="button button-primary" type="submit" disabled={busy === `department:${department.id}`}>Save department</button>
                        <button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="venue-empty">No departments yet.</p>}

          {faculty.canAddDepartment ? (
            newDepartment?.facultyId === faculty.id ? (
              <form className="venue-form structure-inline-form" onSubmit={(event) => void submitDepartment(event)}>
                <div className="venue-form-grid">
                  <label>
                    Department code
                    <input value={newDepartment.code} maxLength={40} required autoComplete="off" placeholder="e.g. CSC"
                      onChange={(event) => setNewDepartment({ ...newDepartment, code: event.target.value })} />
                    <span className="venue-field-hint">Unique across the university. It cannot be changed later.</span>
                  </label>
                  <label>
                    Department name
                    <input value={newDepartment.name} minLength={2} maxLength={160} required autoComplete="off"
                      placeholder="e.g. Department of Computer Science"
                      onChange={(event) => setNewDepartment({ ...newDepartment, name: event.target.value })} />
                  </label>
                  <label>
                    Programme length
                    <select value={newDepartment.programmeYears}
                      onChange={(event) => setNewDepartment({ ...newDepartment, programmeYears: Number(event.target.value) })}>
                      {YEARS.map((years) => <option key={years} value={years}>{years} year{years === 1 ? '' : 's'}</option>)}
                    </select>
                  </label>
                </div>
                <div className="venue-form-actions">
                  <button className="button button-primary" type="submit" disabled={busy === 'new-department'}>
                    {busy === 'new-department' ? 'Adding department' : 'Add department'}
                  </button>
                  <button className="button button-secondary" type="button" onClick={() => setNewDepartment(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <div>
                <button className="button button-secondary" type="button" disabled={Boolean(busy)}
                  onClick={() => setNewDepartment({ facultyId: faculty.id, ...emptyDepartment })}>
                  Add a department to {faculty.name}
                </button>
              </div>
            )
          ) : null}
        </section>
      ))}

      {structure.permissions.manageFaculties ? (
        <section className="venue-panel" aria-labelledby="structure-new-faculty">
          <div className="venue-panel-heading">
            <Layers3 size={16} aria-hidden="true" />
            <div>
              <h3 id="structure-new-faculty">Add a faculty</h3>
              <p>Codes are short and permanent, for example SCI or ENG. Add departments once the faculty exists.</p>
            </div>
          </div>
          <form className="venue-form" onSubmit={(event) => void submitFaculty(event)}>
            <div className="venue-form-grid">
              <label>
                Faculty code
                <input value={newFaculty.code} maxLength={40} required autoComplete="off" placeholder="e.g. SCI"
                  onChange={(event) => setNewFaculty((current) => ({ ...current, code: event.target.value }))} />
              </label>
              <label>
                Faculty name
                <input value={newFaculty.name} minLength={2} maxLength={160} required autoComplete="off" placeholder="e.g. Faculty of Science"
                  onChange={(event) => setNewFaculty((current) => ({ ...current, name: event.target.value }))} />
              </label>
            </div>
            <div className="venue-form-actions">
              <button className="button button-primary" type="submit" disabled={busy === 'new-faculty'}>
                {busy === 'new-faculty' ? 'Adding faculty' : 'Add faculty'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="venue-panel" aria-labelledby="structure-sessions">
        <div className="venue-panel-heading">
          <CalendarRange size={16} aria-hidden="true" />
          <div>
            <h3 id="structure-sessions">Academic sessions</h3>
            <p>
              Students&apos; levels are worked out from the current session, so switch to the new session when it
              begins. Lecturers can only create course offerings inside a session&apos;s semesters.
            </p>
          </div>
        </div>
        {structure.academicSessions.length ? (
          <ul className="staff-list">
            {structure.academicSessions.map((item) => (
              <li key={item.id} className="staff-row">
                <div className="staff-row-main">
                  <strong>{item.code}</strong>
                  {item.isCurrent ? <span className="venue-status venue-status-active">Current</span> : null}
                  <span className="venue-list-subtitle">{formatDate(item.startsAt)} – {formatDate(item.endsAt)}</span>
                  <span className="venue-list-meta">
                    {item.semesters.length
                      ? item.semesters.map((semester) => `${semester.name}: ${formatDate(semester.startsAt)} – ${formatDate(semester.endsAt)}`).join(' · ')
                      : 'No semesters'}
                  </span>
                </div>
                {structure.permissions.manageSessions && !item.isCurrent ? (
                  <div className="staff-row-actions">
                    <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => makeCurrent(item)}>
                      Make current
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="venue-empty">No academic sessions yet.</p>}

        {structure.permissions.manageSessions ? (
          <form className="venue-form structure-session-form" onSubmit={(event) => void submitSession(event)}>
            <h4>Start a new academic session</h4>
            <div className="venue-form-grid">
              <label>
                Session
                <input value={session.code} required pattern="\d{4}/\d{4}" placeholder="2027/2028" autoComplete="off"
                  onChange={(event) => setSession((current) => ({ ...current, code: event.target.value }))} />
              </label>
              <label>
                Starts on
                <input type="date" value={session.startsOn} required
                  onChange={(event) => setSession((current) => ({ ...current, startsOn: event.target.value }))} />
              </label>
              <label>
                Ends on
                <input type="date" value={session.endsOn} required
                  onChange={(event) => setSession((current) => ({ ...current, endsOn: event.target.value }))} />
              </label>
            </div>
            <div className="venue-form-grid">
              <label>
                First semester name
                <input value={session.firstName} required maxLength={80}
                  onChange={(event) => setSession((current) => ({ ...current, firstName: event.target.value }))} />
              </label>
              <label>
                First semester starts
                <input type="date" value={session.firstStarts} required
                  onChange={(event) => setSession((current) => ({ ...current, firstStarts: event.target.value }))} />
              </label>
              <label>
                First semester ends
                <input type="date" value={session.firstEnds} required
                  onChange={(event) => setSession((current) => ({ ...current, firstEnds: event.target.value }))} />
              </label>
            </div>
            <div className="venue-form-grid">
              <label>
                Second semester name
                <input value={session.secondName} maxLength={80}
                  onChange={(event) => setSession((current) => ({ ...current, secondName: event.target.value }))} />
              </label>
              <label>
                Second semester starts
                <input type="date" value={session.secondStarts} required={Boolean(session.secondEnds)}
                  onChange={(event) => setSession((current) => ({ ...current, secondStarts: event.target.value }))} />
              </label>
              <label>
                Second semester ends
                <input type="date" value={session.secondEnds} required={Boolean(session.secondStarts)}
                  onChange={(event) => setSession((current) => ({ ...current, secondEnds: event.target.value }))} />
                <span className="venue-field-hint">Leave both second-semester dates empty to add it later via the setup file.</span>
              </label>
            </div>
            <label className="attendance-checkbox">
              <input type="checkbox" checked={session.makeCurrent}
                onChange={(event) => setSession((current) => ({ ...current, makeCurrent: event.target.checked }))} />
              <span>Make this the current session now</span>
            </label>
            <div className="venue-form-actions">
              <button className="button button-primary" type="submit" disabled={busy === 'new-session'}>
                {busy === 'new-session' ? 'Creating session' : 'Create session'}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
