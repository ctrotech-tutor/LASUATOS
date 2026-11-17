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
  /**
   * When the file holds several lists (a workbook's sheets): every one of them, each read in
   * full, the chosen one first. Empty or absent when there is only one.
   */
  readonly alternatives?: readonly { readonly label: string; readonly result: ReadClassList }[];
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
  '.xlsx', '.xls', '.ods', '.csv', '.tsv', '.txt', '.docx', '.doc', '.odt', '.rtf', '.pdf', '.htm', '.html',
  'text/csv', 'text/plain', 'text/tab-separated-values', 'text/html', 'application/pdf', 'application/rtf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/msword',
  'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.text',
].join(',');

type Candidate = { readonly label: string; readonly result: ReadClassList };

/**
 * The list in a file with several (a workbook's sheets, a document's tables): the one with the
 * most students, the others offered beside it so the HOC can switch with one tap.
 */
export function bestOf(candidates: readonly Candidate[]): ReadClassList {
  if (candidates.length === 0) throw new Error('Nothing in this file could be read as a list.');
  const ranked = [...candidates].sort((a, b) => b.result.rows.length - a.result.rows.length || a.result.notes.length - b.result.notes.length);
  const best = ranked[0]!;
  const others = ranked.slice(1).filter((candidate) => candidate.result.rows.length > 0);
  if (others.length === 0) return best.result;
  return {
    ...best.result,
    alternatives: [best, ...others].map((candidate) => ({ label: candidate.label, result: { ...candidate.result, alternatives: [] } })),
  };
}

/** Each sheet of a workbook read on its own. */
function fromSheets(sheets: readonly { readonly name: string; readonly rows: Table }[], what: string): ReadClassList {
  const useful = sheets.filter((sheet) => sheet.rows.some((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== '')));
  if (useful.length === 0) throw new Error(`This ${what} is empty.`);
  return bestOf(useful.map((sheet) => ({
    label: sheet.name,
    result: readClassListTable(sheet.rows, useful.length > 1 ? `from the sheet “${sheet.name}”` : `from the ${what}`),
  })));
}

/** Tables (and the lines outside them) of a document, whichever finds more students. */
function fromDocument(content: { readonly tables: string[][][]; readonly lines: string[] }, what: string): ReadClassList {
  const table = tableFromWord(content);
  if (table) {
    const fromTable = readClassListTable(table, `from the table${content.tables.length > 1 ? 's' : ''} in the ${what}`);
    if (fromTable.rows.length > 0 || content.lines.length === 0) return fromTable;
  }
  if (content.lines.length === 0) throw new Error(`No list was found in this ${what}.`);
  const fromText = readClassListText(content.lines.join('\n'));
  return { ...fromText, how: `from the ${what}’s lines, ${fromText.how}` };
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function startsWith(bytes: Uint8Array, ...values: number[]): boolean {
  return values.every((value, index) => bytes[index] === value);
}

/**
 * Reads a chosen file by what is inside it, not only its name: portals' ".xls" downloads are
 * often web pages or CSV, and ".doc" files are sometimes RTF. Errors are sentences for the HOC.
 */
export async function readClassListFile(file: File): Promise<ReadClassList> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is over 25 MB, too big for a class list. Remove pictures from it, or save just the list as Excel or CSV.');
  if (/\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/.test(name) || /^image\//.test(file.type)) {
    throw new Error('This is a photo. Photos of lists can’t be read reliably: one misread digit would give a student the wrong matric number. Ask for the Excel, Word or PDF file the list was printed from, or type it into the template.');
  }
  if (/\.(numbers|pages|key)$/.test(name)) throw new Error('Apple Numbers and Pages files can’t be read. In Numbers or Pages, choose File, then Export To, then Excel or Word, and upload that.');
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Zip: Excel (.xlsx), Word (.docx) or OpenDocument (.ods, .odt).
  if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) {
    if (await unzipFile(buffer, 'xl/workbook.xml').catch(() => null)) {
      const { default: readWorkbook } = await import('read-excel-file/browser');
      const sheets = await readWorkbook(file);
      return fromSheets(sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as Table })), 'workbook');
    }
    if (await unzipFile(buffer, 'word/document.xml').catch(() => null)) return readWordDocument(buffer);
    const content = await unzipFile(buffer, 'content.xml').catch(() => null);
    if (content) {
      const { readOpenDocumentXml } = await import('./class-import/open-document');
      const document = readOpenDocumentXml(new TextDecoder().decode(content));
      const spreadsheet = name.endsWith('.ods') || (document.tables.length > 0 && document.lines.length === 0);
      return spreadsheet
        ? fromSheets(document.tables, 'spreadsheet')
        : fromDocument({ tables: document.tables.map((table) => table.rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))))), lines: document.lines }, 'document');
    }
    throw new Error('This file could not be opened. Save it again as Excel (.xlsx) or Word (.docx) and upload that.');
  }

  // Old Office files (Excel 97–2003 .xls, Word 97–2003 .doc).
  if (startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) {
    const { readCompoundFile } = await import('./class-import/compound-file');
    let streams: readonly string[] = [];
    try {
      streams = readCompoundFile(bytes).names.map((stream) => stream.toLowerCase());
    } catch {
      throw new Error('This file could not be opened. It may be damaged. Open it, save it again as Excel (.xlsx) or Word (.docx), and upload that.');
    }
    if (streams.includes('workbook') || streams.includes('book')) {
      const { readXlsWorkbook } = await import('./class-import/xls');
      return fromSheets(readXlsWorkbook(bytes), 'workbook');
    }
    if (streams.includes('worddocument')) {
      const { readDocContent } = await import('./class-import/doc');
      return fromDocument(readDocContent(bytes), 'document');
    }
    if (streams.includes('encryptedpackage')) throw new Error('This file is password-protected. Open it, remove the password (File, then Info), save, and upload it again.');
    throw new Error('This Office file has no sheet or document in it that can be read. Save it as Excel (.xlsx) or Word (.docx) and upload that.');
  }

  // PDF: read by where the words sit on each page.
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) {
    const { readPdf } = await import('./class-import/pdf');
    const reading = await readPdf(buffer);
    if (reading.characters < 20) {
      throw new Error('This PDF is a scan: a picture of the list, with no text in it to read. One misread digit would give a student the wrong matric number, so scans are not guessed at. Ask for the Excel or Word file it was printed from, or type the list into the template.');
    }
    const aligned = readClassListTable(reading.aligned, `from the PDF, its columns lined up by position (${reading.pages} ${reading.pages === 1 ? 'page' : 'pages'})`);
    const byLines = readClassListText(reading.text);
    const best = byLines.rows.length > aligned.rows.length ? { ...byLines, how: `from the PDF, ${byLines.how}` } : aligned;
    return { ...best, notes: [...best.notes, 'Read from a PDF: check the names and numbers below against the PDF before saving.'] };
  }

  const { decodeText } = await import('./class-import/text');
  const { text } = decodeText(bytes);
  const { looksLikeHtml, looksLikeRtf, tablesFromHtml, textFromRtf } = await import('./class-import/markup');
  if (looksLikeHtml(text)) {
    const tables = tablesFromHtml(text);
    return fromDocument({ tables, lines: [] }, name.endsWith('.xls') ? 'file (a web page saved as .xls)' : 'web page');
  }
  if (looksLikeRtf(text)) return fromDocument({ tables: [], lines: textFromRtf(text).split('\n') }, 'document');
  if (/\.(xlsx?|docx?|ods|odt)$/.test(name)) {
    // A spreadsheet or document name over plain text: CSV or tab-separated from a portal.
    const result = readClassListText(text);
    return { ...result, how: `${result.how} (the file is plain text named ${name.slice(name.lastIndexOf('.'))})` };
  }
  return readClassListText(text);
}
