'use client';

import type { StudentAcademicProfile, StudentDepartmentOptions } from '@lasuatos/contracts';
import { GraduationCap, LoaderCircle, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  loadStudentAcademicProfile,
  loadStudentDepartmentOptions,
  updateStudentDepartment,
  updateStudentEntryLevel,
} from '../lib/course-api';
import { Select } from './ui/select';

const ENTRY_OPTIONS = [
  { value: 100, label: '100 Level — UTME' },
  { value: 200, label: '200 Level — Direct Entry' },
  { value: 300, label: '300 Level — Direct Entry' },
] as const;

function explanation(profile: StudentAcademicProfile): string {
  if (profile.levelStatus === 'unknown') {
    return 'Your level could not be read from your matric number. LASU matric numbers are 9 digits and start with your entry year (for example 24… for 2024). Your attendance is recorded either way.';
  }
  const entryYear = profile.entryYear ?? 0;
  if (profile.levelStatus === 'not_started') {
    return `Your matric number shows an entry year of ${entryYear}/${entryYear + 1}, which is after the current ${profile.sessionLabel} session. Your attendance is recorded either way.`;
  }
  const entry = profile.entryLevel === 100 ? 'entered at 100 Level' : `entered by Direct Entry at ${profile.entryLevel} Level`;
  const year = profile.yearOfStudy === 1 ? 'your first year' : `year ${profile.yearOfStudy} of study`;
  const extra = profile.levelStatus === 'extra_year'
    ? ` That is beyond the ${profile.programmeYears}-year programme, so it shows as an extra year.`
    : '';
  return `Worked out from your matric number: you joined in ${entryYear}/${entryYear + 1} and ${entry}, so ${profile.sessionLabel} is ${year}.${extra}`;
}

function failure(caught: unknown): string {
  return caught && typeof caught === 'object' && 'message' in caught ? String(caught.message) : 'The change was not saved.';
}

/**
 * The student's level, derived from the entry year in their matric number.
 * Students can say how they entered (UTME or Direct Entry) and pick their
 * department, which sets the programme length (e.g. 5 years for engineering).
 */
export function StudentLevelCard() {
  const [profile, setProfile] = useState<StudentAcademicProfile | null>(null);
  const [departments, setDepartments] = useState<StudentDepartmentOptions['departments'] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadStudentAcademicProfile(controller.signal)
      .then((loaded) => {
        setProfile(loaded);
        // Without a department the programme length is a guess; invite the student to set it.
        if (!loaded.departmentId && loaded.matricRecognized) setEditing(true);
      })
      .catch(() => {
        // The level is a convenience; the page works without it.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!editing || departments) return;
    const controller = new AbortController();
    loadStudentDepartmentOptions(controller.signal)
      .then((result) => setDepartments(result.departments))
      .catch(() => setDepartments([]));
    return () => controller.abort();
  }, [editing, departments]);

  async function save(change: () => Promise<StudentAcademicProfile>) {
    setBusy(true);
    setError('');
    try {
      setProfile(await change());
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return null;

  return (
    <section className="sx-level" aria-labelledby="student-level-heading">
      <div className="sx-level-top">
        <span className="sx-level-icon" aria-hidden="true"><GraduationCap size={22} /></span>
        <div className="sx-level-main">
          <p className="sx-level-kicker">{profile.sessionLabel} session</p>
          <h2 id="student-level-heading">{profile.levelLabel}</h2>
        </div>
        <span className={`sx-level-chip${profile.matricNumberVerified ? ' is-verified' : ''}`}>
          {profile.matricNumberVerified ? 'Verified' : 'Self-reported'}
        </span>
      </div>
      <dl className="sx-level-facts">
        <div><dt>Matric no.</dt><dd>{profile.matricNumber}</dd></div>
        {profile.departmentName ? <div><dt>Department</dt><dd>{profile.departmentName}</dd></div> : null}
        {profile.departmentName ? <div><dt>Programme</dt><dd>{profile.programmeYears} years</dd></div> : null}
      </dl>
      <details className="sx-level-why">
        <summary>How is this worked out?</summary>
        <p>{explanation(profile)}</p>
      </details>
      <div className="sx-level-actions">
        {editing ? (
          <div className="student-level-edit">
            <label>
              <span>Your department</span>
              <Select
                value={profile.departmentId ?? ''}
                disabled={busy || !departments}
                placeholder={departments ? 'Choose your department' : 'Loading departments…'}
                options={(departments ?? []).map((department) => ({
                  value: department.id,
                  label: departmentLabel(department.name),
                  description: department.facultyName,
                }))}
                onValueChange={(departmentId) => {
                  if (departmentId) void save(() => updateStudentDepartment(departmentId));
                }}
              />
            </label>
            <label>
              <span>How did you enter LASU?</span>
              <Select
                value={String(profile.entryLevel)}
                disabled={busy}
                options={ENTRY_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
                onValueChange={(next) => {
                  const value = Number(next);
                  if (value === 100 || value === 200 || value === 300) void save(() => updateStudentEntryLevel(value));
                }}
              />
            </label>
            {busy ? <LoaderCircle className="course-spin" size={16} aria-hidden="true" /> : null}
            <button className="text-button" type="button" onClick={() => setEditing(false)} disabled={busy}>Done</button>
          </div>
        ) : profile.matricRecognized ? (
          <button className="text-button student-level-change" type="button" onClick={() => setEditing(true)}>
            <Pencil size={13} aria-hidden="true" /> Change department or entry route
          </button>
        ) : null}
        {editing && !profile.departmentId ? (
          <p className="student-level-meta">Choose your department so your level uses the right programme length (for example, 5 years for engineering).</p>
        ) : null}
        {error ? <p className="account-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

/** "Department of Civil Engineering" reads as "Civil Engineering" in the picker, so long names fit on phones. */
function departmentLabel(name: string): string {
  return name.replace(/^department of\s+/i, '');
}
