import { checkMatricNumber, type ClassListRowInput } from '@lasuatos/contracts';

/**
 * Turns whatever a HOC has (an Excel sheet, a CSV file, rows copied from
 * Excel or Google Sheets) into class-list rows. Columns are found by their
 * headings when there are any ("Matric No", "Surname", "Other names",
 * "Email"…), otherwise by what is in them (9-digit numbers, addresses with
 * @, names). A single name column is split as LASU lists usually write it:
 * "SURNAME Firstname Middlename", or "Surname, Firstname Middlename".
 *
 * Nothing is decided here: the server checks every row again and reports
 * problems by row number before anything is saved.
 */

export type Cell = string | number | boolean | Date | null | undefined;

export interface ParsedClassList {
  readonly rows: ClassListRowInput[];
  /** Short notes for the HOC about how the sheet was read. */
  readonly notes: string[];
  /** Rows left out because they had no matric number (titles, blank lines, totals…). */
  readonly skipped: number;
}

type Field = 'matric' | 'surname' | 'first' | 'middle' | 'full' | 'email' | 'entry';

const HEADINGS: readonly [Field, RegExp][] = [
  ['matric', /\b(matric|mat\.?\s*no|matriculation|reg(istration)?\.?\s*(no|number|num)|student\s*(id|no|number))\b/i],
  ['email', /e-?mail/i],
  ['entry', /\b(entry\s*level|mode\s*of\s*entry|entry\s*mode|admission\s*mode)\b/i],
  ['surname', /\b(surname|last\s*name|family\s*name|lastname)\b/i],
  ['first', /\b(first\s*name|firstname|given\s*name|forename)\b/i],
  ['middle', /\b(middle\s*names?|middlename|other\s*names?|othernames?)\b/i],
  ['full', /\b((full|student'?s?)\s*names?|names?|name\s*of\s*student)\b/i],
];

function text(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return '';
  if (typeof cell === 'number') return Number.isInteger(cell) ? String(cell) : String(cell);
  return String(cell).replace(/\s+/g, ' ').trim();
}

/**
 * The matric number as LASUATOS will store it when it is valid (9 digits,
 * tidied the same way the server does: spaces, dashes, a leading ' and a
 * trailing .0 removed). When it is not valid the cell is kept as written, so
 * the server's row report says exactly what is wrong with it.
 */
function matricOf(cell: Cell): { readonly value: string; readonly valid: boolean } {
  const raw = text(cell);
  const checked = checkMatricNumber(raw);
  return checked.ok ? { value: checked.value, valid: true } : { value: raw, valid: false };
}

/** Looks like an attempt at a matric number (rather than a title, serial or total row). */
function looksLikeMatric(value: string): boolean {
  if (!value || value.length > 40) return false;
  const digits = value.match(/\d/g)?.length ?? 0;
  // Spreadsheet-shortened numbers (2.50211E+08) are reported, not skipped.
  if (/^\d(\.\d+)?e\+?\d+$/i.test(value)) return true;
  // At least five digits, mostly digits: leaves out "TOTAL: 120", "S/N" and headings.
  return digits >= 5 && digits >= value.replace(/[\s/.'-]/g, '').length - 3;
}

function headingField(value: string): Field | null {
  for (const [field, pattern] of HEADINGS) if (pattern.test(value)) return field;
  return null;
}

/** "ODEJOBI Abraham Oluwaseun" / "Odejobi, Abraham Oluwaseun" → parts, and whether the split was a guess. */
export function splitFullName(full: string): { surname: string; firstName: string; middleName: string | null; guessed: boolean } {
  const cleaned = full.replace(/\s+/g, ' ').trim();
  if (cleaned.includes(',')) {
    const [surname, rest = ''] = cleaned.split(/,([^]*)/).map((part) => part.trim());
    const [firstName = '', ...middle] = rest.split(' ').filter(Boolean);
    return { surname: surname ?? '', firstName, middleName: middle.join(' ') || null, guessed: false };
  }
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2) return { surname: words[0] ?? '', firstName: '', middleName: null, guessed: true };
  const isUpper = (word: string) => word.length > 1 && word === word.toUpperCase() && /\p{L}/u.test(word);
  const upper = words.map(isUpper);
  // The one word in capitals is the surname, wherever it is.
  if (upper.filter(Boolean).length === 1) {
    const at = upper.indexOf(true);
    const others = words.filter((_word, index) => index !== at);
    return { surname: words[at]!, firstName: others[0]!, middleName: others.slice(1).join(' ') || null, guessed: false };
  }
  // Otherwise LASU's usual order: surname first.
  return { surname: words[0]!, firstName: words[1]!, middleName: words.slice(2).join(' ') || null, guessed: !upper.every(Boolean) || words.length > 1 };
}

function entryLevelOf(value: string): 100 | 200 | 300 | undefined {
  const lower = value.toLowerCase();
  if (!lower) return undefined;
  if (/\b300\b/.test(lower)) return 300;
  if (/\b200\b/.test(lower) || /\b(de|direct)\b/.test(lower)) return 200;
  if (/\b100\b/.test(lower) || /utme|jamb/.test(lower)) return 100;
  return undefined;
}

/** Column positions from a heading row, or null when the row is not one. */
function columnsFromHeading(row: readonly Cell[]): Partial<Record<Field, number>> | null {
  const columns: Partial<Record<Field, number>> = {};
  row.forEach((cell, index) => {
    const value = text(cell);
    if (!value || value.length > 40) return;
    const field = headingField(value);
    if (field && columns[field] === undefined) columns[field] = index;
  });
  // "Surname" + "Other names" (no first-name column): other names are the first and middle names.
  if (columns.first === undefined && columns.middle !== undefined && /other/i.test(text(row[columns.middle]))) {
    columns.first = columns.middle;
    delete columns.middle;
  }
  return columns.matric !== undefined && (columns.surname !== undefined || columns.full !== undefined || columns.first !== undefined) ? columns : null;
}

/** Column positions from the contents, for sheets without headings. */
function columnsFromContent(rows: readonly (readonly Cell[])[]): Partial<Record<Field, number>> {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const sample = rows.slice(0, 60);
  const score = (index: number, test: (value: string) => boolean) =>
    sample.filter((row) => test(text(row[index]))).length / Math.max(1, sample.filter((row) => text(row[index])).length);
  const columns: Partial<Record<Field, number>> = {};
  const nameColumns: number[] = [];
  for (let index = 0; index < width; index += 1) {
    if (sample.every((row) => !text(row[index]))) continue;
    if (columns.matric === undefined && score(index, (value) => checkMatricNumber(value).ok) > 0.6) columns.matric = index;
    else if (columns.email === undefined && score(index, (value) => value.includes('@')) > 0.6) columns.email = index;
    else if (score(index, (value) => /^[\p{L}][\p{L}\p{M}' ’.,-]*( [\p{L}\p{M}' ’.,-]+)*$/u.test(value)) > 0.8) nameColumns.push(index);
  }
  // Template order: surname, first name, middle name. One column: the full name.
  if (nameColumns.length === 1) columns.full = nameColumns[0]!;
  else if (nameColumns.length >= 2) {
    columns.surname = nameColumns[0]!;
    columns.first = nameColumns[1]!;
    if (nameColumns.length >= 3) columns.middle = nameColumns[2]!;
  }
  return columns;
}

export function parseClassListTable(table: readonly (readonly Cell[])[]): ParsedClassList {
  const notes: string[] = [];
  let headingAt = -1;
  let columns: Partial<Record<Field, number>> | null = null;
  for (let index = 0; index < Math.min(table.length, 15); index += 1) {
    const found = columnsFromHeading(table[index] ?? []);
    if (found) {
      headingAt = index;
      columns = found;
      break;
    }
  }
  const body = table.slice(headingAt + 1);
  if (!columns) {
    columns = columnsFromContent(body);
    if (columns.matric === undefined) {
      return { rows: [], notes: ['No column of matric numbers (9 digits) was found. Use the template, or add a “Matric number” heading.'], skipped: body.length };
    }
    notes.push('The sheet has no headings, so columns were read by what is in them. Check the names below.');
  }

  const rows: ClassListRowInput[] = [];
  let skipped = 0;
  let guessedNames = 0;
  for (const row of body) {
    const matric = matricOf(row[columns.matric!]);
    if (!matric.valid && !looksLikeMatric(matric.value)) {
      if (row.some((cell) => text(cell))) skipped += 1;
      continue;
    }
    let surname = columns.surname !== undefined ? text(row[columns.surname]) : '';
    let firstName = columns.first !== undefined ? text(row[columns.first]) : '';
    let middleName: string | null = columns.middle !== undefined ? text(row[columns.middle]) || null : null;
    if (columns.full !== undefined && (!surname || !firstName)) {
      const full = text(row[columns.full]);
      const split = splitFullName(full);
      if (!surname) surname = split.surname;
      if (!firstName) {
        // "Surname" + "Other names" sheets: the full column holds first and middle names.
        if (columns.surname !== undefined) {
          const [first = '', ...rest] = full.split(' ').filter(Boolean);
          firstName = first;
          middleName ??= rest.join(' ') || null;
        } else {
          firstName = split.firstName;
          middleName ??= split.middleName;
          if (split.guessed) guessedNames += 1;
        }
      }
    } else if (columns.first !== undefined && columns.middle === undefined && firstName.includes(' ')) {
      // "Other names" in one column: first word is the first name.
      const [first = '', ...rest] = firstName.split(' ');
      firstName = first;
      middleName = rest.join(' ') || null;
    }
    const email = columns.email !== undefined ? text(row[columns.email]).toLowerCase() : '';
    const entryLevel = columns.entry !== undefined ? entryLevelOf(text(row[columns.entry])) : undefined;
    rows.push({
      matricNumber: matric.value,
      surname,
      firstName,
      middleName,
      lasuEmail: email || null,
      ...(entryLevel ? { entryLevel } : {}),
    });
  }
  if (guessedNames > 0) {
    notes.push(`${guessedNames} name${guessedNames === 1 ? ' was' : 's were'} split as SURNAME, then first name, then middle names. Check them below; put the surname in capitals or use the template to be sure.`);
  }
  if (skipped > 0) notes.push(`${skipped} row${skipped === 1 ? '' : 's'} without a matric number ${skipped === 1 ? 'was' : 'were'} left out (titles, blank or total rows).`);
  return { rows, notes, skipped };
}

/** The template HOCs can download and fill in. */
export const CLASS_LIST_TEMPLATE = [
  'Matric number,Surname,First name,Middle name (optional),LASU email (optional),Entry level (DE only)',
  '250211184,ODEJOBI,Abraham,Oluwaseun,abraham.odejobi@st.lasu.edu.ng,',
  '250211185,BELLO,Aisha,,,',
  '',
].join('\r\n');
