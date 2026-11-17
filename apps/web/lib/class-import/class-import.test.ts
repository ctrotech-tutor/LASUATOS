import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readClassListFile } from '../class-list-read';
import { CompoundFileError, isCompoundFile, readCompoundFile } from './compound-file';
import { readDocContent } from './doc';
import { looksLikeHtml, tablesFromHtml, textFromRtf } from './markup';
import { readOpenDocumentXml } from './open-document';
import { readPdf, tableFromWords, type PdfWord } from './pdf';
import { decodeText } from './text';
import { isEntryValue, repairStudentNumber, tidyEmail, tidyName } from './tidy';
import { readXlsWorkbook } from './xls';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const asFile = (bytes: Uint8Array | string, name: string, type = '') => new File([typeof bytes === 'string' ? bytes : buffer(bytes)], name, { type });

describe('old Office files', () => {
  it('opens the compound file inside .xls and .doc, and refuses anything else', () => {
    const workbook = fixture('excel97-two-lists.xls');
    expect(isCompoundFile(workbook)).toBe(true);
    expect(readCompoundFile(workbook).names).toContain('Workbook');
    expect(readCompoundFile(fixture('word97-table.doc')).names).toContain('WordDocument');
    expect(isCompoundFile(fixture('portal-table.pdf'))).toBe(false);
    expect(() => readCompoundFile(fixture('portal-table.pdf'))).toThrow(CompoundFileError);
    const damaged = workbook.slice(0, 1024);
    expect(() => readCompoundFile(damaged).stream('Workbook')).toThrow();
  });

  it('reads every sheet of an Excel 97–2003 workbook, with its accents and numbers as typed', () => {
    const sheets = readXlsWorkbook(fixture('excel97-two-lists.xls'));
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Read me', 'ECE 300L', '200L']);
    const list = sheets[1]!.rows;
    expect(list[3]).toEqual(['S/N', 'MATRIC NO', 'SURNAME', 'OTHER NAMES', 'E-MAIL']);
    expect(list[4]?.[1]).toBe(220591000);
    expect(list.flat().join(' ')).toMatch(/[ọẹṣ]/);
    // xlwt saves the TOTAL formula with no cached value, so its row reads as empty and is trimmed.
    expect(list).toHaveLength(604);
    expect(sheets[2]!.rows.flat()).toEqual(expect.arrayContaining(['230591001', 230591002]));
  });

  it('reads the tables and lines of a Word 97–2003 document', () => {
    const content = readDocContent(fixture('word97-table.doc'));
    expect(content.tables).toHaveLength(1);
    expect(content.tables[0]?.[0]).toEqual(['Cell 1,1', 'Cell 1,2', 'Cell 1,3']);
    expect(readDocContent(fixture('word97-text.doc')).lines).toHaveLength(1);
  });
});

describe('PDFs', () => {
  const word = (text: string, x: number, y: number): PdfWord => ({ text, x, y, width: text.length * 5, size: 10 });

  it('lines words up into columns by where they sit, even when a cell is empty', () => {
    const reading = tableFromWords([[
      word('S/N', 40, 700), word('MATRIC', 80, 700), word('SURNAME', 180, 700), word('EMAIL', 300, 700),
      word('1', 40, 680), word('250211100', 80, 680), word('ADE', 180, 680), word('a@st.lasu.edu.ng', 300, 680),
      word('2', 40, 660), word('250211101', 80, 660), word('BELLO', 180, 660),
      word('3', 40, 640), word('250211102', 80, 640), word('OKON', 180, 640), word('c@st.lasu.edu.ng', 300, 640),
    ]]);
    expect(reading.aligned).toHaveLength(4);
    expect(reading.aligned[2]).toEqual(['2', '250211101', 'BELLO', '']);
    expect(reading.text.split('\n')[1]).toContain('250211100');
  });

  it('reads a portal PDF across pages, and finds no text in a scan', async () => {
    const portal = await readPdf(buffer(fixture('portal-table.pdf')));
    expect(portal.pages).toBe(2);
    expect(portal.aligned.some((row) => row.includes('250211100'))).toBe(true);
    const scan = await readPdf(buffer(fixture('scanned.pdf')));
    expect(scan.characters).toBe(0);
  });
});

describe('OpenDocument, web pages, RTF and text encodings', () => {
  it('reads OpenDocument sheets without expanding their endless empty rows', () => {
    const xml = '<office:document-content><office:body><office:spreadsheet><table:table table:name="List">'
      + '<table:table-row><table:table-cell office:value-type="string"><text:p>Matric</text:p></table:table-cell><table:table-cell><text:p>Name</text:p></table:table-cell></table:table-row>'
      + '<table:table-row><table:table-cell office:value-type="float" office:value="230591001"><text:p>2.3E+08</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"><text:p>A &amp; B</text:p></table:table-cell></table:table-row>'
      + '<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>'
      + '</table:table></office:spreadsheet></office:body></office:document-content>';
    const { tables } = readOpenDocumentXml(xml);
    expect(tables).toEqual([{ name: 'List', rows: [['Matric', 'Name'], [230591001, 'A & B', 'A & B']] }]);
  });

  it('reads web-page tables saved as .xls, keeping columns lined up across merged cells', () => {
    const html = '<html><body><table><tr><th colspan="2">CSC 200L</th></tr><tr><td>Matric&nbsp;No</td><td>Name</td></tr><tr><td>230591001</td><td>ADE<br>Tunde</td></tr></table></body></html>';
    expect(looksLikeHtml(html)).toBe(true);
    expect(tablesFromHtml(html)).toEqual([[['CSC 200L', ''], ['Matric No', 'Name'], ['230591001', 'ADE Tunde']]]);
  });

  it('reads the text of RTF, table cells as tabs', () => {
    const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator Writer;}\\f0 Class list\\par \\trowd 230591001\\cell \\u7884?L\\\'c1 Ade\\cell\\row }';
    expect(textFromRtf(rtf)).toBe('Class list\n230591001\tỌLÁ Ade\n');
  });

  it('decodes text the way spreadsheet programs save it', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Ọlá\t1'].flatMap((character) => [character.charCodeAt(0) & 0xff, character.charCodeAt(0) >> 8])]);
    expect(decodeText(utf16)).toEqual({ text: 'Ọlá\t1', encoding: 'utf-16le' });
    expect(decodeText(new TextEncoder().encode('Ọlá'))).toEqual({ text: 'Ọlá', encoding: 'utf-8' });
    expect(decodeText(new Uint8Array([0x4f, 0x6c, 0xe1]))).toEqual({ text: 'Olá', encoding: 'windows-1252' });
  });
});

describe('certain repairs', () => {
  it('repairs letters typed for digits only when that makes a valid number', () => {
    expect(repairStudentNumber('25O2111I4')).toBe('250211114');
    expect(repairStudentNumber('2O253OO74987ja')).toBe('202530074987JA');
    expect(repairStudentNumber('250211184')).toBeNull();
    expect(repairStudentNumber('25S211184')).toBeNull();
    expect(repairStudentNumber('ADEBAYO')).toBeNull();
  });

  it('tidies emails, and empties placeholders', () => {
    expect(tidyEmail(' mailto:Ade.Bola@GMIAL.COM. ')).toEqual({ value: 'ade.bola@gmail.com', repaired: true });
    expect(tidyEmail('ade@st,lasu,edu,ng').value).toBe('ade@st.lasu.edu.ng');
    expect(tidyEmail('ade@st.lasu.edu').value).toBe('ade@st.lasu.edu.ng');
    expect(tidyEmail('ade@yahoo.con').value).toBe('ade@yahoo.com');
    expect(tidyEmail('ade@st.lasu.edu.ng')).toEqual({ value: 'ade@st.lasu.edu.ng', repaired: false });
    expect(tidyEmail('N/A')).toEqual({ value: '', repaired: false });
  });

  it('reads Direct Entry marks and titles off names', () => {
    expect(tidyName('OKAFOR Chidi (DE)')).toEqual({ value: 'OKAFOR Chidi', directEntry: true, title: false });
    expect(tidyName('Miss BELLO Aisha Kemi')).toEqual({ value: 'BELLO Aisha Kemi', directEntry: false, title: true });
    expect(tidyName('Ade').value).toBe('Ade');
    expect(isEntryValue('Direct Entry')).toBe(true);
    expect(isEntryValue('200 level')).toBe(true);
    expect(isEntryValue('Lagos')).toBe(false);
  });
});

describe('choosing a file', () => {
  it('reads an Excel 97–2003 workbook, picking the sheet with the list and offering the others', async () => {
    const result = await readClassListFile(asFile(fixture('excel97-two-lists.xls'), 'ECE list.xls'));
    expect(result.rows).toHaveLength(600);
    expect(result.how).toContain('ECE 300L');
    expect(result.rows[0]).toMatchObject({ matricNumber: '220591000' });
    expect(result.alternatives?.map((alternative) => alternative.label)).toEqual(['ECE 300L', '200L']);
  });

  it('reads a portal PDF by its columns, across its pages and repeated headings', async () => {
    const result = await readClassListFile(asFile(fixture('portal-table.pdf'), 'list.pdf', 'application/pdf'));
    expect(result.rows).toHaveLength(70);
    expect(result.rows.find((row) => row.matricNumber === '202530074987JA')).toBeTruthy();
    expect(result.notes.join(' ')).toContain('PDF');
  });

  it('reads a typed PDF list line by line, with its Direct Entry mark', async () => {
    const result = await readClassListFile(asFile(fixture('typed-list.pdf'), 'typed.pdf'));
    expect(result.rows.length).toBe(4);
  });

  it('refuses scans and photos with a way forward', async () => {
    await expect(readClassListFile(asFile(fixture('scanned.pdf'), 'scan.pdf'))).rejects.toThrow(/scan/);
    await expect(readClassListFile(asFile('x', 'list.jpg', 'image/jpeg'))).rejects.toThrow(/photo/);
  });

  it('reads OpenDocument spreadsheets and text documents', async () => {
    const sheet = await readClassListFile(asFile(fixture('libreoffice-list.ods'), 'list.ods'));
    expect(sheet.rows).toHaveLength(25);
    expect(sheet.rows[0]).toMatchObject({ matricNumber: '230591100' });
    const document = await readClassListFile(asFile(fixture('google-docs-list.odt'), 'list.odt'));
    expect(document.rows).toHaveLength(6);
    expect(document.rows[0]).toMatchObject({ matricNumber: '240211500', surname: 'BELLO' });
  });

  it('reads what is inside, not the name: web pages and CSV named .xls, RTF named .doc', async () => {
    const html = '<html><table><tr><td>Matric No</td><td>Surname</td><td>First name</td></tr><tr><td>230591001</td><td>ADE</td><td>Tunde</td></tr></table></html>';
    expect((await readClassListFile(asFile(html, 'export.xls'))).rows).toHaveLength(1);
    expect((await readClassListFile(asFile('Matric,Surname,First name\n230591001,ADE,Tunde\n230591002,OKON,Ita\n', 'export.xls'))).rows).toHaveLength(2);
    const rtf = '{\\rtf1\\ansi Matric\\tab Surname\\tab First name\\par 230591001\\tab ADE\\tab Tunde\\par}';
    expect((await readClassListFile(asFile(rtf, 'list.doc'))).rows).toHaveLength(1);
  });

  it('reads Word 97–2003 documents', async () => {
    await expect(readClassListFile(asFile(fixture('word97-table.doc'), 'table.doc'))).resolves.toBeTruthy();
  });
});
