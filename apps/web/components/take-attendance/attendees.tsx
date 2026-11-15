'use client';

import {
  checkMatricNumber,
  checkPersonName,
  type LectureAttendee,
  type LectureCapabilities,
  type LectureSessionDetail,
  type LectureSessionSummary,
} from '@lasuatos/contracts';
import { formatAccuracy, formatMeters } from '@lasuatos/verification/venue-area';
import { Check, ChevronRight, Clock3, Download, MapPin, PenLine, ScanFace, Smartphone, UserPlus, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { correctLectureAttendee, failureText, formatClock, setLectureAttendeeRemoved } from '../../lib/lecture-api';
import { Button, EmptyState, SegmentedControl, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { EditDialog } from '../ui/edit-dialog';
import { SearchField } from '../ui/search-field';
import { AddStudentSheet } from './add-student';
import { initials, numberFormat } from './format';

type Tone = 'neutral' | 'success' | 'warning';
type Flag = { readonly key: string; readonly label: string; readonly detail?: string; readonly tone: Tone; readonly icon: ReactNode };

/** What is worth knowing about one check-in, most important first. */
function flagsFor(attendee: LectureAttendee): Flag[] {
  const flags: Flag[] = [];
  const accuracy = attendee.accuracyMeters != null ? formatAccuracy(attendee.accuracyMeters) : null;
  if (attendee.venueOutcome === 'outside') {
    flags.push({
      key: 'outside',
      label: attendee.outsideMeters ? `${formatMeters(attendee.outsideMeters)} outside` : 'Outside the venue',
      detail: accuracy ? `The phone was outside the venue (${accuracy}).` : 'The phone was outside the venue.',
      tone: 'warning',
      icon: <MapPin size={13} strokeWidth={2.2} />,
    });
  }
  if (attendee.venueOutcome === 'inconclusive') {
    flags.push({ key: 'unsure', label: 'Location unconfirmed', detail: accuracy ? `The phone’s location was too rough to tell (${accuracy}).` : 'The phone’s location was too rough to tell.', tone: 'warning', icon: <MapPin size={13} strokeWidth={2.2} /> });
  }
  if (attendee.sharedDeviceCount > 0) {
    flags.push({
      key: 'device',
      label: 'Same phone',
      detail: `Checked in on the same phone as ${attendee.sharedDeviceCount} other${attendee.sharedDeviceCount === 1 ? '' : 's'}.`,
      tone: 'warning',
      icon: <Smartphone size={13} strokeWidth={2.2} />,
    });
  }
  if (attendee.faceReview === 'rejected') {
    flags.push({ key: 'face', label: 'Face rejected', detail: 'The face did not match on review.', tone: 'warning', icon: <ScanFace size={13} strokeWidth={2.2} /> });
  } else if (attendee.faceNeedsReview && attendee.faceReview !== 'approved') {
    flags.push({ key: 'face', label: 'Face to review', detail: 'The face matched, but not clearly. It counts until it is reviewed.', tone: 'warning', icon: <ScanFace size={13} strokeWidth={2.2} /> });
  }
  if (attendee.method === 'manual') {
    flags.push({
      key: 'manual',
      label: attendee.addedAfterClose ? 'Added after class' : 'Added by hand',
      detail: `Added by ${attendee.addedByName ?? 'the session taker'}${attendee.addedAfterClose ? ' after attendance closed' : ''}.`,
      tone: attendee.addedAfterClose ? 'warning' : 'neutral',
      icon: attendee.addedAfterClose ? <Clock3 size={13} strokeWidth={2.2} /> : <UserPlus size={13} strokeWidth={2.2} />,
    });
  } else if (!attendee.hasAccount) {
    flags.push({ key: 'guest', label: 'Typed details', detail: 'No account yet: the name and matric number are as the student typed them.', tone: 'neutral', icon: <PenLine size={13} strokeWidth={2.2} /> });
  }
  if (attendee.venueOutcome === 'within') {
    flags.push({
      key: 'within',
      label: 'In the venue',
      detail: `${attendee.outsideMeters ? `${formatMeters(attendee.outsideMeters)} from the walls, inside the allowance` : 'Inside the venue'}${accuracy ? ` (${accuracy})` : ''}.`,
      tone: 'success',
      icon: <Check size={13} strokeWidth={2.4} />,
    });
  }
  if (attendee.faceReview === 'approved') {
    flags.push({ key: 'face-ok', label: 'Face approved', detail: 'A close match, approved after comparing the photos.', tone: 'success', icon: <ScanFace size={13} strokeWidth={2.2} /> });
  } else if (attendee.faceScore != null && !attendee.faceNeedsReview) {
    flags.push({ key: 'face-ok', label: 'Face matched', tone: 'success', icon: <ScanFace size={13} strokeWidth={2.2} /> });
  }
  return flags;
}

export const isFlagged = (attendee: LectureAttendee) => !attendee.removed && flagsFor(attendee).some((flag) => flag.tone === 'warning');

const methodLabel = (attendee: LectureAttendee) =>
  attendee.method === 'qr' ? 'Scanned the QR code' : attendee.method === 'code' ? 'Typed the code' : 'Added by hand';

function csvCell(value: string): string {
  // Leading = + - @ would be read as a formula by spreadsheet apps.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportCsv(session: LectureSessionSummary, attendees: readonly LectureAttendee[]) {
  const rows = [
    ['S/N', 'Full name', 'Matric number', 'Time', 'Method', 'Account', 'Venue check', 'Metres outside walls', 'GPS accuracy (m)', 'Status'],
    ...attendees.filter((item) => !item.removed).map((item, index) => [
      String(index + 1),
      item.fullName,
      item.matricNumber,
      formatClock(item.checkedInAt),
      item.method === 'qr' ? 'QR scan' : item.method === 'code' ? 'Typed code' : `Added by ${item.addedByName ?? 'session taker'}${item.addedAfterClose ? ' after class' : ''}`,
      item.hasAccount ? 'Yes' : 'No',
      item.venueOutcome ?? '',
      item.outsideMeters != null ? String(Math.round(item.outsideMeters)) : '',
      item.accuracyMeters != null ? String(Math.round(item.accuracyMeters)) : '',
      'Present',
    ]),
  ];
  const csv = `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const day = new Date(session.startsAt).toISOString().slice(0, 10);
  link.download = `${session.courseCode.replace(/[^A-Za-z0-9]+/g, '-')}-${day}-attendance.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type Filter = 'all' | 'flagged' | 'removed';

/** Everyone who marked attendance, newest first. Tap a name for the details and actions. */
export function Attendees({ detail, takerRole, loading, onChanged }: Readonly<{
  detail: LectureSessionDetail;
  takerRole: LectureCapabilities['role'];
  /** Drawn from the list while the session loads: the names are not here yet. */
  loading: boolean;
  onChanged: () => void;
}>) {
  const { session, attendees, canManage } = detail;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState<LectureAttendee | null>(null);
  const dialogs = useFeedback();
  const isRep = takerRole === 'hoc' || takerRole === 'ghoc';
  // After class only a lecturer or an administrator can add anyone.
  const canAdd = canManage && (!isRep || session.status === 'open');
  const flagged = useMemo(() => attendees.filter(isFlagged).length, [attendees]);
  const removed = attendees.filter((item) => item.removed).length;
  const activeFilter: Filter = (filter === 'flagged' && !flagged) || (filter === 'removed' && !removed) ? 'all' : filter;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...attendees].reverse().filter((item) => {
      if (activeFilter === 'flagged' && !isFlagged(item)) return false;
      if (activeFilter === 'removed' && !item.removed) return false;
      return !needle || item.fullName.toLowerCase().includes(needle) || item.matricNumber.toLowerCase().includes(needle);
    });
  }, [attendees, query, activeFilter]);

  const openAttendee = attendees.find((item) => item.id === openId) ?? null;

  async function toggleRemoved(attendee: LectureAttendee) {
    let reason: string | undefined;
    if (!attendee.removed) {
      const answer = await dialogs.prompt({
        title: `Remove ${attendee.fullName}?`,
        body: `${attendee.matricNumber} will no longer count as present. You can put them back later.`,
        label: 'Reason (optional)',
        defaultValue: 'Not in class',
        suggestions: ['Not in class', 'Duplicate entry', 'Wrong course', 'Marked for someone else'],
        maxLength: 200,
        confirmLabel: 'Remove',
        tone: 'danger',
      });
      if (answer === null) return;
      reason = answer || undefined;
    }
    try {
      await setLectureAttendeeRemoved(session.id, attendee.id, attendee.removed ? { restore: true } : reason ? { reason } : {});
      dialogs.toast(attendee.removed ? `${attendee.fullName} is back on the list.` : `${attendee.fullName} was removed.`);
      onChanged();
    } catch (caught) {
      dialogs.toast(failureText(caught), 'error');
    }
  }

  return (
    <section className="tk-students" aria-labelledby="tk-students-title">
      <div className="tk-section-head">
        <h2 className="tk-section-title" id="tk-students-title">
          Students <span className="tk-pill">{numberFormat.format(session.presentCount)}</span>
        </h2>
        <div className="tk-section-actions">
          {canAdd ? (
            <Button size="sm" variant="tinted" icon={<UserPlus size={16} strokeWidth={2.2} aria-hidden="true" />} onClick={() => setAdding(true)}>
              Add
            </Button>
          ) : null}
          <button
            className="ds-icon-btn"
            type="button"
            aria-label="Download the list (CSV)"
            data-tip="Download (CSV)"
            disabled={session.presentCount === 0}
            onClick={() => exportCsv(session, attendees)}
          >
            <Download size={18} strokeWidth={2.1} aria-hidden="true" />
          </button>
        </div>
      </div>

      {attendees.length > 6 || flagged || removed ? (
        <div className="tk-students-tools">
          {attendees.length > 6 ? (
            <SearchField value={query} onValueChange={setQuery} placeholder="Name or matric number" aria-label="Find a student" />
          ) : null}
          {flagged || removed ? (
            <SegmentedControl
              label="Show"
              value={activeFilter}
              onChange={setFilter}
              segments={[
                { value: 'all', label: 'All' },
                ...(flagged ? [{ value: 'flagged' as const, label: `Flagged ${flagged}` }] : []),
                ...(removed ? [{ value: 'removed' as const, label: `Removed ${removed}` }] : []),
              ]}
            />
          ) : null}
        </div>
      ) : null}

      {loading ? (
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
      ) : attendees.length === 0 ? (
        <div className="ds-card tk-students-empty">
          <EmptyState
            icon={<Users size={22} strokeWidth={2} aria-hidden="true" />}
            title="No one yet"
            message={session.status === 'open' ? 'Names appear here as students scan.' : undefined}
          />
        </div>
      ) : visible.length === 0 ? (
        <p className="tk-quiet" role="status">No student matches “{query.trim()}”.</p>
      ) : (
        <ul className="ds-list tk-people">
          {visible.map((attendee) => <PersonRow key={attendee.id} attendee={attendee} onOpen={() => setOpenId(attendee.id)} />)}
        </ul>
      )}

      {canManage && isRep && session.status !== 'open' ? (
        <p className="tk-quiet">Attendance has closed. Only the lecturer can add students now.</p>
      ) : null}

      <PersonSheet
        attendee={openAttendee}
        session={session}
        canManage={canManage}
        canReview={!isRep}
        onClose={() => setOpenId(null)}
        onCorrect={(attendee) => { setOpenId(null); setCorrecting(attendee); }}
        onToggleRemoved={(attendee) => { setOpenId(null); void toggleRemoved(attendee); }}
      />
      {canAdd ? (
        <AddStudentSheet open={adding} session={session} isRep={isRep} onAdded={onChanged} onClose={() => setAdding(false)} />
      ) : null}
      {correcting && canManage ? (
        <CorrectAttendeeDialog
          sessionId={session.id}
          attendee={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => { setCorrecting(null); onChanged(); }}
        />
      ) : null}
    </section>
  );
}

function PersonRow({ attendee, onOpen }: Readonly<{ attendee: LectureAttendee; onOpen: () => void }>) {
  // The row carries only what needs a second look; the rest is one tap away.
  const flags = attendee.removed ? [] : flagsFor(attendee).filter((flag) => flag.tone !== 'success').slice(0, 2);
  return (
    <li>
      <button className={`ds-row tk-person${attendee.removed ? ' is-removed' : ''}`} type="button" onClick={onOpen}>
        <span className="tk-avatar" aria-hidden="true">{initials(attendee.fullName)}</span>
        <span className="ds-row-body">
          <span className="ds-row-title">{attendee.fullName}</span>
          <span className="ds-row-subtitle">
            <span className="ds-mono">{attendee.matricNumber}</span> · {formatClock(attendee.checkedInAt)}
            {attendee.removed ? ` · Removed${attendee.removedReason ? `: ${attendee.removedReason}` : ''}` : ''}
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

/** One check-in: how it was made, every check, and what can be done about it. */
function PersonSheet({ attendee, session, canManage, canReview, onClose, onCorrect, onToggleRemoved }: Readonly<{
  attendee: LectureAttendee | null;
  session: LectureSessionSummary;
  canManage: boolean;
  canReview: boolean;
  onClose: () => void;
  onCorrect: (attendee: LectureAttendee) => void;
  onToggleRemoved: (attendee: LectureAttendee) => void;
}>) {
  // Kept while the sheet animates closed.
  const [shown, setShown] = useState<LectureAttendee | null>(attendee);
  if (attendee && attendee !== shown) setShown(attendee);
  const person = attendee ?? shown;
  const flags = person ? flagsFor(person) : [];
  return (
    <Sheet open={Boolean(attendee)} onClose={onClose} title={person?.fullName ?? 'Student'}>
      {person ? (
        <div className="tk-person-sheet">
          <ul className="ds-list tk-facts">
            <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">Matric number</span></span><span className="tk-fact ds-mono">{person.matricNumber}</span></div></li>
            <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">Checked in</span></span><span className="tk-fact">{formatClock(person.checkedInAt)}</span></div></li>
            <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">How</span></span><span className="tk-fact">{methodLabel(person)}</span></div></li>
            {person.removed ? (
              <li><div className="ds-row"><span className="ds-row-body"><span className="ds-row-title">Removed</span></span><span className="tk-fact">{person.removedReason || 'No reason given'}</span></div></li>
            ) : null}
          </ul>
          {flags.length ? (
            <ul className="ds-list tk-checks" aria-label="Checks">
              {flags.map((flag) => (
                <li key={flag.key}><div className="ds-row">
                  <span className={`tk-check-icon is-${flag.tone}`} aria-hidden="true">{flag.icon}</span>
                  <span className="ds-row-body">
                    <span className="ds-row-title">{flag.label}</span>
                    {flag.detail ? <span className="ds-row-subtitle">{flag.detail}</span> : null}
                  </span>
                </div></li>
              ))}
            </ul>
          ) : null}
          <div className="tk-sheet-actions">
            {canReview && person.faceNeedsReview && !person.faceReview && !person.removed ? (
              <Button href="/face-checks" variant="tinted" block icon={<ScanFace size={18} strokeWidth={2.1} aria-hidden="true" />}>Review the face</Button>
            ) : null}
            {canManage && !person.hasAccount && !person.removed ? (
              <Button variant="gray" block icon={<PenLine size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => onCorrect(person)}>Correct details</Button>
            ) : null}
            {canManage ? (
              person.removed
                ? <Button variant="tinted" block onClick={() => onToggleRemoved(person)}>Put back on the list</Button>
                : <Button variant="destructive" block onClick={() => onToggleRemoved(person)}>Remove from the list</Button>
            ) : null}
            {!canManage && session.status === 'open' ? <p className="tk-quiet">View only.</p> : null}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

/** Fixes a typo in what a student without an account typed. */
function CorrectAttendeeDialog({ sessionId, attendee, onClose, onSaved }: Readonly<{
  sessionId: string;
  attendee: LectureAttendee;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const dialogs = useFeedback();
  const [fullName, setFullName] = useState(attendee.fullName);
  const [matricNumber, setMatricNumber] = useState(attendee.matricNumber);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const name = fullName.trim().replace(/\s+/g, ' ');
    const typedMatric = matricNumber.trim();
    const input: { fullName?: string; matricNumber?: string } = {};
    if (name !== attendee.fullName) {
      const checked = checkPersonName(name, 'student’s full name', 'full');
      if (!checked.ok) {
        setError(checked.message);
        return;
      }
      input.fullName = checked.value;
    }
    if (typedMatric.replace(/\s+/g, '') !== attendee.matricNumber) {
      const checked = checkMatricNumber(typedMatric);
      if (!checked.ok) {
        setError(checked.message.startsWith('Add') ? 'Enter the matric number: 9 digits, e.g. 250211184.' : checked.message);
        return;
      }
      if (checked.value !== attendee.matricNumber) input.matricNumber = checked.value;
    }
    if (!input.fullName && !input.matricNumber) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await correctLectureAttendee(sessionId, attendee.id, input);
      dialogs.toast(result.linked
        ? `${result.matricNumber} belongs to ${result.fullName}’s account. The entry is now theirs.`
        : `Saved: ${result.fullName} · ${result.matricNumber}.`);
      onSaved();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditDialog title="Correct details" busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <label className="account-field">
        <span>Full name</span>
        <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={160} autoComplete="off" autoCapitalize="words" required />
      </label>
      <label className="account-field">
        <span>Matric number</span>
        <input value={matricNumber} onChange={(event) => setMatricNumber(event.target.value)} maxLength={20} inputMode="numeric" autoComplete="off" required />
      </label>
    </EditDialog>
  );
}
