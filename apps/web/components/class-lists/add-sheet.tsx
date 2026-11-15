'use client';

import {
  academicSetLabel,
  checkMatricNumber,
  checkPersonName,
  isLasuStudentEmail,
  LASU_STUDENT_EMAIL_DOMAIN,
  type ClassList,
  type ClassListImportResult,
  type ClassListRowInput,
} from '@lasuatos/contracts';
import { AlertTriangle, ClipboardPaste, Download, FileSpreadsheet, UserPlus } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CLASS_LIST_TEMPLATE, parseClassListTable, type Cell, type ParsedClassList } from '../../lib/class-list-parse';
import { departmentOptions, shortDepartmentName } from '../../lib/department-options';
import { failureText } from '../../lib/lecture-api';
import { importClassList } from '../../lib/student-api';
import { Button, SegmentedControl, Sheet } from '../ds';
import { useClock } from '../take-attendance/hooks';
import { Select } from '../ui/select';
import { setOptions } from './format';

type Method = 'file' | 'paste' | 'one';
const MAX_ROWS = 1500;
const PREVIEW_ROWS = 6;
const PROBLEMS_SHOWN = 50;

async function readTable(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as Cell[][];
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files can’t be read. In Excel, choose Save As, then Excel Workbook (.xlsx), and upload that file.');
  return parseText(await file.text());
}

async function parseText(value: string): Promise<Cell[][]> {
  const Papa = (await import('papaparse')).default;
  return Papa.parse<string[]>(value.trim(), { skipEmptyLines: 'greedy' }).data;
}

/** Adds students to a list: an Excel or CSV file, rows pasted from a spreadsheet, or one student. */
export function AddSheet({ open, list, presetDepartmentId, onClose, onDone }: Readonly<{
  open: boolean;
  list: ClassList;
  presetDepartmentId: string | null;
  onClose: () => void;
  /** Saved: which list changed. */
  onDone: (departmentId: string, entryYear: number) => void;
}>) {
  return (
    <Sheet open={open} onClose={onClose} title="Add students" size="wide">
      {open ? <AddForm list={list} presetDepartmentId={presetDepartmentId} onDone={onDone} /> : null}
    </Sheet>
  );
}

function AddForm({ list, presetDepartmentId, onDone }: Readonly<{
  list: ClassList;
  presetDepartmentId: string | null;
  onDone: (departmentId: string, entryYear: number) => void;
}>) {
  const now = useClock('fifteen');
  const [departmentId, setDepartmentId] = useState(
    list.fixedDepartmentId ?? presetDepartmentId ?? list.departmentId ?? (list.departments.length === 1 ? list.departments[0]!.id : ''),
  );
  const [year, setYear] = useState(list.fixedEntryYear ?? list.entryYear ?? null);
  const [method, setMethod] = useState<Method>('file');
  const [pasted, setPasted] = useState('');
  const [parsed, setParsed] = useState<(ParsedClassList & { source: string }) | null>(null);
  const [check, setCheck] = useState<ClassListImportResult | null>(null);
  const [busy, setBusy] = useState<'reading' | 'checking' | 'saving' | null>(null);
  const [error, setError] = useState('');
  const department = list.departments.find((item) => item.id === departmentId);
  const target = department && year ? `${shortDepartmentName(department.name)}, ${academicSetLabel(year)}` : null;

  async function runCheck(rows: ClassListRowInput[], toDepartment: string, toYear: number | null) {
    setCheck(null);
    if (!toDepartment || !toYear || rows.length === 0) return;
    setBusy('checking');
    try {
      setCheck(await importClassList({ departmentId: toDepartment, entryYear: toYear, rows, apply: false }));
    } catch (caught) {
      setError(failureText(caught, 'The list could not be checked. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function take(table: Cell[][], source: string) {
    const result = parseClassListTable(table);
    if (result.rows.length > MAX_ROWS) {
      setError(`That is more than ${MAX_ROWS.toLocaleString('en-NG')} students. Add one set at a time.`);
      return;
    }
    if (result.rows.length === 0) {
      setError('No students were found. Each row needs a matric number and a name.');
      return;
    }
    setParsed({ ...result, source });
    await runCheck(result.rows, departmentId, year);
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

  async function save() {
    if (!parsed || !departmentId || !year) return;
    setBusy('saving');
    setError('');
    try {
      const saved = await importClassList({ departmentId, entryYear: year, rows: parsed.rows, apply: true });
      if (!saved.applied) {
        setCheck(saved);
        setError('Some rows have problems, so nothing was saved. Fix them in the file and try again.');
        setBusy(null);
        return;
      }
      onDone(departmentId, year);
    } catch (caught) {
      setError(failureText(caught, 'The list could not be saved. Try again.'));
      setBusy(null);
    }
  }

  function changeTarget(nextDepartment: string, nextYear: number | null) {
    setDepartmentId(nextDepartment);
    setYear(nextYear);
    if (parsed) void runCheck(parsed.rows, nextDepartment, nextYear);
  }

  function startAgain() {
    setParsed(null);
    setCheck(null);
    setError('');
  }

  const errors = check?.problems.filter((problem) => problem.kind === 'error') ?? [];
  const warnings = check?.problems.filter((problem) => problem.kind === 'warning') ?? [];
  const changes = check ? check.added + check.updated : 0;
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(CLASS_LIST_TEMPLATE)}`;
  const chooseWhere = list.fixedDepartmentId === null || list.fixedEntryYear === null;

  return (
    <div className="cls-add">
      {chooseWhere ? (
        <div className="cls-form-pair">
          {list.fixedDepartmentId === null ? (
            <label className="account-field">
              <span>Department</span>
              <Select value={departmentId} onValueChange={(value) => changeTarget(value, year)} placeholder="Choose the department" options={departmentOptions(list.departments)} />
            </label>
          ) : null}
          {list.fixedEntryYear === null ? (
            <label className="account-field">
              <span>Set (year of admission)</span>
              <Select value={year ? String(year) : ''} onValueChange={(value) => changeTarget(departmentId, Number(value) || null)} placeholder="Choose the set" options={setOptions(now)} />
            </label>
          ) : null}
        </div>
      ) : (
        <p className="cls-form-note">To {target}. Students already on the list are updated, never added twice.</p>
      )}

      {parsed ? (
        <Review
          parsed={parsed}
          check={check}
          errors={errors}
          warnings={warnings}
          target={target}
          busy={busy}
          error={error}
          changes={changes}
          onStartAgain={startAgain}
          onSave={() => void save()}
        />
      ) : (
        <>
          <SegmentedControl
            block
            label="How to add them"
            value={method}
            onChange={(value) => { setMethod(value); setError(''); }}
            segments={[
              { value: 'file', label: 'File', icon: <FileSpreadsheet size={16} strokeWidth={2.1} aria-hidden="true" /> },
              { value: 'paste', label: 'Paste', icon: <ClipboardPaste size={16} strokeWidth={2.1} aria-hidden="true" /> },
              { value: 'one', label: 'One student', icon: <UserPlus size={16} strokeWidth={2.1} aria-hidden="true" /> },
            ]}
          />

          {method === 'file' ? (
            <div className="cls-form">
              <label className={`cls-drop${busy === 'reading' ? ' is-busy' : ''}`}>
                <input
                  type="file"
                  accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => void onFile(event)}
                  disabled={busy !== null}
                />
                <FileSpreadsheet size={30} strokeWidth={1.8} aria-hidden="true" />
                <strong>{busy === 'reading' ? 'Reading the file…' : 'Choose the class list file'}</strong>
                <span>Excel (.xlsx) or CSV. Headings like Matric No, Surname and Other names are recognised.</span>
              </label>
              <p className="cls-form-note">
                Needs the matric number, surname and first name. Middle name and LASU email are optional.{' '}
                <a className="cls-inline-link" href={templateHref} download="lasuatos-class-list-template.csv">
                  <Download size={14} strokeWidth={2.2} aria-hidden="true" /> Download the template
                </a>
              </p>
            </div>
          ) : null}

          {method === 'paste' ? (
            <form className="cls-form" onSubmit={(event) => { event.preventDefault(); setError(''); if (pasted.trim()) void parseText(pasted).then((table) => take(table, 'the pasted rows')); }}>
              <label className="account-field">
                <span>Copy the rows in Excel or Google Sheets, then paste them here</span>
                <textarea
                  className="cls-textarea ds-mono"
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  rows={7}
                  spellCheck={false}
                  placeholder={'250211184\tODEJOBI\tAbraham\tOluwaseun\n250211185\tBELLO\tAisha'}
                />
              </label>
              <div className="cls-actions is-end">
                <Button type="submit" disabled={!pasted.trim() || busy !== null} busy={busy === 'checking'}>Check these rows</Button>
              </div>
            </form>
          ) : null}

          {method === 'one' ? <OneStudent departmentId={departmentId} year={year} onDone={onDone} /> : null}

          {error && method !== 'one' ? <p className="cls-error" role="alert">{error}</p> : null}
        </>
      )}
    </div>
  );
}

function Review({ parsed, check, errors, warnings, target, busy, error, changes, onStartAgain, onSave }: Readonly<{
  parsed: ParsedClassList & { source: string };
  check: ClassListImportResult | null;
  errors: ClassListImportResult['problems'];
  warnings: ClassListImportResult['problems'];
  target: string | null;
  busy: 'reading' | 'checking' | 'saving' | null;
  error: string;
  changes: number;
  onStartAgain: () => void;
  onSave: () => void;
}>) {
  return (
    <div className="cls-review" aria-live="polite">
      <div className="cls-review-head">
        <p className="cls-review-title">{parsed.rows.length} {parsed.rows.length === 1 ? 'student' : 'students'} read from {parsed.source}</p>
        <button className="cls-link" type="button" onClick={onStartAgain}>Start again</button>
      </div>
      {parsed.notes.map((note) => <p key={note} className="cls-form-note">{note}</p>)}

      <div className="cls-table-wrap">
        <table className="cls-table">
          <thead><tr><th scope="col">Matric</th><th scope="col">Surname</th><th scope="col">First name</th><th scope="col">Middle name</th><th scope="col">LASU email</th></tr></thead>
          <tbody>
            {parsed.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
              <tr key={`${row.matricNumber}-${index}`}>
                <td className="ds-mono">{row.matricNumber}</td><td>{row.surname}</td><td>{row.firstName}</td><td>{row.middleName ?? ''}</td><td>{row.lasuEmail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {parsed.rows.length > PREVIEW_ROWS ? <p className="cls-form-note">and {parsed.rows.length - PREVIEW_ROWS} more</p> : null}

      {!target ? <p className="cls-note">Choose the department and set above to check the list.</p> : null}
      {busy === 'checking' ? <p className="cls-form-note" role="status">Checking every row…</p> : null}

      {check ? (
        <>
          <dl className="cls-counts">
            <div><dt>New</dt><dd>{check.added}</dd></div>
            <div><dt>Updated</dt><dd>{check.updated}</dd></div>
            <div><dt>Unchanged</dt><dd>{check.unchanged}</dd></div>
            {check.linked ? <div><dt>Have accounts</dt><dd>{check.linked}</dd></div> : null}
          </dl>
          {errors.length ? (
            <div className="cls-problems is-error">
              <p className="cls-problems-title"><AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" /> {errors.length} {errors.length === 1 ? 'row needs' : 'rows need'} fixing before anything is saved</p>
              <Problems problems={errors} />
            </div>
          ) : null}
          {warnings.length ? (
            <details className="cls-problems is-warning" open={warnings.length <= 5}>
              <summary className="cls-problems-title">{warnings.length} {warnings.length === 1 ? 'note' : 'notes'} to check. These don’t stop saving.</summary>
              <Problems problems={warnings} />
            </details>
          ) : null}
        </>
      ) : null}

      {error ? <p className="cls-error" role="alert">{error}</p> : null}

      <div className="cls-actions is-end">
        <Button
          size="lg"
          disabled={!check || errors.length > 0 || changes === 0 || busy !== null}
          busy={busy === 'saving'}
          onClick={onSave}
        >
          {busy === 'saving' ? 'Saving…' : check && changes === 0 && !errors.length ? 'Nothing to change' : `Save ${changes || ''} ${changes === 1 ? 'change' : 'changes'}${target ? ` to ${target}` : ''}`.replace(/\s+/g, ' ')}
        </Button>
      </div>
    </div>
  );
}

function Problems({ problems }: Readonly<{ problems: ClassListImportResult['problems'] }>) {
  return (
    <>
      <ul>
        {problems.slice(0, PROBLEMS_SHOWN).map((problem) => (
          <li key={`${problem.row}-${problem.message}`}><strong>Row {problem.row}{problem.matricNumber ? ` · ${problem.matricNumber}` : ''}:</strong> {problem.message}</li>
        ))}
      </ul>
      {problems.length > PROBLEMS_SHOWN ? <p>and {problems.length - PROBLEMS_SHOWN} more</p> : null}
    </>
  );
}

const LEVELS = [
  { value: '100', label: '100 Level', description: 'UTME' },
  { value: '200', label: '200 Level', description: 'Direct entry' },
  { value: '300', label: '300 Level', description: 'Direct entry' },
];

function OneStudent({ departmentId, year, onDone }: Readonly<{
  departmentId: string;
  year: number | null;
  onDone: (departmentId: string, entryYear: number) => void;
}>) {
  const [form, setForm] = useState({ matricNumber: '', surname: '', firstName: '', middleName: '', lasuEmail: '', entryLevel: '100' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const set = (name: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [name]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const matric = checkMatricNumber(form.matricNumber);
    const surname = checkPersonName(form.surname, 'surname');
    const firstName = checkPersonName(form.firstName, 'first name');
    const middle = form.middleName.trim() ? checkPersonName(form.middleName, 'middle name', 'several') : null;
    const email = form.lasuEmail.trim().toLowerCase();
    const problem = !departmentId || !year ? 'Choose the department and set first.'
      : !matric.ok ? matric.message
        : !surname.ok ? surname.message
          : !firstName.ok ? firstName.message
            : middle && !middle.ok ? middle.message
              : email && !isLasuStudentEmail(email) ? `A LASU student email ends in @${LASU_STUDENT_EMAIL_DOMAIN}.`
                : '';
    if (problem || !year || !matric.ok || !surname.ok || !firstName.ok || (middle && !middle.ok)) {
      setError(problem);
      if (matric.ok === false) first.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await importClassList({
        departmentId,
        entryYear: year,
        apply: true,
        rows: [{
          matricNumber: matric.value,
          surname: surname.value,
          firstName: firstName.value,
          middleName: middle ? middle.value : null,
          lasuEmail: email || null,
          entryLevel: Number(form.entryLevel) as 100 | 200 | 300,
        }],
      });
      const blocking = saved.problems.find((item) => item.kind === 'error');
      if (!saved.applied || blocking) {
        setError(blocking?.message ?? 'They could not be added. Check the details and try again.');
        setBusy(false);
        return;
      }
      if (saved.added + saved.updated === 0) {
        setError('They are already on this list with these details.');
        setBusy(false);
        return;
      }
      onDone(departmentId, year);
    } catch (caught) {
      setError(failureText(caught, 'They could not be added. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="cls-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span>Matric number</span>
        <input ref={first} className="ds-mono" value={form.matricNumber} onChange={(event) => set('matricNumber')(event.target.value)} inputMode="numeric" maxLength={20} autoComplete="off" />
      </label>
      <div className="cls-form-pair">
        <label className="account-field">
          <span>Surname</span>
          <input value={form.surname} onChange={(event) => set('surname')(event.target.value)} maxLength={80} autoComplete="off" />
        </label>
        <label className="account-field">
          <span>First name</span>
          <input value={form.firstName} onChange={(event) => set('firstName')(event.target.value)} maxLength={80} autoComplete="off" />
        </label>
      </div>
      <div className="cls-form-pair">
        <label className="account-field">
          <span>Middle name <em className="cls-optional">optional</em></span>
          <input value={form.middleName} onChange={(event) => set('middleName')(event.target.value)} maxLength={120} autoComplete="off" />
        </label>
        <label className="account-field">
          <span>LASU email <em className="cls-optional">optional</em></span>
          <input type="email" value={form.lasuEmail} onChange={(event) => set('lasuEmail')(event.target.value)} maxLength={320} autoCapitalize="none" spellCheck={false} placeholder={`name@${LASU_STUDENT_EMAIL_DOMAIN}`} />
        </label>
      </div>
      <label className="account-field">
        <span>Entry</span>
        <Select value={form.entryLevel} onValueChange={set('entryLevel')} options={LEVELS} />
      </label>
      {error ? <p className="cls-error" role="alert">{error}</p> : null}
      <div className="cls-actions is-end">
        <Button type="submit" busy={busy}>{busy ? 'Adding…' : 'Add to the list'}</Button>
      </div>
    </form>
  );
}
