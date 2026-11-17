import Papa from 'papaparse';
import { parseClassListTable, type Cell, type ParsedClassList } from './class-list-parse';

/**
 * Reads a class list from whatever a HOC has: an Excel workbook, a CSV or
 * text file, a Word document (.docx: its tables, or its lines when it has
 * none), or rows pasted from Excel, Google Sheets, Word, a PDF or WhatsApp.
 *
 * Pasted text is read every sensible way (tabs, commas, semicolons, bars,
 * then line by line: the number, the name and the email wherever they are
 * on the line), and the reading that finds the most students is kept.
 * Nothing is decided here: the server checks every row before saving.
 */

export interface ReadClassList extends ParsedClassList {
  /** How the text was read, after the word "Read" ("as columns copied from a spreadsheet"…). */
  readonly how: string;
}

type Table = Cell[][];

const DELIMITERS: readonly { readonly char: string; readonly how: string }[] = [
  { char: '\t', how: 'as columns copied from a spreadsheet' },
  { char: ',', how: 'as comma-separated columns' },
  { char: ';', how: 'as semicolon-separated columns' },
  { char: '|', how: 'as columns split by |' },
];

/** A matric number, a JAMB number (today's and the older one), spaced or not. */
const NUMBER_IN_LINE = /(?<![\dA-Za-z])(\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?[A-Za-z]{2}|\d{8}[A-Za-z]{2}|\d{3}[ -]?\d{3}[ -]?\d{3})(?![\dA-Za-z])/g;
const EMAIL_IN_LINE = /[^\s<>(),;:"'|]+@[^\s<>(),;:"'|]+\.[A-Za-z]{2,}/;
const JAMB_SHAPE = /^\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?[A-Za-z]{2}$|^\d{8}[A-Za-z]{2}$/;

function cleanText(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ');
}

/** A Markdown or bar table: drop the edge bars and the |---|---| lines. */
function unbar(value: string): string {
  return value
    .split('\n')
    .filter((line) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line))
    .map((line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, ''))
    .join('\n');
}

function split(value: string, delimiter: string): Table {
  const source = delimiter === '|' ? unbar(value) : value;
  const rows = Papa.parse<string[]>(source.trim(), { delimiter, skipEmptyLines: 'greedy' }).data;
  return rows.map((row) => row.map((cell) => cell.trim()));
}

/** How many lines split into the same number (2 or more) of cells: is this the separator? */
function consistency(table: Table): number {
  if (table.length === 0) return 0;
  const widths = new Map<number, number>();
  for (const row of table) widths.set(row.length, (widths.get(row.length) ?? 0) + 1);
  const [width, count] = [...widths.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return width >= 2 ? count / table.length : 0;
}

/**
 * Each line on its own: the student number (or both numbers), the email,
 * and the rest as the name. "1. 250211184 ODEJOBI Abraham Oluwaseun",
 * "ODEJOBI Abraham - 250211184 - abraham@st.lasu.edu.ng".
 */
export function tableFromLines(value: string): Table {
  const rows: Table = [];
  let withJamb = false;
  for (const raw of cleanText(value).split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const email = line.match(EMAIL_IN_LINE)?.[0] ?? '';
    let rest = email ? line.replace(email, ' ') : line;
    const numbers = [...rest.matchAll(NUMBER_IN_LINE)].map((match) => match[1]!);
    if (numbers.length === 0) {
      rows.push(['', '', line, '']);
      continue;
    }
    for (const number of numbers) rest = rest.replace(number, ' ');
    const jamb = numbers.find((number) => JAMB_SHAPE.test(number)) ?? '';
    const matric = numbers.find((number) => !JAMB_SHAPE.test(number)) ?? '';
    if (jamb && matric) withJamb = true;
    const name = rest
      .replace(/^\s*(s\/?n\.?\s*)?\d{1,4}\s*[.)\]:-]?\s+/i, ' ') // a serial number at the start
      .replace(/^[\s\-–—:|,.]+|[\s\-–—:|,]+$/g, '')
      .replace(/\s*[-–—|:]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    rows.push([matric || jamb, matric && jamb ? jamb : '', name, email]);
  }
  const heading = ['Matric number', 'JAMB number', 'Full name', 'Email'];
  const table = [heading, ...rows];
  // No second numbers: no JAMB column (it would be read as empty anyway).
  return withJamb ? table : table.map((row) => [row[0], row[2], row[3]]);
}

/** Every reasonable reading of the text, most likely first. */
function readings(value: string): { table: Table; how: string }[] {
  const text = cleanText(value);
  const options: { table: Table; how: string; fit: number }[] = [];
  for (const { char, how } of DELIMITERS) {
    if (!text.includes(char)) continue;
    const table = split(text, char);
    const fit = consistency(table);
    if (fit >= 0.5) options.push({ table, how, fit });
  }
  options.sort((a, b) => b.fit - a.fit);
  return [...options, { table: tableFromLines(text), how: 'line by line (the number, name and email on each line)', fit: 0 }];
}

/** Reads pasted text (or a text file) the way that finds the most students. */
export function readClassListText(value: string): ReadClassList {
  let best: ReadClassList | null = null;
  for (const { table, how } of readings(value)) {
    const parsed = parseClassListTable(table);
    // Prefer the reading that finds more students, then the one with fewer notes to check.
    if (!best || parsed.rows.length > best.rows.length || (parsed.rows.length === best.rows.length && parsed.notes.length < best.notes.length && parsed.rows.length > 0)) {
      best = { ...parsed, how };
    }
  }
  return best!;
}

export function readClassListTable(table: Table, how: string): ReadClassList {
  return { ...parseClassListTable(table), how };
}

/* ── Word (.docx) ─────────────────────────────────────────────────────── */

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export interface WordContent {
  /** Each table in the document, as rows of cell texts. */
  readonly tables: string[][][];
  /** The paragraphs outside tables. */
  readonly lines: string[];
}

/**
 * The tables and paragraphs of a Word document's body (word/document.xml).
 * Cells that span several columns keep the columns lined up; a table inside
 * a cell becomes text of that cell; deleted tracked changes are left out.
 */
export function readWordXml(xml: string): WordContent {
  const tables: string[][][] = [];
  const lines: string[] = [];
  let depth = 0;
  let table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let span = 1;
  let paragraph = '';
  let inText = false;
  const tag = /<(\/?)([\w:]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (const match of xml.matchAll(tag)) {
    const [, closing, name, attributes = '', selfClosing, text] = match;
    if (text !== undefined) {
      if (inText) paragraph += decodeXml(text);
      continue;
    }
    const open = !closing;
    switch (name) {
      case 'w:tbl':
        if (open && !selfClosing) {
          depth += 1;
          if (depth === 1) table = [];
        } else if (closing) {
          if (depth === 1 && table.length) tables.push(table);
          depth = Math.max(0, depth - 1);
        }
        break;
      case 'w:tr':
        if (depth !== 1) break;
        if (open && !selfClosing) row = [];
        else if (closing) table.push(row);
        break;
      case 'w:tc':
        if (depth !== 1) break;
        if (open && !selfClosing) { cell = ''; span = 1; }
        else if (closing) {
          row.push(cell.replace(/\s+/g, ' ').trim());
          for (let extra = 1; extra < span; extra += 1) row.push('');
        }
        break;
      case 'w:gridSpan':
        if (depth === 1) span = Math.max(1, Math.min(20, Number(/w:val="(\d+)"/.exec(attributes)?.[1] ?? 1)));
        break;
      case 'w:t':
        inText = open && !selfClosing;
        break;
      case 'w:tab':
      case 'w:br':
      case 'w:cr':
        if (open) paragraph += name === 'w:tab' ? '\t' : '\n';
        break;
      case 'w:p':
        if (open && !selfClosing) paragraph = '';
        else if (closing || selfClosing) {
          if (depth > 0) cell += ` ${paragraph}`;
          else if (paragraph.trim()) lines.push(...paragraph.split('\n').map((line) => line.trim()).filter(Boolean));
          paragraph = '';
        }
        break;
      default:
        break;
    }
  }
  return { tables, lines };
}

/**
 * One table from a Word document's tables: a list split over pages is often
 * several tables with the heading repeated, so the tables are joined and a
 * repeated heading row is dropped. Small tables (a title block, a signature
 * box) are left out when there is a bigger one.
 */
export function tableFromWord(content: WordContent): Table | null {
  const width = (rows: readonly (readonly string[])[]) => Math.max(...rows.map((cells) => cells.length));
  const useful = content.tables.filter((rows) => rows.length >= 1 && width(rows) >= 2);
  if (useful.length === 0) return null;
  const main = useful.reduce((best, rows) => (rows.length > best.length ? rows : best));
  // Same columns as the biggest table (the list, continued), or a sizeable table of its own.
  const kept = useful.filter((rows) => rows === main || width(rows) === width(main) || rows.length >= 3);
  // The heading (and any title rows) of the first table, repeated at the top of the next ones.
  const top = new Set(kept[0]!.slice(0, 3).map((cells) => cells.join('\u0001').toLowerCase()));
  const joined: Table = [];
  kept.forEach((rows, index) => {
    for (const [at, cells] of rows.entries()) {
      if (index > 0 && at < 3 && top.has(cells.join('\u0001').toLowerCase())) continue;
      joined.push(cells);
    }
  });
  return joined;
}

/* ── Zip (the container of .docx and .xlsx) ───────────────────────────── */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One file from a zip archive, or null when it is not there. Stored and deflated files only (what Word writes). */
export async function unzipFile(archive: ArrayBuffer, path: string): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(archive);
  const view = new DataView(archive);
  // The end-of-central-directory record is in the last 64 KB (after an optional comment).
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('not a zip');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < count && at + 46 <= bytes.length; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== path) continue;
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('broken zip');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) return data;
    if (method === 8) return inflate(data);
    throw new Error('unsupported zip compression');
  }
  return null;
}

/** A Word document's class list: its tables, or its lines when it has none. */
export async function readWordDocument(archive: ArrayBuffer): Promise<ReadClassList> {
  let xml: Uint8Array | null;
  try {
    xml = await unzipFile(archive, 'word/document.xml');
  } catch {
    xml = null;
  }
  if (!xml) throw new Error('That Word file could not be opened. Save it again as a Word Document (.docx), or copy the list and paste it here.');
  const content = readWordXml(new TextDecoder().decode(xml));
  const table = tableFromWord(content);
  if (table) {
    const fromTable = readClassListTable(table, `from the table${content.tables.length > 1 ? 's' : ''} in the document`);
    if (fromTable.rows.length > 0 || content.lines.length === 0) return fromTable;
  }
  const fromText = readClassListText(content.lines.join('\n'));
  return { ...fromText, how: `from the document’s lines, ${fromText.how}` };
}

/* ── Files ────────────────────────────────────────────────────────────── */

export const CLASS_LIST_FILE_TYPES = [
  '.xlsx', '.csv', '.txt', '.docx', '.tsv',
  'text/csv', 'text/plain', 'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

/** Reads a chosen file; errors are sentences for the HOC. */
export async function readClassListFile(file: File): Promise<ReadClassList> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    return readClassListTable((await readSheet(file)) as Table, 'from the first sheet of the workbook');
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files can’t be read. In Excel, choose Save As, then Excel Workbook (.xlsx), and upload that file.');
  if (name.endsWith('.docx')) return readWordDocument(await file.arrayBuffer());
  if (name.endsWith('.doc')) throw new Error('Old .doc files can’t be read. In Word, choose Save As, then Word Document (.docx), and upload that file. Or copy the list and paste it.');
  if (name.endsWith('.pdf')) throw new Error('PDFs can’t be read reliably. Open the PDF, select the list, copy it, and paste it in Paste.');
  if (/\.(numbers|ods|odt|pages)$/.test(name)) throw new Error('Save it as Excel (.xlsx), Word (.docx) or CSV first, then upload that file.');
  return readClassListText(await file.text());
}
