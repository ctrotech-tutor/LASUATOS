'use client';

import { ChevronLeft, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { formatClock, formatDay } from '../../lib/lecture-api';
import { Badge, Button, List, ListRow, rateTone, Sheet } from '../ds';
import { CorrectionForm } from './correction-form';
import { Mark, markLabel } from './grid';
import { CELL, classesToReach, correctionFor, missedInARow, plural, type Report, type Student } from './model';

export type StudentFocus = { readonly studentId: string; readonly classIndex: number | null };

/**
 * One student in this course: where they stand against the required line, what it takes to
 * get back, and every class. A class opens its mark, which can be corrected with a reason.
 * The student is looked up in the latest report, so a correction shows at once.
 */
export function StudentSheet({ report, focus, threshold, onFocus, onClose, onChanged }: Readonly<{
  report: Report;
  focus: StudentFocus | null;
  threshold: number;
  onFocus: (focus: StudentFocus) => void;
  onClose: () => void;
  onChanged: () => void;
}>) {
  // Kept while the sheet animates closed.
  const [shown, setShown] = useState<StudentFocus | null>(focus);
  if (focus && focus !== shown) setShown(focus);
  const current = focus ?? shown;
  const student = current ? report.students.find((item) => item.studentId === current.studentId) ?? null : null;
  return (
    <Sheet open={Boolean(focus && student)} onClose={onClose} title={student?.displayName ?? 'Student'}>
      {student && current ? (
        current.classIndex === null || !report.sessions[current.classIndex] ? (
          <StudentDetail report={report} student={student} threshold={threshold} onClass={(classIndex) => onFocus({ studentId: student.studentId, classIndex })} />
        ) : (
          <MarkDetail
            key={`${student.studentId}:${current.classIndex}`}
            report={report}
            student={student}
            classIndex={current.classIndex}
            onBack={() => onFocus({ studentId: student.studentId, classIndex: null })}
            onChanged={onChanged}
          />
        )
      ) : null}
    </Sheet>
  );
}

function StudentDetail({ report, student, threshold, onClass }: Readonly<{
  report: Report;
  student: Student;
  threshold: number;
  onClass: (classIndex: number) => void;
}>) {
  const active = student.enrollmentStatus !== 'withdrawn';
  const tone = active ? rateTone(student.rate, threshold) : 'none';
  const need = active && student.rate !== null ? classesToReach(student.attendedSessions, student.eligibleSessions, threshold) : null;
  const missed = active ? missedInARow(student.cells) : 0;
  const counted = student.cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => cell !== 'not_enrolled');
  // Newest first, as a history reads.
  const history = report.sessions.map((session, index) => ({ session, index, cell: student.cells[index]! })).reverse();

  return (
    <div className="rg-person rp-person">
      <p className="rg-person-id">
        <span className="ds-mono">{student.studentNumber}</span>
        {student.studentNumberVerified ? null : <span> · matric not verified</span>}
        <span> · {student.levelLabel}{student.levelDiffers ? ' (not this course’s level)' : ''}</span>
      </p>
      {active ? null : <p className="rp-note">Left the course. Their marks are kept, but they no longer count towards the course figures.</p>}
      <div className="rg-person-figure">
        <strong className={`rg-person-rate is-${tone}`}>{student.rate === null ? '–' : `${Math.round(student.rate)}%`}</strong>
        <span>{student.attendedSessions} of {plural(student.eligibleSessions, 'class', 'classes')}</span>
        {active && student.rate !== null
          ? need === null ? <Badge tone="success">At {threshold}% or above</Badge> : <Badge tone={tone === 'danger' ? 'danger' : 'warning'}>Below {threshold}%</Badge>
          : null}
      </div>
      {counted.length ? (
        <div className="rp-strip" role="img" aria-label={`Oldest to newest: ${counted.map(({ cell, index }) => markLabel(cell, report.sessions[index]!.status === 'open').toLowerCase()).join(', ')}`}>
          {counted.map(({ cell, index }) => <Mark key={report.sessions[index]!.id} cell={cell} live={report.sessions[index]!.status === 'open'} />)}
        </div>
      ) : null}
      {need !== null || missed >= 2 ? (
        <ul className="rg-facts">
          {need !== null ? (
            <li>{Number.isFinite(need) ? `Back to ${threshold}% after the next ${plural(need, 'class', 'classes')} in a row` : `${threshold}% can no longer be reached`}</li>
          ) : null}
          {missed >= 2 ? <li>Missed the last {missed} classes</li> : null}
        </ul>
      ) : null}
      <List label="Classes">
        {history.map(({ session, index, cell }) => {
          const live = session.status === 'open';
          return (
            <ListRow
              key={session.id}
              onClick={() => onClass(index)}
              title={session.title}
              subtitle={`${formatDay(session.startsAt)}, ${formatClock(session.startsAt)}${live ? ' · live' : ''}`}
              trailing={<span className={`rp-status is-${CELL[cell].tone}${live && cell === 'absent' ? ' is-pending' : ''}`}><Mark cell={cell} live={live} />{live && cell === 'absent' ? 'Not yet' : CELL[cell].short}</span>}
            />
          );
        })}
      </List>
    </div>
  );
}

/** One student at one class: what the mark is, why, and the change that applies. */
function MarkDetail({ report, student, classIndex, onBack, onChanged }: Readonly<{
  report: Report;
  student: Student;
  classIndex: number;
  onBack: () => void;
  onChanged: () => void;
}>) {
  const [correcting, setCorrecting] = useState(false);
  const session = report.sessions[classIndex]!;
  const cell = student.cells[classIndex]!;
  const live = session.status === 'open';
  const action = correctionFor(cell, student.enrollmentStatus);
  const explanation = explain(cell, live, student.enrollmentStatus);

  return (
    <div className="rp-mark-detail">
      <button className="rp-back" type="button" onClick={onBack}>
        <ChevronLeft size={18} strokeWidth={2.4} aria-hidden="true" />
        Every class
      </button>
      <div className="rp-mark-head">
        <span className={`rp-mark-badge is-${CELL[cell].tone}${live && cell === 'absent' ? ' is-pending' : ''}`}><Mark cell={cell} live={live} /></span>
        <span>
          <strong>{markLabel(cell, live)}</strong>
          <span>{session.title} · {formatDay(session.startsAt)}, {formatClock(session.startsAt)}{session.venueName ? ` · ${session.venueName}` : ''}</span>
        </span>
      </div>
      {explanation ? <p className="rp-explain">{explanation}</p> : null}

      {correcting && action ? (
        <CorrectionForm
          sessionId={session.id}
          studentId={student.studentId}
          studentName={student.displayName}
          action={action}
          onCancel={() => setCorrecting(false)}
          onDone={() => { setCorrecting(false); onChanged(); }}
        />
      ) : (
        <div className="rp-actions is-stack">
          {action === 'revoke' ? (
            <Button variant="destructive" block icon={<UserX size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setCorrecting(true)}>Remove this check-in</Button>
          ) : action === 'mark_present' ? (
            <Button variant="tinted" block icon={<UserCheck size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setCorrecting(true)}>
              {cell === 'revoked' ? 'Put back as present' : 'Mark present'}
            </Button>
          ) : null}
          <Button variant="gray" block href={`/lecturer/attendance/${session.id}`}>Open this class</Button>
        </div>
      )}
    </div>
  );
}

function explain(cell: Student['cells'][number], live: boolean, status: Student['enrollmentStatus']): string | null {
  if (live && cell === 'absent') return 'This class is still taking attendance. If they have not checked in by the end, it counts as missed.';
  switch (cell) {
    case 'within_boundary': return 'Checked in from inside the room.';
    case 'unlocated': return 'Checked in. This class had no room boundary, so the location was not checked.';
    case 'inconclusive': return 'Checked in, but the phone’s location was too rough to be sure they were in the room. It still counts as present.';
    case 'manual': return 'Marked present by a lecturer. The reason is in the class’s changes.';
    case 'revoked': return 'Checked in, but the check-in was removed, so it counts as missed. The reason is in the class’s changes.';
    case 'absent': return status === 'active' ? 'Did not check in.' : `Did not check in. ${status === 'withdrawn' ? 'They have since left the course' : 'The course is over'}, so this mark can no longer be changed.`;
    default: return 'This class was before they joined the course, so it does not count for them.';
  }
}
