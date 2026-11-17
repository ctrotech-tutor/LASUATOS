'use client';

import {
  DEFAULT_ASSISTANT_PERMISSIONS,
  MAX_ASSISTANTS,
  type AssistantPermission,
  type Assistants,
  type ClassListEntry,
  type ClassRep,
  type ClassRepStudent,
} from '@lasuatos/contracts';
import { Check, Search, UserRoundCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { appointAssistant, failureText, lookupAssistantCandidate } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { loadClassList } from '../../lib/student-api';
import { Badge, Button, Sheet } from '../ds';
import { initials } from '../staff/format';
import { SwitchField } from '../ui/switch';
import {
  assistantName,
  assistantShort,
  ATTENDANCE_COPY,
  orderedPermissions,
  permissionCopy,
  powersLine,
  teamPlace,
  togglePermission,
} from './assistant-model';

const SUGGESTIONS = 6;

/** One stable class-list loader per department and set, as useResource needs. */
const listLoaders = new Map<string, (signal: AbortSignal) => Promise<ClassListEntry[]>>();
function listLoader(departmentId: string, entryYear: number) {
  const key = `${departmentId}:${entryYear}`;
  let loader = listLoaders.get(key);
  if (!loader) {
    loader = async (signal: AbortSignal) => (await loadClassList({ departmentId, entryYear }, signal)).entries;
    listLoaders.set(key, loader);
  }
  return loader;
}
const NO_LIST = async (): Promise<ClassListEntry[]> => [];

/** Classmates matching typed words or the start of a matric number: those with accounts first. */
export function suggestClassmates(entries: readonly ClassListEntry[], query: string, exclude: ReadonlySet<string>): ClassListEntry[] {
  const text = query.trim().toLowerCase();
  const digits = text.replace(/\s+/g, '');
  if (text.length < 2 || text.includes('@')) return [];
  const words = text.split(/\s+/);
  return entries
    .filter((entry) => !(entry.userId && exclude.has(entry.userId)))
    .filter((entry) => (/^\d+$/.test(digits)
      ? entry.matricNumber.startsWith(digits)
      : words.every((word) => `${entry.surname} ${entry.firstName} ${entry.middleName ?? ''}`.toLowerCase().includes(word))))
    .sort((a, b) => Number(Boolean(b.userId)) - Number(Boolean(a.userId)) || a.surname.localeCompare(b.surname))
    .slice(0, SUGGESTIONS);
}

/** Adding an assistant: find the classmate, choose what they can do, save. */
export function AddAssistantSheet({ open, data, principalId, onClose, onAdded }: Readonly<{
  open: boolean;
  data: Assistants;
  principalId: string | null;
  onClose: () => void;
  onAdded: (rep: ClassRep) => void;
}>) {
  // A fresh form each time it opens; the last one stays while the sheet animates closed.
  const [round, setRound] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRound(round + 1);
  }
  const short = assistantShort(data.principal.role);
  return (
    <Sheet open={open} onClose={onClose} title={`Add ${short}`}>
      {round > 0 ? <AddForm key={round} data={data} principalId={principalId} onClose={onClose} onAdded={onAdded} onAnother={() => setRound(round + 1)} /> : null}
    </Sheet>
  );
}

function AddForm({ data, principalId, onClose, onAdded, onAnother }: Readonly<{
  data: Assistants;
  principalId: string | null;
  onClose: () => void;
  onAdded: (rep: ClassRep) => void;
  onAnother: () => void;
}>) {
  const { principal } = data;
  const short = assistantShort(principal.role);
  const [query, setQuery] = useState('');
  const [student, setStudent] = useState<ClassRepStudent | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState('');
  const [permissions, setPermissions] = useState<readonly AssistantPermission[]>(orderedPermissions(DEFAULT_ASSISTANT_PERMISSIONS.filter((item) => data.available.includes(item))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<ClassRep | null>(null);
  const queryId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // A frame later, so it lands after the dialog's own focus.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // A HOC picks from their department's list by name; a GHOC's set spans departments, so by matric or email.
  const departmentId = principal.role === 'hoc' ? principal.departmentId : null;
  const classList = useResource(
    departmentId ? `class-reps:list:${departmentId}:${principal.entryYear}` : null,
    departmentId ? listLoader(departmentId, principal.entryYear) : NO_LIST,
    { maxAge: 60_000 },
  );
  const taken = new Set([principal.studentUserId, ...data.assistants.map((item) => item.studentUserId)]);
  const suggestions = student || !classList.data ? [] : suggestClassmates(classList.data, query, taken);
  const full = data.assistants.length >= MAX_ASSISTANTS;

  async function find(text: string) {
    const value = text.trim();
    setFindError('');
    if (value.length < 3) {
      setFindError(departmentId ? 'Type a name from the class list, or their matric number or email.' : 'Type their matric number or email.');
      return;
    }
    setFinding(true);
    try {
      const found = await lookupAssistantCandidate(principalId, value);
      setStudent(found);
      setQuery('');
    } catch (caught) {
      setFindError(failureText(caught, 'The student could not be found. Try again.'));
    } finally {
      setFinding(false);
    }
  }

  function onQueryKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const ready = suggestions.filter((entry) => entry.userId && !entry.isRep);
    if (ready.length === 1 && suggestions.length === 1) void find(ready[0]!.matricNumber);
    else void find(query);
  }

  async function submit() {
    setTried(true);
    setError('');
    if (!student || full) return;
    setBusy(true);
    try {
      const rep = await appointAssistant({
        ...(principalId ? { principalId } : {}),
        studentUserId: student.userId,
        permissions: [...permissions],
      });
      onAdded(rep);
      setDone(rep);
    } catch (caught) {
      setError(failureText(caught, 'They could not be added. Try again.'));
      setBusy(false);
    }
  }

  if (done) {
    const left = MAX_ASSISTANTS - data.assistants.length;
    return (
      <div className="crp-done" role="status">
        <span className="crp-done-icon" aria-hidden="true"><Check size={28} strokeWidth={2.4} /></span>
        <h3 className="crp-done-title">{done.studentName} is now {short}</h3>
        <p className="crp-done-text">{powersLine(done.permissions)} They get it the next time they open LASUATOS.</p>
        <div className="crp-actions">
          {left > 0 ? <Button variant="gray" onClick={onAnother}>Add another</Button> : null}
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  const studentProblem = tried && !student ? 'Find the classmate first.' : '';
  return (
    <form className="crp-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
      <div className="crp-post-card">
        <span className={`crp-role is-${principal.role}`}>{short}</span>
        <div className="crp-post-card-text">
          <p className="crp-post-card-title">{assistantName(principal.role)} to {principal.studentName}</p>
          <p className="crp-post-card-sub">{teamPlace(principal)}</p>
        </div>
      </div>

      {student ? (
        <div className="crp-found">
          <div className="crp-found-head">
            <span className="crp-avatar" aria-hidden="true">{initials(student.fullName)}</span>
            <div className="crp-found-who">
              <p className="crp-found-name">{student.fullName}</p>
              <p className="crp-found-line"><span className="ds-mono">{student.matricNumber}</span> · {student.email}</p>
            </div>
            <button className="crp-inline-link" type="button" onClick={() => { setStudent(null); window.requestAnimationFrame(() => inputRef.current?.focus()); }}>Change</button>
          </div>
        </div>
      ) : (
        <div className="crp-student">
          <label className="crp-label" htmlFor={queryId}>Classmate</label>
          <div className="crp-query">
            <span className="ui-search crp-query-field">
              <Search className="ui-search-icon" size={16} aria-hidden="true" />
              <input
                ref={inputRef}
                id={queryId}
                className="ui-search-input"
                type="search"
                enterKeyHint="search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setFindError(''); }}
                onKeyDown={onQueryKey}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={departmentId ? 'Name, matric number or email' : 'Matric number or email'}
                aria-invalid={Boolean(findError || studentProblem)}
                aria-describedby={`${queryId}-note`}
              />
            </span>
            <Button variant="tinted" busy={finding} onClick={() => void find(query)}>Find</Button>
          </div>
          {findError || studentProblem ? (
            <small className="crp-field-error" id={`${queryId}-note`} role="alert">{findError || studentProblem}</small>
          ) : (
            <small className="crp-form-note" id={`${queryId}-note`}>
              They must be on your class list and have opened their LASUATOS account.
            </small>
          )}
          {suggestions.length ? (
            <ul className="ds-list crp-suggestions" aria-label="On the class list">
              {suggestions.map((entry) => {
                const ready = Boolean(entry.userId) && !entry.isRep;
                return (
                  <li key={entry.id}>
                    <button className="ds-row crp-suggestion" type="button" disabled={!ready || finding} onClick={() => void find(entry.matricNumber)}>
                      <span className="crp-avatar is-small" aria-hidden="true">{initials(`${entry.firstName} ${entry.surname}`)}</span>
                      <span className="ds-row-body">
                        <span className="ds-row-title">{entry.surname.toUpperCase()} {entry.firstName}{entry.middleName ? ` ${entry.middleName}` : ''}</span>
                        <span className="ds-row-subtitle">
                          <span className="ds-mono">{entry.matricNumber}</span>
                          {!entry.userId ? ' · Hasn’t opened an account' : entry.isRep ? ' · Already a rep' : ''}
                        </span>
                      </span>
                      {entry.isRep ? <Badge>Rep</Badge> : null}
                      {ready ? <UserRoundCheck className="crp-suggestion-icon" size={18} strokeWidth={2} aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}

      <fieldset className="ast-choose">
        <legend className="crp-legend">What they can do</legend>
        <div className="ast-always">
          <span className="ast-always-text">
            <span>{ATTENDANCE_COPY.label}</span>
            <small>{ATTENDANCE_COPY.hint}</small>
          </span>
          <span className="ast-always-tag">Always</span>
        </div>
        {orderedPermissions(data.available).map((permission) => {
          const copy = permissionCopy(permission, principal.role);
          return (
            <SwitchField
              key={permission}
              checked={permissions.includes(permission)}
              onCheckedChange={(on) => setPermissions(togglePermission(permissions, permission, on))}
              label={copy.label}
              hint={copy.hint}
            />
          );
        })}
        <small className="crp-form-note">You can change this any time.</small>
      </fieldset>

      {full ? <p className="crp-field-error" role="alert">{principal.studentName} already has {MAX_ASSISTANTS} assistants. Remove one first.</p> : null}
      {error ? <p className="crp-field-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={full} icon={<UserRoundCheck size={20} strokeWidth={2.1} aria-hidden="true" />}>
        {busy ? 'Saving…' : `Make ${short}`}
      </Button>
    </form>
  );
}
