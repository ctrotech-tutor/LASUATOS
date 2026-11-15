'use client';

import { checkMatricNumber, checkPersonName, type LectureSessionSummary, type LectureStudentMatch } from '@lasuatos/contracts';
import { Check, Clock3, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { addLectureAttendee, failureText, formatClock, searchSessionStudents } from '../../lib/lecture-api';
import { toCheckInLocation, useLiveLocation } from '../../lib/location';
import { Button, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { LocationCheck } from '../location-check';
import { SearchField } from '../ui/search-field';
import { initials } from './format';

/**
 * Add a student by hand (a dead phone, no smartphone, a scan that failed): find them by matric
 * number or name on the class lists and tap to add. Anyone already on this list says so instead,
 * so no one is added twice. Someone on no list can still be added with typed details. The sheet
 * stays open, so several students can go in a row.
 */
export function AddStudentSheet({ open, session, isRep, onAdded, onClose }: Readonly<{
  open: boolean;
  session: LectureSessionSummary;
  isRep: boolean;
  onAdded: () => void;
  onClose: () => void;
}>) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a student">
      {open ? <AddStudent session={session} isRep={isRep} onAdded={onAdded} onDone={onClose} /> : null}
    </Sheet>
  );
}

type Search =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching'; readonly query: string }
  | { readonly kind: 'done'; readonly query: string; readonly students: readonly LectureStudentMatch[] }
  | { readonly kind: 'failed'; readonly query: string; readonly message: string };

/** What the server needs before it searches: two letters of a name or three digits. */
function searchable(query: string): boolean {
  const squashed = query.replace(/\s+/g, '');
  return /\d/.test(squashed) ? squashed.length >= 3 : query.trim().length >= 2;
}

function AddStudent({ session, isRep, onAdded, onDone }: Readonly<{
  session: LectureSessionSummary;
  isRep: boolean;
  onAdded: () => void;
  onDone: () => void;
}>) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ kind: 'idle' });
  // Added from this sheet: shown as on the list at once, before the session list refreshes.
  const [added, setAdded] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState('');
  const field = useRef<HTMLDivElement>(null);
  const dialogs = useFeedback();
  // A class rep vouches that the student is in the room, so the rep's own phone must be in the
  // venue when the session checks it.
  const needsLocation = isRep && session.requireVenue && session.status === 'open';
  const live = useLiveLocation(needsLocation);
  const afterClass = !isRep && session.status !== 'open';

  // Search as they type, a beat after the last key, cancelling the previous request.
  useEffect(() => {
    const text = query.trim();
    if (!searchable(text)) {
      const reset = window.setTimeout(() => setSearch({ kind: 'idle' }), 0);
      return () => window.clearTimeout(reset);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearch({ kind: 'searching', query: text });
      searchSessionStudents(session.id, text, controller.signal)
        .then((result) => setSearch({ kind: 'done', query: text, students: result.students }))
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) setSearch({ kind: 'failed', query: text, message: failureText(caught) });
        });
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, session.id]);

  function locationOrError(): ReturnType<typeof toCheckInLocation> | null | undefined {
    if (!needsLocation) return undefined;
    const fix = live.fixRef.current;
    if (fix) return toCheckInLocation(fix);
    setError(live.status === 'denied'
      ? `Location is blocked. Class reps can add students only from inside ${session.venueName ?? 'the venue'}: allow location for this site and try again.`
      : `Still finding your location in ${session.venueName ?? 'the venue'}. Wait a few seconds and try again.`);
    return null;
  }

  async function add(fullName: string, matricNumber: string) {
    setError('');
    const location = locationOrError();
    if (location === null) return;
    setBusy(matricNumber);
    try {
      const result = await addLectureAttendee(session.id, { fullName, matricNumber, ...(location ? { location } : {}) });
      dialogs.toast(result.status === 'restored' ? `${result.fullName} is back on the list.` : `${result.fullName} was added.`);
      setAdded((current) => new Map(current).set(result.matricNumber, new Date().toISOString()));
      setTypedName('');
      onAdded();
      // Ready for the next one: the search text is selected, so typing replaces it.
      field.current?.querySelector('input')?.select();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy(null);
    }
  }

  const text = query.trim();
  const matric = checkMatricNumber(text);
  const found = search.kind === 'done' && search.query === text ? search.students : null;
  // Who can still be added comes first; who is already in sinks to the end (the server's order
  // is kept within each group). Sorted on the server's answer only: a row just added here stays
  // where it was tapped and turns to "In".
  const students = found ? [...found].sort((a, b) => standing(a) - standing(b)) : null;
  // A full matric number on no list: add it with the name typed in.
  const offerTyped = students !== null && matric.ok && !students.some((item) => item.matricNumber === matric.value);

  async function submitTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matric.ok) return;
    const name = checkPersonName(typedName, 'student’s full name', 'full');
    if (!name.ok) {
      setError(name.message);
      return;
    }
    await add(name.value, matric.value);
  }

  return (
    <div className="tk-form tk-add">
      {afterClass ? <p className="tk-note is-warning" role="note"><Clock3 size={16} strokeWidth={2.1} aria-hidden="true" />Marked “Added after class”.</p> : null}
      <div ref={field}>
        <SearchField
          value={query}
          onValueChange={(next) => { setQuery(next); setError(''); }}
          placeholder="Matric number or name"
          aria-label="Find a student by matric number or name"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={80}
        />
      </div>
      {needsLocation ? <LocationCheck live={live} presence={null} venueName={session.venueName ?? 'the venue'} /> : null}
      {error ? <p className="tk-error" role="alert">{error}</p> : null}

      <div className="tk-add-results" aria-live="polite" aria-busy={search.kind === 'searching'}>
        {search.kind === 'searching' && !students ? (
          <ul className="ds-list tk-people" aria-hidden="true">
            {[62, 48].map((width) => (
              <li key={width}>
                <div className="ds-row tk-person">
                  <span className="ds-skeleton tk-avatar" />
                  <span className="ds-row-body">
                    <span className="ds-skeleton" style={{ width: `${width}%` }} />
                    <span className="ds-skeleton tk-bone-small" style={{ width: '38%' }} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {search.kind === 'failed' && search.query === text ? <p className="tk-error" role="alert">{search.message}</p> : null}

        {students && students.length > 0 ? (
          <ul className="ds-list tk-people" aria-label="Matching students">
            {students.map((student) => (
              <MatchRow
                key={student.matricNumber}
                student={student}
                addedAt={added.get(student.matricNumber) ?? null}
                busy={busy === student.matricNumber}
                disabled={busy !== null}
                onAdd={() => void add(student.fullName, student.matricNumber)}
              />
            ))}
          </ul>
        ) : null}

        {students && students.length === 0 && !offerTyped ? (
          <p className="tk-quiet" role="status">
            {/\d/.test(text) ? `No student’s matric number starts with ${text}.` : `No student called “${text}”.`} Type the full matric number to add them by hand.
          </p>
        ) : null}

        {offerTyped && matric.ok ? (
          added.has(matric.value) ? (
            <p className="tk-quiet" role="status">{matric.value} is on the list.</p>
          ) : (
            <form className="tk-add-typed" onSubmit={(event) => void submitTyped(event)} noValidate>
              <p className="tk-add-typed-head"><span className="ds-mono">{matric.value}</span> is not on a class list</p>
              <label className="account-field">
                <span>Full name</span>
                <input
                  value={typedName}
                  onChange={(event) => { setTypedName(event.target.value); setError(''); }}
                  autoComplete="off"
                  autoCapitalize="words"
                  maxLength={160}
                  placeholder="Surname first, e.g. OKAFOR Adaeze"
                />
              </label>
              <Button type="submit" busy={busy === matric.value} disabled={busy !== null} icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>
                Add with these details
              </Button>
            </form>
          )
        ) : null}
      </div>

      <Button variant="gray" size="lg" block onClick={onDone}>{added.size ? 'Done' : 'Cancel'}</Button>
    </div>
  );
}

function standing(student: LectureStudentMatch): number {
  if (student.onList?.status === 'present') return 2;
  return student.onList?.status === 'removed' ? 1 : 0;
}

function MatchRow({ student, addedAt, busy, disabled, onAdd }: Readonly<{
  student: LectureStudentMatch;
  addedAt: string | null;
  busy: boolean;
  disabled: boolean;
  onAdd: () => void;
}>) {
  const present = addedAt !== null || student.onList?.status === 'present';
  const removed = addedAt === null && student.onList?.status === 'removed';
  const since = addedAt ?? student.onList?.checkedInAt ?? null;
  const subtitle = (
    <span className="ds-row-subtitle">
      <span className="ds-mono">{student.matricNumber}</span>
      {student.departmentName ? ` · ${student.departmentName}` : ''}
    </span>
  );
  const body = (
    <>
      <span className="tk-avatar" aria-hidden="true">{initials(student.fullName)}</span>
      <span className="ds-row-body">
        <span className="ds-row-title">{student.fullName}</span>
        {subtitle}
      </span>
    </>
  );
  if (present) {
    // Already marked: say since when, and offer nothing to press.
    return (
      <li>
        <div className="ds-row tk-person is-on-list">
          {body}
          <span className="tk-match-state is-done">
            <Check size={15} strokeWidth={2.6} aria-hidden="true" />
            {since ? `In · ${formatClock(since)}` : 'On the list'}
          </span>
        </div>
      </li>
    );
  }
  return (
    <li>
      <button
        className="ds-row tk-person"
        type="button"
        disabled={disabled}
        aria-label={`${removed ? 'Put back' : 'Add'} ${student.fullName}, ${student.matricNumber}`}
        onClick={onAdd}
      >
        {body}
        <span className={`tk-match-state${busy ? ' is-busy' : ''}`} aria-hidden="true">
          {busy ? <span className="tk-spinner" /> : removed ? <><RotateCcw size={15} strokeWidth={2.4} />Put back</> : <><Plus size={16} strokeWidth={2.6} />Add</>}
        </span>
      </button>
    </li>
  );
}
