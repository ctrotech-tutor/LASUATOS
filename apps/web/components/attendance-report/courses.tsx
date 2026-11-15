'use client';

import type { LectureReport } from '@lasuatos/contracts';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SegmentedControl, Sheet } from '../ds';
import { SearchField } from '../ui/search-field';
import { plural } from './format';
import { RateMeter, registerHref } from './parts';

const PREVIEW = 6;
type Course = LectureReport['courses'][number];
type Sort = 'rate' | 'sessions' | 'code';
const SORTS = [
  { value: 'rate', label: 'Lowest' },
  { value: 'sessions', label: 'Most held' },
  { value: 'code', label: 'A–Z' },
] as const;

const sorters: Readonly<Record<Sort, (a: Course, b: Course) => number>> = {
  rate: (a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.sessions - a.sessions,
  sessions: (a, b) => b.sessions - a.sessions || (a.rate ?? 101) - (b.rate ?? 101),
  code: (a, b) => a.courseCode.localeCompare(b.courseCode, 'en', { numeric: true, sensitivity: 'base' }),
};

/** Courses held in the period, lowest rate first; each opens its register. */
export function CoursesSection({ report }: Readonly<{ report: LectureReport }>) {
  const [open, setOpen] = useState(false);
  if (report.courses.length === 0) return null;
  return (
    <section className="ds-section ar-courses" aria-labelledby="ar-courses-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ar-courses-title">Courses</h2>
        {report.courses.length > PREVIEW ? <button className="ar-link" type="button" onClick={() => setOpen(true)}>See all {report.courses.length}</button> : null}
      </div>
      <ul className="ds-list">
        {report.courses.slice(0, PREVIEW).map((course) => <CourseRow key={course.courseCode} course={course} threshold={report.below.threshold} />)}
      </ul>
      <Sheet open={open} onClose={() => setOpen(false)} title="Courses">
        {open ? <CourseList report={report} /> : null}
      </Sheet>
    </section>
  );
}

function CourseRow({ course, threshold }: Readonly<{ course: Course; threshold: number }>) {
  return (
    <li>
      <Link className="ds-row ar-course" href={registerHref(course.courseCode)}>
        <span className="ar-code">{course.courseCode}</span>
        <span className="ds-row-body">
          <span className="ar-code-inline">{course.courseCode}</span>
          <span className="ds-row-title">{course.courseTitle}</span>
          <span className="ds-row-subtitle">
            {plural(course.sessions, 'session')}
            <span className="ar-course-students"> · {plural(course.students, 'student')}</span>
            {course.below ? <span className="ar-below-note"> · {course.below} below {threshold}%</span> : null}
          </span>
        </span>
        <RateMeter rate={course.rate} threshold={threshold} />
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </Link>
    </li>
  );
}

function CourseList({ report }: Readonly<{ report: LectureReport }>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('rate');
  const courses = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/\s+/g, '');
    const found = needle
      ? report.courses.filter((course) => `${course.courseCode}${course.courseTitle}`.toLowerCase().replace(/\s+/g, '').includes(needle))
      : report.courses;
    return [...found].sort(sorters[sort]);
  }, [report.courses, query, sort]);
  return (
    <div className="ar-sheet">
      <SearchField value={query} onValueChange={setQuery} placeholder="Course code or title" aria-label="Filter courses" />
      <SegmentedControl segments={SORTS} value={sort} onChange={setSort} label="Sort courses" block />
      {courses.length ? (
        <ul className="ds-list" aria-label="Courses">
          {courses.map((course) => <CourseRow key={course.courseCode} course={course} threshold={report.below.threshold} />)}
        </ul>
      ) : <p className="ar-quiet" role="status">No course matches “{query.trim()}”.</p>}
    </div>
  );
}
