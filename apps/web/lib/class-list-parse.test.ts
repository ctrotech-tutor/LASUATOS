import { describe, expect, it } from 'vitest';
import { parseClassListTable, splitFullName } from './class-list-parse';

describe('reading class lists', () => {
  it('reads the template, with headings and an Excel number for the matric', () => {
    const parsed = parseClassListTable([
      ['Matric number', 'Surname', 'First name', 'Middle name (optional)', 'LASU email (optional)', 'Entry level (DE only)'],
      [250211184, 'ODEJOBI', 'Abraham', 'Oluwaseun', 'Abraham.Odejobi@st.lasu.edu.ng', ''],
      ['250211185', 'BELLO', 'Aisha', '', '', 'DE'],
      ['', '', '', '', '', ''],
    ]);
    expect(parsed.rows).toEqual([
      { matricNumber: '250211184', surname: 'ODEJOBI', firstName: 'Abraham', middleName: 'Oluwaseun', lasuEmail: 'abraham.odejobi@st.lasu.edu.ng' },
      { matricNumber: '250211185', surname: 'BELLO', firstName: 'Aisha', middleName: null, lasuEmail: null, entryLevel: 200 },
    ]);
    expect(parsed.notes).toEqual([]);
  });

  it('finds the headings below a title and reads Surname + Other names', () => {
    const parsed = parseClassListTable([
      ['LAGOS STATE UNIVERSITY'],
      ['MECHANICAL ENGINEERING 2025/2026 SET'],
      ['S/N', 'Mat. No', 'Surname', 'Other Names', 'E-mail'],
      [1, '250211184', 'Odejobi', 'Abraham Oluwaseun', ''],
      ['', 'TOTAL: 1'],
    ]);
    expect(parsed.rows).toEqual([
      { matricNumber: '250211184', surname: 'Odejobi', firstName: 'Abraham', middleName: 'Oluwaseun', lasuEmail: null },
    ]);
    expect(parsed.skipped).toBe(1);
  });

  it('splits one name column, LASU style', () => {
    expect(splitFullName('ODEJOBI Abraham Oluwaseun')).toEqual({ surname: 'ODEJOBI', firstName: 'Abraham', middleName: 'Oluwaseun', guessed: false });
    expect(splitFullName('Abraham Oluwaseun ODEJOBI')).toEqual({ surname: 'ODEJOBI', firstName: 'Abraham', middleName: 'Oluwaseun', guessed: false });
    expect(splitFullName('Odejobi, Abraham Oluwaseun')).toEqual({ surname: 'Odejobi', firstName: 'Abraham', middleName: 'Oluwaseun', guessed: false });
    expect(splitFullName('Odejobi Abraham').guessed).toBe(true);
  });

  it('reads pasted rows without headings by their contents', () => {
    const parsed = parseClassListTable([
      ['250211184', 'ODEJOBI Abraham Oluwaseun', 'abraham.odejobi@st.lasu.edu.ng'],
      ['250211185', 'BELLO Aisha', ''],
    ]);
    expect(parsed.rows.map((row) => [row.matricNumber, row.surname, row.firstName, row.middleName, row.lasuEmail])).toEqual([
      ['250211184', 'ODEJOBI', 'Abraham', 'Oluwaseun', 'abraham.odejobi@st.lasu.edu.ng'],
      ['250211185', 'BELLO', 'Aisha', null, null],
    ]);
    expect(parsed.notes[0]).toMatch(/no headings/);
  });

  it('tidies matric numbers like the server, and passes broken ones on to be reported', () => {
    const parsed = parseClassListTable([
      ['Matric number', 'Surname', 'First name'],
      ["'250211184", 'ODEJOBI', 'Abraham'],
      ['250211185.0', 'BELLO', 'Aisha'],
      ['250-211-186', 'ADE', 'Tunde'],
      ['2.50211E+08', 'OKON', 'Ita'],
      ['25O211187', 'EZE', 'Ngozi'],
      ['25021118', 'SANI', 'Musa'],
      ['TOTAL: 6', '', ''],
      ['S/N', '', ''],
    ]);
    expect(parsed.rows.map((row) => row.matricNumber)).toEqual(['250211184', '250211185', '250211186', '2.50211E+08', '25O211187', '25021118']);
    expect(parsed.skipped).toBe(2);
  });

  it('says so when there is no matric column', () => {
    const parsed = parseClassListTable([['Name'], ['Abraham']]);
    expect(parsed.rows).toEqual([]);
    expect(parsed.notes[0]).toMatch(/matric/i);
  });
});
