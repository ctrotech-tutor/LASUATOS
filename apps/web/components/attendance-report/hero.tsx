'use client';

import type { LectureReport } from '@lasuatos/contracts';
import { QrCode, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { chartBars, dayLabel, numberFormat, percent, plural, pointsChange, rangeLabel } from './format';

/**
 * The period's attendance rate on the navy paper: the figure, its change from the period
 * before, a bar per day (per week for a semester) against the 75% line, and three totals.
 */
export function RateCard({ report }: Readonly<{ report: LectureReport }>) {
  const { totals } = report;
  const range = rangeLabel(report.from, report.to);

  if (totals.sessions === 0) {
    return (
      <section className="ds-paper ar-hero" aria-labelledby="ar-hero-title">
        <div className="ar-hero-empty">
          <span className="ar-hero-empty-icon" aria-hidden="true"><QrCode size={24} strokeWidth={1.8} /></span>
          <h2 className="ar-hero-empty-title" id="ar-hero-title">No classes, {range}</h2>
          <Link className="ar-hero-button" href="/sessions">Take attendance</Link>
        </div>
      </section>
    );
  }

  const change = pointsChange(report);
  return (
    <section className="ds-paper ar-hero" aria-labelledby="ar-hero-title">
      <h2 className="ar-hero-title" id="ar-hero-title">Attendance <span>{range}</span></h2>
      <p className="ar-hero-figure">
        <strong className="ar-hero-number">{percent(totals.rate)}</strong>
        {change ? (
          <span className={`ar-trend is-${change.direction}`}>
            {change.direction === 'up' ? <TrendingUp size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
            {change.direction === 'down' ? <TrendingDown size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
            <span aria-hidden="true">{change.label}</span>
            <span className="sr-only">{`, ${change.spoken}`}</span>
          </span>
        ) : null}
      </p>
      <RateChart report={report} />
      <dl className="ar-hero-stats">
        <div><dt>Sessions</dt><dd>{numberFormat.format(totals.sessions)}</dd></div>
        <div><dt>Check-ins</dt><dd>{numberFormat.format(totals.checkIns)}</dd></div>
        <div><dt>Students</dt><dd>{numberFormat.format(totals.students)}</dd></div>
      </dl>
    </section>
  );
}

function RateChart({ report }: Readonly<{ report: LectureReport }>) {
  const bars = chartBars(report);
  const threshold = report.below.threshold;
  const held = bars.filter((bar) => bar.rate !== null);
  const lowest = held.reduce<(typeof bars)[number] | null>((low, bar) => (!low || (bar.rate ?? 0) < (low.rate ?? 0) ? bar : low), null);
  const unit = report.period === 'term' ? 'week' : 'day';
  const description = `Attendance rate per ${unit}, ${rangeLabel(report.from, report.to)}. ${plural(held.length, unit)} with classes, ${plural(held.filter((bar) => (bar.rate ?? 0) >= threshold).length, unit)} at ${threshold}% or above.${lowest ? ` Lowest: ${lowest.title}.` : ''}`;
  const labelled = bars.some((bar) => bar.label);
  return (
    <figure className="ar-chart">
      <div className={`ar-plot${bars.length > 14 ? ' is-dense' : ''}`} style={{ '--bars': bars.length, '--line': threshold / 100 } as CSSProperties}>
        <span className="ar-line" aria-hidden="true"><span>{threshold}%</span></span>
        <div className="ar-bars" role="img" aria-label={description}>
          {bars.map((bar) => (
            <span
              key={bar.key}
              className={`ar-bar${bar.rate === null ? ' is-empty' : bar.rate >= threshold ? ' is-met' : ''}`}
              data-tip={bar.title}
              style={{ '--v': ((bar.rate ?? 0) / 100).toFixed(4) } as CSSProperties}
            />
          ))}
        </div>
      </div>
      <figcaption className={`ar-axis${labelled ? ' is-labelled' : ''}`} style={{ '--bars': bars.length } as CSSProperties} aria-hidden="true">
        {labelled ? bars.map((bar) => <span key={bar.key}>{bar.label}</span>) : (
          <>
            <span>{dayLabel(report.from)}</span>
            <span>Today</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
