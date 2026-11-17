import { CompoundFileError, readCompoundFile } from './compound-file';

/**
 * Old Word documents (.doc, Word 97–2003) read in the browser: the main text, with its tables
 * as rows of cells, in the same shape as the .docx reader (tables, and the lines outside them).
 *
 * Written from Microsoft's published format ([MS-DOC]): the text is found through the piece
 * table (Word saves edits as pieces, some in 8-bit and some in 16-bit characters). A table
 * cell ends with character 7, and so does each row; rows are rebuilt from those marks.
 * Headers, footers, footnotes and comments are not part of the main text and are left out.
 */

export interface DocContent {
  readonly tables: string[][][];
  readonly lines: string[];
}

export class WordFileError extends Error {}

const CELL = '\u0007';

function windows1252(): TextDecoder {
  try {
    return new TextDecoder('windows-1252');
  } catch {
    return new TextDecoder('latin1');
  }
}

/** The main document text, as Word stores it (paragraphs end in \r, cells in \u0007). */
export function readDocText(buffer: ArrayBuffer | Uint8Array): string {
  let file;
  try {
    file = readCompoundFile(buffer);
  } catch (caught) {
    if (caught instanceof CompoundFileError) throw new WordFileError('This .doc file could not be opened. It may be damaged, or not really a Word file.');
    throw caught;
  }
  const word = file.stream('WordDocument');
  if (!word || word.length < 0x200) throw new WordFileError('This file has no Word document in it.');
  const view = new DataView(word.buffer, word.byteOffset, word.byteLength);
  if (view.getUint16(0, true) !== 0xa5ec) throw new WordFileError('This .doc file is from a Word version older than Word 97. Open it in Word, save it as a Word Document (.docx), and upload that.');
  const flags = view.getUint16(0x0a, true);
  if (flags & 0x0100) throw new WordFileError('This document is password-protected. Open it in Word, remove the password, save, and upload it again.');
  const table = file.stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new WordFileError('This .doc file could not be read. Save it as a Word Document (.docx) and upload that.');

  // FIB: FibBase (32 bytes), then the 16-bit, 32-bit and fc/lcb arrays, each led by its count.
  let at = 32;
  const shortCount = view.getUint16(at, true);
  at += 2 + shortCount * 2;
  const longCount = view.getUint16(at, true);
  const longs = at + 2;
  const ccpText = view.getUint32(longs + 3 * 4, true);
  at = longs + longCount * 4;
  const pairCount = view.getUint16(at, true);
  const pairs = at + 2;
  if (pairCount <= 33) throw new WordFileError('This .doc file could not be read. Save it as a Word Document (.docx) and upload that.');
  const fcClx = view.getUint32(pairs + 33 * 8, true);
  const lcbClx = view.getUint32(pairs + 33 * 8 + 4, true);
  if (!lcbClx || fcClx + lcbClx > table.length) throw new WordFileError('This .doc file could not be read. Save it as a Word Document (.docx) and upload that.');

  // Clx: any number of Prc (0x01) blocks, then the Pcdt (0x02) with the piece table.
  const clx = new DataView(table.buffer, table.byteOffset + fcClx, lcbClx);
  let position = 0;
  while (position < lcbClx && clx.getUint8(position) === 0x01) position += 3 + clx.getInt16(position + 1, true);
  if (position >= lcbClx || clx.getUint8(position) !== 0x02) throw new WordFileError('This .doc file could not be read. Save it as a Word Document (.docx) and upload that.');
  const plcLength = clx.getUint32(position + 1, true);
  const plc = position + 5;
  const pieces = Math.floor((plcLength - 4) / 12);
  const decode8 = windows1252();
  const decode16 = new TextDecoder('utf-16le');
  let text = '';
  for (let index = 0; index < pieces && text.length < ccpText; index += 1) {
    const start = clx.getUint32(plc + index * 4, true);
    const end = clx.getUint32(plc + (index + 1) * 4, true);
    const descriptor = plc + (pieces + 1) * 4 + index * 8;
    const fcValue = clx.getUint32(descriptor + 2, true);
    const compressed = (fcValue & 0x40000000) !== 0;
    const count = Math.max(0, Math.min(end, ccpText) - start);
    if (compressed) {
      const offset = (fcValue & 0x3fffffff) / 2;
      text += decode8.decode(word.subarray(offset, Math.min(word.length, offset + count)));
    } else {
      text += decode16.decode(word.subarray(fcValue, Math.min(word.length, fcValue + count * 2)));
    }
  }
  return text.slice(0, ccpText);
}

/** Field codes out, results kept; Word's special characters to plain text. */
function plain(text: string): string {
  let out = '';
  let depth = 0;
  const showing: boolean[] = [];
  for (const character of text) {
    if (character === '\u0013') { depth += 1; showing.push(false); continue; }
    if (character === '\u0014') { if (depth) showing[depth - 1] = true; continue; }
    if (character === '\u0015') { if (depth) { depth -= 1; showing.pop(); } continue; }
    if (depth && !showing[depth - 1]) continue;
    if (character === '\u001e') out += '-';
    else if (character === '\u001f' || character === '\u0001' || character === '\u0008') continue;
    else if (character === '\u000b' || character === '\u000c' || character === '\t') out += character === '\t' ? '\t' : '\n';
    else out += character;
  }
  return out;
}

/**
 * Rows from a run of table cells. Each row is its cells then an empty "row end" cell, so the
 * width is the smallest one for which every row-end position is empty; a table whose rows
 * differ in width falls back to breaking at every empty cell.
 */
function rowsFromCells(cells: readonly string[]): string[][] {
  for (let width = 1; width <= Math.min(40, cells.length - 1); width += 1) {
    if (cells.length % (width + 1) !== 0) continue;
    let fits = true;
    for (let end = width; end < cells.length; end += width + 1) {
      if (cells[end]) { fits = false; break; }
    }
    if (!fits) continue;
    const rows: string[][] = [];
    for (let start = 0; start < cells.length; start += width + 1) rows.push(cells.slice(start, start + width));
    // Not a real fit when it would make every row one cell of a wider table.
    if (width > 1 || rows.every((row) => row[0])) return rows;
  }
  const rows: string[][] = [];
  let row: string[] = [];
  for (const cell of cells) {
    if (!cell && row.length) { rows.push(row); row = []; } else row.push(cell);
  }
  if (row.length) rows.push(row);
  return rows;
}

export function readDocContent(buffer: ArrayBuffer | Uint8Array): DocContent {
  const text = plain(readDocText(buffer));
  const tables: string[][][] = [];
  const lines: string[] = [];
  let cells: string[] = [];
  let carried = '';
  // Tokens end with \r (a paragraph) or \u0007 (a cell, or a row's end).
  const tokens = text.split(/(?<=[\r\u0007])/);
  tokens.forEach((token, index) => {
    const ending = token.at(-1);
    const raw = token.replace(/[\r\u0007]$/, '');
    const body = raw.replace(/\s+/g, ' ').trim();
    if (ending === CELL) {
      cells.push([carried, body].filter(Boolean).join(' '));
      carried = '';
      return;
    }
    // A paragraph inside a cell (the cell's text goes on to a \u0007 before any other \r).
    const next = tokens[index + 1];
    if (cells.length && next?.endsWith(CELL)) { carried = [carried, body].filter(Boolean).join(' '); return; }
    if (cells.length) { tables.push(rowsFromCells(cells)); cells = []; }
    lines.push(...raw.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean));
  });
  if (cells.length) tables.push(rowsFromCells(cells));
  return { tables: tables.filter((rows) => rows.length), lines };
}
