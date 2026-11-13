'use client';

import type {
  AttendanceCorrectionEntry,
  AttendanceReport,
  AttendanceReportCell,
} from '@lasuatos/contracts';
import {
  AlertTriangle,
  BarChart3,
  Check,
  ClipboardList,
  Download,
  History,
  LoaderCircle,
  MessageSquareWarning,
  RefreshCw,
  ShieldAlert,
  UndoDot,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  applyAttendanceCorrection,
  loadAttendanceCorrections,
  loadOfferingAttendanceReport,
  offeringAttendanceReportCsvUrl,
} from '../lib/attendance-api';
import { loadLecturerOfferings } from '../lib/course-api';
import { Select } from './ui/select';
import { SearchField } from './ui/search-field';
import { ListSkeleton, ManagementSkeleton, TableSkeleton } from './ui/skeleton';

const THRESHOLDS = [50, 60, 70, 75, 80, 90] as const;

const CELL_META: Record<AttendanceReportCell, { readonly glyph: string; readonly label: string; readonly attended: boolean }> = {
  within_boundary: { glyph: '✓', label: 'Present · within venue boundary', attended: true },
  inconclusive: { glyph: '?', label: 'Present · location inconclusive', attended: true },
  unlocated: { glyph: '•', label: 'Present · no venue check', attended: true },
  manual: { glyph: 'M', label: 'Present · recorded by lecturer', attended: true },
  revoked: { glyph: '×', label: 'Revoked by lecturer', attended: false },
  absent: { glyph: '', label: 'Absent', attended: false },
  not_enrolled: { glyph: '–', label: 'Not yet enrolled', attended: false },
};

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Check your connection and try again.';
}

const dateFormat = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' });
const dateTimeFormat = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
const shortDate = new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', timeZone: 'Africa/Lagos' });

function formatRate(rate: number | null): string {
  return rate == null ? '—' : `${rate.toFixed(rate % 1 === 0 ? 0 : 1)}%`;
}

function rateTone(rate: number | null, threshold: number): 'good' | 'warn' | 'low' | 'none' {
  if (rate == null) return 'none';
  if (rate >= threshold) return 'good';
  if (rate >= threshold - 15) return 'warn';
  return 'low';
}

interface Selection {
  readonly studentId: string;
  readonly sessionId: string;
}

export function AttendanceReportWorkspace() {
  const [offerings, setOfferings] = useState<Awaited<ReturnType<typeof loadLecturerOfferings>>['offerings']>([]);
  const [offeringId, setOfferingId] = useState('');
  const [threshold, setThreshold] = useState<number>(75);
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [belowOnly, setBelowOnly] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [auditSessionId, setAuditSessionId] = useState('');
  const [audit, setAudit] = useState<AttendanceCorrectionEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadLecturerOfferings(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setOfferings(result.offerings);
        setOfferingId((current) => current || result.offerings[0]?.courseOfferingId || '');
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingOfferings(false);
      });
    return () => controller.abort();
  }, []);

  // Fetches the report for the current controls. Only called from event
  // handlers; the effect below performs the automatic load when controls change.
  const loadReport = useCallback(async () => {
    if (!offeringId) return;
    setLoadingReport(true);
    try {
      setReport(await loadOfferingAttendanceReport(offeringId, threshold));
      setError('');
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setLoadingReport(false);
    }
  }, [offeringId, threshold]);

  useEffect(() => {
    if (!offeringId) return undefined;
    const controller = new AbortController();
    void loadOfferingAttendanceReport(offeringId, threshold, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setReport(result);
        setError('');
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingReport(false);
      });
    return () => controller.abort();
  }, [offeringId, threshold]);

  function changeOffering(nextOfferingId: string) {
    setOfferingId(nextOfferingId);
    setReport(null);
    setSelection(null);
    setReason('');
    setAudit(null);
    setAuditSessionId('');
    setLoadingReport(true);
  }

  function changeThreshold(nextThreshold: number) {
    setThreshold(nextThreshold);
    setLoadingReport(true);
  }

  const loadAudit = useCallback(async (sessionId: string) => {
    setAuditSessionId(sessionId);
    setAuditLoading(true);
    try {
      const result = await loadAttendanceCorrections(sessionId);
      setAudit(result.corrections);
    } catch (caught) {
      setError(failureMessage(caught));
      setAudit(null);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selection) reasonRef.current?.focus();
  }, [selection]);

  const visibleStudents = useMemo(() => {
    if (!report) return [];
    const needle = query.trim().toLowerCase();
    return report.students.filter((student) => {
      if (belowOnly && !student.belowThreshold) return false;
      if (!needle) return true;
      return student.displayName.toLowerCase().includes(needle) || student.studentNumber.toLowerCase().includes(needle);
    });
  }, [report, query, belowOnly]);

  const selected = useMemo(() => {
    if (!report || !selection) return null;
    const studentIndex = report.students.findIndex((student) => student.studentId === selection.studentId);
    const sessionIndex = report.sessions.findIndex((session) => session.id === selection.sessionId);
    const student = report.students[studentIndex];
    const session = report.sessions[sessionIndex];
    if (!student || !session) return null;
    const cell = student.cells[sessionIndex] ?? 'absent';
    return { student, session, cell };
  }, [report, selection]);

  const correctionAction = selected
    ? CELL_META[selected.cell].attended
      ? 'revoke' as const
      : selected.cell === 'absent' || selected.cell === 'revoked'
        ? 'mark_present' as const
        : null
    : null;
  const canMarkPresent = selected?.student.enrollmentStatus === 'active';

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !correctionAction) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await applyAttendanceCorrection(selected.session.id, {
        studentId: selected.student.studentId,
        action: correctionAction,
        reason,
      });
      setMessage(result.status === 'unchanged'
        ? 'No change was needed — the record was already in that state.'
        : correctionAction === 'revoke'
          ? `${selected.student.displayName}'s check-in for “${selected.session.title}” was revoked and logged.`
          : `${selected.student.displayName} was recorded present for “${selected.session.title}” and the change was logged.`);
      setSelection(null);
      setReason('');
      await loadReport();
      if (auditSessionId === selected.session.id) await loadAudit(selected.session.id);
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loadingOfferings) {
    return <ManagementSkeleton label="Loading your assigned courses…" rows={3} withScope={false} />;
  }
  if (!offerings.length) {
    return (
      <div className="course-empty-state">
        <ClipboardList size={21} aria-hidden="true" />
        <p>Reports appear once you have an assigned course offering with attendance sessions.</p>
      </div>
    );
  }

  const totals = report?.totals;
  const auditSession = report?.sessions.find((session) => session.id === auditSessionId);

  return (
    <div className="report-workspace">
      <section className="attendance-notice" aria-label="How to read this report">
        <ShieldAlert size={18} aria-hidden="true" />
        <p>
          <strong>Rates count code, QR and lecturer-recorded check-ins.</strong> Sessions held before a student enrolled are not counted against them,
          revoked check-ins never count, and the threshold only flags students for follow-up — it is a planning aid, not an official LASU eligibility rule.
          Student numbers are self-reported unless marked verified.
        </p>
      </section>

      <section className="report-toolbar attendance-panel" aria-label="Report controls">
        <label>
          <span>Course offering</span>
          <Select
            size="sm"
            value={offeringId}
            onValueChange={changeOffering}
            options={offerings.map((offering) => ({ value: offering.courseOfferingId, label: offering.courseCode, description: offering.courseTitle }))}
          />
        </label>
        <label>
          <span>Follow-up threshold</span>
          <Select
            size="sm"
            value={String(threshold)}
            onValueChange={(next) => changeThreshold(Number(next))}
            options={THRESHOLDS.map((value) => ({ value: String(value), label: `${value}% attendance` }))}
          />
        </label>
        <div className="report-toolbar-actions">
          <button className="course-refresh-button" type="button" onClick={() => void loadReport()} disabled={loadingReport}>
            <RefreshCw className={loadingReport ? 'course-spin' : ''} size={15} aria-hidden="true" /> Refresh
          </button>
          <a className="button button-primary report-download" href={offeringAttendanceReportCsvUrl(offeringId, threshold)} download>
            <Download size={15} aria-hidden="true" /> Download CSV
          </a>
        </div>
      </section>

      {error ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {message ? <p className="course-alert course-alert-success" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}

      {!report ? (
        <TableSkeleton label="Building the attendance report…" rows={6} columns={5} />
      ) : (
        <>
          <section className="report-summary-grid" aria-label="Report summary">
            <article className="report-summary-card">
              <span>Sessions held</span>
              <strong>{totals?.sessionsHeld ?? 0}</strong>
              <p>{report.offering.semesterLabel}</p>
            </article>
            <article className="report-summary-card">
              <span>Active students</span>
              <strong>{totals?.activeStudents ?? 0}</strong>
              <p>{report.offering.departmentName}</p>
            </article>
            <article className={`report-summary-card is-${rateTone(totals?.averageRate ?? null, report.threshold)}`}>
              <span>Overall attendance</span>
              <strong>{formatRate(totals?.averageRate ?? null)}</strong>
              <p>Across eligible sessions</p>
            </article>
            <article className={`report-summary-card${(totals?.studentsBelowThreshold ?? 0) > 0 ? ' is-low' : ''}`}>
              <span>Below {report.threshold}%</span>
              <strong>{totals?.studentsBelowThreshold ?? 0}</strong>
              <p>Active students to follow up</p>
            </article>
            <article className="report-summary-card report-evidence-card">
              <span>Evidence mix</span>
              <ul>
                <li><i className="report-swatch is-inconclusive" aria-hidden="true" />{totals?.inconclusiveRecords ?? 0} inconclusive</li>
                <li><i className="report-swatch is-manual" aria-hidden="true" />{totals?.manualRecords ?? 0} lecturer-recorded</li>
                <li><i className="report-swatch is-revoked" aria-hidden="true" />{totals?.revokedRecords ?? 0} revoked</li>
              </ul>
              <p>{totals?.presentRecords ?? 0} present records in total</p>
            </article>
          </section>

          {(totals?.openDisputes ?? 0) > 0 ? (
            <p className="report-dispute-callout" role="status">
              <MessageSquareWarning size={17} aria-hidden="true" />
              <span>
                <strong>{totals?.openDisputes} open attendance dispute{totals?.openDisputes === 1 ? '' : 's'}</strong>
                {' '}from students in this course {totals?.openDisputes === 1 ? 'is' : 'are'} waiting for your decision. The register reflects records as they stand until you decide.
              </span>
              <Link className="report-link-button" href={`/lecturer/disputes?courseOfferingId=${encodeURIComponent(report.offering.id)}`}>
                Review disputes
              </Link>
            </p>
          ) : null}

          {report.sessions.length ? (
            <section className="attendance-panel report-sessions-panel" aria-labelledby="report-sessions-heading">
              <div className="attendance-panel-heading attendance-list-heading">
                <div>
                  <p className="section-kicker">SESSION BREAKDOWN</p>
                  <h2 id="report-sessions-heading">Attendance by session</h2>
                </div>
              </div>
              <div className="report-table-wrap">
                <table className="report-sessions-table responsive-table">
                  <thead>
                    <tr>
                      <th scope="col">Session</th>
                      <th scope="col">Venue</th>
                      <th scope="col">Present / expected</th>
                      <th scope="col">Rate</th>
                      <th scope="col">Evidence</th>
                      <th scope="col"><span className="sr-only">Audit trail</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.sessions].reverse().map((session) => (
                      <tr key={session.id}>
                        <td data-label="Session">
                          <strong>{session.title}</strong>
                          <span>{dateTimeFormat.format(new Date(session.startsAt))} · {session.status}</span>
                        </td>
                        <td data-label="Venue">{session.venueName ?? <span className="report-muted">No venue</span>}</td>
                        <td data-label="Present / expected">{session.presentCount} / {session.expectedCount}</td>
                        <td data-label="Rate">
                          <span className={`report-rate is-${rateTone(session.rate, report.threshold)}`}>
                            <span className="report-rate-bar" aria-hidden="true"><i style={{ width: `${session.rate ?? 0}%` }} /></span>
                            {formatRate(session.rate)}
                          </span>
                        </td>
                        <td data-label="Evidence" className="report-evidence-cell">
                          {session.withinBoundaryCount ? <span className="report-chip is-within_boundary">{session.withinBoundaryCount} within</span> : null}
                          {session.inconclusiveCount ? <span className="report-chip is-inconclusive">{session.inconclusiveCount} inconclusive</span> : null}
                          {session.unlocatedCount ? <span className="report-chip is-unlocated">{session.unlocatedCount} no venue check</span> : null}
                          {session.manualCount ? <span className="report-chip is-manual">{session.manualCount} recorded</span> : null}
                          {session.revokedCount ? <span className="report-chip is-revoked">{session.revokedCount} revoked</span> : null}
                        </td>
                        <td data-label="Audit trail">
                          <button className="report-link-button" type="button" onClick={() => void loadAudit(session.id)}>
                            <History size={13} aria-hidden="true" /> Audit trail
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {auditSessionId ? (
            <section className="attendance-panel report-audit-panel" aria-labelledby="report-audit-heading" aria-live="polite">
              <div className="attendance-panel-heading attendance-list-heading">
                <div>
                  <p className="section-kicker">CORRECTION AUDIT TRAIL</p>
                  <h2 id="report-audit-heading">{auditSession ? auditSession.title : 'Session'} — changes</h2>
                </div>
                <button className="report-icon-button" type="button" onClick={() => { setAuditSessionId(''); setAudit(null); }} aria-label="Close audit trail">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              {auditLoading ? (
                <ListSkeleton label="Loading corrections…" rows={3} />
              ) : audit?.length ? (
                <ol className="report-audit-list">
                  {audit.map((entry) => (
                    <li key={entry.id}>
                      <span className={`report-audit-icon is-${entry.action}`} aria-hidden="true">
                        {entry.action === 'revoke' ? <UserX size={14} /> : entry.previousStatus === 'revoked' ? <UndoDot size={14} /> : <UserCheck size={14} />}
                      </span>
                      <div>
                        <p>
                          <strong>{entry.actorName}</strong>{' '}
                          {entry.action === 'revoke' ? 'revoked' : entry.previousStatus === 'revoked' ? 'restored' : 'recorded'}{' '}
                          <strong>{entry.studentName}</strong>
                          {entry.action === 'revoke' ? '’s check-in' : ' as present'}
                          {entry.viaDispute ? <span className="report-chip is-dispute">upheld dispute</span> : null}
                        </p>
                        <blockquote>{entry.reason}</blockquote>
                        <small>{dateTimeFormat.format(new Date(entry.createdAt))}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="student-open-empty">No corrections have been made to this session. Every correction is permanently logged here.</p>
              )}
            </section>
          ) : null}

          <section className="attendance-panel report-matrix-panel" aria-labelledby="report-matrix-heading">
            <div className="attendance-panel-heading attendance-list-heading report-matrix-heading">
              <div>
                <p className="section-kicker">STUDENT REGISTER</p>
                <h2 id="report-matrix-heading">Attendance register</h2>
                <p className="report-matrix-hint">Select a cell to record a missed check-in or revoke one. Every correction needs a reason and is logged.</p>
              </div>
              <div className="report-filters">
                <SearchField className="report-search" value={query} onValueChange={setQuery} placeholder="Search name or number" aria-label="Search students" />
                <label className="report-toggle">
                  <input type="checkbox" checked={belowOnly} onChange={(event) => setBelowOnly(event.target.checked)} />
                  <span>Below {report.threshold}% only</span>
                </label>
              </div>
            </div>

            <ul className="report-legend" aria-label="Legend">
              {(Object.keys(CELL_META) as AttendanceReportCell[]).map((cell) => (
                <li key={cell}><span className={`report-cell is-${cell}`} aria-hidden="true">{CELL_META[cell].glyph}</span>{CELL_META[cell].label}</li>
              ))}
            </ul>

            {selected ? (
              <form className="report-correction" onSubmit={submitCorrection} aria-labelledby="report-correction-heading">
                <div className="report-correction-heading">
                  <div>
                    <p className="section-kicker">CORRECT A RECORD</p>
                    <h3 id="report-correction-heading">{selected.student.displayName} · {selected.session.title}</h3>
                    <p>
                      {dateTimeFormat.format(new Date(selected.session.startsAt))} · currently <strong>{CELL_META[selected.cell].label.toLowerCase()}</strong>
                    </p>
                  </div>
                  <button className="report-icon-button" type="button" onClick={() => { setSelection(null); setReason(''); }} aria-label="Cancel correction">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
                {correctionAction == null ? (
                  <p className="report-correction-note">This student was not enrolled when the session started, so there is nothing to correct.</p>
                ) : correctionAction === 'mark_present' && !canMarkPresent ? (
                  <p className="report-correction-note">Only students with an active enrollment can be recorded present.</p>
                ) : (
                  <>
                    <label className="report-reason">
                      <span>Reason (required, kept in the audit trail)</span>
                      <textarea
                        ref={reasonRef}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        minLength={10}
                        maxLength={500}
                        rows={3}
                        required
                        placeholder={correctionAction === 'revoke'
                          ? 'e.g. Code was used from outside the lecture hall.'
                          : 'e.g. Present in class; phone could not get a location fix.'}
                      />
                      <small>{reason.trim().length}/500 · at least 10 characters</small>
                    </label>
                    <div className="report-correction-actions">
                      <button
                        className={`button ${correctionAction === 'revoke' ? 'report-danger-button' : 'button-primary'}`}
                        type="submit"
                        disabled={busy || reason.trim().length < 10}
                      >
                        {busy ? <LoaderCircle className="course-spin" size={15} aria-hidden="true" /> : correctionAction === 'revoke' ? <UserX size={15} aria-hidden="true" /> : <UserCheck size={15} aria-hidden="true" />}
                        {correctionAction === 'revoke' ? 'Revoke check-in' : selected.cell === 'revoked' ? 'Restore as present' : 'Record as present'}
                      </button>
                    </div>
                  </>
                )}
              </form>
            ) : null}

            {!report.sessions.length ? (
              <div className="course-empty-state"><BarChart3 size={21} aria-hidden="true" /><p>No sessions have been held for this course yet. Open one from Attendance sessions.</p></div>
            ) : !report.students.length ? (
              <div className="course-empty-state"><BarChart3 size={21} aria-hidden="true" /><p>No students are enrolled in this course yet.</p></div>
            ) : (
              <div className="report-matrix-wrap">
                <table className="report-matrix">
                  <thead>
                    <tr>
                      <th scope="col" className="report-sticky">Student</th>
                      <th scope="col">Rate</th>
                      {report.sessions.map((session) => (
                        <th scope="col" key={session.id} data-tip={`${session.title} · ${dateFormat.format(new Date(session.startsAt))}`}>
                          <span className="report-session-head">{shortDate.format(new Date(session.startsAt))}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudents.map((student) => (
                      <tr key={student.studentId} className={student.enrollmentStatus !== 'active' ? 'is-inactive' : undefined}>
                        <th scope="row" className="report-sticky">
                          <strong>{student.displayName}</strong>
                          <span>
                            {student.studentNumber}
                            <em className={student.studentNumberVerified ? 'is-verified' : undefined}>
                              {student.studentNumberVerified ? 'verified' : 'self-reported'}
                            </em>
                            {student.enrollmentStatus !== 'active' ? <em>{student.enrollmentStatus}</em> : null}
                          </span>
                          <span
                            className={`report-level${student.levelDiffers ? ' is-different' : ''}`}
                            data-tip={student.levelDiffers
                              ? 'Worked out from the matric number. This differs from the course level — the student may be carrying over or taking an elective.'
                              : 'Worked out from the matric number and the current session. For information only.'}
                          >
                            {student.levelLabel}
                          </span>
                        </th>
                        <td>
                          <span className={`report-rate is-${student.belowThreshold ? 'low' : rateTone(student.rate, report.threshold)}`}>
                            {formatRate(student.rate)}
                          </span>
                          <small className="report-muted"> {student.attendedSessions}/{student.eligibleSessions}</small>
                        </td>
                        {student.cells.map((cell, index) => {
                          const session = report.sessions[index];
                          if (!session) return null;
                          const isSelected = selection?.studentId === student.studentId && selection.sessionId === session.id;
                          return (
                            <td key={session.id} className="report-cell-td">
                              <button
                                type="button"
                                className={`report-cell is-${cell}${isSelected ? ' is-selected' : ''}`}
                                onClick={() => { setSelection({ studentId: student.studentId, sessionId: session.id }); setReason(''); setMessage(''); }}
                                aria-label={`${student.displayName}, ${session.title}: ${CELL_META[cell].label}`}
                                aria-pressed={isSelected}
                                data-tip={`${session.title} — ${CELL_META[cell].label}`}
                                disabled={cell === 'not_enrolled'}
                              >
                                {CELL_META[cell].glyph}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!visibleStudents.length ? (
                      <tr><td colSpan={report.sessions.length + 2} className="report-muted report-no-match">No students match these filters.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
            <p className="report-generated">Generated {dateTimeFormat.format(new Date(report.generatedAt))} (Africa/Lagos).</p>
          </section>
        </>
      )}
    </div>
  );
}
