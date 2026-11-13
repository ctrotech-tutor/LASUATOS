'use client';

import type { LectureAttendanceSummary } from '@lasuatos/contracts';
import { ArrowRight, BookOpenCheck, CalendarCheck2, QrCode, ShieldAlert, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import { failureText, loadLectureSummary } from '../lib/lecture-api';
import { Bone, SkeletonRegion } from './ui/skeleton';

type Period = 7 | 30 | 90;
const PERIODS: readonly Period[] = [7, 30, 90];
const numberFormat = new Intl.NumberFormat('en-NG');
const dayFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function formatDate(date: string, withWeekday = false): string {
  const value = new Date(`${date}T00:00:00Z`);
  return (withWeekday ? weekdayFormat : dayFormat).format(value);
}

/**
 * Attendance taken with QR codes (by lecturers, class reps and administrators)
 * across everything the signed-in person can see. `compact` is the dashboard
 * card; the full version adds departments, courses and data-quality signals.
 */
export function LectureSummaryPanel({ compact = false, headingLevel = 2 }: Readonly<{ compact?: boolean; headingLevel?: 2 | 3 }>) {
  const [period, setPeriod] = useState<Period>(compact ? 7 : 30);
  const [summary, setSummary] = useState<LectureAttendanceSummary | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void loadLectureSummary(period, controller.signal)
      .then((result) => {
        setSummary(result);
        setError('');
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureText(caught));
      });
    return () => controller.abort();
  }, [period, attempt]);

  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const current = summary && summary.days === period ? summary : null;
  const totals = current?.totals;
  const average = totals && totals.sessions ? totals.checkIns / totals.sessions : 0;

  return (
    <section className={`admin-overview-panel qs-panel${compact ? ' is-compact' : ''}`} aria-labelledby="qs-heading">
      <div className="admin-overview-heading qs-heading">
        <div>
          <p className="section-kicker">QR ATTENDANCE</p>
          <Heading id="qs-heading">Attendance taken with QR codes</Heading>
          <p>
            Every session opened by lecturers, GHOCs, HOCs and administrators in your scope
            {current ? `, ${formatDate(current.from)} – ${formatDate(current.to)}` : ''}.
          </p>
        </div>
        <div className="qs-periods" role="radiogroup" aria-label="Period">
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              className={`lx-chip-button${period === value ? ' is-selected' : ''}`}
              onClick={() => setPeriod(value)}
            >
              {value} days
            </button>
          ))}
        </div>
      </div>

      {error && !current ? (
        <div className="qs-body">
          <p className="lx-error" role="alert">{error}</p>
          <button className="button button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </div>
      ) : !current || !totals ? (
        <SkeletonRegion label="Loading attendance summary…" className="qs-body">
          <div className="qs-stats">{[0, 1, 2, 3].map((key) => <Bone key={key} height={74} />)}</div>
          <Bone height={compact ? 150 : 190} />
        </SkeletonRegion>
      ) : (
        <div className="qs-body">
          <dl className="qs-stats">
            <div>
              <dt><CalendarCheck2 size={16} aria-hidden="true" /> Sessions</dt>
              <dd>{numberFormat.format(totals.sessions)}</dd>
              <dd className="qs-stat-note">{totals.openNow ? `${totals.openNow} open now` : `${numberFormat.format(totals.courses)} course${totals.courses === 1 ? '' : 's'}`}</dd>
            </div>
            <div>
              <dt><QrCode size={16} aria-hidden="true" /> Check-ins</dt>
              <dd>{numberFormat.format(totals.checkIns)}</dd>
              <dd className="qs-stat-note">{totals.sessions ? `${average.toFixed(average >= 10 ? 0 : 1)} per session` : 'No sessions yet'}</dd>
            </div>
            <div>
              <dt><UsersRound size={16} aria-hidden="true" /> Students</dt>
              <dd>{numberFormat.format(totals.uniqueStudents)}</dd>
              <dd className="qs-stat-note">different matric numbers</dd>
            </div>
            <div>
              <dt><BookOpenCheck size={16} aria-hidden="true" /> Without account</dt>
              <dd>{totals.checkIns ? `${Math.round((totals.guestCheckIns / totals.checkIns) * 100)}%` : '—'}</dd>
              <dd className="qs-stat-note">{numberFormat.format(totals.guestCheckIns)} guest check-in{totals.guestCheckIns === 1 ? '' : 's'}</dd>
            </div>
          </dl>

          {totals.sessions === 0 ? (
            <p className="qs-empty">
              No attendance has been taken with QR codes in the last {period} days.{' '}
              <Link href="/sessions">Open a session</Link> or appoint <Link href="/class-reps">class representatives</Link> to take it.
            </p>
          ) : (
            <DailyChart summary={current} />
          )}

          {!compact && totals.sessions > 0 ? (
            <>
              <QualitySignals summary={current} />
              <div className="qs-columns">
                <Departments summary={current} />
                <Courses summary={current} />
              </div>
            </>
          ) : null}

          {compact ? (
            <Link className="qs-more" href="/admin/attendance">
              Departments, courses and checks <ArrowRight size={15} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Check-ins per day; columns share the width so 7 or 90 days fit any screen. */
function DailyChart({ summary }: Readonly<{ summary: LectureAttendanceSummary }>) {
  const largest = Math.max(1, ...summary.daily.map((day) => day.checkIns));
  const busiest = summary.daily.reduce((best, day) => (day.checkIns > best.checkIns ? day : best), summary.daily[0]!);
  const labelEvery = summary.days <= 7 ? 1 : summary.days <= 30 ? 7 : 15;
  const last = summary.daily.length - 1;
  // Regular labels plus the last day, skipping one that would crowd the last.
  const showLabel = (index: number) => index === last || (index % labelEvery === 0 && last - index >= Math.ceil(labelEvery / 2));
  const description = `Check-ins per day from ${formatDate(summary.from)} to ${formatDate(summary.to)}. Busiest day: ${formatDate(busiest.date, true)} with ${numberFormat.format(busiest.checkIns)} check-ins in ${busiest.sessions} session${busiest.sessions === 1 ? '' : 's'}.`;
  return (
    <figure className="qs-chart">
      <figcaption className="qs-chart-caption">
        <span>Check-ins per day</span>
        <span>Busiest: <strong>{formatDate(busiest.date, true)}</strong> · {numberFormat.format(busiest.checkIns)}</span>
      </figcaption>
      <div
        className={`qs-bars${summary.days > 30 ? ' is-dense' : ''}`}
        style={{ '--qs-days': summary.daily.length } as CSSProperties}
        role="img"
        aria-label={description}
      >
        {summary.daily.map((day, index) => (
          <span key={day.date} className="qs-bar" data-tip={`${formatDate(day.date, true)}: ${numberFormat.format(day.checkIns)} check-ins, ${day.sessions} session${day.sessions === 1 ? '' : 's'}`}>
            {summary.days <= 7 && day.checkIns > 0 ? <span className="qs-bar-value">{numberFormat.format(day.checkIns)}</span> : null}
            <span className={`qs-bar-fill${day.checkIns === 0 ? ' is-zero' : ''}`} style={{ '--ratio': (day.checkIns / largest).toFixed(4) } as CSSProperties} />
            <span className="qs-bar-label">{showLabel(index) ? formatDate(day.date) : ''}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

function QualitySignals({ summary }: Readonly<{ summary: LectureAttendanceSummary }>) {
  const { totals, takers } = summary;
  const items = [
    { label: 'Added by hand', value: totals.manualCheckIns, hint: 'by the person taking attendance' },
    { label: 'Removed', value: totals.removedEntries, hint: 'taken off a list after checking in' },
    { label: 'Shared phone', value: totals.sharedDeviceEntries, hint: 'one phone marked more than one student', warn: totals.sharedDeviceEntries > 0 },
  ];
  const takerText = [
    takers.lecturer ? `${takers.lecturer} by lecturers` : '',
    takers.ghoc ? `${takers.ghoc} by GHOCs` : '',
    takers.hoc ? `${takers.hoc} by HOCs` : '',
    takers.administrator ? `${takers.administrator} by administrators` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="qs-quality">
      <p className="qs-takers"><strong>Who took them:</strong> {takerText || '—'}</p>
      <ul>
        {items.map((item) => (
          <li key={item.label} className={item.warn ? 'is-warn' : undefined}>
            {item.warn ? <ShieldAlert size={15} aria-hidden="true" /> : null}
            <strong>{numberFormat.format(item.value)}</strong>
            <span>{item.label}<small>{item.hint}</small></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Departments({ summary }: Readonly<{ summary: LectureAttendanceSummary }>) {
  const largest = Math.max(1, ...summary.departments.map((item) => item.checkIns));
  return (
    <section className="qs-section" aria-labelledby="qs-departments">
      <h3 id="qs-departments">By department</h3>
      <ol className="qs-rank">
        {summary.departments.slice(0, 12).map((item) => (
          <li key={item.id ?? item.name}>
            <div className="qs-rank-row">
              <span className="qs-rank-name">{item.name}</span>
              <span className="qs-rank-figures"><strong>{numberFormat.format(item.checkIns)}</strong> check-ins · {item.sessions} session{item.sessions === 1 ? '' : 's'}</span>
            </div>
            <span className="qs-rank-track" aria-hidden="true"><span style={{ '--ratio': (item.checkIns / largest).toFixed(4) } as CSSProperties} /></span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Courses({ summary }: Readonly<{ summary: LectureAttendanceSummary }>) {
  return (
    <section className="qs-section" aria-labelledby="qs-courses">
      <h3 id="qs-courses">Most held courses</h3>
      <ul className="qs-courses">
        {summary.courses.slice(0, 10).map((course) => (
          <li key={course.courseCode}>
            <Link href={`/registers?course=${encodeURIComponent(course.courseCode)}`}>
              <span className="lx-course-code">{course.courseCode}</span>
              <strong>{course.courseTitle}</strong>
              <span className="qs-course-meta">
                {course.sessions} session{course.sessions === 1 ? '' : 's'} · about {numberFormat.format(Math.round(course.averagePresent))} present each · last {formatDate(new Date(new Date(course.lastHeldAt).getTime() + 3_600_000).toISOString().slice(0, 10))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
