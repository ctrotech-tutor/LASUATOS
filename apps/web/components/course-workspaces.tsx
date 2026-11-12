'use client';

import { AlertTriangle, BookOpen, Check, Clipboard, Copy, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createCourseOffering,
  issueCourseJoinCode,
  loadLecturerOfferings,
  loadLecturerSemesters,
  loadStudentEnrollments,
  joinCourse,
  revokeCourseJoinCode,
} from '../lib/course-api';

const levels = ['100', '200', '300', '400', '500', '600', '700'] as const;

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error && error.status === 403) {
    return 'This account does not have access to this workspace. Sign in with the correct account or open its course workspace.';
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Check your connection and try again.';
}

function courseLabel(courseCode: string, courseTitle: string): string {
  return `${courseCode} · ${courseTitle}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date(value));
}

function formatJoinCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export function StudentCoursesWorkspace() {
  const [enrollments, setEnrollments] = useState<Awaited<ReturnType<typeof loadStudentEnrollments>>['enrollments']>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await loadStudentEnrollments(signal);
      if (!signal?.aborted) setEnrollments(result.enrollments);
    } catch (caught) {
      if (!signal?.aborted) setError(failureMessage(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStudentEnrollments(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setEnrollments(result.enrollments);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await joinCourse(String(form.get('code') ?? ''));
      setMessage(result.status === 'already_enrolled'
        ? `You are already enrolled in ${courseLabel(result.course.courseCode, result.course.courseTitle)}.`
        : `You joined ${courseLabel(result.course.courseCode, result.course.courseTitle)}.`);
      formElement.reset();
      await refresh();
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sx-stack">
      <section className="sx-section" aria-labelledby="student-courses-heading">
        <div className="sx-section-head">
          <h2 id="student-courses-heading">Enrolled courses</h2>
          <button className="sx-text-button" type="button" onClick={() => {
            setLoading(true);
            setError('');
            void refresh();
          }} disabled={loading} aria-label="Refresh course list">
            <RefreshCw className={loading ? 'course-spin' : ''} size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
        {error && !enrollments.length ? (
          <p className="sx-alert" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></p>
        ) : loading && !enrollments.length ? (
          <div className="sx-course-grid" aria-busy="true">
            <div className="skeleton-block sx-course-skeleton" />
            <div className="skeleton-block sx-course-skeleton" />
          </div>
        ) : enrollments.length ? (
          <ul className="sx-course-grid">
            {enrollments.map((enrollment) => (
              <li className="sx-course-card" key={enrollment.courseOfferingId}>
                <span className="sx-course-badge" aria-hidden="true">{enrollment.courseCode.replace(/\s*\d.*$/, '').slice(0, 3)}</span>
                <span className="sx-course-copy">
                  <strong>{enrollment.courseCode}</strong>
                  <span className="sx-course-title">{enrollment.courseTitle}</span>
                  <small>{enrollment.level} level · {enrollment.semesterName}</small>
                  <small>{enrollment.departmentName} · joined {formatDate(enrollment.enrolledAt)}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="sx-card sx-empty-courses">
            <span className="sx-empty-icon" aria-hidden="true"><BookOpen size={22} /></span>
            <h3>No courses yet</h3>
            <p>Ask your lecturer for the course code and enter it below. Your courses and lectures will appear here.</p>
          </div>
        )}
      </section>

      <section className="sx-section" aria-labelledby="join-course-heading">
        <div className="sx-section-head">
          <h2 id="join-course-heading">Join a course</h2>
        </div>
        <div className="sx-card sx-join">
          <form className="sx-join-form" onSubmit={submitJoin}>
            <label htmlFor="course-join-code">Course code from your lecturer</label>
            <div className="sx-code-row">
              <input
                id="course-join-code"
                name="code"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="7K9M-PQ2R-4XBD"
                maxLength={20}
                required
              />
              <button className="sx-primary-button" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="course-spin" size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
                {busy ? 'Joining' : 'Join'}
              </button>
            </div>
          </form>
          {error && enrollments.length ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
          {message ? <p className="course-alert course-alert-success" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}
          <p className="sx-join-note"><ShieldAlert size={14} aria-hidden="true" /> Joining enrolls you in the course. It does not mark you present.</p>
        </div>
      </section>
    </div>
  );
}

export function LecturerCoursesWorkspace() {
  const [semesters, setSemesters] = useState<Awaited<ReturnType<typeof loadLecturerSemesters>>['semesters']>([]);
  const [offerings, setOfferings] = useState<Awaited<ReturnType<typeof loadLecturerOfferings>>['offerings']>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeCode, setActiveCode] = useState<{ courseOfferingId: string; code: string; expiresAt: string; rotated: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [semesterResult, offeringResult] = await Promise.all([
        loadLecturerSemesters(signal),
        loadLecturerOfferings(signal),
      ]);
      if (!signal?.aborted) {
        setSemesters(semesterResult.semesters);
        setOfferings(offeringResult.offerings);
      }
    } catch (caught) {
      if (!signal?.aborted) setError(failureMessage(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      loadLecturerSemesters(controller.signal),
      loadLecturerOfferings(controller.signal),
    ])
      .then(([semesterResult, offeringResult]) => {
        if (!controller.signal.aborted) {
          setSemesters(semesterResult.semesters);
          setOfferings(offeringResult.offerings);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function submitOffering(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    setActiveCode(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await createCourseOffering({
        courseCode: form.get('courseCode'),
        courseTitle: form.get('courseTitle'),
        creditUnits: Number(form.get('creditUnits')),
        semesterId: form.get('semesterId'),
        level: form.get('level'),
      });
      setMessage(result.status === 'created' ? 'Course offering created and assigned to your account.' : 'This offering is already assigned to you.');
      if (result.status === 'created') formElement.reset();
      await refresh();
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleIssueCode(courseOfferingId: string) {
    setBusy(true);
    setError('');
    setMessage('');
    setActiveCode(null);
    try {
      const result = await issueCourseJoinCode(courseOfferingId);
      setActiveCode({ courseOfferingId, code: result.code, expiresAt: result.expiresAt, rotated: result.rotated });
      setMessage(result.rotated ? 'The previous code has been rotated. Share only the new code.' : 'A new enrollment code is ready to share.');
      await refresh();
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeCode(courseOfferingId: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await revokeCourseJoinCode(courseOfferingId);
      if (activeCode?.courseOfferingId === courseOfferingId) setActiveCode(null);
      setMessage('The enrollment code has been revoked.');
      await refresh();
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy automatically. Select the code and copy it manually.');
    }
  }

  return (
    <div className="lecturer-course-workspace">
      <section className="lecturer-course-layout">
        <div className="lecturer-form-card">
          <div className="course-section-heading">
            <div>
              <p className="section-kicker">NEW TEACHING OFFERING</p>
              <h2>Create a course</h2>
            </div>
            <span className="lecturer-scope-tag"><ShieldAlert size={13} aria-hidden="true" /> Your assigned department</span>
          </div>
          <p className="lecturer-form-intro">Your LASU lecturer profile sets your course scope. Create offerings only for your assigned department and an available semester.</p>
          {semesters.length ? (
            <form className="lecturer-course-form" onSubmit={submitOffering}>
              <label><span>Course code</span><input name="courseCode" placeholder="e.g. CSC-101" maxLength={32} required /></label>
              <label className="lecturer-course-form-wide"><span>Course title</span><input name="courseTitle" placeholder="Introduction to computing" maxLength={200} required /></label>
              <label><span>Credit units</span><input name="creditUnits" type="number" min={1} max={30} defaultValue={3} required /></label>
              <label><span>Academic level</span><select name="level" defaultValue="100">{levels.map((level) => <option key={level} value={level}>{level} level</option>)}</select></label>
              <label className="lecturer-course-form-wide"><span>Semester</span><select name="semesterId" defaultValue="" required><option value="" disabled>Select an available semester</option>{semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name} · ends {formatDate(semester.endsAt)}</option>)}</select></label>
              {error ? <p className="course-alert course-alert-error lecturer-course-form-wide" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
              {message ? <p className="course-alert course-alert-success lecturer-course-form-wide" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}
              <button className="lecturer-submit-button lecturer-course-form-wide" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="course-spin" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                {busy ? 'Saving course' : 'Create course offering'}
              </button>
            </form>
          ) : loading ? (
            <div className="course-inline-state"><LoaderCircle className="course-spin" size={18} aria-hidden="true" />Loading your available semesters…</div>
          ) : error ? (
            <div className="course-inline-state course-inline-error"><AlertTriangle size={18} aria-hidden="true" />{error}</div>
          ) : (
            <div className="course-inline-state"><BookOpen size={18} aria-hidden="true" /><span>No open semesters are available for your department. Ask your LASU administrator to configure the academic calendar.</span></div>
          )}
        </div>

        <aside className="lecturer-enrollment-note">
          <div className="course-card-icon course-card-icon-blue"><Clipboard size={18} aria-hidden="true" /></div>
          <p className="section-kicker">ENROLLMENT CODES</p>
          <h2>Keep enrollment codes in control</h2>
          <p>Each code is limited to one course offering, expires at semester end, and can be revoked or replaced at any time.</p>
          <div className="lecturer-note-rule" />
          <p className="lecturer-note-caption"><ShieldAlert size={15} aria-hidden="true" /> Students join from a LASUATOS student account using your current course code.</p>
        </aside>
      </section>

      {activeCode ? (
        <section className="join-code-reveal" aria-live="polite" aria-labelledby="issued-code-heading">
          <div className="join-code-reveal-icon"><KeyRound size={18} aria-hidden="true" /></div>
          <div className="join-code-reveal-copy">
            <p className="section-kicker">{activeCode.rotated ? 'ROTATED ENROLLMENT CODE' : 'NEW ENROLLMENT CODE'}</p>
            <h2 id="issued-code-heading">Share with students</h2>
            <p>{offerings.find((offering) => offering.courseOfferingId === activeCode.courseOfferingId)?.courseCode ?? 'Course'} · expires {formatDate(activeCode.expiresAt)}</p>
          </div>
          <code className="join-code-value">{formatJoinCode(activeCode.code)}</code>
          <button className="join-code-copy-button" type="button" onClick={() => void copyCode()}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy code'}
          </button>
          <button className="join-code-dismiss" type="button" aria-label="Hide code" onClick={() => setActiveCode(null)}><X size={17} aria-hidden="true" /></button>
          <p className="join-code-warning"><AlertTriangle size={15} aria-hidden="true" />This code is shown once. Store it securely; a new code will invalidate this one.</p>
        </section>
      ) : null}

      <section className="course-list-section lecturer-offerings-section" aria-labelledby="lecturer-offerings-heading">
        <div className="course-section-heading">
          <div>
            <p className="section-kicker">YOUR ASSIGNED TEACHING</p>
            <h2 id="lecturer-offerings-heading">Course offerings</h2>
          </div>
          <button className="course-refresh-button" type="button" onClick={() => {
            setLoading(true);
            setError('');
            void refresh();
          }} disabled={loading} aria-label="Refresh course offerings">
            <RefreshCw className={loading ? 'course-spin' : ''} size={16} aria-hidden="true" />Refresh
          </button>
        </div>
        {error && !offerings.length ? (
          <div className="course-empty-state course-empty-error"><AlertTriangle size={20} aria-hidden="true" /><p>{error}</p></div>
        ) : loading && !offerings.length ? (
          <div className="course-empty-state"><LoaderCircle className="course-spin" size={22} aria-hidden="true" /><p>Loading assigned offerings…</p></div>
        ) : offerings.length ? (
          <div className="lecturer-offering-list">
            {offerings.map((offering) => (
              <article className="lecturer-offering-card" key={offering.courseOfferingId}>
                <div className="lecturer-offering-main">
                  <div className="lecturer-offering-symbol"><BookOpen size={19} aria-hidden="true" /></div>
                  <div><p className="lecturer-offering-code">{offering.courseCode}<span>{offering.level} level</span></p><h3>{offering.courseTitle}</h3><p className="lecturer-offering-meta">{offering.departmentName} <i /> {offering.semesterName}</p></div>
                </div>
                <div className="lecturer-offering-status">
                  <span className={offering.joinCodeActive ? 'join-code-status is-active' : 'join-code-status'}><i />{offering.joinCodeActive ? 'Code active' : 'No active code'}</span>
                  <span className="lecturer-offering-expiry">Until {formatDate(offering.semesterEndsAt)}</span>
                </div>
                <div className="lecturer-offering-actions">
                  <button type="button" className="offering-code-button" onClick={() => void handleIssueCode(offering.courseOfferingId)} disabled={busy}>
                    {offering.joinCodeActive ? <RefreshCw size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
                    {offering.joinCodeActive ? 'Replace code' : 'Issue code'}
                  </button>
                  {offering.joinCodeActive ? <button type="button" className="offering-revoke-button" onClick={() => void handleRevokeCode(offering.courseOfferingId)} disabled={busy}>Revoke</button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="course-empty-state"><BookOpen size={22} aria-hidden="true" /><p>No course offerings are assigned to your account yet. Create one above or contact your department administrator.</p></div>
        )}
        {error && offerings.length ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      </section>
    </div>
  );
}
