import { describe, expect, it } from 'vitest';
import { parseClassListTable, splitFullName, unglueName } from './class-list-parse';

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
    // The letter O for a zero is repaired (and reported); the rest go to the server's report as written.
    expect(parsed.rows.map((row) => row.matricNumber)).toEqual(['250211184', '250211185', '250211186', '2.50211E+08', '250211187', '25021118']);
    expect(parsed.notes.join(' ')).toContain('25O211187 → 250211187');
    expect(parsed.skipped).toBe(2);
  });

  it('flags initials up front, so a list with "AKAPO S. O." is fixed before it is sent', () => {
    expect(splitFullName('AKAPO S. O.')).toEqual({ surname: 'AKAPO', firstName: 'S.', middleName: 'O.', guessed: false });
    const parsed = parseClassListTable([
      ['Matric No', 'Name'],
      ['250211184', 'AKAPO S. O.'],
      ['250211185', 'BELLO Aisha'],
      ['250211186', 'Okafor, C Ngozi'],
    ]);
    expect(parsed.rows[0]).toMatchObject({ surname: 'AKAPO', firstName: 'S.', middleName: 'O.' });
    expect(parsed.notes[0]).toBe('2 students have initials instead of names (e.g. 250211184 AKAPO S. O.). Registers need full names: write them out (Samuel Olumide, not S. O.) in the sheet and upload it again.');
    const separate = parseClassListTable([
      ['Matric number', 'Surname', 'First name', 'Middle name'],
      ['250211184', 'AKAPO', 'Samuel', 'S.O'],
    ]);
    expect(separate.notes[0]).toMatch(/^1 student has initials/);
    const clean = parseClassListTable([['Matric number', 'Surname', 'First name'], ['250211184', 'AKAPO', 'Samuel']]);
    expect(clean.notes).toEqual([]);
  });

  it('says so when there is no matric column', () => {
    const parsed = parseClassListTable([['Name'], ['Abraham']]);
    expect(parsed.rows).toEqual([]);
    expect(parsed.notes[0]).toMatch(/matric/i);
  });
});

describe('names typed in one cell', () => {
  it('puts back the spaces in a name typed as one word, and leaves real names alone', () => {
    expect(unglueName('ApenaAbdulrahmanOluwanifemi')).toBe('Apena Abdulrahman Oluwanifemi');
    expect(unglueName('APENAAbdulrahman')).toBe('APENA Abdulrahman');
    expect(unglueName('Apena_Abdulrahman')).toBe('Apena Abdulrahman');
    expect(unglueName('Apena.Abdulrahman')).toBe('Apena Abdulrahman');
    expect(unglueName('McDonald')).toBe('McDonald');
    expect(unglueName('AlHassan')).toBe('AlHassan');
    expect(unglueName('Oluwanifemi')).toBe('Oluwanifemi');
    expect(unglueName('Apena Abdulrahman')).toBe('Apena Abdulrahman');
  });

  it('splits a whole name left in the surname column instead of refusing the row', () => {
    const parsed = parseClassListTable([
      ['Matric number', 'Surname', 'First name', 'Middle name'],
      ['250261004', 'Oluwatamilore', 'Joseph', ''],
      ['250261006', 'ApenaAbdulrahmanOluwanifemi', '', ''],
      ['250261011', 'Adeyemi Tolulope', '', ''],
      ['250261012', 'Ibrahim', '', ''],
    ]);
    expect(parsed.rows.map(({ surname, firstName, middleName }) => [surname, firstName, middleName])).toEqual([
      ['Oluwatamilore', 'Joseph', null],
      ['Apena', 'Abdulrahman', 'Oluwanifemi'],
      ['Adeyemi', 'Tolulope', null],
      // One name only: nothing to split, so the server asks for the first name.
      ['Ibrahim', '', null],
    ]);
    expect(parsed.notes.join(' ')).toMatch(/2 names were written in one cell.*ApenaAbdulrahmanOluwanifemi became Apena, Abdulrahman, Oluwanifemi/);
  });

  it('splits a one-word full name in a single name column', () => {
    const parsed = parseClassListTable([
      ['Matric No', 'Full name'],
      ['250261006', 'ApenaAbdulrahmanOluwanifemi'],
    ]);
    expect(parsed.rows[0]).toMatchObject({ surname: 'Apena', firstName: 'Abdulrahman', middleName: 'Oluwanifemi' });
    expect(parsed.notes).toHaveLength(1);
  });
});

describe('portal-style lists', () => {
  it('reads a heading split over two rows below title lines, and makes only certain repairs, each reported', () => {
    const parsed = parseClassListTable([
      ['LAGOS STATE UNIVERSITY'], ['CSC 200L'], [],
      ['S/N', 'MATRIC', 'NAMES', '', 'E-MAIL', 'MODE'],
      ['', 'NO', 'SURNAME', 'OTHER NAMES', '', ''],
      [1, '23O591001', 'ADE', 'Mr Tunde Bola', 'ade@gmial.com', 'UTME'],
      [2, '230591002', 'OKAFOR', 'Chidi (DE)', 'nil', ''],
      [2, '230591002', 'OKAFOR', 'Chidi (DE)', 'nil', ''],
      [3, '230591003', 'BELLO', 'Aisha', 'bello@st.lasu.edu', 'Direct Entry'],
    ]);
    expect(parsed.columns).toEqual(['Matric number', 'Surname', 'First name', 'Email', 'Entry level']);
    expect(parsed.skipped).toBe(0);
    expect(parsed.rows).toEqual([
      { matricNumber: '230591001', surname: 'ADE', firstName: 'Tunde', middleName: 'Bola', lasuEmail: 'ade@gmail.com', entryLevel: 100 },
      { matricNumber: '230591002', surname: 'OKAFOR', firstName: 'Chidi', middleName: null, lasuEmail: null, entryLevel: 200 },
      { matricNumber: '230591003', surname: 'BELLO', firstName: 'Aisha', middleName: null, lasuEmail: 'bello@st.lasu.edu.ng', entryLevel: 200 },
    ]);
    const notes = parsed.notes.join('\n');
    expect(notes).toContain('23O591001 → 230591001');
    expect(notes).toContain('Tidied 2 emails');
    expect(notes).toContain('1 name is marked “DE”');
    expect(notes).toContain('Mr Tunde Bola');
    expect(notes).toContain('1 student was on the list twice');
  });

  it('finds the matric column by its contents when the heading points at serial numbers', () => {
    const parsed = parseClassListTable([
      ['Reg No', 'Student', 'Matric'],
      [1, 'ADE Tunde', '230591001'],
      [2, 'OKON Ita', '230591002'],
    ]);
    expect(parsed.rows.map((row) => row.matricNumber)).toEqual(['230591001', '230591002']);
  });

  it('keeps students with the same number but different names for the server to report', () => {
    const parsed = parseClassListTable([
      ['Matric number', 'Surname', 'First name'],
      ['230591003', 'BELLO', 'Aisha'],
      ['230591003', 'BELLO', 'Kemi'],
    ]);
    expect(parsed.rows).toHaveLength(2);
  });
});
