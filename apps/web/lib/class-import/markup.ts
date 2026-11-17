/**
 * Two more shapes that class lists arrive in under misleading names:
 *
 * - HTML tables. Many portals' "Export to Excel" buttons download a web page named .xls, and
 *   "Save as Web Page" does the same. The tables are read row by row, cells that span columns
 *   keeping the columns lined up.
 * - RTF. Some tools save "Word" files as Rich Text with a .doc name. Its text is read, table
 *   cells separated by tabs and rows by new lines.
 */

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function looksLikeHtml(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?(<!doctype html|<html|<table|<meta|<head|<body)/i.test(text.slice(0, 2000)) && /<t[dh][\s>]/i.test(text);
}

/** Every table in an HTML page, as rows of cell texts (nested tables become their cell's text). */
export function tablesFromHtml(html: string): string[][][] {
  const source = html.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)[^>]*>[^]*?<\/\1>/gi, '');
  const tables: string[][][] = [];
  const stack: { rows: string[][]; row: string[] | null; cell: string | null; span: number }[] = [];
  const tag = /<(\/?)(table|tr|td|th|br|p|div)\b([^>]*)>|([^<]+)|<[^>]*>/gi;
  for (const match of source.matchAll(tag)) {
    const [, closing, rawName, attributes = '', text] = match;
    const top = stack.at(-1);
    if (text !== undefined) {
      if (top?.cell !== null && top?.cell !== undefined) top.cell += decodeEntities(text);
      continue;
    }
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (name === 'table') {
      if (!closing) stack.push({ rows: [], row: null, cell: null, span: 1 });
      else {
        const done = stack.pop();
        if (done) {
          if (done.row) done.rows.push(done.row);
          const parent = stack.at(-1);
          if (parent && parent.cell !== null) parent.cell += ` ${done.rows.map((cells) => cells.join(' ')).join(' ')}`;
          else if (done.rows.length) tables.push(done.rows);
        }
      }
      continue;
    }
    if (!top) continue;
    if (name === 'tr') {
      if (top.row) top.rows.push(top.row);
      top.row = closing ? null : [];
    } else if (name === 'td' || name === 'th') {
      if (!closing) {
        top.row ??= [];
        top.cell = '';
        top.span = Math.max(1, Math.min(20, Number(/colspan\s*=\s*["']?(\d+)/i.exec(attributes)?.[1] ?? 1)));
      } else if (top.cell !== null) {
        top.row ??= [];
        top.row.push(top.cell.replace(/\s+/g, ' ').trim());
        for (let extra = 1; extra < top.span; extra += 1) top.row.push('');
        top.cell = null;
      }
    } else if ((name === 'br' || name === 'p' || name === 'div') && top.cell !== null) {
      top.cell += ' ';
    }
  }
  return tables;
}

export function looksLikeRtf(text: string): boolean {
  return text.startsWith('{\\rtf');
}

/** The text of an RTF document: \par and \row end lines, \cell becomes a tab. */
export function textFromRtf(rtf: string): string {
  let out = '';
  let depth = 0;
  /** Depths of groups whose text is not shown (fonts, colours, styles, pictures, field codes). */
  const hidden: number[] = [];
  let skipNext = 0;
  const token = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|([^\\{}\r\n]+)|[\r\n]+/gi;
  const decoder = (() => { try { return new TextDecoder('windows-1252'); } catch { return new TextDecoder('latin1'); } })();
  const showing = () => hidden.length === 0;
  for (const match of rtf.matchAll(token)) {
    const [, word, parameter, hex, symbol, brace, text] = match;
    if (brace === '{') { depth += 1; continue; }
    if (brace === '}') { if (hidden.at(-1) === depth) hidden.pop(); depth -= 1; continue; }
    if (word) {
      const lower = word.toLowerCase();
      if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'fldinst', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'header', 'footer', 'object'].includes(lower)) {
        if (hidden.at(-1) !== depth) hidden.push(depth);
        continue;
      }
      if (!showing()) continue;
      if (lower === 'par' || lower === 'row' || lower === 'line' || lower === 'sect' || lower === 'page') out += '\n';
      else if (lower === 'cell' || lower === 'tab') out += '\t';
      else if (lower === 'u' && parameter !== undefined) {
        const code = Number(parameter) < 0 ? Number(parameter) + 65536 : Number(parameter);
        out += String.fromCharCode(code);
        skipNext = 1; // the plain-text stand-in that follows \uN
      }
      continue;
    }
    if (symbol === '*') { if (hidden.at(-1) !== depth) hidden.push(depth); continue; }
    if (!showing()) continue;
    if (hex) {
      if (skipNext) { skipNext -= 1; continue; }
      out += decoder.decode(new Uint8Array([Number.parseInt(hex, 16)]));
      continue;
    }
    if (symbol) { if (symbol === '~') out += ' '; else if (symbol === '_') out += '-'; else if ('\\{}'.includes(symbol)) out += symbol; continue; }
    if (text) {
      let value = text;
      if (skipNext) { value = value.slice(skipNext); skipNext = 0; }
      out += value;
    }
  }
  // A table row ends with "\cell\row": no tab before the line end.
  return out.replace(/\t\n/g, '\n').replace(/[ \t]+$/gm, '');
}
