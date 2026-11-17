'use client';

import { Check, ChevronRight, Download, MapPin, Smartphone, UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { applyAttendanceCorrection } from '../../lib/attendance-api';
import { formatClock } from '../../lib/lecture-api';
import { haptic } from '../../lib/use-live';
import { Button, EmptyState, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { SearchField } from '../ui/search-field';
import { initials } from '../take-attendance/format';
import { CORRECTION_REASONS as REASONS, methodLabel, plural, problemText, reasonProblem, type Absentee, type Attendee, type CourseSession } from './model';

type Tone = 'neutral' | 'success' | 'warning';
type Flag = { readonly key: string; readonly label: string; readonly detail: string; readonly tone: Tone; readonly icon: ReactNode };

function flagsFor(attendee: Attendee): Flag[] {
  const flags: Flag[] = [];
  if (attendee.status === 'revoked') {
    flags.push({
      key: 'revoked',
      label: 'Removed',
      detail: attendee.revokedAt ? `Taken off at ${formatClock(attendee.revokedAt)}. It does not count.` : 'Taken off the list. It does not count.',
      tone: 'neutral',
      icon: <UserX size={13} strokeWidth={2.2} />,
    });
    return flags;
  }
  if (attendee.sharedDevice) {
    flags.push({
      key: 'device',
      label: 'Same phone',
      detail: 'Another student checked in on this phone too. It can be a friend lending a phone, or one person marking for others.',
      tone: 'warning',
      icon: <Smartphone size={13} strokeWidth={2.2} />,
    });
  }
  if (attendee.venueOutcome === 'inconclusive') {
    flags.push({ key: 'unsure', label: 'Location unconfirmed', detail: 'The phone’s location was too rough to tell whether it was in the room. It still counts.', tone: 'warning', icon: <MapPin size={13} strokeWidth={2.2} /> });
  }
  if (attendee.method === 'manual') {
    flags.push({ key: 'manual', label: 'Marked by you', detail: 'You marked this student present, with a reason that is kept in the record.', tone: 'neutral', icon: <UserPlus size={13} strokeWidth={2.2} /> });
  }
  if (attendee.venueOutcome === 'within_boundary') {
    flags.push({ key: 'within', label: 'In the room', detail: 'The phone was inside the venue’s boundary.', tone: 'success', icon: <Check size={13} strokeWidth={2.4} /> });
  }
  return flags;
}

function csvCell(value: string): string {
  // A leading = + - @ would be read as a formula by spreadsheet apps.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The whole class for this session: present, removed and not checked in. */
function exportCsv(session: CourseSession, attendees: readonly Attendee[], absent: readonly Absentee[]) {
  const how = (item: Attendee) => (item.method === 'qr_code' ? 'QR scan' : item.method === 'code' ? 'Typed code' : 'Marked by lecturer');
  const rows = [
    ['S/N', 'Full name', 'Matric number', 'Level', 'Status', 'Time', 'How', 'Notes'],
    ...[
      ...attendees.map((item) => [
        item.displayName,
        item.studentNumber,
        item.levelLabel,
        item.status === 'present' ? 'Present' : 'Removed',
        formatClock(item.checkedInAt),
        how(item),
        [item.sharedDevice ? 'Same phone as another student' : '', item.venueOutcome === 'inconclusive' ? 'Location unconfirmed' : '', item.venueOutcome === 'within_boundary' ? 'In the room' : ''].filter(Boolean).join('; '),
      ]),
      ...absent.map((item) => [item.displayName, item.studentNumber, item.levelLabel, 'Not checked in', '', '', '']),
    ].map((row, index) => [String(index + 1), ...row]),
  ];
  const csv = `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${session.courseCode.replace(/[^A-Za-z0-9]+/g, '-')}-${session.startsAt.slice(0, 10)}-${session.title.replace(/[^A-Za-z0-9]+/g, '-')}.csv`.toLowerCase();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const matches = (needle: string, name: string, matric: string) => !needle || name.toLowerCase().includes(needle) || matric.toLowerCase().includes(needle);

type Person =
  | { readonly kind: 'attendee'; readonly attendee: Attendee }
  | { readonly kind: 'absent'; readonly student: Absentee };

/**
 * Who checked in (newest first, removed at the end) and who has not, with a search over both
 * when the class is big. A name opens what is known and the one correction that applies.
 */
export function Roster({ session, attendees, absent, loading, fresh, onChanged }: Readonly<{
  session: CourseSession;
  attendees: readonly Attendee[];
  absent: readonly Absentee[];
  loading: boolean;
  /** Check-ins that just arrived, lit up for a few seconds. */
  fresh?: ReadonlySet<string>;
  onChanged: () => void;
}>) {
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const needle = query.trim().toLowerCase();
  const present = useMemo(() => attendees.filter((item) => item.status === 'present').reverse(), [attendees]);
  const revoked = useMemo(() => attendees.filter((item) => item.status === 'revoked'), [attendees]);
  const listed = useMemo(
    () => [...present, ...revoked].filter((item) => matches(needle, item.displayName, item.studentNumber)),
    [present, revoked, needle],
  );
  const notYet = useMemo(() => absent.filter((item) => matches(needle, item.displayName, item.studentNumber)), [absent, needle]);
  const open = session.status === 'open';
  const searchable = attendees.length + absent.length > 8;

  return (
    <>
      <div className="tk-panel" data-panel="students">
        <section className="tk-students" aria-labelledby="cs-present-title">
          <div className="tk-section-head">
            <h2 className="tk-section-title" id="cs-present-title">
              Present <span className="tk-pill">{present.length.toLocaleString('en-NG')}</span>
            </h2>
            <div className="tk-section-actions">
              <button
                className="ds-icon-btn"
                type="button"
                aria-label="Download the class list (CSV)"
                data-tip="Download (CSV)"
                disabled={loading || attendees.length + absent.length === 0}
                onClick={() => exportCsv(session, attendees, absent)}
              >
                <Download size={18} strokeWidth={2.1} aria-hidden="true" />
              </button>
            </div>
          </div>
          {searchable ? (
            <div className="tk-students-tools">
              <SearchField value={query} onValueChange={setQuery} placeholder="Name or matric number" aria-label="Find a student" />
            </div>
          ) : null}
          {session.sharedDeviceCount ? (
            <p className="tk-note is-warning" role="note">
              <Smartphone size={16} strokeWidth={2.1} aria-hidden="true" />
              <span>{plural(session.sharedDeviceCount, 'check-in')} came from a phone that checked in someone else too. Worth a look, not proof.</span>
            </p>
          ) : null}
          {loading ? <PeopleBones /> : attendees.length === 0 ? (
            <div className="ds-card tk-students-empty">
              <EmptyState
                icon={<Users size={22} strokeWidth={2} aria-hidden="true" />}
                title="No one yet"
                message={open ? 'Names appear here as students scan.' : 'No one checked in to this class.'}
              />
            </div>
          ) : listed.length === 0 ? (
            <p className="tk-quiet" role="status">No one present matches “{query.trim()}”.</p>
          ) : (
            <ul className="ds-list tk-people">
              {listed.map((item) => <AttendeeRow key={item.studentId} attendee={item} fresh={fresh?.has(item.studentId) ?? false} onOpen={() => setPerson({ kind: 'attendee', attendee: item })} />)}
            </ul>
          )}
        </section>
      </div>

      <div className="tk-panel" data-panel="absent">
        <section className="tk-students" aria-labelledby="cs-absent-title">
          <div className="tk-section-head cs-absent-head">
            <h2 className="tk-section-title" id="cs-absent-title">
              {open ? 'Not checked in' : 'Absent'} <span className="tk-pill">{absent.length.toLocaleString('en-NG')}</span>
            </h2>
          </div>
          {searchable ? (
            // Phones show one list at a time, so this list gets its own search (same query).
            <div className="tk-students-tools cs-absent-search">
              <SearchField value={query} onValueChange={setQuery} placeholder="Name or matric number" aria-label="Find a student who has not checked in" />
            </div>
          ) : null}
          {loading ? <PeopleBones /> : absent.length === 0 ? (
            <div className="ds-card tk-students-empty">
              <EmptyState
                icon={<UserCheck size={22} strokeWidth={2} aria-hidden="true" />}
                title={attendees.length ? 'Everyone is in' : 'No students on this course'}
                message={attendees.length ? 'Every student on the course has checked in.' : 'Students join with the course’s code in Course tools.'}
              />
            </div>
          ) : notYet.length === 0 ? (
            <p className="tk-quiet" role="status">No one else matches “{query.trim()}”.</p>
          ) : (
            <ul className="ds-list tk-people cs-absent">
              {notYet.map((item) => (
                <li key={item.studentId}>
                  <button className="ds-row tk-person" type="button" onClick={() => setPerson({ kind: 'absent', student: item })}>
                    <span className="tk-avatar cs-avatar-quiet" aria-hidden="true">{initials(item.displayName)}</span>
                    <span className="ds-row-body">
                      <span className="ds-row-title">{item.displayName}</span>
                      <span className="ds-row-subtitle"><span className="ds-mono">{item.studentNumber}</span> · {item.levelLabel}</span>
                    </span>
                    <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <PersonSheet
        session={session}
        person={person}
        onClose={() => setPerson(null)}
        onDone={() => {
          setPerson(null);
          onChanged();
        }}
      />
    </>
  );
}

function AttendeeRow({ attendee, fresh, onOpen }: Readonly<{ attendee: Attendee; fresh: boolean; onOpen: () => void }>) {
  const removed = attendee.status === 'revoked';
  // The row carries only what needs a second look; the rest is one tap away.
  const flags = removed ? [] : flagsFor(attendee).filter((flag) => flag.tone !== 'success').slice(0, 2);
  return (
    <li>
      <button className={`ds-row tk-person${removed ? ' is-removed' : ''}${fresh ? ' is-arrival' : ''}`} type="button" onClick={onOpen}>
        <span className="tk-avatar" aria-hidden="true">{initials(attendee.displayName)}</span>
        <span className="ds-row-body">
          <span className="ds-row-title">{attendee.displayName}</span>
          <span className="ds-row-subtitle">
            <span className="ds-mono">{attendee.studentNumber}</span> · {formatClock(attendee.checkedInAt)}{removed ? ' · Removed' : ''}
          </span>
          {flags.length ? (
            <span className="tk-flags">
              {flags.map((flag) => <span key={flag.key} className={`tk-flag is-${flag.tone}`}>{flag.icon}{flag.label}</span>)}
            </span>
          ) : null}
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

function PeopleBones() {
  return (
    <ul className="ds-list tk-people" role="status" aria-label="Loading students">
      {[68, 54, 61].map((width) => (
        <li key={width}>
          <div className="ds-row tk-person">
            <span className="ds-skeleton tk-avatar" />
            <span className="ds-row-body">
              <span className="ds-skeleton" style={{ width: `${width}%` }} />
              <span className="ds-skeleton tk-bone-small" style={{ width: '34%' }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One student: what is known, and the correction that applies, with the reason it needs. */
function PersonSheet({ session, person, onClose, onDone }: Readonly<{
  session: CourseSession;
  person: Person | null;
  onClose: () => void;
  onDone: () => void;
}>) {
  // Kept while the sheet animates closed.
  const [shown, setShown] = useState<Person | null>(person);
  if (person && person !== shown) setShown(person);
  const current = person ?? shown;
  const name = current ? (current.kind === 'attendee' ? current.attendee.displayName : current.student.displayName) : 'Student';
  const key = current ? (current.kind === 'attendee' ? `${current.attendee.studentId}:${current.attendee.status}` : current.student.studentId) : '';
  return (
    <Sheet open={Boolean(person)} onClose={onClose} title={name}>
      {current ? <PersonDetail key={key} session={session} person={current} onDone={onDone} /> : null}
    </Sheet>
  );
}

function PersonDetail({ session, person, onDone }: Readonly<{ session: CourseSession; person: Person; onDone: () => void }>) {
  const feedback = useFeedback();
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attendee = person.kind === 'attendee' ? person.attendee : null;
  const studentId = attendee ? attendee.studentId : person.kind === 'absent' ? person.student.studentId : '';
  const displayName = attendee ? attendee.displayName : person.kind === 'absent' ? person.student.displayName : '';
  const matric = attendee ? attendee.studentNumber : person.kind === 'absent' ? person.student.studentNumber : '';
  const level = attendee ? attendee.levelLabel : person.kind === 'absent' ? person.student.levelLabel : '';
  const action: 'mark_present' | 'revoke' = attendee?.status === 'present' ? 'revoke' : 'mark_present';
  const flags = attendee ? flagsFor(attendee) : [];
  const problem = reasonProblem(reason);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (correcting) field.current?.focus();
  }, [correcting]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await applyAttendanceCorrection(session.id, { studentId, action, reason: reason.trim() });
      haptic(14);
      feedback.toast(result.status === 'unchanged'
        ? `${displayName} was already ${action === 'revoke' ? 'off' : 'on'} the list.`
        : action === 'revoke' ? `${displayName} no longer counts as present.` : `${displayName} is marked present.`);
      onDone();
    } catch (caught) {
      setError(problemText(caught, 'That did not save. Check your connection and try again.'));
      setBusy(false);
    }
  }

  return (
    <div className="tk-person-sheet">
      <ul className="ds-list tk-facts">
        <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">Matric number</span></span><span className="tk-fact ds-mono">{matric}</span></div></li>
        <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">Level</span></span><span className="tk-fact">{level}</span></div></li>
        {attendee ? (
          <>
            <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">Checked in</span></span><span className="tk-fact">{formatClock(attendee.checkedInAt)}</span></div></li>
            <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">How</span></span><span className="tk-fact">{methodLabel(attendee.method)}</span></div></li>
          </>
        ) : (
          <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">This class</span></span><span className="tk-fact">Not checked in</span></div></li>
        )}
      </ul>

      {flags.length ? (
        <ul className="ds-list tk-checks" aria-label="Checks">
          {flags.map((flag) => (
            <li key={flag.key}><div className="ds-row">
              <span className={`tk-check-icon is-${flag.tone}`} aria-hidden="true">{flag.icon}</span>
              <span className="ds-row-body">
                <span className="ds-row-title">{flag.label}</span>
                <span className="ds-row-subtitle">{flag.detail}</span>
              </span>
            </div></li>
          ))}
        </ul>
      ) : null}

      {correcting ? (
        <form className="cs-reason" onSubmit={(event) => void submit(event)} noValidate>
          <label className="account-field">
            <span className="tk-label-row">
              <span>{action === 'revoke' ? 'Why remove this check-in?' : 'Why mark them present?'}</span>
              <span className="tk-label-aside">{reason.trim().length}/500</span>
            </span>
            <textarea
              value={reason}
              onChange={(event) => { setReason(event.target.value); setError(''); }}
              rows={3}
              maxLength={500}
              ref={field}
              aria-describedby="cs-reason-hint"
            />
            <small id="cs-reason-hint">Kept with the record for good. The student sees the change in My attendance.</small>
          </label>
          <div className="ui-dialog-chips">
            {REASONS[action].map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={`lx-chip-button${reason === suggestion ? ' is-selected' : ''}`}
                onClick={() => { setReason(suggestion); setError(''); }}
              >
                {suggestion}
              </button>
            ))}
          </div>
          {error ? <p className="tk-error" role="alert">{error}</p> : null}
          <div className="tk-sheet-actions is-row">
            <Button variant="gray" block disabled={busy} onClick={() => { setCorrecting(false); setError(''); }}>Cancel</Button>
            <Button type="submit" variant={action === 'revoke' ? 'destructive' : 'filled'} block busy={busy}>
              {action === 'revoke' ? 'Remove' : 'Mark present'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="tk-sheet-actions">
          {action === 'revoke' ? (
            <Button variant="destructive" block icon={<UserX size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setCorrecting(true)}>Remove from the list</Button>
          ) : (
            <Button variant="tinted" block icon={<UserCheck size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => setCorrecting(true)}>
              {attendee ? 'Put back on the list' : 'Mark present'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
