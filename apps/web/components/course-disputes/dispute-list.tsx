'use client';

import { ATTENDANCE_DISPUTE_WINDOW_DAYS } from '@lasuatos/contracts';
import { Check, CheckCircle2, ListFilter, MessageSquareWarning, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatShortDay } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { arrivalsSentence, useArrivals } from '../../lib/use-arrivals';
import { LiveAnnouncer, LiveLag } from '../ui/live-status';
import { Badge, Button, EmptyState, List, ListRow, PageHeader, SegmentedControl, Sheet } from '../ds';
import { Mark } from '../course-reports/grid';
import { GuideButton } from '../shell/guide-button';
import { useToday } from '../take-attendance/hooks';
import { listKey, listLoader, loadOfferings, OFFERINGS_KEY } from './data';
import { DisputeSheet } from './dispute-sheet';
import { canUphold, daysSince, inCourse, KIND_LABEL, numberFormat, OUTCOME, waitedLabel, type Dispute, type DisputeList, type Tab } from './model';
import '../registers/registers.css';
import '../course-reports/course-reports.css';
import './course-disputes.css';

const PATH = '/lecturer/disputes';

/**
 * Attendance disputes: students who say a mark in one of the lecturer's courses is wrong.
 * Waiting ones come oldest first; a dispute opens in a sheet with the class, the student's
 * account and where they stand, and is upheld or rejected there with a note to the student.
 */
export function CourseDisputes({ courseOfferingId: initialCourse }: Readonly<{ courseOfferingId: string }>) {
  const today = useToday();
  const [tab, setTab] = useState<Tab>('open');
  const [course, setCourse] = useState(initialCourse);
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // New disputes arrive by themselves: every 15 s while the page is in view, every 45 s once
  // nothing has changed for two minutes, and at once when the page comes back into view.
  // Unchanged polls are answered with no body (lib/remembered-answers).
  const open = useResource(listKey('open'), listLoader('open'), { maxAge: 0, poll: 15_000, pollQuiet: 45_000 });
  const decided = useResource(tab === 'resolved' ? listKey('resolved') : null, listLoader('resolved'), { maxAge: 20_000 });
  const offerings = useResource(OFFERINGS_KEY, loadOfferings, { maxAge: 30_000 });

  const list = tab === 'open' ? open : decided;
  const shown = useMemo(() => (list.data ? inCourse(list.data.disputes, course) : null), [list.data, course]);
  const waiting = open.data ? inCourse(open.data.disputes, course).length : null;
  // Disputes that came in while the page was open light up, and are read out once.
  const arrivals = useArrivals(open.data?.disputes, disputeId);
  const arrivalNews = arrivalsSentence(arrivals.arrived.map((dispute) => dispute.student.displayName), arrivals.arrived.length === 1 ? 'sent a new dispute' : 'sent new disputes');
  const courses = useMemo(() => {
    const rows = [...(offerings.data ?? [])];
    // Courses with something waiting first, then by code.
    return rows.sort((a, b) => Number(b.openDisputes > 0) - Number(a.openDisputes > 0) || a.courseCode.localeCompare(b.courseCode));
  }, [offerings.data]);
  const courseCode = course
    ? courses.find((row) => row.courseOfferingId === course)?.courseCode
      ?? open.data?.disputes.find((dispute) => dispute.courseOfferingId === course)?.courseCode
      ?? 'One course'
    : null;

  function chooseCourse(next: string) {
    setCourse(next);
    setFiltering(false);
    // The address keeps the filter, so a reload or a shared link shows the same list.
    window.history.replaceState(window.history.state, '', next ? `${PATH}?courseOfferingId=${next}` : PATH);
  }

  const subtitle = waiting === null
    ? '\u00a0'
    : waiting ? `${numberFormat.format(waiting)} waiting for you` : 'Nothing waiting';

  return (
    <div className="rg rp dp">
      <PageHeader
        title="Disputes"
        subtitle={subtitle}
        actions={(
          <div className="rg-head-actions">
            <GuideButton page={PATH} label="Disputes" />
            {courses.length > 1 ? (
              <button className="ds-icon-btn" type="button" aria-label="Choose a course" data-tip="Choose a course" onClick={() => setFiltering(true)}>
                <ListFilter size={18} strokeWidth={2.1} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )}
      />

      <div className="dp-bar">
        <SegmentedControl
          label="Show"
          block
          value={tab}
          onChange={setTab}
          segments={[
            { value: 'open', label: <>Waiting{waiting ? <span className="dp-count">{numberFormat.format(waiting)}</span> : null}</> },
            { value: 'resolved', label: 'Decided' },
          ]}
        />
        {courseCode ? (
          <button className="dp-chip" type="button" onClick={() => chooseCourse('')}>
            <span>{courseCode}</span>
            <X size={14} strokeWidth={2.6} aria-hidden="true" />
            <span className="sr-only">: show every course</span>
          </button>
        ) : null}
      </div>

      {shown === null ? (
        list.error ? (
          <div className="ds-card">
            <EmptyState error title="Disputes did not load" message={list.error} action={<Button variant="tinted" onClick={list.reload}>Try again</Button>} />
          </div>
        ) : <ListBones />
      ) : shown.length === 0 ? (
        <div className="ds-card">
          {tab === 'open' ? (
            <EmptyState
              icon={<CheckCircle2 size={26} strokeWidth={1.9} aria-hidden="true" />}
              title={courseCode ? `Nothing waiting in ${courseCode}` : 'Nothing waiting'}
              message={`Students can dispute a mark for up to ${ATTENDANCE_DISPUTE_WINDOW_DAYS} days after a class. New ones appear here, and you get an email.`}
            />
          ) : (
            <EmptyState
              icon={<MessageSquareWarning size={26} strokeWidth={1.9} aria-hidden="true" />}
              title="No decisions yet"
              message={courseCode ? `Disputes in ${courseCode} that you or another lecturer decided, or the student withdrew, appear here.` : 'Disputes you or another lecturer decided, or the student withdrew, appear here.'}
            />
          )}
        </div>
      ) : (
        <>
          <LiveLag error={list.error} checkedAt={list.checkedAt} onRetry={list.reload} />
          <List leading className="dp-list" label={tab === 'open' ? 'Waiting, oldest first' : 'Decided, newest first'}>
            {shown.map((dispute) => (
              <DisputeRow key={dispute.id} dispute={dispute} today={today} fresh={tab === 'open' && arrivals.fresh.has(dispute.id)} onOpen={() => setSelected(dispute.id)} />
            ))}
          </List>
          {tab === 'open' && shown.length > 1 ? <p className="rg-quiet">Oldest first, so no one waits longest.</p> : null}
        </>
      )}

      <LiveAnnouncer message={arrivalNews} round={arrivals.round} />

      <DisputeSheet
        selectedId={selected}
        lists={[open.data, decided.data].filter((data): data is DisputeList => Boolean(data))}
        openList={open.data}
        course={course}
        today={today}
        onSelect={setSelected}
        onClose={() => setSelected(null)}
        onStale={() => { open.reload(); decided.reload(); }}
      />

      <Sheet open={filtering} onClose={() => setFiltering(false)} title="Course">
        <List label="Courses">
          <ListRow
            onClick={() => chooseCourse('')}
            title="Every course"
            trailing={course ? null : <Check className="dp-check" size={18} strokeWidth={2.6} aria-label="Chosen" />}
          />
          {courses.map((row) => (
            <ListRow
              key={row.courseOfferingId}
              onClick={() => chooseCourse(row.courseOfferingId)}
              title={<span className="rp-course-title"><span className="rp-code">{row.courseCode}</span><span className="rp-course-name">{row.courseTitle}</span></span>}
              trailing={(
                <span className="rp-trailing">
                  {row.openDisputes ? <Badge tone="warning">{numberFormat.format(row.openDisputes)} waiting</Badge> : null}
                  {course === row.courseOfferingId ? <Check className="dp-check" size={18} strokeWidth={2.6} aria-label="Chosen" /> : null}
                </span>
              )}
            />
          ))}
        </List>
      </Sheet>
    </div>
  );
}

const disputeId = (dispute: Dispute) => dispute.id;

function DisputeRow({ dispute, today, fresh, onOpen }: Readonly<{ dispute: Dispute; today: string; fresh: boolean; onOpen: () => void }>) {
  const decided = dispute.status !== 'open';
  const outcome = dispute.status === 'open' ? null : OUTCOME[dispute.status];
  const quote = decided
    ? dispute.status === 'withdrawn' ? 'Withdrawn by the student' : `“${dispute.resolutionNote ?? ''}”`
    : `“${dispute.statement}”`;
  return (
    <ListRow
      onClick={onOpen}
      chevron
      highlight={fresh}
      leading={(
        <span className={`rp-mark-badge dp-kind is-${dispute.kind === 'revoked_check_in' ? 'removed' : 'absent'}`}>
          <Mark cell={dispute.kind === 'revoked_check_in' ? 'revoked' : 'absent'} />
        </span>
      )}
      title={(
        <span className="dp-row-title">
          <span className="dp-name">{dispute.student.displayName}</span>
          {canUphold(dispute) || decided ? null : <Badge>Left</Badge>}
        </span>
      )}
      subtitle={(
        <>
          <span className="dp-where">
            <span className="dp-fact">{dispute.courseCode}<span className="rp-sep"> ·</span></span>{' '}
            <span className="dp-fact dp-class">{dispute.sessionTitle}<span className="rp-sep"> ·</span></span>{' '}
            <span className="dp-fact">{formatShortDay(dispute.sessionStartsAt)}</span>
          </span>
          <span className="dp-quote">{quote}</span>
        </>
      )}
      trailing={(
        <span className="dp-trailing">
          {outcome ? <Badge tone={outcome.tone}>{outcome.label}</Badge> : (
            // Amber after five days: it has waited long enough to be worth doing first.
            <span className={`dp-waited${today && daysSince(dispute.createdAt, today) >= 5 ? ' is-long' : ''}`}>
              {today ? waitedLabel(dispute.createdAt, today) : ''}
            </span>
          )}
          <span className="sr-only">{decided ? '' : `, ${KIND_LABEL[dispute.kind].toLowerCase()}`}</span>
        </span>
      )}
    />
  );
}

function ListBones() {
  return (
    <ul className="ds-list has-leading dp-list" role="status" aria-label="Loading disputes">
      {[0, 1, 2].map((key) => (
        <li key={key}>
          <div className="ds-row">
            <span className="ds-row-leading"><span className="ds-skeleton dp-bone-icon" /></span>
            <span className="ds-row-body">
              <span className="ds-skeleton" style={{ width: '40%', height: 16 }} />
              <span className="ds-skeleton" style={{ width: '62%', height: 12 }} />
              <span className="ds-skeleton" style={{ width: '80%', height: 12 }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

