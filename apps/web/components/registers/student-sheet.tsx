'use client';

import type { LectureRegister } from '@lasuatos/contracts';
import { Check, Minus } from 'lucide-react';
import { formatClock, formatDay } from '../../lib/lecture-api';
import { Badge, List, ListRow, rateTone, Sheet } from '../ds';
import { sessionsToReach, plural } from './format';

type Student = LectureRegister['students'][number];

/** One student in one course: where they stand, what it takes to get back, and every session. */
export function StudentSheet({ register, student, threshold, onClose }: Readonly<{
  register: LectureRegister;
  student: Student | null;
  threshold: number;
  onClose: () => void;
}>) {
  return (
    <Sheet open={student !== null} onClose={onClose} title={student?.fullName ?? ''}>
      {student ? <StudentDetail register={register} student={student} threshold={threshold} /> : null}
    </Sheet>
  );
}

function StudentDetail({ register, student, threshold }: Readonly<{ register: LectureRegister; student: Student; threshold: number }>) {
  const held = register.sessions.length;
  const tone = rateTone(student.rate, threshold);
  const need = sessionsToReach(student.attended, held, threshold);
  const missedInARow = (() => {
    let count = 0;
    for (let index = student.present.length - 1; index >= 0 && !student.present[index]; index -= 1) count += 1;
    return count;
  })();
  // Newest first, as a history reads.
  const history = register.sessions.map((session, index) => ({ session, present: Boolean(student.present[index]) })).reverse();

  return (
    <div className="rg-person">
      <p className="rg-person-id ds-mono">{student.matricNumber} · {register.courseCode}</p>
      <div className="rg-person-figure">
        <strong className={`rg-person-rate is-${tone}`}>{Math.round(student.rate)}%</strong>
        <span>{student.attended} of {plural(held, 'session')}</span>
        {need === null ? <Badge tone="success">At {threshold}% or above</Badge> : <Badge tone={tone === 'danger' ? 'danger' : 'warning'}>Below {threshold}%</Badge>}
      </div>
      <div className="rg-strip" role="img" aria-label={`Oldest to newest: ${student.present.map((present) => (present ? 'present' : 'absent')).join(', ')}`}>
        {student.present.map((present, index) => <i key={register.sessions[index]!.id} className={present ? 'is-present' : ''} />)}
      </div>
      {need !== null || missedInARow >= 2 ? (
        <ul className="rg-facts">
          {need !== null ? (
            <li>{Number.isFinite(need) ? `Back to ${threshold}% after the next ${plural(need, 'session')} in a row` : `${threshold}% can no longer be reached`}</li>
          ) : null}
          {missedInARow >= 2 ? <li>Missed the last {missedInARow} sessions</li> : null}
        </ul>
      ) : null}
      <List label="Sessions">
        {history.map(({ session, present }) => (
          <ListRow
            key={session.id}
            href={`/sessions/${session.id}`}
            title={formatDay(session.startsAt)}
            subtitle={`${formatClock(session.startsAt)} · ${session.takenBy}`}
            trailing={present
              ? <span className="rg-status is-present"><Check size={15} strokeWidth={2.6} aria-hidden="true" />Present</span>
              : <span className="rg-status"><Minus size={15} strokeWidth={2.6} aria-hidden="true" />Absent</span>}
          />
        ))}
      </List>
    </div>
  );
}
