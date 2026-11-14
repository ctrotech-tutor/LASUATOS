'use client';

import {
  academicSetLabel,
  checkMatricNumber,
  checkPersonName,
  type ClassList,
  type ClassListEntry,
  type ClassListEntryStage,
  type ClassListImportResult,
  type ClassListRowInput,
} from '@lasuatos/contracts';
import { AlertTriangle, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet, History, Pencil, RotateCcw, ScanFace, Trash2, Upload, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { CLASS_LIST_TEMPLATE, parseClassListTable, type Cell, type ParsedClassList } from '../lib/class-list-parse';
import { departmentOptions, shortDepartmentName } from '../lib/department-options';
import { failureText, LectureRequestError } from '../lib/lecture-api';
import {
  classListPhotoUrl,
  importClassList,
  loadClassList,
  removeClassListEntry,
  resetClassListFace,
  updateClassListEntry,
} from '../lib/student-api';
import { useFeedback } from './feedback';
import { EditDialog, formText } from './ui/edit-dialog';
import { SearchField } from './ui/search-field';
import { Select } from './ui/select';
import { ManagementSkeleton } from './ui/skeleton';

/**
 * Class lists: the students of one department and set, kept by their HOC (or
 * an administrator on their behalf). Every student account opens from this
 * list, so the names on registers are the HOC's names, not whatever students
 * type. HOCs upload the Excel sheet they already have (or paste it, or fill
 * in the template); the server checks every row first and saves all or
 * nothing. After that, single corrections are made here and take effect
 * straight away. Every change is recorded.
 */

const STAGES: Record<ClassListEntryStage, { label: string; tone: string }> = {
  not_joined: { label: 'Not joined', tone: 'muted' },
  joined: { label: 'Account opened', tone: 'amber' },
  email_confirmed: { label: 'Email confirmed', tone: 'blue' },
  ready: { label: 'Ready', tone: 'green' },
};

type StageFilter = 'all' | ClassListEntryStage;

function displayName(entry: Pick<ClassListEntry, 'surname' | 'firstName' | 'middleName'>): string {
  return [entry.surname.toUpperCase(), entry.firstName, entry.middleName ?? ''].filter(Boolean).join(' ');
}

function setOptions(): { value: string; label: string }[] {
  const year = new Date().getFullYear();
  return Array.from({ length: 8 }, (_unused, index) => year - index).map((entryYear) => ({ value: String(entryYear), label: academicSetLabel(entryYear) }));
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

async function readTable(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as Cell[][];
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files cannot be read. In Excel, use Save As and choose Excel Workbook (.xlsx), then upload that file.');
  return parseText(await file.text());
}

async function parseText(value: string): Promise<Cell[][]> {
  const Papa = (await import('papaparse')).default;
  const parsed = Papa.parse<string[]>(value.trim(), { skipEmptyLines: 'greedy' });
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Upload                                                               */
/* ------------------------------------------------------------------ */

function Uploader({ list, onSaved }: Readonly<{ list: ClassList; onSaved: () => void }>) {
  const feedback = useFeedback();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pasted, setPasted] = useState('');
  const [parsed, setParsed] = useState<(ParsedClassList & { source: string }) | null>(null);
  const [check, setCheck] = useState<ClassListImportResult | null>(null);
  const [entryYear, setEntryYear] = useState<string>(list.fixedEntryYear ? String(list.fixedEntryYear) : list.entryYear ? String(list.entryYear) : '');
  const [busy, setBusy] = useState<'reading' | 'checking' | 'saving' | null>(null);
  const [error, setError] = useState('');
  const year = Number(entryYear) || null;

  const runCheck = useCallback(async (rows: ClassListRowInput[], targetYear: number | null) => {
    setCheck(null);
    if (!list.departmentId || !targetYear || rows.length === 0) return;
    setBusy('checking');
    try {
      setCheck(await importClassList({ departmentId: list.departmentId, entryYear: targetYear, rows, apply: false }));
    } catch (caught) {
      setError(failureText(caught, 'The list could not be checked.'));
    } finally {
      setBusy(null);
    }
  }, [list.departmentId]);

  async function take(table: Cell[][], source: string) {
    const result = parseClassListTable(table);
    if (result.rows.length > 1500) {
      setError('That is more than 1,500 students. Upload one set at a time.');
      return;
    }
    setParsed({ ...result, source });
    await runCheck(result.rows, year);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setBusy('reading');
    try {
      const table = await readTable(file);
      setBusy(null);
      await take(table, file.name);
    } catch (caught) {
      setBusy(null);
      setError(caught instanceof Error && caught.message ? caught.message : 'That file could not be read. Save it as .xlsx or .csv and try again.');
    }
  }

  async function onPaste() {
    setError('');
    if (!pasted.trim()) return;
    await take(await parseText(pasted), 'pasted rows');
  }

  async function save() {
    if (!parsed || !list.departmentId || !year) return;
    const department = list.departments.find((item) => item.id === list.departmentId);
    const changes = check ? check.added + check.updated : parsed.rows.length;
    const confirmed = await feedback.confirm({
      title: `Save ${changes} change${changes === 1 ? '' : 's'}?`,
      body: <>To the {shortDepartmentName(department?.name ?? 'department')} class list, {academicSetLabel(year)}. Students can open their accounts straight away.</>,
      confirmLabel: 'Save to the class list',
    });
    if (!confirmed) return;
    setBusy('saving');
    setError('');
    try {
      const saved = await importClassList({ departmentId: list.departmentId, entryYear: year, rows: parsed.rows, apply: true });
      if (!saved.applied) {
        setCheck(saved);
        setError('Some rows have problems, so nothing was saved. Fix them and upload again.');
        return;
      }
      feedback.toast(`Class list saved: ${saved.added} added, ${saved.updated} updated${saved.linked ? `, ${saved.linked} matched to existing accounts` : ''}.`, 'success');
      setParsed(null);
      setCheck(null);
      setPasted('');
      onSaved();
    } catch (caught) {
      setError(failureText(caught, 'The list could not be saved.'));
    } finally {
      setBusy(null);
    }
  }

  const errors = check?.problems.filter((problem) => problem.kind === 'error') ?? [];
  const warnings = check?.problems.filter((problem) => problem.kind === 'warning') ?? [];
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(CLASS_LIST_TEMPLATE)}`;

  return (
    <section className="cl-card cl-upload" aria-labelledby="cl-upload-title">
      <div className="cl-section-head">
        <div>
          <h2 id="cl-upload-title"><Upload size={18} aria-hidden="true" /> Add or update students</h2>
          <p>Upload the class list you already have. Matric number, surname and first name are needed; middle name and LASU email are optional. Students already on the list are updated, never duplicated.</p>
        </div>
        <a className="button button-secondary cl-template" href={templateHref} download="lasuatos-class-list-template.csv"><Download size={16} aria-hidden="true" /> Template</a>
      </div>

      {!list.fixedEntryYear ? (
        <label className="account-field cl-set-field">
          <span>Set (year of admission)</span>
          <Select
            value={entryYear}
            onValueChange={(value) => { setEntryYear(value); if (parsed) void runCheck(parsed.rows, Number(value) || null); }}
            placeholder="Choose the set"
            options={setOptions()}
          />
        </label>
      ) : null}

      <div className="cl-tabs" role="tablist" aria-label="How to add students">
        <button type="button" role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'is-active' : ''} onClick={() => setMode('file')}><FileSpreadsheet size={16} aria-hidden="true" /> Excel or CSV file</button>
        <button type="button" role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'is-active' : ''} onClick={() => setMode('paste')}><ClipboardPaste size={16} aria-hidden="true" /> Paste rows</button>
      </div>

      {mode === 'file' ? (
        <label className={`cl-drop${busy === 'reading' ? ' is-busy' : ''}`}>
          <input type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void onFile(event)} disabled={busy !== null} />
          <FileSpreadsheet size={28} aria-hidden="true" />
          <strong>{busy === 'reading' ? 'Reading the file…' : 'Choose the class list file'}</strong>
          <span>.xlsx (Excel) or .csv. Headings like “Matric No”, “Surname”, “Other names” are recognised.</span>
        </label>
      ) : (
        <div className="cl-paste">
          <label className="account-field">
            <span>Copy the rows in Excel or Google Sheets and paste them here</span>
            <textarea value={pasted} onChange={(event) => setPasted(event.target.value)} rows={6} placeholder={'250211184\tODEJOBI\tAbraham\tOluwaseun\n250211185\tBELLO\tAisha'} spellCheck={false} />
          </label>
          <button className="button button-secondary" type="button" onClick={() => void onPaste()} disabled={!pasted.trim() || busy !== null}>Check these rows</button>
        </div>
      )}

      {error ? <p className="account-error" role="alert">{error}</p> : null}

      {parsed ? (
        <div className="cl-preview" aria-live="polite">
          <div className="cl-preview-head">
            <strong>{parsed.rows.length} student{parsed.rows.length === 1 ? '' : 's'} read from {parsed.source}</strong>
            <button className="lx-link-button" type="button" onClick={() => { setParsed(null); setCheck(null); setError(''); }}>Start again</button>
          </div>
          {parsed.notes.map((note) => <p key={note} className="cl-note">{note}</p>)}
          {parsed.rows.length > 0 ? (
            <div className="cl-table-wrap">
              <table className="cl-table cl-preview-table">
                <thead><tr><th>Matric</th><th>Surname</th><th>First name</th><th>Middle name</th><th>LASU email</th></tr></thead>
                <tbody>
                  {parsed.rows.slice(0, 6).map((row, index) => (
                    <tr key={`${row.matricNumber}-${index}`}><td>{row.matricNumber}</td><td>{row.surname}</td><td>{row.firstName}</td><td>{row.middleName ?? ''}</td><td>{row.lasuEmail ?? ''}</td></tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 6 ? <p className="cl-more">and {parsed.rows.length - 6} more</p> : null}
            </div>
          ) : null}

          {!year ? <p className="cl-note">Choose the set above to check the list.</p> : null}
          {busy === 'checking' ? <p className="cl-note">Checking every row…</p> : null}
          {check ? (
            <div className="cl-check">
              <ul className="cl-check-counts">
                <li><strong>{check.added}</strong> new</li>
                <li><strong>{check.updated}</strong> updated</li>
                <li><strong>{check.unchanged}</strong> unchanged</li>
                {check.linked ? <li><strong>{check.linked}</strong> matched to accounts</li> : null}
              </ul>
              {errors.length ? (
                <div className="cl-problems is-error">
                  <p><AlertTriangle size={16} aria-hidden="true" /> {errors.length} row{errors.length === 1 ? ' needs' : 's need'} fixing before anything can be saved:</p>
                  <ul>{errors.slice(0, 50).map((problem) => <li key={`${problem.row}-${problem.message}`}><b>Row {problem.row}{problem.matricNumber ? ` · ${problem.matricNumber}` : ''}:</b> {problem.message}</li>)}</ul>
                  {errors.length > 50 ? <p>and {errors.length - 50} more.</p> : null}
                </div>
              ) : null}
              {warnings.length ? (
                <details className="cl-problems is-warning" open={warnings.length <= 5}>
                  <summary>{warnings.length} note{warnings.length === 1 ? '' : 's'} to check (these do not stop saving)</summary>
                  <ul>{warnings.slice(0, 50).map((problem) => <li key={`${problem.row}-${problem.message}`}><b>Row {problem.row}{problem.matricNumber ? ` · ${problem.matricNumber}` : ''}:</b> {problem.message}</li>)}</ul>
                </details>
              ) : null}
              <button className="button button-primary lx-big-button" type="button" onClick={() => void save()} disabled={busy !== null || errors.length > 0 || check.added + check.updated === 0}>
                {busy === 'saving' ? 'Saving…' : check.added + check.updated === 0 ? 'Nothing to change' : `Save ${check.added + check.updated} change${check.added + check.updated === 1 ? '' : 's'}`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One student                                                          */
/* ------------------------------------------------------------------ */

function EntryEditor({ entry, onClose, onSaved }: Readonly<{ entry: ClassListEntry; onClose: () => void; onSaved: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const emailLocked = entry.stage === 'email_confirmed' || entry.stage === 'ready';

  async function submit(form: HTMLFormElement) {
    // The same rules as the server, so mistakes show before anything is sent.
    const matric = checkMatricNumber(formText(form, 'matricNumber'));
    const surname = checkPersonName(formText(form, 'surname'), 'surname');
    const firstName = checkPersonName(formText(form, 'firstName'), 'first name');
    const middleRaw = formText(form, 'middleName');
    const middle = middleRaw ? checkPersonName(middleRaw, 'middle name', 'several') : null;
    const problem = !matric.ok ? matric.message : !surname.ok ? surname.message : !firstName.ok ? firstName.message : middle && !middle.ok ? middle.message : '';
    if (!matric.ok || !surname.ok || !firstName.ok || (middle && !middle.ok)) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const email = formText(form, 'lasuEmail');
      await updateClassListEntry(entry.id, {
        matricNumber: matric.value,
        surname: surname.value,
        firstName: firstName.value,
        middleName: middle ? middle.value : null,
        ...(emailLocked ? {} : { lasuEmail: email || null }),
        entryLevel: Number(formText(form, 'entryLevel')) as 100 | 200 | 300,
      });
      onSaved();
    } catch (caught) {
      setError(failureText(caught, 'The change could not be saved.'));
      throw caught;
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditDialog title="Correct student details" description={entry.userId ? 'This student has an account: the new details show everywhere straight away.' : undefined} busy={busy} error={error} onClose={onClose} onSubmit={submit}>
      <label className="account-field"><span>Matric number</span><input name="matricNumber" defaultValue={entry.matricNumber} inputMode="numeric" maxLength={20} required /></label>
      <label className="account-field"><span>Surname</span><input name="surname" defaultValue={entry.surname} maxLength={80} required /></label>
      <label className="account-field"><span>First name</span><input name="firstName" defaultValue={entry.firstName} maxLength={80} required /></label>
      <label className="account-field"><span>Middle name <em className="cl-optional">optional</em></span><input name="middleName" defaultValue={entry.middleName ?? ''} maxLength={120} /></label>
      <label className="account-field">
        <span>LASU email <em className="cl-optional">optional</em></span>
        <input name="lasuEmail" type="email" defaultValue={entry.lasuEmail ?? ''} maxLength={320} readOnly={emailLocked} placeholder="name@st.lasu.edu.ng" />
        {emailLocked ? <small>Confirmed by the student, so it cannot be changed here.</small> : null}
      </label>
      <label className="account-field">
        <span>Entry</span>
        <Select name="entryLevel" defaultValue={String(entry.entryLevel)} options={[
          { value: '100', label: '100 Level (UTME)' },
          { value: '200', label: '200 Level (Direct Entry)' },
          { value: '300', label: '300 Level (Direct Entry)' },
        ]} />
      </label>
    </EditDialog>
  );
}

function EntryRow({ entry, list, onEdit, onChanged }: Readonly<{ entry: ClassListEntry; list: ClassList; onEdit: () => void; onChanged: () => void }>) {
  const feedback = useFeedback();
  const stage = STAGES[entry.stage];
  const hasFace = entry.stage === 'ready' && list.faceRequired;

  async function remove() {
    const confirmed = await feedback.confirm({
      title: `Remove ${entry.firstName} ${entry.surname}?`,
      body: `${entry.matricNumber} will no longer be able to open an account from this list.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await removeClassListEntry(entry.id);
      feedback.toast('Removed from the class list.', 'success');
      onChanged();
    } catch (caught) {
      feedback.toast(failureText(caught, 'Could not remove the student.'), 'error');
    }
  }

  async function showFace() {
    const reset = await feedback.confirm({
      title: displayName(entry),
      body: <img className="cl-face-photo" src={classListPhotoUrl(entry.id)} alt={`Registered face of ${entry.firstName} ${entry.surname}`} />,
      confirmLabel: list.canResetFaces ? 'Reset face' : 'Close',
      cancelLabel: 'Close',
      tone: list.canResetFaces ? 'danger' : 'default',
    });
    if (!reset || !list.canResetFaces) return;
    const sure = await feedback.confirm({
      title: 'Reset this face?',
      body: `${entry.firstName} must register their face again before their next check-in. Do this when the photo is not them, or they asked for it to be deleted.`,
      confirmLabel: 'Reset face',
      tone: 'danger',
    });
    if (!sure) return;
    try {
      await resetClassListFace(entry.id);
      feedback.toast('Face reset. The student registers it again from their account.', 'success');
      onChanged();
    } catch (caught) {
      feedback.toast(failureText(caught, 'Could not reset the face.'), 'error');
    }
  }

  return (
    <li className="cl-entry">
      <div className="cl-entry-main">
        <strong>{displayName(entry)}</strong>
        <span className="cl-entry-meta">
          <span className="cl-matric">{entry.matricNumber}</span>
          {entry.isRep ? <span className="cl-tag">Class rep</span> : null}
          {entry.entryLevel !== 100 ? <span className="cl-tag">DE</span> : null}
          {entry.lasuEmail ? <span className="cl-email">{entry.lasuEmail}</span> : null}
        </span>
      </div>
      <span className={`cl-stage is-${stage.tone}`}>{entry.stage === 'ready' ? <CheckCircle2 size={13} aria-hidden="true" /> : null}{stage.label}</span>
      <div className="cl-entry-actions">
        {hasFace ? <button className="cl-icon-button" type="button" onClick={() => void showFace()} aria-label={`Registered face of ${entry.firstName}`} data-tooltip="Registered face"><ScanFace size={17} aria-hidden="true" /></button> : null}
        <button className="cl-icon-button" type="button" onClick={onEdit} aria-label={`Correct ${entry.firstName}’s details`} data-tooltip="Correct details"><Pencil size={16} aria-hidden="true" /></button>
        {!entry.userId ? <button className="cl-icon-button is-danger" type="button" onClick={() => void remove()} aria-label={`Remove ${entry.firstName}`} data-tooltip="Remove"><Trash2 size={16} aria-hidden="true" /></button> : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export function ClassListWorkspace() {
  const [query, setQuery] = useState<{ departmentId: string | null; entryYear: number | null }>({ departmentId: null, entryYear: null });
  const [list, setList] = useState<ClassList | null>(null);
  const [failure, setFailure] = useState<{ status: number; message: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StageFilter>('all');
  const [editing, setEditing] = useState<ClassListEntry | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadClassList(query, controller.signal)
      .then((value) => { setList(value); setFailure(null); })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        const status = caught instanceof LectureRequestError ? caught.status : 0;
        if (status === 401) {
          window.location.replace('/sign-in?next=/class-list');
          return;
        }
        setFailure({ status, message: failureText(caught, 'The class list could not be loaded.') });
      });
    return () => controller.abort();
  }, [query, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const shown = useMemo(() => {
    if (!list) return [];
    const needle = search.trim().toLowerCase();
    return list.entries.filter((entry) =>
      (filter === 'all' || entry.stage === filter) &&
      (!needle || `${entry.matricNumber} ${entry.surname} ${entry.firstName} ${entry.middleName ?? ''} ${entry.lasuEmail ?? ''}`.toLowerCase().includes(needle)));
  }, [filter, list, search]);

  if (failure && !list) {
    return (
      <section className="workspace-message" role="status">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>{failure.status === 403 ? 'Class lists are for HOCs and administrators' : 'The class list could not be loaded'}</h2>
          <p>{failure.message}</p>
          {failure.status !== 403 ? <div className="workspace-message-actions"><button className="button button-primary" type="button" onClick={refresh}>Try again</button></div> : null}
        </div>
      </section>
    );
  }
  if (!list) return <ManagementSkeleton label="Opening the class list…" rows={6} />;

  const department = list.departments.find((item) => item.id === list.departmentId);
  const scopeTitle = department ? shortDepartmentName(department.name) : 'Choose a department';
  const percentReady = list.counts.total ? Math.round((list.counts.ready / list.counts.total) * 100) : 0;

  return (
    <div className="page-stack cl-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">CLASS LIST</p>
          <h1>{scopeTitle}{list.setLabel ? <span className="cl-set"> · {list.setLabel}</span> : null}</h1>
          <p className="page-lede">Students open their accounts from this list with just their matric number, so names on every register come from here.</p>
        </div>
      </section>

      {!list.fixedDepartmentId || !list.fixedEntryYear ? (
        <div className="cl-scope">
          {!list.fixedDepartmentId ? (
            <label className="account-field">
              <span>Department</span>
              <Select
                value={list.departmentId ?? ''}
                onValueChange={(value) => setQuery((current) => ({ ...current, departmentId: value || null }))}
                placeholder="Choose a department"
                options={departmentOptions(list.departments)}
              />
            </label>
          ) : null}
          {!list.fixedEntryYear ? (
            <label className="account-field">
              <span>Set</span>
              <Select
                value={list.entryYear ? String(list.entryYear) : 'all'}
                onValueChange={(value) => setQuery((current) => ({ ...current, entryYear: value === 'all' ? null : Number(value) }))}
                options={[{ value: 'all', label: 'All sets' }, ...setOptions()]}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {list.departmentId ? (
        <>
          <section className="cl-stats" aria-label="Class list progress">
            <div><strong>{list.counts.total}</strong><span>On the list</span></div>
            <div><strong>{list.counts.joined}</strong><span>Opened an account</span></div>
            <div><strong>{list.counts.emailConfirmed}</strong><span>Email confirmed</span></div>
            <div className="is-ready"><strong>{list.counts.ready}</strong><span>{list.faceRequired ? 'Face registered' : 'Ready'}</span></div>
            <div className="cl-progress" role="img" aria-label={`${percentReady}% ready to mark attendance`}>
              <span style={{ width: `${percentReady}%` }} />
            </div>
          </section>

          <Uploader key={`${list.departmentId}-${list.entryYear ?? 'all'}`} list={list} onSaved={refresh} />

          <section className="cl-card cl-list" aria-labelledby="cl-list-title">
            <div className="cl-section-head">
              <div>
                <h2 id="cl-list-title"><UsersRound size={18} aria-hidden="true" /> Students ({list.counts.total})</h2>
                <p>Correct a name or matric number here; it changes everywhere straight away.</p>
              </div>
            </div>
            {list.entries.length ? (
              <>
                <div className="cl-filters">
                  <SearchField value={search} onValueChange={setSearch} placeholder="Search name, matric or email" aria-label="Search the class list" />
                  <div className="cl-chips" role="group" aria-label="Show">
                    {(['all', 'not_joined', 'joined', 'email_confirmed', 'ready'] as const).map((value) => (
                      <button key={value} type="button" className={filter === value ? 'is-active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                        {value === 'all' ? 'All' : STAGES[value].label}
                      </button>
                    ))}
                  </div>
                </div>
                {shown.length ? (
                  <ul className="cl-entries">
                    {shown.map((entry) => <EntryRow key={entry.id} entry={entry} list={list} onEdit={() => setEditing(entry)} onChanged={refresh} />)}
                  </ul>
                ) : <p className="cl-empty">No students match.</p>}
              </>
            ) : (
              <p className="cl-empty">No students yet. Upload the class list above, and then tell your classmates to open their accounts at <strong>lasuatos.vercel.app/sign-up</strong> with their matric number.</p>
            )}
          </section>

          {list.history.length ? (
            <details className="cl-card cl-history">
              <summary><History size={16} aria-hidden="true" /> Recent changes</summary>
              <ul>
                {list.history.map((event) => (
                  <li key={event.id}>
                    <span>{event.summary}{event.matricNumber ? ` · ${event.matricNumber}` : ''}</span>
                    <small>{event.actorName ?? 'LASUATOS'} · {when(event.at)}</small>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <p className="cl-empty cl-card"><RotateCcw size={16} aria-hidden="true" /> Choose a department to see and upload its class list.</p>
      )}

      {editing ? <EntryEditor entry={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
    </div>
  );
}
