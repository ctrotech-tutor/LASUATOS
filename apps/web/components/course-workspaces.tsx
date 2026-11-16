'use client';

import { AlertTriangle, BookOpen, Check, Clipboard, Copy, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createCourseOffering,
  issueCourseJoinCode,
  loadLecturerOfferings,
  loadLecturerSemesters,
  revokeCourseJoinCode,
  updateCourseOffering,
} from '../lib/course-api';
import { Select } from './ui/select';
import { NumberField } from './ui/number-field';
import { Bone, CardGridSkeleton, SkeletonRegion } from './ui/skeleton';
import { EditButton, EditDialog, formText } from './ui/edit-dialog';
import { useFeedback } from './feedback';

type LecturerOffering = Awaited<ReturnType<typeof loadLecturerOfferings>>['offerings'][number];

const levels = ['100', '200', '300', '400', '500', '600', '700'] as const;

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error && error.status === 403) {
    return 'This account does not have access to this workspace. Sign in with the correct account or open its course workspace.';
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Check your connection and try again.';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date(value));
}

function formatJoinCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
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
  const [editingOffering, setEditingOffering] = useState<LecturerOffering | null>(null);
  const dialogs = useFeedback();

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
              <label><span>Credit units</span><NumberField name="creditUnits" min={1} max={30} defaultValue={3} required /></label>
              <label><span>Academic level</span><Select name="level" defaultValue="100" options={levels.map((level) => ({ value: String(level), label: `${level} level` }))} /></label>
              <label className="lecturer-course-form-wide"><span>Semester</span><Select name="semesterId" required placeholder="Select an available semester" options={semesters.map((semester) => ({ value: semester.id, label: semester.name, description: `Ends ${formatDate(semester.endsAt)}` }))} /></label>
              {error ? <p className="course-alert course-alert-error lecturer-course-form-wide" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
              {message ? <p className="course-alert course-alert-success lecturer-course-form-wide" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}
              <button className="lecturer-submit-button lecturer-course-form-wide" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="course-spin" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                {busy ? 'Saving course' : 'Create course offering'}
              </button>
            </form>
          ) : loading ? (
            <SkeletonRegion label="Loading your available semesters…" className="sk-form"><Bone className="sk-text" width="40%" /><Bone className="sk-button" /><Bone className="sk-button" /></SkeletonRegion>
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
          <CardGridSkeleton label="Loading assigned offerings…" count={3} />
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
                  <EditButton label={`Edit ${offering.courseCode}`} compact onClick={() => setEditingOffering(offering)} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="course-empty-state"><BookOpen size={22} aria-hidden="true" /><p>No course offerings are assigned to your account yet. Create one above or contact your department administrator.</p></div>
        )}
        {error && offerings.length ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      </section>
      {editingOffering ? (
        <EditOfferingDialog
          offering={editingOffering}
          sharedWith={offerings.filter((item) => item.courseCode === editingOffering.courseCode && item.courseOfferingId !== editingOffering.courseOfferingId).length}
          onClose={() => setEditingOffering(null)}
          onSaved={(updated) => {
            setEditingOffering(null);
            // The title and credits are shared by the code, so refresh every card for it.
            setOfferings((current) => current.map((item) => (
              item.courseOfferingId === updated.courseOfferingId
                ? updated
                : item.courseCode === updated.courseCode ? { ...item, courseTitle: updated.courseTitle, creditUnits: updated.creditUnits } : item
            )));
            dialogs.toast(`${updated.courseCode} was updated.`);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function EditOfferingDialog({
  offering,
  sharedWith,
  onClose,
  onSaved,
}: Readonly<{ offering: LecturerOffering; sharedWith: number; onClose: () => void; onSaved: (offering: LecturerOffering) => void }>) {
  const [level, setLevel] = useState(offering.level);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const levelOptions = (levels as readonly string[]).includes(offering.level) ? levels : [offering.level, ...levels];

  async function save(form: HTMLFormElement) {
    const courseTitle = formText(form, 'courseTitle').replace(/\s+/g, ' ');
    const creditUnits = Number(formText(form, 'creditUnits'));
    const changes = {
      ...(courseTitle !== offering.courseTitle ? { courseTitle } : {}),
      ...(creditUnits !== offering.creditUnits ? { creditUnits } : {}),
      ...(level !== offering.level ? { level } : {}),
    };
    if (!Object.keys(changes).length) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await updateCourseOffering(offering.courseOfferingId, changes);
      onSaved(result.offering);
    } catch (caught) {
      setError(failureMessage(caught));
      setBusy(false);
    }
  }

  return (
    <EditDialog
      title={`Edit ${offering.courseCode}`}
      description={(
        <>
          {offering.departmentName} · {offering.semesterName}. The course title and credit units belong to {offering.courseCode}, so a change
          shows on every offering of the code{sharedWith ? `, including ${sharedWith} other${sharedWith === 1 ? '' : 's'} of yours` : ''}. The level is this offering&apos;s own.
        </>
      )}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      <label className="account-field">
        <span>Course title</span>
        <input name="courseTitle" defaultValue={offering.courseTitle} required maxLength={200} />
      </label>
      <div className="ui-edit-row">
        <label className="account-field">
          <span>Credit units</span>
          <NumberField name="creditUnits" defaultValue={offering.creditUnits || ''} min={1} max={30} step={1} required />
        </label>
        <label className="account-field">
          <span>Level</span>
          <Select value={level} onValueChange={setLevel} options={levelOptions.map((value) => ({ value, label: `${value} level` }))} />
        </label>
      </div>
    </EditDialog>
  );
}
