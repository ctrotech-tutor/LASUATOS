import { describe, expect, it } from 'vitest';
import { parseClassListTable } from './class-list-parse';
import { readClassListText, readWordDocument, readWordXml, tableFromWord, unzipFile } from './class-list-read';

/** A zip with one file, stored or deflated (what Word writes), for the tests. */
async function zip(path: string, content: string, deflate: boolean): Promise<ArrayBuffer> {
  const raw = new TextEncoder().encode(content);
  const data = deflate
    ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    : raw;
  const name = new TextEncoder().encode(path);
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, deflate ? 8 : 0, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, raw.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, deflate ? 8 : 0, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, raw.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const all = new Uint8Array(local.length + data.length + central.length + end.length);
  all.set(local, 0);
  all.set(data, local.length);
  all.set(central, local.length + data.length);
  all.set(end, local.length + data.length + central.length);
  return all.buffer;
}

const cell = (text: string, span = 1) => `<w:tc><w:tcPr>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

describe('pasted rows', () => {
  it('reads columns copied from Excel or Google Sheets (tabs), headings or not', () => {
    const read = readClassListText('Matric No\tSurname\tOther Names\n250211184\tODEJOBI\tAbraham Oluwaseun\n250211185\tBELLO\tAisha\n');
    expect(read.how).toBe('columns copied from a spreadsheet');
    expect(read.rows.map((r) => [r.matricNumber, r.surname, r.firstName, r.middleName])).toEqual([
      ['250211184', 'ODEJOBI', 'Abraham', 'Oluwaseun'],
      ['250211185', 'BELLO', 'Aisha', null],
    ]);
    expect(read.columns).toEqual(['Matric number', 'Surname', 'First name']);
  });

  it('reads CSV and semicolon text, and a Markdown table', () => {
    expect(readClassListText('250211184,ODEJOBI,Abraham\n250211185,BELLO,Aisha').rows).toHaveLength(2);
    expect(readClassListText('250211184;ODEJOBI;Abraham\n250211185;BELLO;Aisha').how).toBe('semicolon-separated columns');
    const md = readClassListText('| Matric | Surname | First name |\n|---|---|---|\n| 250211184 | ODEJOBI | Abraham |\n| 250211185 | BELLO | Aisha |');
    expect(md.rows.map((r) => r.surname)).toEqual(['ODEJOBI', 'BELLO']);
  });

  it('reads a list typed or copied from Word, a PDF or WhatsApp, line by line', () => {
    const read = readClassListText([
      'MECHANICAL ENGINEERING 200 LEVEL',
      '1. 250211184 ODEJOBI Abraham Oluwaseun',
      '2) BELLO, Aisha - 250 211 185 - aisha.bello@st.lasu.edu.ng',
      '3 ADEYEMI Kunle 202530074987JA kunle.adeyemi@gmail.com',
    ].join('\n'));
    expect(read.how).toContain('line by line');
    expect(read.rows).toEqual([
      { matricNumber: '250211184', surname: 'ODEJOBI', firstName: 'Abraham', middleName: 'Oluwaseun', lasuEmail: null },
      { matricNumber: '250211185', surname: 'BELLO', firstName: 'Aisha', middleName: null, lasuEmail: 'aisha.bello@st.lasu.edu.ng' },
      { matricNumber: '202530074987JA', surname: 'ADEYEMI', firstName: 'Kunle', middleName: null, lasuEmail: 'kunle.adeyemi@gmail.com' },
    ]);
    expect(read.onJamb).toBe(1);
    expect(read.skipped).toBe(1);
  });

  it('does not take “Surname, First name” commas for columns', () => {
    const read = readClassListText('250211184 ODEJOBI, Abraham\n250211185 BELLO, Aisha');
    expect(read.rows.map((r) => [r.matricNumber, r.surname, r.firstName])).toEqual([['250211184', 'ODEJOBI', 'Abraham'], ['250211185', 'BELLO', 'Aisha']]);
  });

  it('keeps both numbers on a line: the JAMB number goes along to switch the student', () => {
    const read = readClassListText('250591050 202530074987JA ADEYEMI Kunle');
    expect(read.rows[0]).toMatchObject({ matricNumber: '250591050', jambNumber: '202530074987JA', surname: 'ADEYEMI' });
  });
});

describe('JAMB numbers on uploaded lists', () => {
  it('reads a JAMB column next to the matric column, and a JAMB-only list', () => {
    const both = parseClassListTable([
      ['S/N', 'Matric No', 'JAMB Reg No', 'Surname', 'First name', 'Email'],
      [1, '250211184', '', 'ODEJOBI', 'Abraham', ''],
      [2, '', '202530074987ja', 'ADEYEMI', 'Kunle', 'kunle@gmail.com'],
      [3, '250591070', '202530011111JA', 'ADE', 'Bola', ''],
    ]);
    expect(both.rows).toEqual([
      { matricNumber: '250211184', surname: 'ODEJOBI', firstName: 'Abraham', middleName: null, lasuEmail: null },
      { matricNumber: '202530074987JA', surname: 'ADEYEMI', firstName: 'Kunle', middleName: null, lasuEmail: 'kunle@gmail.com' },
      { matricNumber: '250591070', jambNumber: '202530011111JA', surname: 'ADE', firstName: 'Bola', middleName: null, lasuEmail: null },
    ]);
    expect(both.onJamb).toBe(1);
    expect(both.notes.join(' ')).toContain('1 student is listed by JAMB number');
    expect(both.notes.join(' ')).toContain('both a matric number and a JAMB number');
    expect(both.columns).toEqual(['Matric or JAMB number', 'JAMB number', 'Surname', 'First name', 'Email']);

    const deOnly = parseClassListTable([
      ['UTME/DE Reg. Number', 'Surname', 'Other names'],
      ['202530074987JA', 'ADEYEMI', 'Kunle Tobi'],
    ]);
    expect(deOnly.rows).toEqual([{ matricNumber: '202530074987JA', surname: 'ADEYEMI', firstName: 'Kunle', middleName: 'Tobi', lasuEmail: null }]);
    expect(deOnly.columns[0]).toBe('JAMB number');
  });

  it('reads the template, Direct Entry row included', async () => {
    const { CLASS_LIST_TEMPLATE } = await import('./class-list-parse');
    const read = readClassListText(CLASS_LIST_TEMPLATE);
    expect(read.rows).toHaveLength(3);
    expect(read.rows[2]).toEqual({ matricNumber: '202530074987JA', surname: 'ADEYEMI', firstName: 'Kunle', middleName: 'Tobi', lasuEmail: 'kunle.adeyemi@gmail.com', entryLevel: 200 });
  });

  it('reads JAMB numbers by content when there are no headings', () => {
    const read = readClassListText('202530074987JA\tADEYEMI\tKunle\n202530011111JA\tADE\tBola');
    expect(read.rows.map((r) => r.matricNumber)).toEqual(['202530074987JA', '202530011111JA']);
  });
});

describe('Word documents', () => {
  it('reads the table, keeping merged cells in line and joining a list split over pages', () => {
    const xml = doc([
      para('LAGOS STATE UNIVERSITY'),
      `<w:tbl>${row(cell('Class list', 3))}${row(cell('S/N'), cell('Mat. No'), cell('Name'))}${row(cell('1'), cell('250211184'), cell('ODEJOBI Abraham Oluwaseun'))}${row(cell('2'), cell('250211185'), cell('BELLO &amp; Co Aisha'))}</w:tbl>`,
      para('Page 2'),
      `<w:tbl>${row(cell('S/N'), cell('Mat. No'), cell('Name'))}${row(cell('3'), cell('202530074987JA'), cell('ADEYEMI Kunle'))}</w:tbl>`,
    ].join(''));
    const content = readWordXml(xml);
    expect(content.tables).toHaveLength(2);
    expect(content.tables[0]![0]).toEqual(['Class list', '', '']);
    expect(content.lines).toEqual(['LAGOS STATE UNIVERSITY', 'Page 2']);
    const table = tableFromWord(content)!;
    expect(table.filter((cells) => cells[1] === 'Mat. No')).toHaveLength(1);
    const parsed = parseClassListTable(table);
    expect(parsed.rows.map((r) => r.matricNumber)).toEqual(['250211184', '250211185', '202530074987JA']);
    expect(parsed.rows[1]!.surname).toBe('BELLO');
  });

  it('opens a real .docx (stored or deflated) and falls back to its lines when it has no table', async () => {
    const tableDoc = doc(`<w:tbl>${row(cell('Matric number'), cell('Surname'), cell('First name'))}${row(cell('250211184'), cell('ODEJOBI'), cell('Abraham'))}</w:tbl>`);
    for (const deflate of [false, true]) {
      const read = await readWordDocument(await zip('word/document.xml', tableDoc, deflate));
      expect(read.rows).toEqual([{ matricNumber: '250211184', surname: 'ODEJOBI', firstName: 'Abraham', middleName: null, lasuEmail: null }]);
      expect(read.how).toBe('the table in the document');
    }
    const linesDoc = doc([para('CSC 200 LEVEL'), para('1. 250211184 ODEJOBI Abraham'), para('2. 250211185 BELLO Aisha')].join(''));
    const read = await readWordDocument(await zip('word/document.xml', linesDoc, true));
    expect(read.rows.map((r) => r.surname)).toEqual(['ODEJOBI', 'BELLO']);
    expect(read.how).toContain('the document’s lines');
  });

  it('says what to do with a file that is not a Word document', async () => {
    await expect(readWordDocument(new TextEncoder().encode('hello').buffer)).rejects.toThrow('Save it again as a Word Document (.docx)');
    expect(await unzipFile(await zip('word/other.xml', 'x', false), 'word/document.xml')).toBeNull();
  });
});
