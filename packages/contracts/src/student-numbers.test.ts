import { describe, expect, it } from 'vitest';
import {
  ClassListEntryUpdateSchema,
  OpenAccountCodeRequestSchema,
  checkStudentNumber,
  isJambRegNumber,
  isPersonalEmail,
  isStudentProofEmail,
  jambYear,
  studentNumberKind,
  studentNumberName,
} from './index.js';

describe('JAMB registration numbers (students without a matric number yet)', () => {
  it('accepts today’s 12 digits + 2 letters and the older 8 + 2, tidied', () => {
    expect(checkStudentNumber('202430074987JA')).toEqual({ ok: true, value: '202430074987JA', kind: 'jamb' });
    expect(checkStudentNumber(' 2024 3007 4987 ja ')).toEqual({ ok: true, value: '202430074987JA', kind: 'jamb' });
    expect(checkStudentNumber('12345678hc')).toEqual({ ok: true, value: '12345678HC', kind: 'jamb' });
    expect(isJambRegNumber('2024-3007-4987-JA')).toBe(true);
    expect(isJambRegNumber('250211184')).toBe(false);
  });

  it('still reads matric numbers as before', () => {
    expect(checkStudentNumber('250211184')).toEqual({ ok: true, value: '250211184', kind: 'matric' });
    expect(checkStudentNumber(250211184)).toEqual({ ok: true, value: '250211184', kind: 'matric' });
    expect(checkStudentNumber("'250211184")).toEqual({ ok: true, value: '250211184', kind: 'matric' });
  });

  it('explains a JAMB number with the wrong length in words', () => {
    const short = checkStudentNumber('20243007498JA');
    expect(short.ok).toBe(false);
    expect(!short.ok && short.message).toContain('has 11 digits and 2 letters; JAMB numbers have 12 digits and 2 letters');
    const oneLetter = checkStudentNumber('202430074987J');
    expect(!oneLetter.ok && oneLetter.message).toContain('12 digits and 1 letter;');
  });

  it('keeps the look-alike hint for a mistyped matric number', () => {
    const typo = checkStudentNumber('25021118O');
    expect(!typo.ok && typo.message).toContain('the letter O looks like 0');
    const empty = checkStudentNumber('');
    expect(!empty.ok && empty.message).toContain('JAMB registration number');
  });

  it('reads the exam year and names the kind', () => {
    expect(jambYear('202530074987JA')).toBe(2025);
    expect(jambYear('12345678HC')).toBeNull();
    expect(studentNumberKind('202530074987JA')).toBe('jamb');
    expect(studentNumberKind('250211184')).toBe('matric');
    expect(studentNumberName('12345678HC')).toBe('JAMB number');
    expect(studentNumberName('250211184')).toBe('matric number');
  });
});

describe('which emails prove who a student is', () => {
  it('takes a personal email only for a student on a JAMB number', () => {
    expect(isStudentProofEmail('ada.obi@st.lasu.edu.ng', { jamb: false })).toBe(true);
    expect(isStudentProofEmail('ada.obi@gmail.com', { jamb: false })).toBe(false);
    expect(isStudentProofEmail('ada.obi@gmail.com', { jamb: true })).toBe(true);
    expect(isStudentProofEmail('ada.obi@st.lasu.edu.ng', { jamb: true })).toBe(true);
  });

  it('refuses addresses no student reads', () => {
    expect(isPersonalEmail('someone@yahoo.com')).toBe(true);
    expect(isPersonalEmail('not-an-email')).toBe(false);
    expect(isPersonalEmail('x@account.invalid')).toBe(false);
    expect(isPersonalEmail('staff@lasu.edu.ng')).toBe(false);
    // A LASU student address is not personal either: it is the account email's job (ADR 040).
    expect(isPersonalEmail('24-0591-001@st.lasu.edu.ng')).toBe(false);
  });

  it('lets the sign-up code request carry a personal email (the server decides)', () => {
    expect(OpenAccountCodeRequestSchema.parse({ matricNumber: '202430074987ja', email: 'Ada@Gmail.com' }))
      .toEqual({ matricNumber: '202430074987JA', email: 'ada@gmail.com' });
  });

  it('lets a HOC type a JAMB number on a class list entry', () => {
    expect(ClassListEntryUpdateSchema.parse({ matricNumber: '2024 3007 4987 JA' })).toEqual({ matricNumber: '202430074987JA' });
    expect(ClassListEntryUpdateSchema.safeParse({ matricNumber: '2024300749JA' }).success).toBe(false);
  });
});
