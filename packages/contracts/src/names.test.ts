import { describe, expect, it } from 'vitest';
import {
  ClassListLookupResultSchema,
  OpenWithSetupCodeRequestSchema,
  PasswordResetRequestSchema,
  checkPersonName,
  formatSetupCode,
  normalizeSetupCode,
} from './index.js';

describe('names on class lists and registers', () => {
  it('refuses initials, with or without dots, and says so plainly', () => {
    for (const [value, words] of [['S.', 'one'], ['S', 'one'], ['S.O.', 'one'], ['S.O', 'one'], ['O. A.', 'several'], ['AKAPO S. O.', 'full'], ['Akapo S O', 'full']] as const) {
      const check = checkPersonName(value, 'first name', words);
      expect(check.ok, value).toBe(false);
      if (!check.ok) expect(check.message, value).toMatch(/not an initial/);
    }
    const hyphenated = checkPersonName('S-O', 'first name');
    expect(hyphenated.ok).toBe(false);
    if (!hyphenated.ok) expect(hyphenated.message).toMatch(/not initials/);
  });

  it('accepts real names, including accents, hyphens and apostrophes', () => {
    expect(checkPersonName('Ọlámídé', 'first name')).toEqual({ ok: true, value: 'Ọlámídé' });
    expect(checkPersonName('Ade-Bello', 'surname')).toEqual({ ok: true, value: 'Ade-Bello' });
    expect(checkPersonName("O'Neil", 'surname')).toEqual({ ok: true, value: "O'Neil" });
    expect(checkPersonName('D’Angelo', 'surname').ok).toBe(true);
    expect(checkPersonName('Samuel  Olumide', 'middle name', 'several')).toEqual({ ok: true, value: 'Samuel Olumide' });
    expect(checkPersonName('AKAPO Samuel Olumide', 'full name', 'full')).toEqual({ ok: true, value: 'AKAPO Samuel Olumide' });
  });

  it('wants a full name in one box to have a first name and a surname', () => {
    const one = checkPersonName('Akapo', 'student’s full name', 'full');
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.message).toBe('Write the student’s full name in full: first name and surname (“Akapo” is one word).');
  });

  it('still names stray symbols', () => {
    const check = checkPersonName('Sam1', 'first name');
    expect(check).toEqual({ ok: false, message: 'Use letters only in the first name: remove “1”.' });
  });
});

describe('account schemas', () => {
  it('lets forgot password take an email or a matric number', () => {
    expect(PasswordResetRequestSchema.safeParse({ email: 'someone@st.lasu.edu.ng' }).success).toBe(true);
    expect(PasswordResetRequestSchema.safeParse({ email: '250211184' }).success).toBe(true);
    expect(PasswordResetRequestSchema.safeParse({ email: '250 211 184' }).success).toBe(true);
    expect(PasswordResetRequestSchema.safeParse({ email: 'not an email@' }).success).toBe(false);
    expect(PasswordResetRequestSchema.safeParse({ email: 'ab' }).success).toBe(false);
    expect(PasswordResetRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(PasswordResetRequestSchema.parse({ email: 'Amina@Example.NET' }).email).toBe('amina@example.net');
  });

  it('reads setup codes typed any way, and refuses look-alike characters', () => {
    expect(normalizeSetupCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(formatSetupCode('abcdefgh')).toBe('ABCD-EFGH');
    expect(OpenWithSetupCodeRequestSchema.parse({ matricNumber: '250211184', setupCode: 'abcd efgh' }).setupCode).toBe('ABCDEFGH');
    // I, L, O, 0 and 1 are never in a setup code.
    expect(OpenWithSetupCodeRequestSchema.safeParse({ matricNumber: '250211184', setupCode: 'ABCD-EFG1' }).success).toBe(false);
    expect(OpenWithSetupCodeRequestSchema.safeParse({ matricNumber: '250211184', setupCode: 'ABCD-EFG' }).success).toBe(false);
  });

  it('defaults the account status for older servers', () => {
    const found = ClassListLookupResultSchema.parse({ status: 'found', matricNumber: '250211184', fullName: 'A B', departmentName: 'D', levelLabel: '100 Level', hasAccount: false, emailOnList: true });
    expect(found).toMatchObject({ accountStatus: 'none' });
  });
});
