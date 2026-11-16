'use client';

import type {
  AttendanceDisputeKind,
  AttendanceDisputeStatus,
  StudentAttendanceDisputes,
} from '@lasuatos/contracts';
import {
  AlertTriangle,
  Check,
  Clock3,
  LoaderCircle,
  MessageSquareWarning,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  loadStudentAttendanceDisputes,
  submitAttendanceDispute,
  withdrawAttendanceDispute,
} from '../lib/attendance-api';

const STATEMENT_MIN = 20;
const STATEMENT_MAX = 1000;

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
    <section className="sx-section dispute-panel student-dispute-panel" id="attendance-disputes" aria-labelledby="student-disputes-heading">
      <div className="sx-section-head">
        <h2 id="student-disputes-heading">Something wrong?</h2>
        {openCount ? <span className="sx-section-meta">{openCount} waiting</span> : null}
      </div>
      <p className="sx-section-lede">
        Attended but nothing was recorded, or a check-in was revoked unfairly? Ask your lecturer to review it
        {data ? ` within ${data.windowDays} days of the lecture.` : '.'}
      </p>

      {error ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {message ? <p className="course-alert course-alert-success" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}

      {loading && !data ? (
        <div className="skeleton-block sx-dispute-skeleton" />
      ) : data ? (
        <>
          {atLimit ? (
            <p className="dispute-note"><Clock3 size={14} aria-hidden="true" /> You have {openCount} concerns waiting for a decision. Wait for one to be decided, or withdraw one, before raising another.</p>
          ) : null}
          {data.disputableSessions.length ? (
            <ul className="dispute-list student-dispute-list">
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
            <p className="sx-card sx-empty-small sx-empty-check"><Check size={16} aria-hidden="true" /> All clear. Missed or revoked lectures show up here once check-in closes.</p>
          )}

          {data.disputes.length ? (
            <>
              <h3 className="dispute-subheading">Your concerns</h3>
              <ul className="dispute-list student-dispute-list">
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
