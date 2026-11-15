'use client';

import type { LectureAttendanceSummary } from '@lasuatos/contracts';
import { ChevronRight, QrCode, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Resource } from '../../lib/resource';
import { dayLabel, numberFormat, plural, trendOf } from './format';

const WEEK = 7;

/**
 * The week's check-ins on the sidebar's navy paper: the number, its change from the week
 * before, the last 30 days as bars (this week brighter), and three supporting figures.
 */
export function AttendanceCard({ resource }: Readonly<{ resource: Resource<LectureAttendanceSummary> & { reload: () => void } }>) {
  const summary = resource.data;
  if (!summary) {
    return (
      <section className="ov-hero" aria-label="Check-ins" aria-busy={!resource.error}>
        {resource.error ? (
          <div className="ov-hero-empty" role="alert">
            <p className="ov-hero-empty-title">Check-ins did not load</p>
            <p className="ov-hero-empty-text">{resource.error}</p>
            <button className="ov-hero-button" type="button" onClick={resource.reload}>Try again</button>
          </div>
        ) : (
          <div className="ov-hero-bones" aria-hidden="true">
            <span className="ov-bone" style={{ width: 92 }} />
            <span className="ov-bone ov-bone-number" />
            <span className="ov-bone ov-bone-chart" />
            <span className="ov-bone" style={{ width: '70%' }} />
          </div>
        )}
      </section>
    );
  }

  const daily = summary.daily;
  const week = daily.slice(-WEEK);
  const before = daily.slice(-WEEK * 2, -WEEK);
  const total = (days: typeof daily, key: 'checkIns' | 'sessions') => days.reduce((sum, day) => sum + day[key], 0);
  const checkIns = total(week, 'checkIns');
  const sessions = total(week, 'sessions');
  const trend = trendOf(checkIns, total(before, 'checkIns'), 'week');
  const average = sessions ? Math.round(checkIns / sessions) : 0;

  if (summary.totals.sessions === 0) {
    return (
      <section className="ov-hero" aria-labelledby="ov-hero-title">
        <div className="ov-hero-empty">
          <span className="ov-hero-empty-icon" aria-hidden="true"><QrCode size={24} strokeWidth={1.8} /></span>
          <h2 className="ov-hero-empty-title" id="ov-hero-title">No attendance in the last 30 days</h2>
          <Link className="ov-hero-button" href="/sessions">Take attendance</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="ov-hero" aria-labelledby="ov-hero-title">
      <div className="ov-hero-head">
        <h2 className="ov-hero-title" id="ov-hero-title">Check-ins <span>Last 7 days</span></h2>
        <Link className="ov-hero-link" href="/admin/attendance">
          Report<ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
        </Link>
      </div>
      <p className="ov-hero-figure">
        <strong className="ov-hero-number">{numberFormat.format(checkIns)}</strong>
        {trend ? (
          <span className={`ov-trend is-${trend.direction}`}>
            {trend.direction === 'up' ? <TrendingUp size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
            {trend.direction === 'down' ? <TrendingDown size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
            <span aria-hidden="true">{trend.label}</span>
            <span className="sr-only">{`, ${trend.spoken}`}</span>
          </span>
        ) : null}
      </p>
      <Bars summary={summary} />
      <dl className="ov-hero-stats">
        <div>
          <dt>Sessions</dt>
          <dd>{numberFormat.format(sessions)}</dd>
        </div>
        <div>
          <dt>Per class</dt>
          <dd>{sessions ? numberFormat.format(average) : '—'}</dd>
        </div>
        <div>
          <dt>Students <span>30 days</span></dt>
          <dd>{numberFormat.format(summary.totals.uniqueStudents)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Check-ins per day for the whole period; the last seven days stand out. */
function Bars({ summary }: Readonly<{ summary: LectureAttendanceSummary }>) {
  const days = summary.daily;
  const largest = Math.max(1, ...days.map((day) => day.checkIns));
  const recentFrom = Math.max(0, days.length - WEEK);
  const busiest = days.reduce((best, day) => (day.checkIns > best.checkIns ? day : best), days[0]!);
  const description = `Check-ins per day, ${dayLabel(summary.from)} to ${dayLabel(summary.to)}. Busiest: ${dayLabel(busiest.date, true)}, ${plural(busiest.checkIns, 'check-in')}.`;
  return (
    <figure className="ov-chart">
      <div className="ov-bars" role="img" aria-label={description} style={{ '--days': days.length } as CSSProperties}>
        {days.map((day, index) => (
          <span
            key={day.date}
            className={`ov-bar${index >= recentFrom ? ' is-recent' : ''}${day.checkIns === 0 ? ' is-zero' : ''}`}
            data-tip={`${dayLabel(day.date, true)}: ${plural(day.checkIns, 'check-in')}`}
            style={{ '--ratio': (day.checkIns / largest).toFixed(4) } as CSSProperties}
          />
        ))}
      </div>
      <figcaption className="ov-axis" style={{ '--days': days.length, '--before': recentFrom, '--recent': days.length - recentFrom } as CSSProperties}>
        <span>{dayLabel(summary.from)}</span>
        <span className="ov-axis-week">Today</span>
      </figcaption>
    </figure>
  );
}
