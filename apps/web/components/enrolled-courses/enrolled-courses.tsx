'use client';

import type { AdministratorAttendanceOverview } from '@lasuatos/contracts';
import { BookOpen, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { loadAdministratorAttendanceOverview } from '../../lib/attendance-api';
import { useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, List, RateMeter, SegmentedControl, Sheet, SkeletonLines, Stat, Stats } from '../ds';
import { SearchField } from '../ui/search-field';
import { SwitchField } from '../ui/switch';
import {
  classesLabel, count, evidenceChips, percent, plural, PREVIEW, studentsLabel, THRESHOLD,
  updatedLabel, visibleOfferings, waitLabel, type Offering, type Sort,
} from './model';
import './enrolled-courses.css';

const KEY = 'admin:attendance-overview';
const loader = (signal: AbortSignal) => loadAdministratorAttendanceOverview(signal);

const SORTS = [
  { value: 'rate', label: 'Lowest' },
  { value: 'disputes', label: 'Disputes' },
  { value: 'recent', label: 'Recent' },
  { value: 'code', label: 'A–Z' },
] as const;

/**
 * Attendance in enrolled courses (course offerings with class lists), under the attendance report.
 * The totals first, then the courses lowest first; "See all" searches and sorts every course.
 * How the figures are worked out lives in the page's Guide ("Enrolled courses").
 */
export function EnrolledCourses() {
  const overview = useResource(KEY, loader, { maxAge: 60_000 });
  const [open, setOpen] = useState(false);
  // Busy from a tap on Refresh until a new answer (or a failure) replaces the one on screen.
  const [pending, setPending] = useState<{ at: string; error: string | undefined } | null>(null);
  const { data, error } = overview;
  const refreshing = pending !== null && data !== undefined && pending.at === data.generatedAt && pending.error === error;

  const preview = useMemo(() => (data ? visibleOfferings(data.offerings).slice(0, PREVIEW) : []), [data]);
  const total = data?.offerings.length ?? 0;

  const refresh = () => {
    if (data) setPending({ at: data.generatedAt, error });
    overview.reload();
  };

  return (
    <section className="ds-section ae" id="enrolled-courses" aria-labelledby="ae-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ae-title">Enrolled courses</h2>
        {total > preview.length ? (
          <button className="ae-link" type="button" onClick={() => setOpen(true)}>See all {count(total)}</button>
        ) : null}
      </div>

      {data ? (
        <>
          <Totals overview={data} />
          {preview.length ? (
            <List className="ae-list" label="Courses, lowest attendance first">
              {preview.map((offering) => <CourseRow key={offering.courseOfferingId} offering={offering} now={data.generatedAt} />)}
            </List>
          ) : (
            <div className="ds-card">
              <EmptyState
                icon={<BookOpen size={22} />}
                title="No classes held yet"
                message={`${plural(total, 'course')} ${total === 1 ? 'has' : 'have'} class lists, but no class has been held in ${total === 1 ? 'it' : 'them'}.`}
              />
            </div>
          )}
          <div className="ae-foot">
            <p className="ae-updated" role="status">
              {error && !refreshing
                ? <span className="ae-stale">Couldn’t refresh. Showing figures from {updatedLabel(data.generatedAt)}.</span>
                : <>Updated {updatedLabel(data.generatedAt)}</>}
            </p>
            <button className="ae-link ae-refresh" type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing || undefined}>
              <RefreshCw className={refreshing ? 'ae-spin' : undefined} size={15} strokeWidth={2.2} aria-hidden="true" />
              {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
          <Sheet open={open} onClose={() => setOpen(false)} title="Enrolled courses">
            {open ? <AllCourses overview={data} /> : null}
          </Sheet>
        </>
      ) : error ? (
        <div className="ds-card">
          <EmptyState
            error
            title="Couldn’t load enrolled courses"
            message={error}
            action={<Button variant="tinted" icon={<RefreshCw size={16} />} onClick={overview.reload}>Try again</Button>}
          />
        </div>
      ) : (
        <div className="ds-card">
          <SkeletonLines lines={4} label="Loading enrolled courses" />
        </div>
      )}
    </section>
  );
}

function Totals({ overview }: Readonly<{ overview: AdministratorAttendanceOverview }>) {
  const { totals, generatedAt } = overview;
  const rateTone = totals.rate === null ? undefined : totals.rate >= THRESHOLD ? 'success' : 'warning';
  return (
    <Stats label="Enrolled course totals">
      <Stat
        label="Attendance"
        value={percent(totals.rate)}
        tone={rateTone}
        hint={totals.expectedCheckIns ? `${count(totals.presentCheckIns)} of ${count(totals.expectedCheckIns)} expected` : 'Nothing expected yet'}
      />
      <Stat
        label="Classes held"
        value={count(totals.sessionsHeld)}
        hint={`In ${plural(totals.offeringsWithSessions, 'course')}`}
      />
      <Stat
        label="Open disputes"
        value={count(totals.openDisputes)}
        tone={totals.openDisputes ? 'warning' : undefined}
        hint={waitLabel(totals.oldestOpenDisputeAt, generatedAt)}
      />
      <Stat label="Location unclear" value={count(totals.inconclusiveCheckIns)} hint="Counted as present" />
      <Stat label="Added by hand" value={count(totals.manualCheckIns)} hint="By a lecturer" />
      <Stat label="Removed" value={count(totals.revokedCheckIns)} hint="Not counted" />
    </Stats>
  );
}

function CourseRow({ offering, now }: Readonly<{ offering: Offering; now: string }>) {
  const chips = evidenceChips(offering, now);
  return (
    <li>
      <div className="ds-row ae-row">
        <span className="ae-code" aria-hidden="true">{offering.courseCode}</span>
        <span className="ds-row-body ae-body">
          <span className="ae-code-inline">{offering.courseCode}</span>
          <span className="ds-row-title ae-title">
            <span className="sr-only">{offering.courseCode}: </span>{offering.courseTitle}
          </span>
          <span className="ds-row-subtitle ae-where">{offering.departmentName} · {offering.semesterLabel}</span>
          <span className="ds-row-subtitle">{classesLabel(offering, now)} · {studentsLabel(offering)}</span>
          {chips.length ? (
            <span className="ae-chips">
              {chips.map((chip) => <Badge key={chip.key} tone={chip.tone}>{chip.text}</Badge>)}
            </span>
          ) : null}
        </span>
        <span className="ae-rate">
          <RateMeter rate={offering.rate} threshold={THRESHOLD} />
          <small>{offering.expectedCheckIns ? `${count(offering.presentCheckIns)} of ${count(offering.expectedCheckIns)}` : 'None expected'}</small>
        </span>
      </div>
    </li>
  );
}

function AllCourses({ overview }: Readonly<{ overview: AdministratorAttendanceOverview }>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('rate');
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const empty = useMemo(() => overview.offerings.filter((offering) => offering.sessionsHeld === 0).length, [overview.offerings]);
  const rows = useMemo(() => visibleOfferings(overview.offerings, { query, sort, includeEmpty }), [overview.offerings, query, sort, includeEmpty]);
  const shown = includeEmpty ? overview.offerings.length : overview.offerings.length - empty;
  return (
    <div className="ae-sheet">
      <SearchField value={query} onValueChange={setQuery} placeholder="Code, title or department" aria-label="Filter courses" data-autofocus />
      <SegmentedControl segments={SORTS} value={sort} onChange={setSort} label="Sort courses" block />
      {empty ? (
        <SwitchField
          checked={includeEmpty}
          onCheckedChange={setIncludeEmpty}
          label="Show courses with no classes"
          hint={`${plural(empty, 'course')} with a class list but no class yet`}
        />
      ) : null}
      {rows.length ? (
        <List className="ae-list" label="Enrolled courses">
          {rows.map((offering) => <CourseRow key={offering.courseOfferingId} offering={offering} now={overview.generatedAt} />)}
        </List>
      ) : null}
      <p className="ae-quiet" role="status">
        {rows.length === 0
          ? (query.trim() ? `No course matches “${query.trim()}”.` : 'No classes held in any course yet.')
          : query.trim() ? `${plural(rows.length, 'course')} of ${count(shown)}` : ''}
      </p>
    </div>
  );
}
