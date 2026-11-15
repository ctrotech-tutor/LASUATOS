'use client';

import { academicSetLabel, type ClassListEntry, type ClassRep, type ClassRepList, type ClassRepRole, type ClassRepStudent } from '@lasuatos/contracts';
import { AlertTriangle, Check, Search, UserRoundCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { departmentOptions, shortDepartmentName } from '../../lib/department-options';
import { appointClassRep, failureText, lookupClassRepStudent, revokeClassRep } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { loadClassList } from '../../lib/student-api';
import { Badge, Button, Sheet } from '../ds';
import { initials } from '../staff/format';
import { Select } from '../ui/select';
import { appointedLine, listLine, postKey, postPlace, ROLE_NAME, setChoices, type Post } from './format';

/** What opened the sheet: a post to fill (and who it replaces), or nothing chosen yet. */
export interface AppointRequest {
  readonly post: Post | null;
  readonly replacing: ClassRep | null;
  /** False when a link opened it: the keyboard waits until they tap a field. */
  readonly focus: boolean;
}

const ROLE_HINT: Readonly<Record<ClassRepRole, string>> = {
  hoc: 'One department’s set: takes attendance and keeps the class list',
  ghoc: 'Every department in the faculty for one set; can appoint HOCs',
};
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

/** Class-list entries matching typed words or the start of a matric number. */
function suggest(entries: readonly ClassListEntry[], query: string): ClassListEntry[] {
  const text = query.trim().toLowerCase();
  const digits = text.replace(/\s+/g, '');
  if (text.length < 2 || text.includes('@')) return [];
  const words = text.split(/\s+/);
  return entries
    .filter((entry) => (/^\d+$/.test(digits)
      ? entry.matricNumber.startsWith(digits)
      : words.every((word) => `${entry.surname} ${entry.firstName} ${entry.middleName ?? ''}`.toLowerCase().includes(word))))
    .sort((a, b) => Number(Boolean(b.userId)) - Number(Boolean(a.userId)) || a.surname.localeCompare(b.surname))
    .slice(0, SUGGESTIONS);
}

/** Appointing a rep: the post (preset when they tapped an open post), then the student. */
export function AppointSheet({ request, data, posts, defaultSet, now, onClose, onAppointed }: Readonly<{
  request: AppointRequest | null;
  data: ClassRepList;
  posts: readonly Post[];
  defaultSet: number | null;
  now: number;
  onClose: () => void;
  onAppointed: (rep: ClassRep, removedIds: string[]) => void;
}>) {
  // A fresh form each time it opens (or for "Appoint another"); the last one stays while the
  // sheet animates closed.
  const [seen, setSeen] = useState<AppointRequest | null>(null);
  const [form, setForm] = useState<{ readonly request: AppointRequest; readonly round: number } | null>(null);
  if (request && request !== seen) {
    setSeen(request);
    setForm({ request, round: (form?.round ?? 0) + 1 });
  }
  const shown = form?.request;
  const title = shown?.replacing ? `Replace ${shown.replacing.studentName}` : shown?.post ? `Appoint a ${ROLE_NAME[shown.post.role]}` : 'Appoint a class rep';
  return (
    <Sheet open={request !== null} onClose={onClose} title={title}>
      {form && shown ? (
        <AppointForm
          key={form.round}
          request={shown}
          data={data}
          posts={posts}
          defaultSet={defaultSet}
          now={now}
          onClose={onClose}
          onAppointed={onAppointed}
          onAnother={() => setForm((current) => ({ request: { post: null, replacing: null, focus: true }, round: (current?.round ?? 0) + 1 }))}
        />
      ) : null}
    </Sheet>
  );
}

type Done = { readonly rep: ClassRep; readonly removed: readonly string[]; readonly failed: readonly string[] };

function AppointForm({ request, data, posts, defaultSet, now, onClose, onAppointed, onAnother }: Readonly<{
  request: AppointRequest;
  data: ClassRepList;
  posts: readonly Post[];
  defaultSet: number | null;
  now: number;
  onClose: () => void;
  onAppointed: (rep: ClassRep, removedIds: string[]) => void;
  onAnother: () => void;
}>) {
  const preset = request.post;
  const fixed = data.fixedEntryYear;
  const canGhoc = data.faculties.length > 0;
  const [editingPost, setEditingPost] = useState(!preset);
  const [role, setRole] = useState<ClassRepRole>(preset?.role ?? 'hoc');
  const [departmentId, setDepartmentId] = useState(preset?.departmentId ?? (data.departments.length === 1 ? data.departments[0]!.id : ''));
  const [facultyId, setFacultyId] = useState(preset?.role === 'ghoc' ? preset.facultyId : data.faculties.length === 1 ? data.faculties[0]!.id : '');
  const [year, setYear] = useState(String(preset?.entryYear ?? fixed ?? defaultSet ?? ''));
  const [query, setQuery] = useState('');
  const [student, setStudent] = useState<ClassRepStudent | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState('');
  const [removeHolders, setRemoveHolders] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const roleName = useId();
  const queryId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // A frame later, so it lands after the dialog's own showModal() focus.
  const focusStudent = request.focus && Boolean(preset);
  useEffect(() => {
    if (!focusStudent) return undefined;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusStudent]);

  const placeId = role === 'hoc' ? departmentId : facultyId;
  const entryYear = year ? Number(year) : null;
  const chosen = placeId && entryYear ? posts.find((post) => post.key === postKey(role, placeId, entryYear)) ?? null : null;
  const department = data.departments.find((item) => item.id === departmentId) ?? null;
  const faculty = data.faculties.find((item) => item.id === facultyId) ?? null;
  const placeName = role === 'hoc' ? (department ? shortDepartmentName(department.name) : '') : faculty?.name ?? '';

  // The class list for this department and set, to pick the student by name.
  const listed = role === 'hoc' && departmentId && entryYear ? data.lists.find((item) => item.departmentId === departmentId && item.entryYear === entryYear) : undefined;
  const classList = useResource(listed && entryYear ? `class-reps:list:${departmentId}:${entryYear}` : null, listed && entryYear ? listLoader(departmentId, entryYear) : NO_LIST, { maxAge: 60_000 });
  const suggestions = student || !classList.data ? [] : suggest(classList.data, query);

  const holders = request.replacing
    ? [request.replacing]
    : (chosen?.holders ?? []).filter((holder) => holder.studentUserId !== student?.userId);
  const toRemove = request.replacing ? holders : removeHolders ? holders : [];
  const already = student ? chosen?.holders.find((holder) => holder.studentUserId === student.userId) : undefined;
  const problems = {
    place: placeId ? '' : role === 'hoc' ? 'Choose a department.' : 'Choose a faculty.',
    year: entryYear ? '' : 'Choose a set.',
    student: student ? '' : 'Find the student first.',
  };
  const shown = (key: keyof typeof problems) => (tried ? problems[key] : '');

  function prefill(found: ClassRepStudent) {
    if (!editingPost) return;
    if (role === 'hoc' && !departmentId && found.departmentId && data.departments.some((item) => item.id === found.departmentId)) setDepartmentId(found.departmentId);
    if (role === 'ghoc' && !facultyId && found.facultyId && data.faculties.some((item) => item.id === found.facultyId)) setFacultyId(found.facultyId);
    if (!year && fixed === null && found.entryYear) setYear(String(found.entryYear));
  }

  async function find(text: string) {
    const value = text.trim();
    setFindError('');
    if (value.length < 3) {
      setFindError('Type their matric number or email, or a name from the class list.');
      return;
    }
    setFinding(true);
    try {
      const found = await lookupClassRepStudent(value);
      setStudent(found);
      setQuery('');
      prefill(found);
    } catch (caught) {
      setFindError(failureText(caught, 'The student could not be found. Try again.'));
    } finally {
      setFinding(false);
    }
  }

  function onQueryKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const ready = suggestions.filter((entry) => entry.userId);
    if (ready.length === 1 && suggestions.length === 1) void find(ready[0]!.matricNumber);
    else void find(query);
  }

  async function submit() {
    setTried(true);
    setError('');
    if (Object.values(problems).some(Boolean) || !student || !entryYear || already) return;
    setBusy(true);
    try {
      const rep = await appointClassRep({
        studentUserId: student.userId,
        role,
        entryYear,
        ...(role === 'hoc' ? { departmentId } : { facultyId }),
      });
      const removed: string[] = [];
      const removedIds: string[] = [];
      const failed: string[] = [];
      for (const holder of toRemove) {
        try {
          await revokeClassRep(holder.id);
          removed.push(holder.studentName);
          removedIds.push(holder.id);
        } catch {
          failed.push(holder.studentName);
        }
      }
      onAppointed(rep, removedIds);
      setDone({ rep, removed, failed });
    } catch (caught) {
      setError(failureText(caught, 'The appointment could not be saved. Try again.'));
      setBusy(false);
    }
  }

  if (done) {
    const { rep } = done;
    return (
      <div className="crp-done" role="status">
        <span className="crp-done-icon" aria-hidden="true"><Check size={28} strokeWidth={2.4} /></span>
        <h3 className="crp-done-title">{rep.studentName} is now {ROLE_NAME[rep.role]}</h3>
        <p className="crp-done-text">
          {appointedLine(rep)} The next time they open LASUATOS they can take attendance{rep.role === 'ghoc' ? ' and appoint HOCs for their set' : ' and keep the class list'}.
        </p>
        {done.removed.length ? <p className="crp-done-text">{done.removed.join(' and ')} {done.removed.length === 1 ? 'is' : 'are'} no longer {ROLE_NAME[rep.role]}.</p> : null}
        {done.failed.length ? (
          <p className="crp-note is-warning" role="note">
            <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
            {done.failed.join(' and ')} could not be removed. Open them in the list and choose Remove.
          </p>
        ) : null}
        <div className="crp-actions">
          <Button variant="gray" onClick={onAnother}>Appoint another</Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  const mismatch = student ? [
    role === 'hoc' && student.departmentId && departmentId && student.departmentId !== departmentId ? student.departmentName : null,
    role === 'ghoc' && student.facultyId && facultyId && student.facultyId !== facultyId ? student.facultyName : null,
    student.entryYear && entryYear && student.entryYear !== entryYear ? academicSetLabel(student.entryYear) : null,
  ].filter(Boolean) : [];

  return (
    <form className="crp-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
      {!editingPost && chosen ? (
        <div className="crp-post-card">
          <span className={`crp-role is-${chosen.role}`}>{ROLE_NAME[chosen.role]}</span>
          <div className="crp-post-card-text">
            <p className="crp-post-card-title">{chosen.role === 'ghoc' ? chosen.facultyName : postPlace(chosen)}</p>
            <p className="crp-post-card-sub">{academicSetLabel(chosen.entryYear)} · {listLine(chosen)}</p>
          </div>
          {!request.replacing ? <button className="crp-inline-link" type="button" onClick={() => setEditingPost(true)}>Change</button> : null}
        </div>
      ) : (
        <>
          {canGhoc ? (
            <fieldset className="crp-choices">
              <legend className="crp-legend">Role</legend>
              {(['hoc', 'ghoc'] as const).map((value) => (
                <label key={value} className="crp-choice">
                  <input type="radio" name={roleName} value={value} checked={role === value} onChange={() => setRole(value)} />
                  <span>
                    <strong>{ROLE_NAME[value]}</strong>
                    <small>{ROLE_HINT[value]}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="crp-pair">
            {role === 'hoc' ? (
              data.departments.length === 1 ? (
                <div className="account-field crp-fixed"><span>Department</span><p>{shortDepartmentName(data.departments[0]!.name)}</p></div>
              ) : (
                <label className="account-field">
                  <span>Department</span>
                  <Select value={departmentId} onValueChange={setDepartmentId} placeholder="Choose a department" options={departmentOptions(data.departments)} />
                  {shown('place') ? <small className="crp-field-error">{shown('place')}</small> : null}
                </label>
              )
            ) : data.faculties.length === 1 ? (
              <div className="account-field crp-fixed"><span>Faculty</span><p>{data.faculties[0]!.name}</p></div>
            ) : (
              <label className="account-field">
                <span>Faculty</span>
                <Select value={facultyId} onValueChange={setFacultyId} placeholder="Choose a faculty" options={data.faculties.map((item) => ({ value: item.id, label: item.name }))} />
                {shown('place') ? <small className="crp-field-error">{shown('place')}</small> : null}
              </label>
            )}
            {fixed !== null ? (
              <div className="account-field crp-fixed"><span>Set</span><p>{academicSetLabel(fixed)}</p></div>
            ) : (
              <label className="account-field">
                <span>Set</span>
                <Select value={year} onValueChange={setYear} placeholder="Choose a set" options={setChoices(posts, now).map((value) => ({ value: String(value), label: academicSetLabel(value) }))} />
                {shown('year') ? <small className="crp-field-error">{shown('year')}</small> : null}
              </label>
            )}
          </div>
        </>
      )}

      {student ? (
        <div className="crp-found">
          <div className="crp-found-head">
            <span className="crp-avatar" aria-hidden="true">{initials(student.fullName)}</span>
            <div className="crp-found-who">
              <p className="crp-found-name">{student.fullName}</p>
              <p className="crp-found-line"><span className="ds-mono">{student.matricNumber}</span> · {student.email}</p>
              <p className="crp-found-line">{[student.departmentName ? shortDepartmentName(student.departmentName) : null, student.entryYear ? academicSetLabel(student.entryYear) : null].filter(Boolean).join(' · ') || 'Department not recorded'}</p>
            </div>
            <button className="crp-inline-link" type="button" onClick={() => { setStudent(null); window.requestAnimationFrame(() => inputRef.current?.focus()); }}>Change</button>
          </div>
          {already ? <p className="crp-field-error" role="alert">{student.fullName} is already {ROLE_NAME[role]} here.</p> : null}
          {!already && student.currentRole ? (
            <p className="crp-note is-warning" role="note"><AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />Now {student.currentRole}. Appointing them here ends that.</p>
          ) : null}
          {!already && mismatch.length ? (
            <p className="crp-note is-warning" role="note"><AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />Their record says {mismatch.join(', ')}. Check this is the right person for this post.</p>
          ) : null}
        </div>
      ) : (
        <div className="crp-student">
          <label className="crp-label" htmlFor={queryId}>Student</label>
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
                placeholder={listed ? 'Name, matric number or email' : 'Matric number or email'}
                aria-invalid={Boolean(findError || shown('student'))}
                aria-describedby={`${queryId}-note`}
              />
            </span>
            <Button variant="tinted" busy={finding} onClick={() => void find(query)}>Find</Button>
          </div>
          {findError || shown('student') ? (
            <small className="crp-field-error" id={`${queryId}-note`} role="alert">{findError || shown('student')}</small>
          ) : (
            <small className="crp-form-note" id={`${queryId}-note`}>
              {listed ? `Type a name from the ${department?.code || placeName} ${academicSetLabel(listed.entryYear)} list, or a matric number or email.` : 'They need a LASUATOS account first. Opening one takes a minute.'}
            </small>
          )}
          {suggestions.length ? (
            <ul className="ds-list crp-suggestions" aria-label="On the class list">
              {suggestions.map((entry) => (
                <li key={entry.id}>
                  <button className="ds-row crp-suggestion" type="button" disabled={!entry.userId || finding} onClick={() => void find(entry.matricNumber)}>
                    <span className="crp-avatar is-small" aria-hidden="true">{initials(`${entry.firstName} ${entry.surname}`)}</span>
                    <span className="ds-row-body">
                      <span className="ds-row-title">{entry.surname.toUpperCase()} {entry.firstName}{entry.middleName ? ` ${entry.middleName}` : ''}</span>
                      <span className="ds-row-subtitle"><span className="ds-mono">{entry.matricNumber}</span>{entry.userId ? '' : ' · Hasn’t opened an account'}</span>
                    </span>
                    {entry.isRep ? <Badge tone="accent">Rep</Badge> : null}
                    {entry.userId ? <UserRoundCheck className="crp-suggestion-icon" size={18} strokeWidth={2} aria-hidden="true" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {holders.length && !already ? (
        request.replacing ? (
          <p className="crp-note" role="note">{request.replacing.studentName} stops being {ROLE_NAME[request.replacing.role]} when you appoint someone new.</p>
        ) : (
          <label className="crp-check">
            <input type="checkbox" checked={removeHolders} onChange={(event) => setRemoveHolders(event.target.checked)} />
            <span>
              Remove {holders.map((holder) => holder.studentName).join(' and ')} as {ROLE_NAME[role]}
              <small>{holders.length === 1 ? 'They hold this post now. Untick to share it with them.' : 'They hold this post now. Untick to share it.'}</small>
            </span>
          </label>
        )
      ) : null}

      {error ? <p className="crp-field-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={Boolean(already)} icon={<UserRoundCheck size={20} strokeWidth={2.1} aria-hidden="true" />}>
        {busy ? 'Saving…' : `Appoint as ${ROLE_NAME[role]}`}
      </Button>
    </form>
  );
}

const NO_LIST = async (): Promise<ClassListEntry[]> => [];
