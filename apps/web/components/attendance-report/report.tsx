'use client';

import type { LectureReport, LectureReportPeriod } from '@lasuatos/contracts';
import { Download, Printer, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { loadLectureReport } from '../../lib/lecture-api';
import { revalidate, useResource } from '../../lib/resource';
import { Button, EmptyState, Menu, PageHeader, SegmentedControl } from '../ds';
import { GuideButton } from '../take-attendance/guide-button';
import { BelowSection } from './below';
import { ChecksSection, DepartmentsSection, TakersSection } from './breakdown';
import { CoursesSection } from './courses';
import { downloadBelow, downloadCourses, PERIOD_LABEL } from './format';
import { RateCard } from './hero';
import './report.css';

const PERIODS: readonly LectureReportPeriod[] = ['week', 'month', 'term'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE = 60_000;

type Selection = { readonly period: LectureReportPeriod; readonly department: string | null };
const keyOf = ({ period, department }: Selection) => `report:${period}:${department ?? 'all'}`;

// One loader per selection, kept so useResource sees the same function on every render.
const loaders = new Map<string, (signal: AbortSignal) => Promise<LectureReport>>();
function loaderFor(selection: Selection) {
  const key = keyOf(selection);
  let loader = loaders.get(key);
  if (!loader) {
    loader = (signal) => loadLectureReport(selection.period, selection.department, signal);
    loaders.set(key, loader);
  }
  return loader;
}

function readSelection(params: URLSearchParams | null): Selection {
  const period = params?.get('period');
  const department = params?.get('department') ?? null;
  return {
    period: PERIODS.includes(period as LectureReportPeriod) ? (period as LectureReportPeriod) : 'week',
    department: department && UUID.test(department) ? department : null,
  };
}

/**
 * Attendance overview: how well students attend over 7 days, 30 days or the semester, who is
 * below 75%, and how each course and department compares. The period and department live in
 * the URL, so Back and shared links work like an app.
 */
export function AttendanceReport() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selection = readSelection(params);
  // The answer on screen before a change, shown dimmed while the new one loads.
  const [previous, setPrevious] = useState<Selection | null>(null);

  const current = useResource(keyOf(selection), loaderFor(selection), { maxAge: MAX_AGE });
  const fallbackSelection = previous && keyOf(previous) !== keyOf(selection) ? previous : null;
  const fallback = useResource(fallbackSelection ? keyOf(fallbackSelection) : null, loaderFor(fallbackSelection ?? selection), { maxAge: Infinity });
  const report = current.data ?? fallback.data;
  const stale = !current.data && Boolean(fallback.data);

  function go(next: Selection, mode: 'push' | 'replace') {
    setPrevious(selection);
    const query = new URLSearchParams();
    if (next.period !== 'week') query.set('period', next.period);
    if (next.department) query.set('department', next.department);
    const search = query.toString();
    const href = search ? `${pathname}?${search}` : pathname;
    if (mode === 'push') router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }

  // Warm the other periods when the control is about to be used.
  const prefetch = () => {
    for (const period of PERIODS) {
      if (period !== selection.period) revalidate(keyOf({ ...selection, period }), loaderFor({ ...selection, period }), MAX_AGE);
    }
  };

  const termLabel = report && report.term === null ? '90 days' : PERIOD_LABEL.term;
  const segments = PERIODS.map((period) => ({ value: period, label: period === 'term' ? termLabel : PERIOD_LABEL[period] }));

  return (
    <div className="ar">
      <PageHeader
        title="Attendance overview"
        actions={(
          <div className="ar-head-actions">
            <GuideButton page="/admin/attendance" label="Attendance overview" />
            <Menu
              label="Report actions"
              items={[
                { label: 'Download courses', icon: <Download size={18} strokeWidth={2.1} />, disabled: !report?.courses.length, onSelect: () => report && downloadCourses(report) },
                {
                  label: `Download below ${report?.below.threshold ?? 75}%`,
                  icon: <Download size={18} strokeWidth={2.1} />,
                  disabled: !report?.below.rows.length,
                  onSelect: () => report && downloadBelow(report),
                },
                { label: 'Print', icon: <Printer size={18} strokeWidth={2.1} />, disabled: !report, onSelect: () => window.print() },
              ]}
            />
          </div>
        )}
      />

      <div className="ar-toolbar" onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}>
        <SegmentedControl segments={segments} value={selection.period} onChange={(period) => go({ ...selection, period }, 'replace')} label="Period" />
        {selection.department ? (
          <button className="ar-chip" type="button" onClick={() => go({ ...selection, department: null }, 'replace')} aria-label={`Show every department, not only ${report?.department?.name ?? 'this one'}`}>
            <span>{report?.department?.name ?? 'One department'}</span>
            <X size={15} strokeWidth={2.4} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {report ? (
        <div className={`ar-grid${stale ? ' is-stale' : ''}`} aria-busy={stale}>
          <div className="ar-main">
            <RateCard report={report} />
            <CoursesSection report={report} />
            <DepartmentsSection report={report} onPick={(department) => go({ ...selection, department }, 'push')} />
          </div>
          <div className="ar-rail">
            <BelowSection report={report} />
            <ChecksSection report={report} />
            <TakersSection report={report} />
          </div>
        </div>
      ) : current.error ? (
        <div className="ds-card">
          <EmptyState error title="The report did not load" message={current.error} action={<Button variant="tinted" onClick={current.reload}>Try again</Button>} />
        </div>
      ) : <ReportSkeleton />}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="ar-grid" role="status" aria-label="Loading the report">
      <div className="ar-main">
        <div className="ds-paper ar-hero ar-hero-bones" aria-hidden="true">
          <span className="ar-bone" style={{ width: 120 }} />
          <span className="ar-bone ar-bone-number" />
          <span className="ar-bone ar-bone-chart" />
          <span className="ar-bone" style={{ width: '70%' }} />
        </div>
      </div>
      <div className="ar-rail" aria-hidden="true">
        <ul className="ds-list">
          {[64, 52, 58].map((width) => (
            <li key={width}>
              <div className="ds-row">
                <span className="ds-row-body">
                  <span className="ds-skeleton" style={{ width: `${width}%`, height: 14 }} />
                  <span className="ds-skeleton" style={{ width: '36%', height: 12 }} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
