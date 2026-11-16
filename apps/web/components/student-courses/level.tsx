'use client';

import type { StudentAcademicProfile, StudentDepartmentOptions } from '@lasuatos/contracts';
import { BadgeCheck, ChevronRight, GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { loadStudentAcademicProfile, loadStudentDepartmentOptions, updateStudentDepartment, updateStudentEntryLevel } from '../../lib/course-api';
import { departmentOptions } from '../../lib/department-options';
import { primeResource, useResource } from '../../lib/resource';
import { Badge, Button, Sheet } from '../ds';
import { Select } from '../ui/select';

const PROFILE_KEY = 'student:academic-profile';
const DEPARTMENTS_KEY = 'student:department-options';

const ENTRY_OPTIONS = [
  { value: '100', label: '100 Level · UTME' },
  { value: '200', label: '200 Level · Direct Entry' },
  { value: '300', label: '300 Level · Direct Entry' },
];

// The level is a convenience: without it the page still works, so a failure shows nothing.
const loadProfile = (signal: AbortSignal) => loadStudentAcademicProfile(signal).catch((caught: unknown) => {
  if (caught instanceof DOMException) throw caught;
  return null;
});
const loadDepartments = (signal: AbortSignal): Promise<StudentDepartmentOptions['departments']> => loadStudentDepartmentOptions(signal)
  .then((result) => result.departments)
  .catch((caught: unknown) => {
    if (caught instanceof DOMException) throw caught;
    return [];
  });

/** How the level was worked out, in one paragraph. */
export function levelExplanation(profile: StudentAcademicProfile): string {
  if (profile.levelStatus === 'unknown') {
    return 'Your level could not be read from your matric number. LASU matric numbers have 9 digits and start with your entry year (for example 24… for 2024). Your attendance is recorded either way.';
  }
  const entryYear = profile.entryYear ?? 0;
  if (profile.levelStatus === 'not_started') {
    return `Your matric number shows an entry year of ${entryYear}/${entryYear + 1}, which is after the current ${profile.sessionLabel} session. Your attendance is recorded either way.`;
  }
  const entry = profile.entryLevel === 100 ? 'entered at 100 Level' : `entered by Direct Entry at ${profile.entryLevel} Level`;
  const year = profile.yearOfStudy === 1 ? 'your first year' : `year ${profile.yearOfStudy} of study`;
  const extra = profile.levelStatus === 'extra_year' ? ` That is past the ${profile.programmeYears}-year programme, so it shows as an extra year.` : '';
  return `From your matric number: you joined in ${entryYear}/${entryYear + 1} and ${entry}, so ${profile.sessionLabel} is ${year}.${extra}`;
}

function failure(caught: unknown): string {
  return caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string' && caught.message
    ? caught.message
    : 'The change was not saved. Try again.';
}

/**
 * The student's level, read from the entry year in the matric number. How they entered
 * (UTME or Direct Entry) and their department (which sets the programme length) are
 * changed in a sheet.
 */
export function LevelCard() {
  const profile = useResource(PROFILE_KEY, loadProfile, { maxAge: 60_000 });
  const [open, setOpen] = useState(false);
  const data = profile.data;
  if (!data) return null;
  const needsDepartment = !data.departmentId && data.matricRecognized;

  return (
    <section className="ds-section" aria-labelledby="stc-level-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="stc-level-title">Your level</h2>
        <span className="ds-section-aside">{data.sessionLabel} session</span>
      </div>
      <div className="ds-card stc-level">
        <div className="stc-level-top">
          <span className="stc-level-icon" aria-hidden="true"><GraduationCap size={22} strokeWidth={2} /></span>
          <p className="stc-level-label">{data.levelLabel}</p>
          {data.matricNumberVerified
            ? <Badge tone="success"><BadgeCheck size={13} strokeWidth={2.4} aria-hidden="true" /> Verified</Badge>
            : <Badge>Self-reported</Badge>}
        </div>
        <dl className="stc-facts">
          <div><dt>Matric no.</dt><dd className="ds-mono">{data.matricNumber}</dd></div>
          <div><dt>Department</dt><dd>{data.departmentName ?? <span className="stc-dim">Not chosen</span>}</dd></div>
          {data.departmentName ? <div><dt>Programme</dt><dd>{data.programmeYears} years</dd></div> : null}
        </dl>
        {data.matricRecognized ? (
          needsDepartment ? (
            <button className="stc-level-prompt" type="button" onClick={() => setOpen(true)}>
              <span>
                <strong>Choose your department</strong>
                <span>So your level uses the right programme length, e.g. 5 years for engineering.</span>
              </span>
              <ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : (
            <Button variant="plain" size="sm" className="stc-level-change" onClick={() => setOpen(true)}>Change department or entry route</Button>
          )
        ) : <p className="stc-level-note">{levelExplanation(data)}</p>}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Your level">
        {open ? <LevelForm profile={data} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </section>
  );
}

function LevelForm({ profile, onDone }: Readonly<{ profile: StudentAcademicProfile; onDone: () => void }>) {
  const departments = useResource(DEPARTMENTS_KEY, loadDepartments, { maxAge: 5 * 60_000 });
  const [busy, setBusy] = useState<'department' | 'entry' | null>(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  async function save(which: 'department' | 'entry', change: () => Promise<StudentAcademicProfile>) {
    setBusy(which);
    setError('');
    setSaved('');
    try {
      const next = await change();
      primeResource(PROFILE_KEY, next);
      setSaved(`Saved. You’re ${next.levelLabel}.`);
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stc-level-form">
      <p className="stc-level-why">{levelExplanation(profile)}</p>
      <label className="account-field">
        <span>Your department</span>
        <Select
          value={profile.departmentId ?? ''}
          disabled={busy !== null || !departments.data}
          placeholder={departments.data ? 'Choose your department' : 'Loading departments…'}
          options={departmentOptions(departments.data ?? [])}
          searchPlaceholder="Search departments…"
          onValueChange={(departmentId) => {
            if (departmentId && departmentId !== profile.departmentId) void save('department', () => updateStudentDepartment(departmentId));
          }}
        />
      </label>
      <label className="account-field">
        <span>How you entered LASU</span>
        <Select
          value={String(profile.entryLevel)}
          disabled={busy !== null}
          options={ENTRY_OPTIONS}
          onValueChange={(next) => {
            const value = Number(next);
            if ((value === 100 || value === 200 || value === 300) && value !== profile.entryLevel) void save('entry', () => updateStudentEntryLevel(value));
          }}
        />
      </label>
      <div aria-live="polite">
        {busy ? <p className="stc-level-status">Saving…</p> : null}
        {saved && !busy ? <p className="stc-level-status is-saved">{saved}</p> : null}
        {error ? <p className="stc-level-status is-error" role="alert">{error}</p> : null}
      </div>
      <Button size="lg" block onClick={onDone} disabled={busy !== null}>Done</Button>
    </div>
  );
}
