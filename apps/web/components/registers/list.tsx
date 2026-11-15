'use client';

import type { LectureRegisterCourses } from '@lasuatos/contracts';
import { BookOpenCheck, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatShortDay, loadRegisterCourses } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { Button, EmptyState, PageHeader, RateMeter } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { AccessMessage, useTakerAccess } from '../take-attendance/access';
import { SearchField } from '../ui/search-field';
import { plural } from './format';
import { registerHref } from './href';
import { useThreshold } from './threshold';
import './registers.css';

type Course = LectureRegisterCourses['courses'][number];
// One loader per required rate, so useResource sees a stable function.
const loaders = new Map<number, (signal: AbortSignal) => Promise<LectureRegisterCourses>>();
function loaderFor(threshold: number) {
  let loader = loaders.get(threshold);
  if (!loader) {
    loader = (signal) => loadRegisterCourses(threshold, signal);
    loaders.set(threshold, loader);
  }
  return loader;
}
const SEARCH_FROM = 8;
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const dayMonthYear = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

/**
 * Course registers: every course with sessions. This semester's courses come first, each with
 * its average attendance and how many are below the required line; earlier ones follow.
 */
export function RegisterList() {
  const { access, retry } = useTakerAccess();
  const threshold = useThreshold();
  const courses = useResource(access.kind === 'ready' ? `registers:courses:${threshold}` : null, loaderFor(threshold), { maxAge: 60_000 });
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const list = courses.data?.courses ?? [];
    const needle = query.trim().toLowerCase().replace(/\s+/g, '');
    const found = needle ? list.filter((course) => `${course.courseCode}${course.courseTitle}`.toLowerCase().replace(/\s+/g, '').includes(needle)) : list;
    const byCode = (a: Course, b: Course) => collator.compare(a.courseCode, b.courseCode);
    return {
      current: found.filter((course) => course.standing).sort(byCode),
      earlier: found.filter((course) => !course.standing).sort((a, b) => b.lastHeldAt.localeCompare(a.lastHeldAt)),
    };
  }, [courses.data, query]);

  if (access.kind !== 'ready' && access.kind !== 'loading') return <div className="rg"><AccessMessage access={access} retry={retry} /></div>;

  const data = courses.data;
  const header = <PageHeader title="Course registers" actions={<GuideButton page="/registers" label="Course registers" />} />;

  if (!data) {
    return (
      <div className="rg">
        {header}
        {courses.error ? (
          <div className="ds-card"><EmptyState error title="Registers did not load" message={courses.error} action={<Button variant="tinted" onClick={courses.reload}>Try again</Button>} /></div>
        ) : <ListSkeleton />}
      </div>
    );
  }

  if (data.courses.length === 0) {
    return (
      <div className="rg">
        {header}
        <div className="ds-card">
          <EmptyState
            icon={<BookOpenCheck size={26} strokeWidth={1.9} />}
            title="No registers yet"
            message="A course gets a register when attendance is first taken for it."
            action={<Button href="/sessions">Take attendance</Button>}
          />
        </div>
      </div>
    );
  }

  const since = formatShortDay(`${data.standingSince}T12:00:00Z`);
  return (
    <div className="rg">
      {header}
      {data.courses.length >= SEARCH_FROM ? (
        <SearchField className="rg-find" value={query} onValueChange={setQuery} placeholder="Course code or title" aria-label="Find a course" />
      ) : null}
      {groups.current.length ? (
        <section className="ds-section" aria-labelledby="rg-current-title">
          <div className="ds-section-head">
            <h2 className="ds-section-title" id="rg-current-title">{data.standingLabel ? 'This semester' : 'Last 90 days'}</h2>
            <span className="ds-section-aside">Since {since}</span>
          </div>
          <ul className="ds-list rg-courses">
            {groups.current.map((course) => <CourseRow key={course.courseCode} course={course} threshold={data.threshold} />)}
          </ul>
        </section>
      ) : null}
      {groups.earlier.length ? (
        <section className="ds-section" aria-labelledby="rg-earlier-title">
          <div className="ds-section-head">
            <h2 className="ds-section-title" id="rg-earlier-title">Earlier</h2>
          </div>
          <ul className="ds-list rg-courses">
            {groups.earlier.map((course) => <CourseRow key={course.courseCode} course={course} threshold={data.threshold} />)}
          </ul>
        </section>
      ) : null}
      {!groups.current.length && !groups.earlier.length ? <p className="rg-quiet" role="status">No course matches “{query.trim()}”.</p> : null}
    </div>
  );
}

function CourseRow({ course, threshold }: Readonly<{ course: Course; threshold: number }>) {
  const { standing } = course;
  return (
    <li>
      <Link className="ds-row rg-course" href={registerHref(course.courseCode)}>
        <span className="rg-code">{course.courseCode}</span>
        <span className="ds-row-body">
          <span className="rg-code-inline">{course.courseCode}</span>
          <span className="ds-row-title">{course.courseTitle}</span>
          <span className="ds-row-subtitle">
            {standing ? (
              <>
                {plural(standing.held, 'session')}
                <span className="rg-hide-narrow"> · {plural(standing.students, 'student')}</span>
                {standing.below ? <span className="rg-below-note"> · {standing.below} below {threshold}%</span> : null}
              </>
            ) : <>{plural(course.sessionCount, 'session')} · last {dayMonthYear.format(new Date(course.lastHeldAt))}</>}
          </span>
        </span>
        {standing ? <RateMeter rate={standing.rate} threshold={threshold} /> : null}
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="ds-section" role="status" aria-label="Loading registers">
      <div className="ds-section-head"><span className="ds-skeleton" style={{ width: 120, height: 20 }} /></div>
      <ul className="ds-list" aria-hidden="true">
        {[62, 48, 56, 40].map((width) => (
          <li key={width}>
            <div className="ds-row">
              <span className="ds-skeleton rg-code-bone" />
              <span className="ds-row-body">
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 15 }} />
                <span className="ds-skeleton" style={{ width: '34%', height: 12 }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
