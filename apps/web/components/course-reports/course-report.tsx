'use client';

import { Download, MessageSquareWarning, Plus, Printer, QrCode, SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { offeringAttendanceReportCsvUrl } from '../../lib/attendance-api';
import { formatDay } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, List, ListRow, Menu, PageHeader, RateMeter, SegmentedControl, Sheet, Stat, Stats } from '../ds';
import { THRESHOLDS } from '../registers/format';
import { setThreshold, useThreshold } from '../registers/threshold';
import { GuideButton } from '../shell/guide-button';
import { SearchField } from '../ui/search-field';
import { ClassSheet } from './class-sheet';
import { useClock } from '../take-attendance/hooks';
import { afterCorrection, loadOfferings, OFFERINGS_KEY, reportKey, reportLoader } from './data';
import { ReportGrid } from './grid';
import { isBelow, LEGEND, matches, numberFormat, plural, sortStudents, summarize, type Report, type ReportSort, type Student } from './model';
import { StudentSheet, type StudentFocus } from './student-sheet';
import '../registers/registers.css';
import './course-reports.css';

const BACK = { href: '/lecturer/reports', label: 'Reports' };
const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'matric', label: 'Matric' },
  { value: 'rate', label: 'Lowest' },
] as const;
const hasLiveClass = (report: Report) => report.sessions.some((session) => session.status === 'open');

/**
 * One course's attendance report: every student against every class, for exam eligibility.
 * Marks can be corrected (with a reason) from a student or a class; the figures follow at once.
 */
export function CourseReport({ courseOfferingId }: Readonly<{ courseOfferingId: string }>) {
  const report = useResource(reportKey(courseOfferingId), reportLoader(courseOfferingId), { maxAge: 30_000, poll: 20_000, pollWhile: hasLiveClass });

  if (!report.data) {
    return (
      <div className="rg rg-register rp">
        <PageHeader back={BACK} title={report.error ? 'Report' : <span className="ds-skeleton rg-title-bone" />} />
        {report.error ? (
          <div className="ds-card">
            <EmptyState error title="This report did not load" message={report.error} action={<Button variant="tinted" onClick={report.reload}>Try again</Button>} />
          </div>
        ) : <ReportSkeleton />}
      </div>
    );
  }
  return <ReportBody key={report.data.offering.id} report={report.data} reload={report.reload} />;
}

function ReportBody({ report, reload }: Readonly<{ report: Report; reload: () => void }>) {
  const router = useRouter();
  const threshold = useThreshold();
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'all' | 'below'>('all');
  const [sort, setSort] = useState<ReportSort>('name');
  const [options, setOptions] = useState(false);
  const [student, setStudent] = useState<StudentFocus | null>(null);
  const [classIndex, setClassIndex] = useState<number | null>(null);

  const { offering, sessions } = report;
  const held = sessions.length;
  const stats = useMemo(() => summarize(report, threshold), [report, threshold]);
  const rows = useMemo(
    () => sortStudents(report.students, sort).filter((row) => (show === 'all' || isBelow(row, threshold)) && matches(row, query)),
    [report.students, sort, show, threshold, query],
  );
  const live = sessions.find((session) => session.status === 'open') ?? null;
  const span = held ? dateSpan(sessions[0]!.startsAt, sessions[held - 1]!.startsAt) : null;
  const caption = `${offering.courseCode} · ${offering.courseTitle}: attendance, ${offering.semesterLabel} (${plural(held, 'class', 'classes')}, ${threshold}% required)`;
  const sessionsHref = `/lecturer/attendance?courseOfferingId=${offering.id}`;

  function changed(sessionId: string) {
    afterCorrection(sessionId);
    reload();
  }

  return (
    <div className="rg rg-register rp">
      <PageHeader
        back={BACK}
        eyebrow={offering.courseCode}
        title={offering.courseTitle}
        subtitle={[offering.semesterLabel, span].filter(Boolean).join(' · ')}
        actions={(
          <div className="rg-head-actions">
            <GuideButton page="/lecturer/reports" label="Attendance reports" />
            <Menu
              label="Report actions"
              title={offering.courseCode}
              items={[
                held ? { label: 'Download for Excel', icon: <Download size={18} strokeWidth={2.1} />, onSelect: () => window.location.assign(offeringAttendanceReportCsvUrl(offering.id, threshold)) } : null,
                held ? { label: 'Print', icon: <Printer size={18} strokeWidth={2.1} />, onSelect: () => window.print() } : null,
                { label: 'Required attendance', icon: <SlidersHorizontal size={18} strokeWidth={2.1} />, onSelect: () => setOptions(true) },
                { label: 'Course sessions', icon: <QrCode size={18} strokeWidth={2.1} />, onSelect: () => router.push(sessionsHref) },
              ]}
            />
          </div>
        )}
      />

      {report.totals.openDisputes ? (
        <List className="rp-callout" leading>
          <ListRow
            href={`/lecturer/disputes?courseOfferingId=${offering.id}`}
            leading={<span className="rp-callout-icon" aria-hidden="true"><MessageSquareWarning size={18} strokeWidth={2.1} /></span>}
            title={`${plural(report.totals.openDisputes, 'dispute')} waiting for you`}
            subtitle="Students who say a mark here is wrong. Upholding one changes it."
          />
        </List>
      ) : null}

      {live ? (
        <List className="rp-callout is-live" leading>
          <ListRow
            href={`/lecturer/attendance/${live.id}`}
            leading={<span className="rp-live-dot" aria-hidden="true" />}
            title={`${live.title} is taking attendance`}
            subtitle={`${numberFormat.format(live.presentCount)} of ${numberFormat.format(live.expectedCount)} checked in so far. This report updates by itself.`}
          />
        </List>
      ) : null}

      {held === 0 ? (
        <NoClasses courseOfferingId={offering.id} students={stats.students} sessionsHref={sessionsHref} />
      ) : (
        <>
          <Stats label="Summary">
            <Stat label="Classes" value={numberFormat.format(stats.classes)} />
            <Stat label="Students" value={numberFormat.format(stats.students)} hint={stats.left ? `${numberFormat.format(stats.left)} left` : undefined} />
            <Stat label="Average" value={<RateMeter rate={stats.average} threshold={threshold} />} />
            <Stat label={`Below ${threshold}%`} value={numberFormat.format(stats.below)} tone={stats.below ? 'warning' : undefined} />
          </Stats>

          <div className="rg-toolbar">
            <SearchField className="rg-search" value={query} onValueChange={setQuery} placeholder="Name or matric" aria-label="Find a student" />
            <SegmentedControl
              label="Show"
              value={show}
              onChange={setShow}
              segments={[
                { value: 'all', label: `Everyone ${numberFormat.format(report.students.length)}` },
                { value: 'below', label: `Below ${threshold}% ${numberFormat.format(stats.below)}` },
              ]}
            />
            <button className="ds-icon-btn rg-options" type="button" aria-label="Sort and required attendance" data-tip="Sort and required" onClick={() => setOptions(true)}>
              <SlidersHorizontal size={18} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="rg-quiet" role="status">
              {query.trim() ? `No student matches “${query.trim()}”.` : `Everyone is at ${threshold}% or above.`}
            </p>
          ) : (
            <>
              <ReportGrid
                report={report}
                rows={rows}
                threshold={threshold}
                caption={caption}
                onStudent={(row, index) => setStudent({ studentId: row.studentId, classIndex: index ?? null })}
                onClass={setClassIndex}
              />
              <ul className="rp-legend" aria-label="What the marks mean">
                {LEGEND.map((item) => <li key={item.tone}><span className={`rp-mark is-${item.tone}`} aria-hidden="true" />{item.label}</li>)}
              </ul>
              <List className="rg-people" label={`${offering.courseCode} students`}>
                {rows.map((row) => <PersonRow key={row.studentId} row={row} threshold={threshold} onOpen={() => setStudent({ studentId: row.studentId, classIndex: null })} />)}
              </List>
            </>
          )}

          <section className="ds-section rp-classes" aria-labelledby="rp-classes-title">
            <div className="ds-section-head"><h2 className="ds-section-title" id="rp-classes-title">Classes</h2></div>
            <List label="Classes, latest first">
              {[...sessions.keys()].reverse().map((index) => {
                const session = sessions[index]!;
                return (
                  <ListRow
                    key={session.id}
                    onClick={() => setClassIndex(index)}
                    title={session.title}
                    subtitle={`${formatDay(session.startsAt)}${session.venueName ? ` · ${session.venueName}` : ''} · ${numberFormat.format(session.presentCount)} of ${numberFormat.format(session.expectedCount)}`}
                    trailing={session.status === 'open' ? <Badge tone="success" dot>Live</Badge> : <RateMeter rate={session.rate} threshold={threshold} />}
                  />
                );
              })}
            </List>
          </section>
        </>
      )}

      <Sheet open={options} onClose={() => setOptions(false)} title="Report options">
        <div className="rg-options-sheet">
          <section className="ds-section">
            <div className="ds-section-head"><h3 className="ds-section-title rg-sheet-title">Sort by</h3></div>
            <SegmentedControl label="Sort by" segments={SORTS} value={sort} onChange={setSort} block />
          </section>
          <section className="ds-section">
            <div className="ds-section-head"><h3 className="ds-section-title rg-sheet-title">Required attendance</h3></div>
            <SegmentedControl
              label="Required attendance"
              segments={THRESHOLDS.map((value) => ({ value: String(value), label: `${value}%` }))}
              value={String(threshold)}
              onChange={(value) => setThreshold(Number(value))}
              block
            />
            <p className="ds-section-foot">Who counts as below it, here, in the download and on the printout. Kept on this device.</p>
          </section>
        </div>
      </Sheet>

      <StudentSheet
        report={report}
        focus={student}
        threshold={threshold}
        onFocus={setStudent}
        onClose={() => setStudent(null)}
        onChanged={() => { if (student?.classIndex != null) changed(sessions[student.classIndex]!.id); }}
      />
      <ClassSheet
        report={report}
        classIndex={classIndex}
        threshold={threshold}
        onClose={() => setClassIndex(null)}
        onStudent={(row, index) => { setClassIndex(null); setStudent({ studentId: row.studentId, classIndex: index }); }}
      />
    </div>
  );
}

const dayMonth = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });

/** "5 Oct – 16 Nov 2026", or one day; the year shows on both ends when it differs. */
function dateSpan(first: string, last: string): string {
  const [from, to] = [new Date(first), new Date(last)];
  if (dayMonthYear.format(from) === dayMonthYear.format(to)) return dayMonthYear.format(to);
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  return `${(sameYear ? dayMonth : dayMonthYear).format(from)} – ${dayMonthYear.format(to)}`;
}

/** Before the first class: what to do next depends on whether the semester runs and anyone has joined. */
function NoClasses({ courseOfferingId, students, sessionsHref }: Readonly<{ courseOfferingId: string; students: number; sessionsHref: string }>) {
  const offerings = useResource(OFFERINGS_KEY, loadOfferings, { maxAge: 30_000 });
  const now = useClock('fifteen');
  const course = offerings.data?.find((item) => item.courseOfferingId === courseOfferingId);
  const notYet = course && now ? Date.parse(course.semesterStartsAt) > now : false;
  const message = notYet
    ? `Its semester has not started yet. ${students ? `${plural(students, 'student')} ${students === 1 ? 'has' : 'have'} joined so far.` : 'Give students its join code from Course tools so they can join before it does.'}`
    : students
      ? `${plural(students, 'student')} ${students === 1 ? 'has' : 'have'} joined. The report fills in as you hold classes.`
      : 'No students have joined yet. Give them the join code from Course tools, then open a class.';
  return (
    <div className="ds-card">
      <EmptyState
        icon={<QrCode size={26} strokeWidth={1.9} aria-hidden="true" />}
        title="No classes yet"
        message={message}
        action={notYet || !students
          ? <Button variant="tinted" href="/lecturer/courses">Go to Course tools</Button>
          : <Button href={`${sessionsHref}&new=1`} icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>Open a class</Button>}
      />
    </div>
  );
}

function PersonRow({ row, threshold, onOpen }: Readonly<{ row: Student; threshold: number; onOpen: () => void }>) {
  const left = row.enrollmentStatus === 'withdrawn';
  return (
    <ListRow
      onClick={onOpen}
      title={row.displayName}
      subtitle={<><span className="ds-mono">{row.studentNumber}</span> · {row.attendedSessions} of {row.eligibleSessions}</>}
      trailing={left ? <Badge>Left</Badge> : <RateMeter rate={row.rate} threshold={threshold} />}
    />
  );
}

function ReportSkeleton() {
  return (
    <div className="rg-skeleton" role="status" aria-label="Loading the report">
      <div className="ds-stats" aria-hidden="true">
        {[0, 1, 2, 3].map((key) => <div key={key} className="ds-stat"><span className="ds-skeleton" style={{ width: '50%', height: 12 }} /><span className="ds-skeleton" style={{ width: '40%', height: 24 }} /></div>)}
      </div>
      <div className="ds-card rg-grid-bone" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((key) => <span key={key} className="ds-skeleton" style={{ height: 18 }} />)}
      </div>
    </div>
  );
}
