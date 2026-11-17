'use client';

import type { StudentAcademicProfile } from '@lasuatos/contracts';
import { BadgeCheck, GraduationCap, MessageCircleQuestion } from 'lucide-react';
import { loadStudentAcademicProfile } from '../../lib/course-api';
import { useResource } from '../../lib/resource';
import { Badge } from '../ds';

const PROFILE_KEY = 'student:academic-profile';

// The level is a convenience: without it the page still works, so a failure shows nothing.
const loadProfile = (signal: AbortSignal) => loadStudentAcademicProfile(signal).catch((caught: unknown) => {
  if (caught instanceof DOMException) throw caught;
  return null;
});

const ROLE_LABEL: Record<StudentAcademicProfile['classReps'][number]['role'], string> = {
  hoc: 'HOC',
  ahoc: 'Assistant HOC',
  ghoc: 'GHOC',
  aghoc: 'Assistant GHOC',
};

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

/** "Ada Obi (HOC) or Tunde Bello (Assistant HOC)". */
export function repNames(reps: StudentAcademicProfile['classReps']): string {
  const named = reps.map((rep) => `${rep.name} (${ROLE_LABEL[rep.role]})`);
  if (named.length <= 1) return named.join('');
  return `${named.slice(0, -1).join(', ')} or ${named.at(-1)}`;
}

/**
 * The student's level, read from the entry year in the matric number, and the record
 * behind it. The department and the entry route come from the class list, so the
 * student cannot change them here: the HOC corrects them there, and this updates.
 */
export function LevelCard() {
  const profile = useResource(PROFILE_KEY, loadProfile, { maxAge: 60_000 });
  const data = profile.data;
  if (!data) return null;
  const entry = data.entryLevel === 100 ? 'UTME · 100 Level' : `Direct entry · ${data.entryLevel} Level`;

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
          <div><dt>Department</dt><dd>{data.departmentName ?? <span className="stc-dim">Not set yet</span>}</dd></div>
          <div><dt>Entered by</dt><dd>{entry}</dd></div>
          {data.setLabel ? <div><dt>Class list</dt><dd>{data.setLabel}</dd></div> : null}
          {data.departmentName ? <div><dt>Programme</dt><dd>{data.programmeYears} years</dd></div> : null}
        </dl>
        {data.matricRecognized ? null : <p className="stc-level-note">{levelExplanation(data)}</p>}
        <div className="stc-level-ask">
          <span className="stc-level-ask-icon" aria-hidden="true"><MessageCircleQuestion size={18} strokeWidth={2.2} /></span>
          <p>
            {data.onClassList ? (
              <>
                <strong>Something wrong here?</strong>{' '}
                Your department and how you entered come from your class list.{' '}
                {data.classReps.length
                  ? <>Ask {repNames(data.classReps)} to correct it.</>
                  : <>Ask your department’s HOC to correct it.</>}{' '}
                It updates here straight away, and your attendance is kept.
              </>
            ) : (
              <>
                <strong>You’re not on a class list yet.</strong>{' '}
                Ask your department’s HOC to add you. Your department and level then come from it, and your attendance so far is kept.
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
