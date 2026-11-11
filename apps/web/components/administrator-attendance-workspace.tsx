'use client';

import type { AdministratorAttendanceOverview } from '@lasuatos/contracts';
import { AlertTriangle, LoaderCircle, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAdministratorAttendanceOverview } from '../lib/attendance-api';

const numberFormat = new Intl.NumberFormat('en-NG');
const dateFormat = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' });
const dateTimeFormat = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Check your connection and try again.';
}

function formatRate(rate: number | null): string {
  return rate == null ? '—' : `${rate.toFixed(rate % 1 === 0 ? 0 : 1)}%`;
}

function tone(rate: number | null): 'good' | 'warn' | 'low' | 'none' {
  if (rate == null) return 'none';
  if (rate >= 75) return 'good';
  if (rate >= 60) return 'warn';
  return 'low';
}

/** Whole days between two ISO instants, for "waiting N days" copy. */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000));
}

function waitingLabel(oldestIso: string | null, nowIso: string): string {
  if (!oldestIso) return 'None waiting for a decision';
  const days = daysBetween(oldestIso, nowIso);
  return days === 0 ? 'Oldest raised today' : `Oldest waiting ${days} day${days === 1 ? '' : 's'}`;
}

type SortKey = 'course' | 'rate' | 'sessions' | 'recent' | 'disputes';

export function AdministratorAttendanceWorkspace() {
  const [overview, setOverview] = useState<AdministratorAttendanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('rate');
  const [hideEmpty, setHideEmpty] = useState(true);

  const fetchOverview = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await loadAdministratorAttendanceOverview(signal);
      if (signal?.aborted) return;
      setOverview(result);
      setError('');
    } catch (caught) {
      if (!signal?.aborted) setError(failureMessage(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  function load() {
    setLoading(true);
    void fetchOverview();
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadAdministratorAttendanceOverview(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setOverview(result);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => {
    if (!overview) return [];
    const needle = query.trim().toLowerCase();
    const filtered = overview.offerings.filter((offering) => {
      if (hideEmpty && offering.sessionsHeld === 0) return false;
      if (!needle) return true;
      return [offering.courseCode, offering.courseTitle, offering.departmentName]
        .some((value) => value.toLowerCase().includes(needle));
    });
    return [...filtered].sort((left, right) => {
      if (sort === 'course') return left.courseCode.localeCompare(right.courseCode);
      if (sort === 'sessions') return right.sessionsHeld - left.sessionsHeld;
      if (sort === 'recent') return (right.lastSessionAt ?? '').localeCompare(left.lastSessionAt ?? '');
      if (sort === 'disputes') {
        return right.openDisputes - left.openDisputes
          || (left.oldestOpenDisputeAt ?? '9999').localeCompare(right.oldestOpenDisputeAt ?? '9999');
      }
      // Lowest attendance first so courses needing attention surface at the top.
      return (left.rate ?? 101) - (right.rate ?? 101);
    });
  }, [overview, query, sort, hideEmpty]);

  if (!overview) {
    return error
      ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p>
      : <div className="course-empty-state"><LoaderCircle className="course-spin" size={20} aria-hidden="true" /><p>Loading attendance across your scope…</p></div>;
  }

  const { totals } = overview;

  return (
    <div className="report-workspace">
      <section className="attendance-notice" aria-label="How these figures are calculated">
        <ShieldAlert size={18} aria-hidden="true" />
        <p>
          <strong>Expected check-ins</strong> count each started session for each actively enrolled student who was enrolled when it began.
          Revoked check-ins never count; inconclusive location evidence still counts as attendance. Colour bands at 75% and 60% are visual guides, not institutional policy.
          Open disputes are decided by the course’s assigned lecturers; figures change only when a dispute is upheld.
        </p>
      </section>
      {error ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}

      <section className="report-summary-grid" aria-label="Attendance totals">
        <article className={`report-summary-card is-${tone(totals.rate)}`}>
          <span>Overall attendance</span>
          <strong>{formatRate(totals.rate)}</strong>
          <p>{numberFormat.format(totals.presentCheckIns)} of {numberFormat.format(totals.expectedCheckIns)} expected</p>
        </article>
        <article className="report-summary-card">
          <span>Sessions held</span>
          <strong>{numberFormat.format(totals.sessionsHeld)}</strong>
          <p>{totals.offeringsWithSessions} offerings with sessions</p>
        </article>
        <article className="report-summary-card">
          <span>Inconclusive location</span>
          <strong>{numberFormat.format(totals.inconclusiveCheckIns)}</strong>
          <p>Counted as present</p>
        </article>
        <article className="report-summary-card">
          <span>Lecturer corrections</span>
          <strong>{numberFormat.format(totals.manualCheckIns + totals.revokedCheckIns)}</strong>
          <p>{totals.manualCheckIns} recorded · {totals.revokedCheckIns} revoked</p>
        </article>
        <article className={`report-summary-card${totals.openDisputes > 0 ? ' is-warn' : ''}`}>
          <span>Open student disputes</span>
          <strong>{numberFormat.format(totals.openDisputes)}</strong>
          <p>{waitingLabel(totals.oldestOpenDisputeAt, overview.generatedAt)}</p>
        </article>
      </section>

      <section className="attendance-panel report-sessions-panel" aria-labelledby="admin-attendance-heading">
        <div className="attendance-panel-heading attendance-list-heading report-matrix-heading">
          <div>
            <p className="section-kicker">COURSE OFFERINGS</p>
            <h2 id="admin-attendance-heading">Attendance by course</h2>
          </div>
          <div className="report-filters">
            <label className="report-search">
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">Search courses</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search course or department" />
            </label>
            <label className="report-select-inline">
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                <option value="rate">Lowest attendance first</option>
                <option value="course">Course code</option>
                <option value="sessions">Most sessions</option>
                <option value="recent">Most recent session</option>
                <option value="disputes">Most open disputes</option>
              </select>
            </label>
            <label className="report-toggle">
              <input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />
              <span>Hide courses with no sessions</span>
            </label>
            <button className="course-refresh-button" type="button" onClick={load} disabled={loading}>
              <RefreshCw className={loading ? 'course-spin' : ''} size={15} aria-hidden="true" /> Refresh
            </button>
          </div>
        </div>
        {rows.length ? (
          <div className="report-table-wrap">
            <table className="report-sessions-table">
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">Department</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Enrolled</th>
                  <th scope="col">Present / expected</th>
                  <th scope="col">Rate</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Last session</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((offering) => (
                  <tr key={offering.courseOfferingId}>
                    <td><strong>{offering.courseCode}</strong><span>{offering.courseTitle} · {offering.semesterLabel}</span></td>
                    <td>{offering.departmentName}</td>
                    <td>{offering.sessionsHeld}</td>
                    <td>{offering.activeEnrollments}</td>
                    <td>{numberFormat.format(offering.presentCheckIns)} / {numberFormat.format(offering.expectedCheckIns)}</td>
                    <td>
                      <span className={`report-rate is-${tone(offering.rate)}`}>
                        <span className="report-rate-bar" aria-hidden="true"><i style={{ width: `${offering.rate ?? 0}%` }} /></span>
                        {formatRate(offering.rate)}
                      </span>
                    </td>
                    <td className="report-evidence-cell">
                      {offering.inconclusiveCheckIns ? <span className="report-chip is-inconclusive">{offering.inconclusiveCheckIns} inconclusive</span> : null}
                      {offering.manualCheckIns ? <span className="report-chip is-manual">{offering.manualCheckIns} recorded</span> : null}
                      {offering.revokedCheckIns ? <span className="report-chip is-revoked">{offering.revokedCheckIns} revoked</span> : null}
                      {offering.openDisputes ? (
                        <span
                          className="report-chip is-dispute"
                          title={offering.oldestOpenDisputeAt ? waitingLabel(offering.oldestOpenDisputeAt, overview.generatedAt) : undefined}
                        >
                          {offering.openDisputes} open dispute{offering.openDisputes === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </td>
                    <td>{offering.lastSessionAt ? dateFormat.format(new Date(offering.lastSessionAt)) : <span className="report-muted">None yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="course-empty-state"><p>{overview.offerings.length ? 'No courses match these filters.' : 'No course offerings exist in your scope yet.'}</p></div>
        )}
        <p className="report-generated">Generated {dateTimeFormat.format(new Date(overview.generatedAt))} (Africa/Lagos).</p>
      </section>
    </div>
  );
}
