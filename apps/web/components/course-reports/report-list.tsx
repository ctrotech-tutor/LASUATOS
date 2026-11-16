'use client';

import { BarChart3, BookOpenCheck, Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, List, ListRow, PageHeader, RateMeter, SegmentedControl, Sheet } from '../ds';
import { THRESHOLDS } from '../registers/format';
import { setThreshold, useThreshold } from '../registers/threshold';
import { GuideButton } from '../shell/guide-button';
import { lagosDay } from '../take-attendance/format';
import { useClock, useToday } from '../take-attendance/hooks';
import { loadOfferings, OFFERINGS_KEY, overviewKey, overviewLoader } from './data';
import { groupCourses, numberFormat, plural, reportHref, type CourseRow } from './model';
import '../registers/registers.css';
import './course-reports.css';

const PATH = '/lecturer/reports';

/**
 * Attendance reports: each of the lecturer's courses with its average and how many students
 * are below the required attendance; this semester first. A course opens its full report.
 */
export function ReportList() {
  const threshold = useThreshold();
  const now = useClock('fifteen');
  const today = useToday();
  const offerings = useResource(OFFERINGS_KEY, loadOfferings, { maxAge: 30_000 });
  const overview = useResource(overviewKey(threshold), overviewLoader(threshold), { maxAge: 30_000 });
  const [options, setOptions] = useState(false);

  const groups = useMemo(
    () => (offerings.data && now ? groupCourses(offerings.data, overview.data ?? [], now) : null),
    [offerings.data, overview.data, now],
  );
  const header = (
    <PageHeader
      title="Attendance reports"
      subtitle={`${threshold}% required`}
      actions={(
        <div className="rg-head-actions">
          <GuideButton page={PATH} label="Attendance reports" />
          <button className="ds-icon-btn" type="button" aria-label="Required attendance" data-tip="Required attendance" onClick={() => setOptions(true)}>
            <SlidersHorizontal size={18} strokeWidth={2.1} aria-hidden="true" />
          </button>
        </div>
      )}
    />
  );

  const thresholdSheet = (
    <Sheet open={options} onClose={() => setOptions(false)} title="Required attendance">
      <div className="rg-options-sheet">
        <section className="ds-section">
          <SegmentedControl
            label="Required attendance"
            segments={THRESHOLDS.map((value) => ({ value: String(value), label: `${value}%` }))}
            value={String(threshold)}
            onChange={(value) => setThreshold(Number(value))}
            block
          />
          <p className="ds-section-foot">Who counts as below it, here and in every report, the download and the printout. Kept on this device; Course registers use it too.</p>
        </section>
      </div>
    </Sheet>
  );

  if (!groups) {
    return (
      <div className="rg rp">
        {header}
        {offerings.error ? (
          <div className="ds-card">
            <EmptyState error title="Your courses did not load" message={offerings.error} action={<Button variant="tinted" onClick={offerings.reload}>Try again</Button>} />
          </div>
        ) : <ListBones />}
        {thresholdSheet}
      </div>
    );
  }

  const none = !groups.current.length && !groups.upcoming.length && !groups.earlier.length;
  return (
    <div className="rg rp">
      {header}
      {none ? (
        <div className="ds-card">
          <EmptyState
            icon={<BookOpenCheck size={26} strokeWidth={1.9} aria-hidden="true" />}
            title="No courses yet"
            message="A report appears for each course you add in Course tools, once you hold classes for it."
            action={<Button href="/lecturer/courses" icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>Go to Course tools</Button>}
          />
        </div>
      ) : (
        <>
          {overview.error && !overview.data ? (
            <p className="rp-note is-error" role="alert">
              Figures did not load: {overview.error}{' '}
              <button className="rp-link" type="button" onClick={overview.reload}>Try again</button>
            </p>
          ) : null}
          <CourseGroup title="This semester" rows={groups.current} threshold={threshold} today={today} loading={!overview.data && !overview.error} />
          <CourseGroup title="Next semester" rows={groups.upcoming} threshold={threshold} today={today} loading={false} />
          <CourseGroup title="Earlier" rows={groups.earlier} threshold={threshold} today={today} loading={!overview.data && !overview.error} />
        </>
      )}
      {thresholdSheet}
    </div>
  );
}

function CourseGroup({ title, rows, threshold, today, loading }: Readonly<{
  title: string;
  rows: readonly CourseRow[];
  threshold: number;
  today: string;
  loading: boolean;
}>) {
  if (!rows.length) return null;
  const id = `rp-group-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className="ds-section" aria-labelledby={id}>
      <div className="ds-section-head"><h2 className="ds-section-title" id={id}>{title}</h2></div>
      <List className="rp-courses">
        {rows.map((row) => <CourseRowItem key={row.offering.courseOfferingId} row={row} threshold={threshold} today={today} loading={loading} />)}
      </List>
    </section>
  );
}

function CourseRowItem({ row, threshold, today, loading }: Readonly<{ row: CourseRow; threshold: number; today: string; loading: boolean }>) {
  const { offering, standing } = row;
  const held = standing?.sessionsHeld ?? offering.sessions;
  const last = standing?.lastSessionAt ? lastClassLabel(standing.lastSessionAt, today) : null;
  const facts = [
    held ? plural(held, 'class', 'classes') : 'No classes yet',
    plural(standing?.activeStudents ?? offering.students, 'student'),
    last ? `last ${last}` : null,
  ].filter((fact): fact is string => Boolean(fact));
  const below = standing?.studentsBelowThreshold ?? 0;
  return (
    <ListRow
      href={reportHref(offering.courseOfferingId)}
      title={(
        <span className="rp-course-title">
          <span className="rp-code">{offering.courseCode}</span>
          <span className="rp-course-name">{offering.courseTitle}</span>
        </span>
      )}
      subtitle={(
        <>
          {/* Lines break only between facts, with the dot left at the end of a line. */}
          {facts.map((fact, index) => (
            <span key={fact} className={fact.startsWith('last ') ? 'rp-fact-when' : undefined}><span className="rp-fact">{fact}{index < facts.length - 1 || below ? <span className="rp-sep"> ·</span> : ''}</span>{index < facts.length - 1 || below ? ' ' : ''}</span>
          ))}
          {below ? <span className="rp-fact rp-below">{numberFormat.format(below)} below {threshold}%</span> : null}
        </>
      )}
      trailing={(
        <span className="rp-trailing">
          {offering.openDisputes ? <Badge tone="warning">{plural(offering.openDisputes, 'dispute')}</Badge> : null}
          {held ? (loading && !standing ? <span className="ds-skeleton rp-meter-bone" aria-hidden="true" /> : <RateMeter rate={standing?.averageRate ?? null} threshold={threshold} />) : null}
        </span>
      )}
    />
  );
}

const shortDay = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short' });
const withYear = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });

/** "today", "yesterday", "Thu 12 Nov", or "3 Mar 2025" in another year. */
function lastClassLabel(iso: string, today: string): string {
  const day = lagosDay(iso);
  if (day === today) return 'today';
  if (today && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) === 86_400_000) return 'yesterday';
  return (day.slice(0, 4) === today.slice(0, 4) ? shortDay : withYear).format(new Date(iso)).replace(',', '');
}

function ListBones() {
  return (
    <ul className="ds-list rp-courses" role="status" aria-label="Loading your courses">
      {[0, 1, 2].map((key) => (
        <li key={key}>
          <div className="ds-row">
            <span className="ds-row-body">
              <span className="ds-skeleton" style={{ width: '45%', height: 16 }} />
              <span className="ds-skeleton" style={{ width: '65%', height: 12 }} />
            </span>
            <BarChart3 size={18} className="rp-bone-icon" aria-hidden="true" />
          </div>
        </li>
      ))}
    </ul>
  );
}
