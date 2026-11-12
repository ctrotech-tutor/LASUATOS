'use client';

import { academicSetLabel, type ClassRep, type ClassRepList, type ClassRepRole, type ClassRepStudent } from '@lasuatos/contracts';
import { Search, ShieldCheck, UserRoundPlus, UserRoundX } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { forgetSession, lookupSession } from '../lib/current-account';
import { appointClassRep, failureText, LectureRequestError, loadClassReps, lookupClassRepStudent, revokeClassRep } from '../lib/lecture-api';
import { WorkspaceSkeleton } from './account-gate';
import { useFeedback } from './feedback';
import { Select } from './ui/select';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly list: ClassRepList }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Administrators appoint a GHOC for each faculty and academic set, and HOCs for
 * departments. A GHOC appoints the HOCs of their own faculty and set. Class
 * reps can then take attendance from their phones.
 */
export function ClassRepsWorkspace() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const session = await lookupSession();
      if (controller.signal.aborted) return;
      if (session.kind === 'signed_out') {
        window.location.replace('/sign-in?next=/class-reps');
        return;
      }
      if (session.kind === 'unavailable') {
        setState({ kind: 'error', message: 'We could not reach LASUATOS. Check your connection and try again.' });
        return;
      }
      try {
        const list = await loadClassReps(controller.signal);
        setState({ kind: 'ready', list });
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof LectureRequestError && caught.status === 403) setState({ kind: 'denied' });
        else setState({ kind: 'error', message: failureText(caught) });
      }
    })();
    return () => controller.abort();
  }, [reload]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  if (state.kind === 'loading') return <WorkspaceSkeleton label="Loading class reps…" />;
  if (state.kind === 'denied' || state.kind === 'error') {
    return (
      <section className="workspace-message" role="status">
        <span className="workspace-message-icon" aria-hidden="true">{state.kind === 'denied' ? 'i' : '!'}</span>
        <div>
          <h1>{state.kind === 'denied' ? 'Only administrators and GHOCs manage class reps' : 'Class reps are unavailable'}</h1>
          <p>{state.kind === 'denied' ? 'Ask your GHOC or an administrator if you need to be added as a HOC.' : state.message}</p>
          {state.kind === 'error' ? (
            <div className="workspace-message-actions">
              <button className="button button-primary" type="button" onClick={() => { forgetSession(); setState({ kind: 'loading' }); refresh(); }}>Try again</button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const { list } = state;
  const ghocs = list.reps.filter((rep) => rep.role === 'ghoc');
  const hocs = list.reps.filter((rep) => rep.role === 'hoc');
  return (
    <div className="page-stack lx-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">CLASS REPRESENTATIVES</p>
          <h1>HOCs and GHOCs</h1>
          <p className="page-lede">
            A HOC takes attendance for their department’s set. A GHOC covers the whole faculty set and can add HOCs.
            {list.fixedEntryYear ? ` You can add HOCs for the ${academicSetLabel(list.fixedEntryYear)}.` : ''}
          </p>
        </div>
      </section>

      <AppointForm list={list} onSaved={refresh} />

      {ghocs.length > 0 ? <RepGroup title="GHOCs" reps={ghocs} onChanged={refresh} /> : null}
      <RepGroup title="HOCs" reps={hocs} onChanged={refresh} empty="No HOCs yet. Find a student above to add one." />
    </div>
  );
}

function AppointForm({ list, onSaved }: Readonly<{ list: ClassRepList; onSaved: () => void }>) {
  const [query, setQuery] = useState('');
  const [student, setStudent] = useState<ClassRepStudent | null>(null);
  const [role, setRole] = useState<ClassRepRole>('hoc');
  const [departmentId, setDepartmentId] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [entryYear, setEntryYear] = useState<number>(list.fixedEntryYear ?? new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, index) => thisYear - index);

  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaved('');
    setStudent(null);
    if (query.trim().length < 3) {
      setError('Type the student’s matric number or email.');
      return;
    }
    setBusy(true);
    try {
      const found = await lookupClassRepStudent(query.trim());
      setStudent(found);
      if (found.departmentId && list.departments.some((item) => item.id === found.departmentId)) setDepartmentId(found.departmentId);
      if (found.facultyId && list.faculties.some((item) => item.id === found.facultyId)) setFacultyId(found.facultyId);
      if (!list.fixedEntryYear && found.entryYear) setEntryYear(found.entryYear);
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function appoint() {
    if (!student) return;
    setError('');
    if (role === 'hoc' && !departmentId) {
      setError('Choose the department.');
      return;
    }
    if (role === 'ghoc' && !facultyId) {
      setError('Choose the faculty.');
      return;
    }
    setBusy(true);
    try {
      const rep = await appointClassRep({
        studentUserId: student.userId,
        role,
        entryYear: list.fixedEntryYear ?? entryYear,
        ...(role === 'hoc' ? { departmentId } : { facultyId }),
      });
      setSaved(`${rep.studentName} is now ${rep.role.toUpperCase()} for ${rep.departmentName ?? rep.facultyName}, ${rep.setLabel}. They can take attendance from their phone.`);
      setStudent(null);
      setQuery('');
      onSaved();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lx-card lx-appoint" aria-labelledby="lx-appoint-title">
      <h2 id="lx-appoint-title"><UserRoundPlus size={20} aria-hidden="true" /> Add a class rep</h2>
      <form className="lx-code-form" onSubmit={find}>
        <label className="lx-search lx-grow">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Student matric number or email</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Student’s matric number or email" autoComplete="off" />
        </label>
        <button className="button button-secondary" type="submit" disabled={busy}>Find</button>
      </form>
      <p className="lx-fine">The student needs a LASUATOS account first (sign-up takes a minute).</p>

      {student ? (
        <div className="lx-found">
          <div className="lx-me">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>{student.fullName}</strong>
              <span>{student.matricNumber} · {student.email}</span>
              <span>{[student.departmentName, student.entryYear ? academicSetLabel(student.entryYear) : null].filter(Boolean).join(' · ') || 'Department not set'}</span>
              {student.currentRole ? <span className="lx-flag is-warn">Currently {student.currentRole}. Adding replaces it.</span> : null}
            </div>
          </div>

          <div className="lx-grid-2">
            {list.faculties.length > 0 ? (
              <label className="account-field">
                <span>Role</span>
                <Select
                  value={role}
                  onValueChange={(next) => setRole(next as ClassRepRole)}
                  options={[
                    { value: 'hoc', label: 'HOC', description: 'One department' },
                    { value: 'ghoc', label: 'GHOC', description: 'The whole faculty' },
                  ]}
                />
              </label>
            ) : null}
            {role === 'hoc' ? (
              <label className="account-field">
                <span>Department</span>
                <Select
                  value={departmentId}
                  onValueChange={setDepartmentId}
                  placeholder="Choose department"
                  options={list.departments.map((item) => ({ value: item.id, label: item.name }))}
                />
              </label>
            ) : (
              <label className="account-field">
                <span>Faculty</span>
                <Select
                  value={facultyId}
                  onValueChange={setFacultyId}
                  placeholder="Choose faculty"
                  options={list.faculties.map((item) => ({ value: item.id, label: item.name }))}
                />
              </label>
            )}
            <label className="account-field">
              <span>Academic set</span>
              <Select
                value={String(list.fixedEntryYear ?? entryYear)}
                disabled={list.fixedEntryYear !== null}
                onValueChange={(next) => setEntryYear(Number(next))}
                options={(list.fixedEntryYear ? [list.fixedEntryYear] : years).map((year) => ({ value: String(year), label: academicSetLabel(year) }))}
              />
            </label>
          </div>
          <button className="button button-primary" type="button" disabled={busy} onClick={() => void appoint()}>
            {busy ? 'Saving…' : `Make ${role.toUpperCase()}`}
          </button>
        </div>
      ) : null}

      {error ? <p className="lx-error" role="alert">{error}</p> : null}
      {saved ? <p className="account-success" role="status">{saved}</p> : null}
    </section>
  );
}

function RepGroup({ title, reps, onChanged, empty }: Readonly<{ title: string; reps: ClassRep[]; onChanged: () => void; empty?: string }>) {
  const [busy, setBusy] = useState('');
  const dialogs = useFeedback();
  const [error, setError] = useState('');

  async function revoke(rep: ClassRep) {
    const sure = await dialogs.confirm({
      title: `Remove ${rep.studentName} as ${rep.role.toUpperCase()}?`,
      body: 'They will no longer be able to take attendance. Their past sessions are kept.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy(rep.id);
    setError('');
    try {
      await revokeClassRep(rep.id);
      dialogs.toast(`${rep.studentName} is no longer ${rep.role.toUpperCase()}.`);
      onChanged();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="lx-section" aria-label={title}>
      <h2>{title} <span className="lx-muted">{reps.length}</span></h2>
      {error ? <p className="lx-error" role="alert">{error}</p> : null}
      {reps.length === 0 ? <p className="lx-empty">{empty}</p> : (
        <ul className="lx-rep-list">
          {reps.map((rep) => (
            <li key={rep.id} className="lx-card">
              <div className="lx-attendee-main">
                <strong>{rep.studentName}</strong>
                <span>{rep.matricNumber} · {rep.email}</span>
                <span className="lx-flags">
                  <span className="lx-flag is-ok">{rep.role.toUpperCase()}</span>
                  <span className="lx-flag">{rep.departmentName ?? rep.facultyName}</span>
                  <span className="lx-flag">{rep.setLabel}</span>
                </span>
              </div>
              <button className="lx-icon-button" type="button" disabled={busy === rep.id} onClick={() => void revoke(rep)} aria-label={`Remove ${rep.studentName}`} data-tip="Remove">
                <UserRoundX size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
