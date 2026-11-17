import { checkStudentNumber, isJambRegNumber, type ClassListRowInput } from '@lasuatos/contracts';
import { isEntryValue, repairStudentNumber, tidyEmail, tidyName } from './class-import/tidy';

/** A word that is only initials: "S.", "S", "S.O.", "S.O". */
const INITIALS_WORD = /^(?:\p{L}\.)+\p{L}?$|^\p{L}$/u;

/**
 * Turns whatever a HOC has (an Excel sheet, a CSV file, a Word table, rows
 * copied from Excel or Google Sheets) into class-list rows. Columns are found
 * by their headings when there are any ("Matric No", "JAMB Reg No",
 * "Surname", "Other names", "Email"…), otherwise by what is in them (9-digit
 * matric numbers, JAMB numbers, addresses with @, names). A single name
 * column is split as LASU lists usually write it: "SURNAME Firstname
 * Middlename", or "Surname, Firstname Middlename".
 *
 * Direct Entry students without a matric number yet are listed by their
 * JAMB registration number (12 digits and 2 letters): in the matric column,
 * or in a JAMB column with the matric cell empty. A row with both numbers
 * switches a student already listed by JAMB number to the matric number.
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
  /** What each column was read as, left to right ("Matric number", "Surname", …). */
  readonly columns: readonly string[];
  /** Rows of students listed by JAMB number (Direct Entry, no matric number yet). */
  readonly onJamb: number;
}

export type Field = 'matric' | 'jamb' | 'surname' | 'first' | 'middle' | 'full' | 'email' | 'entry';

/** How each kind of column is named back to the HOC. */
export const FIELD_LABELS: Readonly<Record<Field, string>> = {
  matric: 'Matric number',
  jamb: 'JAMB number',
  surname: 'Surname',
  first: 'First name',
  middle: 'Middle name',
  full: 'Full name',
  email: 'Email',
  entry: 'Entry level',
};

/** "JAMB Reg No", "UTME/DE Reg. Number", "JAMB number". */
const JAMB_HEADING = /\b(jamb|utme\s*(\/\s*de\s*)?reg|de\s*reg)/i;

const HEADINGS: readonly [Field, RegExp][] = [
  ['matric', /\b(matric|mat\.?\s*no|matriculation|reg(istration)?\.?\s*(no|number|num)|student\s*(id|no|number))\b/i],
  ['email', /e-?mail/i],
  ['entry', /^\s*mode\s*$|\b(entry\s*level|mode\s*of\s*(entry|admission)|entry\s*mode|admission\s*mode)\b/i],
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
 * The matric number (or JAMB number) as LASUATOS will store it when it is
 * valid (tidied the same way the server does: spaces, dashes, a leading ' and
 * a trailing .0 removed, letters in capitals). When it is not valid the cell
 * is kept as written, so the server's row report says exactly what is wrong.
 */
function matricOf(cell: Cell): { readonly value: string; readonly valid: boolean; readonly jamb: boolean; readonly repairedFrom?: string } {
  const raw = text(cell);
  const checked = checkStudentNumber(raw);
  if (checked.ok) return { value: checked.value, valid: true, jamb: checked.kind === 'jamb' };
  // "25O211184": the letter O for a zero, I or l for a one.
  const repaired = repairStudentNumber(raw);
  const again = repaired ? checkStudentNumber(repaired) : null;
  if (again?.ok) return { value: again.value, valid: true, jamb: again.kind === 'jamb', repairedFrom: raw };
  return { value: raw, valid: false, jamb: false };
}

/** Share of a column's filled cells that pass `test` (0 when the column is empty). */
function share(rows: readonly (readonly Cell[])[], index: number, test: (value: string) => boolean): number {
  let filled = 0;
  let passing = 0;
  for (const row of rows) {
    const value = text(row[index]);
    if (!value) continue;
    filled += 1;
    if (test(value)) passing += 1;
  }
  return filled ? passing / filled : 0;
}

const isStudentNumber = (value: string) => matricOf(value).valid;

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
  // "JAMB Reg No" is a JAMB column; "Matric/JAMB No" is the one number column, holding either.
  if (!/e-?mail/i.test(value) && JAMB_HEADING.test(value) && (/^\W*(jamb|utme)/i.test(value) || !/matric|mat\.?\s*no/i.test(value))) return 'jamb';
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
  // Initials such as "S." are not a surname in capitals: at least two letters.
  const isUpper = (word: string) => (word.match(/\p{L}/gu)?.length ?? 0) > 1 && word === word.toUpperCase();
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

const letters = (word: string) => word.match(/\p{L}/gu)?.length ?? 0;

/**
 * A name typed as one word puts its spaces back: "ApenaAbdulrahmanOluwanifemi"
 * becomes "Apena Abdulrahman Oluwanifemi", "APENAAbdulrahman" becomes "APENA
 * Abdulrahman", "Apena_Abdulrahman" and "Apena.Abdulrahman" too. Each piece
 * must be a whole name (three letters or more), so "McDonald" stays as it is.
 * Only for a cell with no spaces; anything else is returned unchanged.
 */
export function unglueName(value: string): string {
  if (/\s/.test(value.trim())) return value;
  const pieces = value
    .replace(/_+/g, ' ')
    .replace(/(\p{L}{2,})\.(?=\p{L}{2,})/gu, '$1 ')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}{2,})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(' ')
    .filter(Boolean);
  return pieces.length > 1 && pieces.every((piece) => letters(piece) >= 3) ? pieces.join(' ') : value;
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
    if (!value || value.length > 60) return;
    const field = headingField(value);
    if (field && columns[field] === undefined) columns[field] = index;
  });
  // "Surname" + "Other names" (no first-name column): other names are the first and middle names.
  if (columns.first === undefined && columns.middle !== undefined && /other/i.test(text(row[columns.middle]))) {
    columns.first = columns.middle;
    delete columns.middle;
  }
  // A list of Direct Entry students only: the JAMB column is the number column.
  if (columns.matric === undefined && columns.jamb !== undefined) {
    columns.matric = columns.jamb;
    delete columns.jamb;
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
    const isJamb = (value: string) => isJambRegNumber(value);
    if (columns.matric === undefined && score(index, (value) => checkStudentNumber(value).ok) > 0.6) columns.matric = index;
    else if (columns.jamb === undefined && score(index, isJamb) > 0.6) columns.jamb = index;
    else if (columns.email === undefined && score(index, (value) => value.includes('@')) > 0.6) columns.email = index;
    else if (columns.entry === undefined && score(index, isEntryValue) > 0.8 && sample.some((row) => /[a-z]/i.test(text(row[index])))) columns.entry = index;
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

/** Two heading rows read as one: "Names" over "Surname | Other names", "Matric" over "No.". */
function mergedHeading(top: readonly Cell[], below: readonly Cell[]): Cell[] {
  const width = Math.max(top.length, below.length);
  let carried = '';
  return Array.from({ length: width }, (_unused, index) => {
    const upper = text(top[index]);
    // A heading merged across columns is written in its first cell only.
    if (upper) carried = upper;
    const lower = text(below[index]);
    // A heading word underneath says it all ("Names" over "Surname"); otherwise the two read
    // together ("Matric" over "No.").
    if (lower && headingField(lower)) return lower;
    return [lower ? (upper || carried) : upper, lower].filter(Boolean).join(' ');
  });
}

/**
 * Where the heading row is and what each column holds. Looks through the first 40 rows (portal
 * exports put several title lines first), reads a heading split over two rows, then checks the
 * headings against what is under them: a "Reg. No" column that holds serial numbers is not the
 * number column when another column is full of matric numbers.
 */
function findColumns(table: readonly (readonly Cell[])[]): { headingAt: number; columns: Partial<Record<Field, number>> } | null {
  const limit = Math.min(table.length, 40);
  for (let index = 0; index < limit; index += 1) {
    const row = table[index] ?? [];
    const below = table[index + 1] ?? [];
    let found = columnsFromHeading(row);
    let headingAt = index;
    // The row under it is part of the heading (it has heading words and no student number).
    if (row.some((cell) => headingField(text(cell))) && below.length && !below.some((cell) => isStudentNumber(text(cell))) && below.some((cell) => headingField(text(cell)))) {
      const merged = columnsFromHeading(mergedHeading(row, below));
      if (merged && (!found || Object.keys(merged).length >= Object.keys(found).length)) {
        found = merged;
        headingAt = index + 1;
      }
    }
    if (!found) continue;
    const body = table.slice(headingAt + 1, headingAt + 81);
    const numberAt = found.matric!;
    if (share(body, numberAt, isStudentNumber) < 0.3) {
      const width = Math.max(0, ...body.map((cells) => cells.length));
      for (let column = 0; column < width; column += 1) {
        if (column !== numberAt && share(body, column, isStudentNumber) >= 0.6) {
          for (const [field, at] of Object.entries(found) as [Field, number][]) if (at === column) delete found[field];
          found.matric = column;
          break;
        }
      }
    }
    // An email heading over cells that are not emails is not the email column.
    if (found.email !== undefined && share(body, found.email, (value) => value.includes('@')) < 0.2 && body.some((cells) => text(cells[found!.email!]))) delete found.email;
    // No entry heading: a column of "UTME" / "DE" / "200" says it anyway.
    if (found.entry === undefined) {
      const used = new Set(Object.values(found));
      const width = Math.max(0, ...body.map((cells) => cells.length));
      for (let column = 0; column < width; column += 1) {
        if (!used.has(column) && body.some((cells) => /[a-z]/i.test(text(cells[column]))) && share(body, column, isEntryValue) >= 0.8) {
          found.entry = column;
          break;
        }
      }
    }
    return { headingAt, columns: found };
  }
  return null;
}

export function parseClassListTable(table: readonly (readonly Cell[])[]): ParsedClassList {
  const notes: string[] = [];
  const located = findColumns(table);
  const headingAt = located?.headingAt ?? -1;
  let columns: Partial<Record<Field, number>> | null = located?.columns ?? null;
  const body = table.slice(headingAt + 1);
  if (!columns) {
    columns = columnsFromContent(body);
    if (columns.matric === undefined) {
      return {
        rows: [],
        notes: ['No column of matric numbers (9 digits) or JAMB numbers (12 digits and 2 letters) was found. Use the template, or add a “Matric number” heading.'],
        skipped: body.length,
        columns: [],
        onJamb: 0,
      };
    }
    notes.push('The sheet has no headings, so columns were read by what is in them. Check the names below.');
  }

  const rows: ClassListRowInput[] = [];
  let skipped = 0;
  let guessedNames = 0;
  /** Whole names found in one cell and split here: "as written" → "surname, first name". */
  const splitFromOneCell: string[] = [];
  const withInitials: string[] = [];
  let onJamb = 0;
  let switching = 0;
  const repairedNumbers: string[] = [];
  const repairedEmails: string[] = [];
  const markedDirect: string[] = [];
  const titles: string[] = [];
  const seen = new Map<string, string>();
  let repeated = 0;
  for (const row of body) {
    let matric = matricOf(row[columns.matric!]);
    const jambCell = columns.jamb !== undefined ? matricOf(row[columns.jamb]) : null;
    // No matric number yet: the JAMB number stands in.
    if (!matric.value && jambCell?.value) matric = jambCell;
    if (!matric.valid && !looksLikeMatric(matric.value)) {
      // A heading repeated on each printed page is not a missing student.
      if (row.some((cell) => text(cell)) && !columnsFromHeading(row)) skipped += 1;
      continue;
    }
    // Both numbers: the JAMB number goes along, so a student listed by it gets the matric number.
    const jambNumber = jambCell?.value && jambCell.value !== matric.value ? jambCell.value : null;
    if (matric.jamb) onJamb += 1;
    else if (jambNumber) switching += 1;
    // "(DE)" after a name marks Direct Entry; a title ("Mr") is not part of the name. Both come
    // off each name cell before it is split.
    let directEntry = false;
    const rowTitles: string[] = [];
    const nameCell = (at: number | undefined, wholeName: boolean) => {
      if (at === undefined) return '';
      const written = text(row[at]);
      const tidy = tidyName(written, wholeName ? 2 : 1);
      if (tidy.directEntry) directEntry = true;
      if (tidy.title) rowTitles.push(written);
      return tidy.value;
    };
    let surname = nameCell(columns.surname, false);
    let firstName = nameCell(columns.first, false);
    let middleName: string | null = nameCell(columns.middle, false) || null;
    if (columns.full !== undefined && (!surname || !firstName)) {
      const written = nameCell(columns.full, columns.surname === undefined);
      const full = unglueName(written);
      if (full !== written) splitFromOneCell.push(written);
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
          // Split from one word: already noted as such.
          if (split.guessed && full === written) guessedNames += 1;
        }
      }
    } else if (columns.first !== undefined && columns.middle === undefined && firstName.includes(' ')) {
      // "Other names" in one column: first word is the first name.
      const [first = '', ...rest] = firstName.split(' ');
      firstName = first;
      middleName = rest.join(' ') || null;
    }
    // The whole name in one name cell, the other empty (often typed without spaces):
    // split it rather than refuse the row for a missing first name.
    if (!firstName !== !surname) {
      const written = surname || firstName;
      const words = unglueName(written).split(' ').filter(Boolean);
      if (words.length >= 2) {
        const split = splitFullName(words.join(' '));
        surname = split.surname;
        firstName = split.firstName;
        middleName = [split.middleName, middleName].filter(Boolean).join(' ') || null;
        splitFromOneCell.push(written);
      }
    }
    if ([surname, firstName, middleName ?? ''].join(' ').split(' ').some((word) => INITIALS_WORD.test(word))) {
      withInitials.push(`${matric.value} ${[surname, firstName, middleName].filter(Boolean).join(' ')}`);
    }
    const writtenEmail = columns.email !== undefined ? text(row[columns.email]) : '';
    const tidyEmailResult = tidyEmail(writtenEmail);
    const email = tidyEmailResult.value;
    const entryLevel = (columns.entry !== undefined ? entryLevelOf(text(row[columns.entry])) : undefined) ?? (directEntry ? 200 : undefined);
    // The same student twice, word for word (a list pasted twice, a page repeated): kept once.
    const fingerprint = [matric.value, surname, firstName, middleName ?? '', email].join('\u0001').toLowerCase();
    if (seen.get(matric.value) === fingerprint) {
      repeated += 1;
      if (matric.jamb) onJamb -= 1;
      else if (jambNumber) switching -= 1;
      continue;
    }
    if (!seen.has(matric.value)) seen.set(matric.value, fingerprint);
    // Reported once per student kept (a repeated row was not counted twice).
    if (matric.repairedFrom) repairedNumbers.push(`${matric.repairedFrom} → ${matric.value}`);
    if (tidyEmailResult.repaired && email) repairedEmails.push(`${writtenEmail} → ${email}`);
    if (directEntry) markedDirect.push([surname, firstName].filter(Boolean).join(' '));
    titles.push(...rowTitles);
    rows.push({
      matricNumber: matric.value,
      ...(jambNumber ? { jambNumber } : {}),
      surname,
      firstName,
      middleName,
      lasuEmail: email || null,
      ...(entryLevel ? { entryLevel } : {}),
    });
  }
  if (onJamb > 0) {
    notes.push(`${onJamb} ${onJamb === 1 ? 'student is' : 'students are'} listed by JAMB number (no matric number yet), so ${onJamb === 1 ? 'is' : 'are'} saved as Direct Entry${columns.entry !== undefined ? ' unless the entry column says otherwise' : ' (200 level)'}. They sign up with the JAMB number and a personal email, and add the matric number when it arrives; their attendance stays.`);
  }
  if (switching > 0) {
    notes.push(`${switching} ${switching === 1 ? 'row has' : 'rows have'} both a matric number and a JAMB number: a student already listed by that JAMB number gets the matric number, keeping their account and attendance.`);
  }
  if (withInitials.length > 0) {
    const example = withInitials[0]!;
    notes.push(`${withInitials.length} student${withInitials.length === 1 ? ' has' : 's have'} initials instead of names (e.g. ${example}). Registers need full names: write them out (Samuel Olumide, not S. O.) in the sheet and upload it again.`);
  }
  if (splitFromOneCell.length > 0) {
    const example = splitFromOneCell[0]!;
    const shown = splitFullName(unglueName(example));
    notes.push(`${splitFromOneCell.length} ${splitFromOneCell.length === 1 ? 'name was' : 'names were'} written in one cell, so ${splitFromOneCell.length === 1 ? 'it was' : 'they were'} split: surname first, then first name (e.g. ${example} became ${[shown.surname, shown.firstName, shown.middleName].filter(Boolean).join(', ')}). Check them below.`);
  }
  if (guessedNames > 0) {
    notes.push(`${guessedNames} name${guessedNames === 1 ? ' was' : 's were'} split as SURNAME, then first name, then middle names. Check them below; put the surname in capitals or use the template to be sure.`);
  }
  if (repairedNumbers.length > 0) {
    notes.push(`Fixed ${repairedNumbers.length} ${repairedNumbers.length === 1 ? 'number' : 'numbers'} typed with the letter O for 0 or I for 1 (e.g. ${repairedNumbers[0]}).`);
  }
  if (repairedEmails.length > 0) {
    notes.push(`Tidied ${repairedEmails.length} ${repairedEmails.length === 1 ? 'email' : 'emails'} (spaces, a comma for a dot, a misspelt ending; e.g. ${repairedEmails[0]}). Check them below.`);
  }
  if (markedDirect.length > 0) {
    notes.push(`${markedDirect.length} ${markedDirect.length === 1 ? 'name is' : 'names are'} marked “DE” (e.g. ${markedDirect[0]}), so ${markedDirect.length === 1 ? 'that student is' : 'those students are'} saved as Direct Entry (200 level), without the mark in the name.`);
  }
  if (titles.length > 0) {
    notes.push(`Left out the title (Mr, Miss…) before ${titles.length} ${titles.length === 1 ? 'name' : 'names'} (e.g. ${titles[0]}).`);
  }
  if (repeated > 0) {
    notes.push(`${repeated} ${repeated === 1 ? 'student was' : 'students were'} on the list twice, exactly the same, so ${repeated === 1 ? 'is' : 'are'} added once.`);
  }
  if (skipped > 0) notes.push(`${skipped} row${skipped === 1 ? '' : 's'} without a matric number ${skipped === 1 ? 'was' : 'were'} left out (titles, blank or total rows).`);
  const read = columns;
  const order = (Object.keys(read) as Field[]).sort((a, b) => read[a]! - read[b]!);
  return { rows, notes, skipped, columns: order.map((field) => (field === 'matric' && onJamb > 0 && onJamb < rows.length ? 'Matric or JAMB number' : field === 'matric' && onJamb === rows.length && rows.length > 0 ? 'JAMB number' : FIELD_LABELS[field])), onJamb };
}

/**
 * The template HOCs can download and fill in. A Direct Entry student without
 * a matric number yet has the matric cell empty, the JAMB number, and a
 * personal email; when the matric number arrives, filling it in next to the
 * JAMB number and uploading again switches them over.
 */
export const CLASS_LIST_TEMPLATE = [
  'Matric number,JAMB number (DE; if no matric yet),Surname,First name,Middle name (optional),Email (LASU; or personal with JAMB),Entry level (DE only)',
  '250211184,,ODEJOBI,Abraham,Oluwaseun,abraham.odejobi@st.lasu.edu.ng,',
  '250211185,,BELLO,Aisha,,,',
  ',202530074987JA,ADEYEMI,Kunle,Tobi,kunle.adeyemi@gmail.com,200',
  '',
].join('\r\n');
