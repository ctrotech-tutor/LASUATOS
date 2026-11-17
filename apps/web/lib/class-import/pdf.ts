import type { Cell } from '../class-list-parse';

/**
 * PDF class lists. A PDF has no rows or columns, only words placed on a page, so the list is
 * rebuilt from where the words sit: words at the same height form a line, a wide gap between
 * words starts a new cell, and cells that start at the same place on many lines form a column.
 * Two readings come out (columns lined up by position, and each line with its cells split by
 * tabs) and the caller keeps whichever finds more students.
 *
 * A scanned PDF is a picture of a list, with no words in it at all. Those are recognised and
 * refused with a clear way forward: reading pictures of names and numbers would put wrong
 * matric numbers on a register, which is worse than asking for the original file.
 */

export interface PdfWord {
  readonly text: string;
  /** Left edge and baseline, in PDF points (y grows upwards). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** Font size, roughly. */
  readonly size: number;
}

export interface PdfReading {
  /** Columns lined up by position (empty cells kept in place). */
  readonly aligned: Cell[][];
  /** Each line, its cells separated by tabs. */
  readonly text: string;
  readonly pages: number;
  /** Characters of text found; none means a scan. */
  readonly characters: number;
}

export class PdfError extends Error {}

type Chunk = { text: string; x: number; end: number };

/** Words to lines (top to bottom) and each line to chunks, split at wide gaps. */
function linesOf(words: readonly PdfWord[]): Chunk[][] {
  const sorted = words.filter((word) => word.text.trim()).slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfWord[][] = [];
  for (const word of sorted) {
    const line = lines.at(-1);
    const tolerance = Math.max(2, word.size * 0.45);
    if (line && Math.abs(line[0]!.y - word.y) <= tolerance) line.push(word);
    else lines.push([word]);
  }
  return lines.map((line) => {
    const ordered = line.sort((a, b) => a.x - b.x);
    const chunks: Chunk[] = [];
    for (const word of ordered) {
      const last = chunks.at(-1);
      // About a space and a half: wider is a new cell.
      const gap = Math.max(3, word.size * 0.55);
      if (last && word.x - last.end <= gap) {
        last.text += word.x - last.end > word.size * 0.12 ? ` ${word.text.trim()}` : word.text.trim();
        last.end = Math.max(last.end, word.x + word.width);
      } else {
        chunks.push({ text: word.text.trim(), x: word.x, end: word.x + word.width });
      }
    }
    return chunks.map((chunk) => ({ ...chunk, text: chunk.text.replace(/\s+/g, ' ').trim() })).filter((chunk) => chunk.text);
  });
}

/** Column starts shared by many lines (left edges within a few points of each other). */
function columnStarts(lines: readonly Chunk[][]): number[] {
  const multi = lines.filter((line) => line.length >= 2);
  if (multi.length < 2) return [];
  const starts = multi.flatMap((line) => line.map((chunk) => chunk.x)).sort((a, b) => a - b);
  const clusters: { sum: number; count: number; last: number }[] = [];
  for (const x of starts) {
    const cluster = clusters.at(-1);
    if (cluster && x - cluster.last <= 4) {
      cluster.sum += x;
      cluster.count += 1;
      cluster.last = x;
    } else {
      clusters.push({ sum: x, count: 1, last: x });
    }
  }
  return clusters.filter((cluster) => cluster.count >= Math.max(2, multi.length * 0.25)).map((cluster) => cluster.sum / cluster.count);
}

export function tableFromWords(pages: readonly (readonly PdfWord[])[]): PdfReading {
  const lines = pages.flatMap((words) => linesOf(words));
  const characters = lines.reduce((total, line) => total + line.reduce((sum, chunk) => sum + chunk.text.length, 0), 0);
  const starts = columnStarts(lines);
  const aligned: Cell[][] = lines.map((line) => {
    if (!starts.length) return line.map((chunk) => chunk.text);
    const cells: string[] = Array.from({ length: starts.length }, () => '');
    for (const chunk of line) {
      // The last column starting at or before this chunk (a right-aligned number starts a bit later).
      let column = 0;
      for (let index = 0; index < starts.length; index += 1) if (starts[index]! <= chunk.x + 4) column = index;
      cells[column] = cells[column] ? `${cells[column]} ${chunk.text}` : chunk.text;
    }
    return cells;
  });
  const text = lines.map((line) => line.map((chunk) => chunk.text).join('\t')).join('\n');
  return { aligned, text, pages: pages.length, characters };
}

const PDF_RUNTIME_VERSION = '6.5.438';
const MAX_PAGES = 80;

/** Reads a PDF's words page by page with pdf.js (loaded only when a PDF is chosen). */
export async function readPdf(data: ArrayBuffer): Promise<PdfReading> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (pdfjs.version !== PDF_RUNTIME_VERSION) throw new PdfError('The PDF reader is updating. Refresh the page and try again.');
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = `/pdf/pdf.worker-${PDF_RUNTIME_VERSION}.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0, disableFontFace: true, useSystemFonts: false, useWasm: false, stopAtErrors: false });
  let document;
  try {
    document = await task.promise;
  } catch (caught) {
    const name = caught instanceof Error ? caught.name : '';
    if (name === 'PasswordException') {
      void task.destroy();
      throw new PdfError('This PDF is password-protected. Open it, save a copy without the password (or print it to a new PDF), and upload that.');
    }
    void task.destroy();
    throw new PdfError('This PDF could not be opened. It may be damaged. Ask for the original Excel or Word file, or copy the list from the PDF and paste it.');
  }
  try {
    const pages: PdfWord[][] = [];
    for (let number = 1; number <= Math.min(document.numPages, MAX_PAGES); number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const words: PdfWord[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [a = 1, b = 0, , , x = 0, y = 0] = item.transform as number[];
        // Rotated text (a stamp, a watermark) is not part of the list.
        if (Math.abs(b) > Math.abs(a) * 0.2) continue;
        words.push({ text: item.str, x, y, width: item.width, size: Math.hypot(a, b) || item.height || 10 });
      }
      pages.push(words);
      page.cleanup();
    }
    return tableFromWords(pages);
  } finally {
    void task.destroy();
  }
}
