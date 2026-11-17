import type { Cell } from '../class-list-parse';

/**
 * OpenDocument files (LibreOffice, WPS Office and Google Docs downloads): spreadsheets (.ods),
 * every sheet with its cells, and text documents (.odt), their tables and the lines outside
 * them. Both keep their content in content.xml inside the zip.
 */

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (value: string) => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
  if (name[0] === '#') {
    const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  }
  return ENTITIES[name] ?? whole;
});

export interface OpenDocumentContent {
  /** Each table (a sheet, or a table in a text document) with its name. */
  readonly tables: { readonly name: string; readonly rows: Cell[][] }[];
  /** Paragraphs outside tables. */
  readonly lines: string[];
}

const MAX_REPEAT = 200;
const MAX_ROWS = 20_000;

export function readOpenDocumentXml(xml: string): OpenDocumentContent {
  const tables: { name: string; rows: Cell[][] }[] = [];
  const lines: string[] = [];
  let depth = 0;
  let rows: Cell[][] = [];
  let name = '';
  let row: Cell[] = [];
  let rowRepeat = 1;
  let cell = '';
  let cellRepeat = 1;
  let cellValue: Cell = null;
  let paragraph = '';
  let inParagraph = 0;
  const tag = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  const attribute = (attributes: string, key: string) => new RegExp(`${key}="([^"]*)"`).exec(attributes)?.[1];
  for (const match of xml.matchAll(tag)) {
    const [, closing, element, attributes = '', selfClosing, text] = match;
    if (text !== undefined) {
      if (inParagraph) paragraph += decode(text);
      continue;
    }
    const open = !closing;
    switch (element) {
      case 'table:table':
        if (open && !selfClosing) {
          depth += 1;
          if (depth === 1) { rows = []; name = decode(attribute(attributes, 'table:name') ?? ''); }
        } else if (closing) {
          if (depth === 1) {
            while (rows.length && rows.at(-1)!.every((value) => value === null || value === '')) rows.pop();
            tables.push({ name, rows });
          }
          depth = Math.max(0, depth - 1);
        }
        break;
      case 'table:table-row':
        if (depth !== 1) break;
        if (open) { row = []; rowRepeat = Math.min(MAX_REPEAT, Number(attribute(attributes, 'table:number-rows-repeated') ?? 1) || 1); }
        if (closing || selfClosing) {
          const empty = row.every((value) => value === null || value === '');
          // A run of empty rows repeated thousands of times is the sheet's unused area.
          for (let index = 0; index < (empty ? Math.min(rowRepeat, 2) : rowRepeat) && rows.length < MAX_ROWS; index += 1) rows.push([...row]);
        }
        break;
      case 'table:table-cell':
      case 'table:covered-table-cell':
        if (depth !== 1) break;
        if (open) {
          cell = '';
          cellRepeat = Math.min(MAX_REPEAT, Number(attribute(attributes, 'table:number-columns-repeated') ?? 1) || 1);
          const type = attribute(attributes, 'office:value-type');
          const value = attribute(attributes, 'office:value');
          cellValue = type === 'float' && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
        }
        if (closing || selfClosing) {
          const value: Cell = cellValue ?? (cell.replace(/\s+/g, ' ').trim() || null);
          for (let index = 0; index < cellRepeat && row.length < 80; index += 1) row.push(value);
          cellValue = null;
        }
        break;
      case 'text:p':
      case 'text:h':
        if (open && !selfClosing) { inParagraph += 1; paragraph = inParagraph === 1 ? '' : paragraph; }
        else if (closing || selfClosing) {
          inParagraph = Math.max(0, inParagraph - 1);
          if (depth > 0) cell += ` ${paragraph}`;
          else if (paragraph.trim()) lines.push(...paragraph.split('\n').map((line) => line.trim()).filter(Boolean));
          paragraph = '';
        }
        break;
      case 'text:s':
        if (inParagraph) paragraph += ' '.repeat(Math.min(20, Number(attribute(attributes, 'text:c') ?? 1) || 1));
        break;
      case 'text:tab':
        if (inParagraph) paragraph += '\t';
        break;
      case 'text:line-break':
        if (inParagraph) paragraph += '\n';
        break;
      default:
        break;
    }
  }
  return { tables, lines };
}
