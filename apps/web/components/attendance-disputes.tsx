'use client';

import { ATTENDANCE_DISPUTE_WINDOW_DAYS } from '@lasuatos/contracts';
import type {
  AttendanceDisputeKind,
  AttendanceDisputeStatus,
  LecturerAttendanceDispute,
  StudentAttendanceDisputes,
} from '@lasuatos/contracts';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MessageSquareWarning,
  RefreshCw,
  ShieldAlert,
  Undo2,
  UserCheck,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  DISPUTES_CHANGED_EVENT,
  loadLecturerAttendanceDisputes,
  loadStudentAttendanceDisputes,
  resolveAttendanceDispute,
  submitAttendanceDispute,
  withdrawAttendanceDispute,
  type LecturerDisputeFilter,
} from '../lib/attendance-api';
import { loadLecturerOfferings } from '../lib/course-api';


const STATEMENT_MIN = 20;
const STATEMENT_MAX = 1000;
const NOTE_MIN = 10;
const NOTE_MAX = 500;

const dateTimeFormat = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

function formatTimestamp(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Check your connection and try again.';
}

const KIND_LABEL: Record<AttendanceDisputeKind, string> = {
  missing_check_in: 'No check-in recorded',
  revoked_check_in: 'Check-in revoked by lecturer',
};

const STUDENT_STATUS: Record<AttendanceDisputeStatus, { readonly label: string; readonly tone: string }> = {
  open: { label: 'Waiting for your lecturer', tone: 'open' },
  upheld: { label: 'Upheld · recorded present', tone: 'upheld' },
  rejected: { label: 'Not upheld', tone: 'rejected' },
  withdrawn: { label: 'Withdrawn', tone: 'withdrawn' },
};

const LECTURER_STATUS: Record<AttendanceDisputeStatus, string> = {
  open: 'Awaiting your decision',
  upheld: 'Upheld',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn by student',
};

type DisputableSession = StudentAttendanceDisputes['disputableSessions'][number];

/**
 * Student-facing panel on My attendance: lists sessions the student may
 * dispute (missing or revoked check-ins within the window) and their own
 * disputes with the lecturer's decision. A statement is a request for human
 * review; it is never treated as evidence of presence.
 */
export function StudentDisputePanel() {
  const [data, setData] = useState<StudentAttendanceDisputes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [drafting, setDrafting] = useState<DisputableSession | null>(null);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState('');

  const refresh = useCallback(async () => {
    try {
      setData(await loadStudentAttendanceDisputes());
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStudentAttendanceDisputes(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const openCount = data?.disputes.filter((dispute) => dispute.status === 'open').length ?? 0;
  const atLimit = data ? openCount >= data.openLimit : false;

  function startDraft(session: DisputableSession) {
    setDrafting(session);
    setStatement('');
    setError('');
    setMessage('');
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!drafting) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { dispute } = await submitAttendanceDispute({
        attendanceSessionId: drafting.attendanceSessionId,
        statement,
      });
      setMessage(`Your concern about ${dispute.courseCode} · ${dispute.sessionTitle} was sent to your lecturer.`);
      setDrafting(null);
      setStatement('');
      await refresh();
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(disputeId: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { dispute } = await withdrawAttendanceDispute(disputeId);
      setMessage(`You withdrew your concern about ${dispute.courseCode} · ${dispute.sessionTitle}.`);
      setConfirmWithdraw('');
      await refresh();
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const trimmedLength = statement.trim().length;

  return (
    <section className="attendance-panel dispute-panel" id="attendance-disputes" aria-labelledby="student-disputes-heading">
      <div className="attendance-panel-heading attendance-list-heading">
        <div>
          <p className="section-kicker">ATTENDANCE CONCERNS</p>
          <h2 id="student-disputes-heading">Something wrong with your record?</h2>
          <p>
            If you attended but no check-in was recorded, or your lecturer revoked a check-in you believe was valid, ask them to review it.
            {data ? ` You can raise a concern up to ${data.windowDays} days after a session ends and have up to ${data.openLimit} waiting at once.` : ''}
          </p>
        </div>
        <button
          className="course-refresh-button"
          type="button"
          onClick={() => { setLoading(true); setError(''); void refresh(); }}
          disabled={loading}
          aria-label="Refresh attendance concerns"
        >
          <RefreshCw className={loading ? 'course-spin' : ''} size={15} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {message ? <p className="course-alert course-alert-success" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}

      {loading && !data ? (
        <p className="student-open-empty"><LoaderCircle className="course-spin" size={16} aria-hidden="true" /> Loading your attendance concerns…</p>
      ) : data ? (
        <>
          <h3 className="dispute-subheading">Sessions you can raise a concern about</h3>
          {atLimit ? (
            <p className="dispute-note"><Clock3 size={14} aria-hidden="true" /> You have {openCount} concerns waiting for a decision. Wait for one to be decided, or withdraw one, before raising another.</p>
          ) : null}
          {data.disputableSessions.length ? (
            <ul className="dispute-list">
              {data.disputableSessions.map((session) => {
                const isDrafting = drafting?.attendanceSessionId === session.attendanceSessionId;
                return (
                  <li className={`dispute-item${isDrafting ? ' is-active' : ''}`} key={session.attendanceSessionId}>
                    <div className="dispute-item-topline">
                      <div>
                        <strong>{session.courseCode} · {session.sessionTitle}</strong>
                        <small>{session.courseTitle} · {formatTimestamp(session.startsAt)}</small>
                      </div>
                      <span className={`dispute-kind is-${session.kind}`}>{KIND_LABEL[session.kind]}</span>
                    </div>
                    {session.revocation ? (
                      <blockquote className="dispute-quote">
                        <span>Lecturer’s reason · {formatTimestamp(session.revocation.revokedAt)}</span>
                        {session.revocation.reason}
                      </blockquote>
                    ) : null}
                    {isDrafting ? (
                      <form className="dispute-form" onSubmit={submitDraft}>
                        <label className="report-reason">
                          <span>What happened? Your lecturer will read this.</span>
                          <textarea
                            value={statement}
                            onChange={(event) => setStatement(event.target.value)}
                            minLength={STATEMENT_MIN}
                            maxLength={STATEMENT_MAX}
                            rows={4}
                            required
                            autoFocus
                            placeholder={session.kind === 'revoked_check_in'
                              ? 'e.g. I was seated in the third row; my location was inaccurate because I was indoors.'
                              : 'e.g. I was in the lecture but my phone battery died before I could enter the code.'}
                          />
                          <small>{trimmedLength}/{STATEMENT_MAX} · at least {STATEMENT_MIN} characters · keep it factual; do not include passwords or medical details</small>
                        </label>
                        <div className="dispute-form-actions">
                          <button className="attendance-secondary-button" type="button" onClick={() => setDrafting(null)} disabled={busy}>
                            Cancel
                          </button>
                          <button className="button button-primary" type="submit" disabled={busy || trimmedLength < STATEMENT_MIN}>
                            {busy ? <LoaderCircle className="course-spin" size={15} aria-hidden="true" /> : <MessageSquareWarning size={15} aria-hidden="true" />}
                            {busy ? 'Sending' : 'Send to lecturer'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="dispute-item-footer">
                        <small>Raise by {formatTimestamp(session.disputeDeadline)}</small>
                        <button className="attendance-secondary-button" type="button" onClick={() => startDraft(session)} disabled={atLimit || busy}>
                          <MessageSquareWarning size={14} aria-hidden="true" /> Raise a concern
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="student-open-empty">Nothing to raise right now. Sessions you missed or had revoked appear here once check-in has closed, for {data.windowDays} days.</p>
          )}

          {data.disputes.length ? (
            <>
              <h3 className="dispute-subheading">Your concerns</h3>
              <ul className="dispute-list">
                {data.disputes.map((dispute) => {
                  const status = STUDENT_STATUS[dispute.status];
                  return (
                    <li className="dispute-item" key={dispute.id}>
                      <div className="dispute-item-topline">
                        <div>
                          <strong>{dispute.courseCode} · {dispute.sessionTitle}</strong>
                          <small>{KIND_LABEL[dispute.kind]} · raised {formatTimestamp(dispute.createdAt)}</small>
                        </div>
                        <span className={`dispute-status is-${status.tone}`}>{status.label}</span>
                      </div>
                      <blockquote className="dispute-quote"><span>You wrote</span>{dispute.statement}</blockquote>
                      {dispute.resolutionNote ? (
                        <blockquote className={`dispute-quote is-decision is-${dispute.status}`}>
                          <span>
                            {dispute.resolvedByName ?? 'Your lecturer'}
                            {dispute.resolvedAt ? ` · ${formatTimestamp(dispute.resolvedAt)}` : ''}
                          </span>
                          {dispute.resolutionNote}
                        </blockquote>
                      ) : null}
                      {dispute.status === 'withdrawn' && dispute.resolvedAt ? (
                        <small className="dispute-meta">Withdrawn {formatTimestamp(dispute.resolvedAt)}. You may raise it again while the window is open.</small>
                      ) : null}
                      {dispute.status === 'open' ? (
                        <div className="dispute-item-footer">
                          <small>Decisions are final once made. You can withdraw while it is waiting.</small>
                          {confirmWithdraw === dispute.id ? (
                            <span className="dispute-confirm">
                              <button className="attendance-secondary-button" type="button" onClick={() => setConfirmWithdraw('')} disabled={busy}>Keep it</button>
                              <button className="button report-danger-button" type="button" onClick={() => void withdraw(dispute.id)} disabled={busy}>
                                {busy ? <LoaderCircle className="course-spin" size={14} aria-hidden="true" /> : <Undo2 size={14} aria-hidden="true" />} Confirm withdraw
                              </button>
                            </span>
                          ) : (
                            <button className="report-link-button" type="button" onClick={() => setConfirmWithdraw(dispute.id)} disabled={busy}>
                              <Undo2 size={13} aria-hidden="true" /> Withdraw
                            </button>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function currentRecordLine(dispute: LecturerAttendanceDispute): string {
  const record = dispute.record;
  if (!record) return 'No check-in recorded for this session.';
  if (record.status === 'revoked') {
    return `Check-in at ${formatTimestamp(record.checkedInAt)} was revoked${record.revokedAt ? ` on ${formatTimestamp(record.revokedAt)}` : ''}.`;
  }
  const how = record.method === 'manual'
    ? 'recorded by a lecturer'
    : record.venueOutcome === 'within_boundary'
      ? 'location within the venue boundary'
      : record.venueOutcome === 'inconclusive'
        ? 'location inconclusive'
        : 'no venue check';
  return `Present since ${formatTimestamp(record.checkedInAt)} (${how}).`;
}

function DisputeCard({
  dispute,
  busy,
  onResolve,
}: {
  readonly dispute: LecturerAttendanceDispute;
  readonly busy: boolean;
  readonly onResolve: (dispute: LecturerAttendanceDispute, decision: 'uphold' | 'reject', note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<'uphold' | 'reject' | null>(null);
  const trimmed = note.trim().length;
  const enrolled = dispute.student.enrollmentStatus === 'active';
  const alreadyPresent = dispute.record?.status === 'present';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Two submit buttons share this form; the one pressed carries the decision.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const value = submitter instanceof HTMLButtonElement ? submitter.value : '';
    if (value !== 'uphold' && value !== 'reject') return;
    setDecision(value);
    if (await onResolve(dispute, value, note)) {
      setNote('');
      setDecision(null);
    }
  }

  return (
    <li className={`dispute-item dispute-card is-${dispute.status}`}>
      <div className="dispute-item-topline">
        <div>
          <strong>{dispute.student.displayName}</strong>
          <small>
            {dispute.student.studentNumber}
            {dispute.student.studentNumberVerified ? '' : ' (self-reported)'}
            {' · '}{dispute.courseCode} · {dispute.sessionTitle} · {formatTimestamp(dispute.sessionStartsAt)}
            {dispute.venueName ? ` · ${dispute.venueName}` : ''}
          </small>
        </div>
        <span className={`dispute-kind is-${dispute.kind}`}>{KIND_LABEL[dispute.kind]}</span>
      </div>

      <blockquote className="dispute-quote">
        <span>Student’s statement · {formatTimestamp(dispute.createdAt)}</span>
        {dispute.statement}
      </blockquote>

      <div className="dispute-record">
        <p><strong>Current record:</strong> {currentRecordLine(dispute)}</p>
        {dispute.lastCorrection ? (
          <p>
            <strong>Last correction:</strong> {dispute.lastCorrection.actorName}{' '}
            {dispute.lastCorrection.action === 'revoke' ? 'revoked' : 'recorded present'} on {formatTimestamp(dispute.lastCorrection.createdAt)} — “{dispute.lastCorrection.reason}”
          </p>
        ) : null}
        {!enrolled ? (
          <p className="dispute-warning"><AlertTriangle size={13} aria-hidden="true" /> This student is no longer actively enrolled, so they cannot be recorded present. You can still reject with an explanation.</p>
        ) : null}
      </div>

      {dispute.status === 'open' ? (
        <form className="dispute-form" onSubmit={submit}>
          <label className="report-reason">
            <span>Decision note (shown to the student; when upholding it is also the audited correction reason)</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              minLength={NOTE_MIN}
              maxLength={NOTE_MAX}
              rows={3}
              required
              placeholder="e.g. I saw you in the second row; recording you present."
            />
            <small>{trimmed}/{NOTE_MAX} · at least {NOTE_MIN} characters</small>
          </label>
          <div className="dispute-form-actions">
            <button
              className="button report-danger-button"
              type="submit"
              name="decision"
              value="reject"
              disabled={busy || trimmed < NOTE_MIN}
            >
              {busy && decision === 'reject' ? <LoaderCircle className="course-spin" size={15} aria-hidden="true" /> : <UserX size={15} aria-hidden="true" />}
              Reject
            </button>
            <button
              className="button button-primary"
              type="submit"
              name="decision"
              value="uphold"
              disabled={busy || trimmed < NOTE_MIN || !enrolled}
            >
              {busy && decision === 'uphold' ? <LoaderCircle className="course-spin" size={15} aria-hidden="true" /> : <UserCheck size={15} aria-hidden="true" />}
              {alreadyPresent ? 'Uphold (already present)' : 'Uphold & record present'}
            </button>
          </div>
        </form>
      ) : (
        <div className="dispute-outcome">
          <span className={`dispute-status is-${dispute.status}`}>
            {dispute.status === 'upheld' ? <CheckCircle2 size={13} aria-hidden="true" /> : dispute.status === 'rejected' ? <XCircle size={13} aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}
            {LECTURER_STATUS[dispute.status]}
          </span>
          {dispute.resolutionNote ? (
            <blockquote className={`dispute-quote is-decision is-${dispute.status}`}>
              <span>{dispute.resolvedByName ?? 'Lecturer'}{dispute.resolvedAt ? ` · ${formatTimestamp(dispute.resolvedAt)}` : ''}</span>
              {dispute.resolutionNote}
            </blockquote>
          ) : dispute.resolvedAt ? (
            <small className="dispute-meta">{formatTimestamp(dispute.resolvedAt)}</small>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * Lecturer review queue for disputes in assigned course offerings. Upholding
 * records the student present through an audited correction; rejecting keeps
 * the record as it stands. Both decisions are final.
 */
export function LecturerDisputeWorkspace() {
  const searchParams = useSearchParams();
  const initialOffering = searchParams.get('courseOfferingId') ?? '';
  const [filter, setFilter] = useState<LecturerDisputeFilter>('open');
  const [offeringId, setOfferingId] = useState(initialOffering);
  const [offerings, setOfferings] = useState<Awaited<ReturnType<typeof loadLecturerOfferings>>['offerings']>([]);
  const [disputes, setDisputes] = useState<LecturerAttendanceDispute[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchQueue = useCallback(async (status: LecturerDisputeFilter, courseOfferingId: string, signal?: AbortSignal) => {
    try {
      const result = await loadLecturerAttendanceDisputes(
        { status, ...(courseOfferingId ? { courseOfferingId } : {}) },
        signal,
      );
      if (signal?.aborted) return;
      setDisputes(result.disputes);
      setOpenCount(result.openCount);
    } catch (caught) {
      if (!signal?.aborted) setError(failureMessage(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLecturerOfferings(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setOfferings(result.offerings);
      })
      .catch(() => {
        // The course filter is optional; the queue still loads without it.
      });
    void loadLecturerAttendanceDisputes(
      { status: 'open', ...(initialOffering ? { courseOfferingId: initialOffering } : {}) },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setDisputes(result.disputes);
        setOpenCount(result.openCount);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [initialOffering]);

  function reload(status: LecturerDisputeFilter, courseOfferingId: string) {
    setLoading(true);
    setError('');
    void fetchQueue(status, courseOfferingId);
  }

  function changeFilter(next: LecturerDisputeFilter) {
    setFilter(next);
    setMessage('');
    reload(next, offeringId);
  }

  function changeOffering(next: string) {
    setOfferingId(next);
    setMessage('');
    reload(filter, next);
  }

  async function resolve(dispute: LecturerAttendanceDispute, decision: 'uphold' | 'reject', note: string): Promise<boolean> {
    setBusyId(dispute.id);
    setError('');
    setMessage('');
    try {
      const result = await resolveAttendanceDispute(dispute.id, { decision, note });
      const who = `${dispute.student.displayName} · ${dispute.courseCode} ${dispute.sessionTitle}`;
      setMessage(decision === 'reject'
        ? `Rejected the dispute from ${who}. The student can see your note.`
        : result.correction === 'applied'
          ? `Upheld the dispute from ${who} and recorded them present. The correction is in the session’s audit trail.`
          : `Upheld the dispute from ${who}. They were already recorded present, so no correction was needed.`);
      setDisputes((current) => current
        ? filter === 'open'
          ? current.filter((entry) => entry.id !== dispute.id)
          : current.map((entry) => (entry.id === dispute.id ? result.dispute : entry))
        : current);
      setOpenCount((count) => Math.max(0, count - 1));
      window.dispatchEvent(new Event(DISPUTES_CHANGED_EVENT));
      return true;
    } catch (caught) {
      setError(failureMessage(caught));
      // Another lecturer may have decided it, or the student withdrew; resync.
      void fetchQueue(filter, offeringId);
      return false;
    } finally {
      setBusyId('');
    }
  }

  const offeringOptions = useMemo(
    () => [...offerings].sort((left, right) => left.courseCode.localeCompare(right.courseCode)),
    [offerings],
  );

  return (
    <div className="report-workspace">
      <section className="attendance-notice" aria-label="How dispute decisions work">
        <ShieldAlert size={18} aria-hidden="true" />
        <p>
          A dispute is the student’s own account and is not evidence by itself. Use what you know about the session — your own recollection, the class, or location evidence — and decide fairly.
          Upholding records the student present with your note as the audited correction reason. Rejecting keeps the record as it stands. Decisions are final and visible to the student.
        </p>
      </section>

      <section className="report-toolbar attendance-panel" aria-label="Dispute filters">
        <div className="dispute-tabs" role="tablist" aria-label="Dispute status">
          {([
            ['open', `Open${openCount ? ` (${openCount})` : ''}`],
            ['resolved', 'Decided'],
            ['all', 'All'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={`dispute-tab${filter === value ? ' is-active' : ''}`}
              onClick={() => changeFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          <span>Course offering</span>
          <select value={offeringId} onChange={(event) => changeOffering(event.target.value)}>
            <option value="">All my courses</option>
            {offeringOptions.map((offering) => (
              <option key={offering.courseOfferingId} value={offering.courseOfferingId}>
                {offering.courseCode} · {offering.courseTitle}
              </option>
            ))}
          </select>
        </label>
        <div className="report-toolbar-actions">
          <button className="course-refresh-button" type="button" onClick={() => reload(filter, offeringId)} disabled={loading}>
            <RefreshCw className={loading ? 'course-spin' : ''} size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
      </section>

      {error ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {message ? <p className="course-alert course-alert-success" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}

      <section className="attendance-panel dispute-panel" aria-labelledby="lecturer-disputes-heading" aria-busy={loading}>
        <div className="attendance-panel-heading attendance-list-heading">
          <div>
            <p className="section-kicker">REVIEW QUEUE</p>
            <h2 id="lecturer-disputes-heading">
              {filter === 'open' ? 'Waiting for a decision' : filter === 'resolved' ? 'Decided disputes' : 'All disputes'}
            </h2>
            <p>{filter === 'open' ? 'Oldest first, so nobody waits longest.' : 'Most recent decisions first.'}</p>
          </div>
        </div>
        {loading && !disputes ? (
          <p className="student-open-empty"><LoaderCircle className="course-spin" size={16} aria-hidden="true" /> Loading disputes…</p>
        ) : disputes?.length ? (
          <ul className="dispute-list">
            {disputes.map((dispute) => (
              <DisputeCard key={dispute.id} dispute={dispute} busy={busyId === dispute.id} onResolve={resolve} />
            ))}
          </ul>
        ) : (
          <div className="course-empty-state">
            {filter === 'open' ? <CheckCircle2 size={21} aria-hidden="true" /> : <X size={21} aria-hidden="true" />}
            <p>{filter === 'open' ? `No disputes are waiting for you. Students can raise one for up to ${ATTENDANCE_DISPUTE_WINDOW_DAYS} days after a session ends.` : 'No disputes match these filters.'}</p>
          </div>
        )}
      </section>
    </div>
  );
}
