'use client';

import { DEFAULT_ATTENDANCE_THRESHOLD, type LectureRegister, type LectureRegisterCourses } from '@lasuatos/contracts';
import { ArrowLeft, BookOpenCheck, ChevronRight, Download, Printer, Search, TriangleAlert, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  failureText,
  formatClock,
  formatDay,
  formatSheetDate,
  formatShortDay,
  loadCourseRegister,
  loadRegisterCourses,
} from '../lib/lecture-api';
import { WorkspaceSkeleton } from './account-gate';
import { AccessMessage, useTakerAccess } from './lecture-sessions';
import { SessionsTabs } from './sessions-tabs';

const THRESHOLDS = [50, 60, 70, 75, 80] as const;

function readCourseFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('course')?.trim() ?? '';
}

/**
 * Course registers: for each course code, every student against every session,
 * with attendance percentages and who falls below the required threshold.
 * The selected course lives in the URL (?course=CPE%20301) so the back button
 * and shared links behave like an app.
 */
export function CourseRegisters() {
  const { access, retry } = useTakerAccess();
  const [course, setCourse] = useState('');

  useEffect(() => {
    const sync = () => setCourse(readCourseFromUrl());
    // Read after mount so the server render (no URL) matches the first client render.
    const timer = window.setTimeout(sync, 0);
    window.addEventListener('popstate', sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  function open(next: string) {
    const url = next ? `/registers?course=${encodeURIComponent(next)}` : '/registers';
    window.history.pushState(null, '', url);
    setCourse(next);
    window.scrollTo({ top: 0 });
  }

  if (access.kind !== 'ready') return <AccessMessage access={access} retry={retry} />;
  return course ? <RegisterView courseCode={course} onBack={() => open('')} /> : <CourseList onOpen={open} />;
}

function CourseList({ onOpen }: Readonly<{ onOpen: (course: string) => void }>) {
  const [courses, setCourses] = useState<LectureRegisterCourses['courses'] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void loadRegisterCourses(controller.signal)
      .then((result) => setCourses(result.courses))
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(failureText(caught)); });
    return () => controller.abort();
  }, []);

  return (
    <div className="page-stack lx-page">
      <section className="page-heading lx-heading">
        <div>
          <p className="page-eyebrow">COURSE REGISTERS</p>
          <h1>Registers</h1>
          <p className="page-lede">Every student against every session of a course, with attendance percentages for exam eligibility. Export to Excel or print.</p>
        </div>
      </section>
      <SessionsTabs active="registers" />
      {error ? <p className="lx-error" role="alert">{error}</p> : null}
      {courses === null && !error ? <div className="lx-course-grid" aria-hidden="true">{[0, 1, 2].map((key) => <div key={key} className="skeleton-block rg-course-skeleton" />)}</div> : null}
      {courses?.length === 0 ? (
        <div className="lx-empty rg-empty">
          <BookOpenCheck size={26} aria-hidden="true" />
          <p>Registers appear here after your first attendance session.</p>
          <Link className="button button-primary" href="/sessions">Take attendance</Link>
        </div>
      ) : null}
      {courses && courses.length > 0 ? (
        <div className="lx-course-grid">
          {courses.map((course) => (
            <button key={course.courseCode} type="button" className="rg-course-card" onClick={() => onOpen(course.courseCode)}>
              <span className="lx-course-code">{course.courseCode}</span>
              <strong>{course.courseTitle}</strong>
              <span className="lx-session-meta">
                {course.sessionCount} session{course.sessionCount === 1 ? '' : 's'} · last {formatShortDay(course.lastHeldAt)}
              </span>
              <ChevronRight className="rg-course-arrow" size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function dateRange(first: string, last: string): string {
  const start = formatDay(first);
  const end = formatDay(last);
  return start === end ? start : `${start} – ${end}`;
}

function rateTone(rate: number, threshold: number): 'good' | 'warn' | 'low' {
  if (rate >= threshold) return 'good';
  if (rate >= threshold - 15) return 'warn';
  return 'low';
}

function csvCell(value: string): string {
  // A leading = + - @ would be run as a formula by spreadsheet apps.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function RegisterView({ courseCode, onBack }: Readonly<{ courseCode: string; onBack: () => void }>) {
  const [register, setRegister] = useState<LectureRegister | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [threshold, setThreshold] = useState<number>(DEFAULT_ATTENDANCE_THRESHOLD);

  useEffect(() => {
    const controller = new AbortController();
    void loadCourseRegister(courseCode, controller.signal)
      .then((result) => { setRegister(result); setError(''); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(failureText(caught)); });
    return () => controller.abort();
  }, [courseCode]);

  const stats = useMemo(() => {
    if (!register) return null;
    const total = register.students.length;
    const average = total ? Math.round((register.students.reduce((sum, row) => sum + row.rate, 0) / total) * 10) / 10 : 0;
    const below = register.students.filter((row) => row.rate < threshold).length;
    return { total, average, below, held: register.sessions.length };
  }, [register, threshold]);

  const rows = useMemo(() => {
    if (!register) return [];
    const needle = query.trim().toLowerCase();
    return register.students.filter((row) =>
      (!onlyBelow || row.rate < threshold) &&
      (!needle || row.fullName.toLowerCase().includes(needle) || row.matricNumber.toLowerCase().includes(needle)));
  }, [register, query, onlyBelow, threshold]);

  function exportCsv() {
    if (!register) return;
    const header = [
      'S/N', 'Full name', 'Matric number',
      ...register.sessions.map((session) => `${formatSheetDate(session.startsAt)} ${formatClock(session.startsAt)}`),
      'Attended', 'Held', 'Percentage', `Eligible (${threshold}%)`,
    ];
    const body = register.students.map((row, index) => [
      String(index + 1), row.fullName, row.matricNumber,
      ...row.present.map((present) => (present ? 'P' : 'A')),
      String(row.attended), String(register.sessions.length), `${row.rate}%`, row.rate >= threshold ? 'Yes' : 'No',
    ]);
    const csv = `${[header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${register.courseCode.replace(/[^A-Za-z0-9]+/g, '-')}-register.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="page-stack lx-page rg-page">
      <button className="back-link rg-back" type="button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> All registers</button>
      {error ? (
        <section className="workspace-message" role="alert">
          <span className="workspace-message-icon" aria-hidden="true">!</span>
          <div><h2>Register not available</h2><p>{error}</p></div>
        </section>
      ) : null}
      {!register && !error ? <WorkspaceSkeleton label="Building the register…" /> : null}
      {register && stats ? (
        <>
          <section className="lx-session-head rg-head">
            <div>
              <span className="lx-course-code">{register.courseCode}</span>
              <h1>{register.courseTitle}</h1>
              <p className="lx-session-meta">
                {dateRange(register.sessions[0]!.startsAt, register.sessions[register.sessions.length - 1]!.startsAt)}
              </p>
            </div>
          </section>

          <section className="rg-stats" aria-label="Summary">
            <div className="rg-stat"><span>Sessions held</span><strong>{stats.held}</strong></div>
            <div className="rg-stat"><span>Students</span><strong>{stats.total}</strong></div>
            <div className="rg-stat"><span>Average attendance</span><strong>{stats.average}%</strong></div>
            <div className={`rg-stat${stats.below ? ' is-warn' : ''}`}><span>Below {threshold}%</span><strong>{stats.below}</strong></div>
          </section>

          <section className="rg-toolbar" aria-label="Filter and export">
            <label className="lx-search rg-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Find a student</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find by name or matric" />
            </label>
            <div className="rg-segment" role="group" aria-label="Show">
              <button type="button" className={onlyBelow ? '' : 'is-selected'} aria-pressed={!onlyBelow} onClick={() => setOnlyBelow(false)}>Everyone</button>
              <button type="button" className={onlyBelow ? 'is-selected' : ''} aria-pressed={onlyBelow} onClick={() => setOnlyBelow(true)}>
                <TriangleAlert size={14} aria-hidden="true" /> Below {threshold}%
              </button>
            </div>
            <label className="rg-threshold">
              <span className="rg-threshold-label">Required</span>
              <select value={threshold} onChange={(event) => setThreshold(Number(event.target.value))}>
                {THRESHOLDS.map((value) => <option key={value} value={value}>{value}%</option>)}
              </select>
            </label>
            <div className="rg-actions">
              <button className="button button-secondary" type="button" onClick={exportCsv}><Download size={16} aria-hidden="true" /> Excel / CSV</button>
              <button className="button button-secondary" type="button" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print</button>
            </div>
          </section>

          {rows.length === 0 ? (
            <p className="lx-empty">{onlyBelow ? `Everyone is at or above ${threshold}%.` : 'No student matches that search.'}</p>
          ) : (
            <>
              {/* Desktop and print: the full register grid. */}
              <div className="rg-table-wrap" role="region" aria-label={`${register.courseCode} register`} tabIndex={0}>
                <table className="rg-table">
                  <caption className="rg-print-title">{register.courseCode} · {register.courseTitle} — attendance register ({stats.held} sessions, required {threshold}%)</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="rg-sn">#</th>
                      <th scope="col" className="rg-name">Student</th>
                      {register.sessions.map((session, index) => (
                        <th scope="col" key={session.id} className="rg-day" title={`${formatDay(session.startsAt)} ${formatClock(session.startsAt)} · ${session.takenBy} · ${session.presentCount} present`}>
                          <span>{formatShortDay(session.startsAt)}</span>
                          <span className="sr-only">, session {index + 1}</span>
                          <small>{formatClock(session.startsAt)}</small>
                        </th>
                      ))}
                      <th scope="col" className="rg-total">Attended</th>
                      <th scope="col" className="rg-rate">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const tone = rateTone(row.rate, threshold);
                      return (
                        <tr key={row.matricNumber} className={`is-${tone}`}>
                          <td className="rg-sn">{index + 1}</td>
                          <th scope="row" className="rg-name">
                            <strong>{row.fullName}</strong>
                            <span>{row.matricNumber}</span>
                          </th>
                          {row.present.map((present, position) => (
                            <td key={register.sessions[position]!.id} className={`rg-cell${present ? ' is-present' : ''}`}>
                              <span aria-label={present ? 'Present' : 'Absent'} data-mark={present ? 'P' : 'A'}>{present ? 'P' : '·'}</span>
                            </td>
                          ))}
                          <td className="rg-total">{row.attended}/{stats.held}</td>
                          <td className="rg-rate"><span className={`rg-pill is-${tone}`}>{row.rate}%</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Phones: one card per student. */}
              <ul className="rg-cards">
                {rows.map((row) => {
                  const tone = rateTone(row.rate, threshold);
                  return (
                    <li key={row.matricNumber} className="lx-card rg-card">
                      <div className="rg-card-top">
                        <div className="lx-attendee-main">
                          <strong>{row.fullName}</strong>
                          <span>{row.matricNumber}</span>
                        </div>
                        <span className={`rg-pill is-${tone}`}>{row.rate}%</span>
                      </div>
                      <div className="rg-dots" role="img" aria-label={`${row.attended} of ${stats.held} sessions attended`}>
                        {row.present.map((present, position) => <i key={register.sessions[position]!.id} className={present ? 'is-present' : ''} />)}
                      </div>
                      <span className="lx-session-meta">{row.attended} of {stats.held} sessions</span>
                    </li>
                  );
                })}
              </ul>
              <p className="lx-fine rg-foot"><UsersRound size={14} aria-hidden="true" /> Students are matched by matric number. Removed entries are not counted. P = present.</p>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
