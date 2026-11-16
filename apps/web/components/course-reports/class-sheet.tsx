'use client';

import { History } from 'lucide-react';
import { useState } from 'react';
import { formatClock, formatDay } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { Badge, Button, List, ListRow, RateMeter, Sheet, SkeletonLines } from '../ds';
import { changesKey, changesLoader } from './data';
import { Mark } from './grid';
import { CELL, isAttended, numberFormat, plural, type Report, type Student } from './model';

const FIRST_NAMES = 8;

/**
 * One class across the course: how many came, how they checked in, who missed it, and every
 * correction made to it (who, what and why). A missing student opens at this class.
 */
export function ClassSheet({ report, classIndex, threshold, onClose, onStudent }: Readonly<{
  report: Report;
  classIndex: number | null;
  threshold: number;
  onClose: () => void;
  onStudent: (student: Student, classIndex: number) => void;
}>) {
  const [shown, setShown] = useState<number | null>(classIndex);
  if (classIndex !== null && classIndex !== shown) setShown(classIndex);
  const index = classIndex ?? shown;
  const session = index === null ? null : report.sessions[index] ?? null;
  return (
    <Sheet open={classIndex !== null && Boolean(session)} onClose={onClose} title={session?.title ?? 'Class'}>
      {session && index !== null ? <ClassDetail key={session.id} report={report} index={index} threshold={threshold} onStudent={onStudent} /> : null}
    </Sheet>
  );
}

function ClassDetail({ report, index, threshold, onStudent }: Readonly<{
  report: Report;
  index: number;
  threshold: number;
  onStudent: (student: Student, classIndex: number) => void;
}>) {
  const session = report.sessions[index]!;
  const live = session.status === 'open';
  const [all, setAll] = useState(false);
  const changes = useResource(changesKey(session.id), changesLoader(session.id), { maxAge: 15_000 });

  const missing = report.students.filter((student) => student.enrollmentStatus !== 'withdrawn' && !isAttended(student.cells[index]!) && student.cells[index] !== 'not_enrolled');
  const shownMissing = all ? missing : missing.slice(0, FIRST_NAMES);
  const ways = [
    { key: 'within_boundary', label: 'In the room', count: session.withinBoundaryCount },
    { key: 'unlocated', label: 'Location not checked', count: session.unlocatedCount },
    { key: 'inconclusive', label: 'Location unsure', count: session.inconclusiveCount },
    { key: 'manual', label: 'Marked by a lecturer', count: session.manualCount },
    { key: 'revoked', label: 'Check-in removed', count: session.revokedCount },
  ] as const;

  return (
    <div className="rp-class">
      <p className="rg-person-id">
        {formatDay(session.startsAt)}, {formatClock(session.startsAt)}{session.venueName ? ` · ${session.venueName}` : ''}
        {live ? <> · <Badge tone="success" dot>Taking attendance</Badge></> : null}
      </p>
      <div className="rg-person-figure">
        <strong className="rg-person-rate rp-class-count">{numberFormat.format(session.presentCount)}</strong>
        <span>of {plural(session.expectedCount, 'student')} present</span>
        <RateMeter rate={session.rate} threshold={threshold} />
      </div>

      <List label="How they checked in">
        {ways.filter((way) => way.count > 0).map((way) => (
          <ListRow key={way.key} title={<span className="rp-way"><Mark cell={way.key} />{way.label}</span>} detail={numberFormat.format(way.count)} />
        ))}
      </List>

      <section className="ds-section rp-sheet-section" aria-labelledby="rp-missing-title">
        <div className="ds-section-head">
          <h3 className="ds-section-title rg-sheet-title" id="rp-missing-title">{live ? 'Not checked in yet' : 'Missed it'}</h3>
          <span className="rp-section-count">{numberFormat.format(missing.length)}</span>
        </div>
        {missing.length ? (
          <>
            <List label={live ? 'Not checked in yet' : 'Missed it'}>
              {shownMissing.map((student) => (
                <ListRow
                  key={student.studentId}
                  onClick={() => onStudent(student, index)}
                  title={student.displayName}
                  subtitle={<span className="ds-mono">{student.studentNumber}</span>}
                  trailing={<span className={`rp-status is-${CELL[student.cells[index]!].tone}`}><Mark cell={student.cells[index]!} live={live} />{live && student.cells[index] === 'absent' ? 'Not yet' : CELL[student.cells[index]!].short}</span>}
                />
              ))}
            </List>
            {missing.length > FIRST_NAMES && !all ? (
              <Button variant="plain" onClick={() => setAll(true)}>Show all {numberFormat.format(missing.length)}</Button>
            ) : null}
          </>
        ) : <p className="rp-quiet-line">Everyone on the course was there.</p>}
      </section>

      <section className="ds-section rp-sheet-section" aria-labelledby="rp-changes-title">
        <div className="ds-section-head">
          <h3 className="ds-section-title rg-sheet-title" id="rp-changes-title">Changes</h3>
        </div>
        {changes.data ? (
          changes.data.length ? (
            <ol className="rp-changes">
              {changes.data.map((entry) => (
                <li key={entry.id}>
                  <span className={`rp-change-icon is-${entry.action === 'revoke' ? 'removed' : 'marked'}`} aria-hidden="true"><History size={15} strokeWidth={2.2} /></span>
                  <span className="rp-change-body">
                    <strong>{entry.action === 'revoke' ? `${entry.studentName}’s check-in removed` : `${entry.studentName} marked present`}</strong>
                    <q>{entry.reason}</q>
                    <span>
                      {entry.actorName} · {formatDay(entry.createdAt)}, {formatClock(entry.createdAt)}
                      {entry.viaDispute ? ' · from a dispute' : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="rp-quiet-line">No marks in this class have been changed.</p>
        ) : changes.error ? (
          <p className="rp-quiet-line">{changes.error} <button className="rp-link" type="button" onClick={changes.reload}>Try again</button></p>
        ) : <SkeletonLines lines={2} label="Loading the changes" />}
      </section>

      <Button variant="gray" block href={`/lecturer/attendance/${session.id}`}>Open this class</Button>
    </div>
  );
}
