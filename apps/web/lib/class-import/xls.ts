import { CompoundFileError, readCompoundFile } from './compound-file';
import type { Cell } from '../class-list-parse';

/**
 * Old Excel workbooks (.xls, Excel 97–2003, and Excel 5/95) read in the browser: every sheet's
 * name and its cells (text, numbers, true/false, the last value of formulas). Formatting,
 * charts and macros are ignored; a macro is never run, only its file is skipped over.
 *
 * Written from Microsoft's published format ([MS-XLS], BIFF8; BIFF5 for Excel 95). Every
 * length is checked against the bytes really there, and sizes are capped, so a broken file
 * gives a clear message instead of hanging the page.
 */

export interface WorkbookSheet {
  readonly name: string;
  readonly rows: Cell[][];
}

export class SpreadsheetError extends Error {}

const MAX_ROWS = 20_000;
const MAX_COLUMNS = 80;

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const FILEPASS = 0x002f;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const RSTRING = 0x00d6;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;
const BOOLERR = 0x0205;
const CODEPAGE = 0x0042;

type Record = { readonly type: number; readonly offset: number; readonly data: Uint8Array };

function records(stream: Uint8Array): Record[] {
  const out: Record[] = [];
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  let at = 0;
  while (at + 4 <= stream.length) {
    const type = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    const end = Math.min(stream.length, at + 4 + length);
    out.push({ type, offset: at, data: stream.subarray(at + 4, end) });
    at = end;
    if (out.length > 2_000_000) break;
  }
  return out;
}

/** Reads bytes across a record and its CONTINUE records, as Excel splits long string tables. */
class Segments {
  private index = 0;
  private at = 0;
  constructor(private readonly parts: readonly Uint8Array[]) {}

  private current(): Uint8Array | null {
    while (this.index < this.parts.length && this.at >= this.parts[this.index]!.length) {
      this.index += 1;
      this.at = 0;
    }
    return this.parts[this.index] ?? null;
  }

  get done(): boolean {
    return this.current() === null;
  }

  byte(): number {
    const part = this.current();
    if (!part) throw new SpreadsheetError('ran out of data');
    const value = part[this.at]!;
    this.at += 1;
    return value;
  }

  u16(): number {
    return this.byte() | (this.byte() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(count: number) {
    for (let left = count; left > 0;) {
      const part = this.current();
      if (!part) return;
      const step = Math.min(left, part.length - this.at);
      this.at += step;
      left -= step;
    }
  }

  /** `count` characters; where the characters cross into the next record, it starts with a fresh flags byte. */
  chars(count: number, wide: boolean, decode8: (code: number) => string): string {
    let high = wide;
    let out = '';
    for (let left = count; left > 0; left -= 1) {
      const part = this.parts[this.index];
      if (!part || this.at >= part.length) {
        if (!this.current()) break;
        high = (this.byte() & 0x01) === 1;
      }
      out += high ? String.fromCharCode(this.u16()) : decode8(this.byte());
    }
    return out;
  }
}

/** XLUnicodeRichExtendedString (BIFF8): the strings of the shared string table. */
function richString(reader: Segments, decode8: (code: number) => string): string {
  const count = reader.u16();
  const flags = reader.byte();
  const runs = flags & 0x08 ? reader.u16() : 0;
  const extra = flags & 0x04 ? reader.u32() : 0;
  const value = reader.chars(count, (flags & 0x01) === 1, decode8);
  reader.skip(runs * 4 + extra);
  return value;
}

function rk(value: number): number {
  let number: number;
  if (value & 0x02) {
    number = value >> 2; // a signed 30-bit integer
  } else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(4, value & 0xfffffffc, true);
    number = buffer.getFloat64(0, true);
  }
  return value & 0x01 ? number / 100 : number;
}

/** The 8-bit characters of old files: Windows code pages, Latin-1 when unknown. */
function decoderFor(codepage: number): (code: number) => string {
  const label = codepage === 1252 || codepage === 0x8001 ? 'windows-1252' : codepage === 65001 ? 'utf-8' : codepage >= 1250 && codepage <= 1258 ? `windows-${codepage}` : null;
  if (!label) return (code) => String.fromCharCode(code);
  try {
    const decoder = new TextDecoder(label);
    const table = Array.from({ length: 256 }, (_unused, code) => decoder.decode(new Uint8Array([code])));
    return (code) => table[code] ?? '';
  } catch {
    return (code) => String.fromCharCode(code);
  }
}

export function readXlsWorkbook(buffer: ArrayBuffer | Uint8Array): WorkbookSheet[] {
  let stream: Uint8Array | null;
  try {
    const file = readCompoundFile(buffer);
    stream = file.stream('Workbook') ?? file.stream('Book');
  } catch (caught) {
    if (caught instanceof CompoundFileError) throw new SpreadsheetError('This .xls file could not be opened. It may be damaged, or not really an Excel file.');
    throw caught;
  }
  if (!stream) throw new SpreadsheetError('This file has no Excel workbook in it.');
  const all = records(stream);
  const first = all[0];
  if (!first || (first.type & 0xff) !== 0x09) throw new SpreadsheetError('This .xls file could not be opened. It may be damaged.');
  const firstView = new DataView(first.data.buffer, first.data.byteOffset, first.data.byteLength);
  const biff8 = first.data.length >= 2 && firstView.getUint16(0, true) === 0x0600;

  let decode8 = decoderFor(1252);
  const strings: string[] = [];
  const sheets: { name: string; offset: number; kind: number }[] = [];
  // The workbook globals, up to the first EOF.
  for (let index = 1; index < all.length; index += 1) {
    const record = all[index]!;
    const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
    if (record.type === EOF) break;
    if (record.type === FILEPASS) throw new SpreadsheetError('This workbook is password-protected. Open it in Excel, remove the password (File, then Info), save, and upload it again.');
    if (record.type === CODEPAGE && record.data.length >= 2) decode8 = decoderFor(view.getUint16(0, true));
    if (record.type === BOUNDSHEET && record.data.length >= 8) {
      const offset = view.getUint32(0, true);
      const kind = record.data[5] ?? 0;
      const length = record.data[6] ?? 0;
      let name: string;
      if (biff8) {
        const wide = ((record.data[7] ?? 0) & 0x01) === 1;
        name = new Segments([record.data.subarray(8)]).chars(length, wide, decode8);
      } else {
        name = Array.from(record.data.subarray(7, 7 + length), (code) => decode8(code)).join('');
      }
      sheets.push({ name, offset, kind });
    }
    if (record.type === SST) {
      const parts = [record.data.subarray(8)];
      for (let next = index + 1; all[next]?.type === CONTINUE; next += 1) parts.push(all[next]!.data);
      const total = record.data.length >= 8 ? view.getUint32(4, true) : 0;
      const reader = new Segments(parts);
      for (let count = 0; count < Math.min(total, 500_000) && !reader.done; count += 1) {
        try {
          strings.push(richString(reader, decode8));
        } catch {
          break;
        }
      }
    }
  }

  const byOffset = new Map(all.map((record, index) => [record.offset, index]));
  const out: WorkbookSheet[] = [];
  for (const sheet of sheets) {
    if (sheet.kind !== 0) continue; // charts, macro sheets
    const start = byOffset.get(sheet.offset);
    if (start === undefined || (all[start]!.type & 0xff) !== 0x09) continue;
    const rows: Cell[][] = [];
    const put = (row: number, column: number, value: Cell) => {
      if (row >= MAX_ROWS || column >= MAX_COLUMNS) return;
      while (rows.length <= row) rows.push([]);
      const cells = rows[row]!;
      while (cells.length < column) cells.push(null);
      cells[column] = value;
    };
    let pendingString: { row: number; column: number } | null = null;
    for (let index = start + 1; index < all.length; index += 1) {
      const record = all[index]!;
      if (record.type === EOF || record.type === BOF) break;
      const data = record.data;
      if (data.length < 6 && record.type !== STRING) continue;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const row = data.length >= 2 ? view.getUint16(0, true) : 0;
      const column = data.length >= 4 ? view.getUint16(2, true) : 0;
      switch (record.type) {
        case LABELSST:
          if (data.length >= 10) put(row, column, strings[view.getUint32(6, true)] ?? '');
          break;
        case LABEL:
        case RSTRING: {
          if (data.length < 8) break;
          const length = view.getUint16(6, true);
          if (biff8) {
            const parts = [data.subarray(9)];
            for (let next = index + 1; all[next]?.type === CONTINUE; next += 1) parts.push(all[next]!.data);
            put(row, column, new Segments(parts).chars(length, ((data[8] ?? 0) & 0x01) === 1, decode8));
          } else {
            put(row, column, Array.from(data.subarray(8, 8 + length), (code) => decode8(code)).join(''));
          }
          break;
        }
        case NUMBER:
          if (data.length >= 14) put(row, column, view.getFloat64(6, true));
          break;
        case RK:
          if (data.length >= 10) put(row, column, rk(view.getUint32(6, true)));
          break;
        case MULRK: {
          const count = Math.floor((data.length - 6) / 6);
          for (let item = 0; item < count; item += 1) put(row, column + item, rk(view.getUint32(4 + item * 6 + 2, true)));
          break;
        }
        case BOOLERR:
          if (data.length >= 8 && data[7] === 0) put(row, column, data[6] === 1);
          break;
        case FORMULA: {
          if (data.length < 14) break;
          if (view.getUint16(12, true) !== 0xffff) {
            put(row, column, view.getFloat64(6, true));
          } else if (data[6] === 0) {
            pendingString = { row, column }; // the value follows in a STRING record
          } else if (data[6] === 1) {
            put(row, column, data[8] === 1);
          }
          break;
        }
        case STRING: {
          if (!pendingString || data.length < 2) break;
          const length = view.getUint16(0, true);
          if (biff8) {
            const parts = [data.subarray(3)];
            for (let next = index + 1; all[next]?.type === CONTINUE; next += 1) parts.push(all[next]!.data);
            put(pendingString.row, pendingString.column, new Segments(parts).chars(length, ((data[2] ?? 0) & 0x01) === 1, decode8));
          } else {
            put(pendingString.row, pendingString.column, Array.from(data.subarray(2, 2 + length), (code) => decode8(code)).join(''));
          }
          pendingString = null;
          break;
        }
        default:
          break;
      }
    }
    out.push({ name: sheet.name || `Sheet ${out.length + 1}`, rows });
  }
  return out;
}
