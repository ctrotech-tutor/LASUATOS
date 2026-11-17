import { describe, expect, it } from 'vitest';
import { googleProvesEmail } from './service.js';

const who = (email: string, hostedDomain: string | null) => ({ email, hostedDomain, subject: '1' });

describe('which addresses Google can vouch for (ADR 027, ADR 028)', () => {
  it('accepts a LASU student address only from LASU’s own Google Workspace', () => {
    expect(googleProvesEmail(who('ada@st.lasu.edu.ng', 'st.lasu.edu.ng'), { jamb: false })).toBe(true);
    expect(googleProvesEmail(who('ada@st.lasu.edu.ng', null), { jamb: true })).toBe(false);
    expect(googleProvesEmail(who('ada@st.lasu.edu.ng', 'example.com'), { jamb: true })).toBe(false);
  });

  it('with personal addresses allowed, accepts Gmail and a Workspace domain’s own address', () => {
    expect(googleProvesEmail(who('ada@gmail.com', null), { jamb: true })).toBe(true);
    // An Outlook or Yahoo address registered as a Google account proves nothing about that mailbox.
    expect(googleProvesEmail(who('ada@outlook.com', null), { jamb: true })).toBe(false);
    expect(googleProvesEmail(who('ada@company.ng', 'company.ng'), { jamb: true })).toBe(true);
    // A student's personal email is never a staff address.
    expect(googleProvesEmail(who('staff@lasu.edu.ng', 'lasu.edu.ng'), { jamb: true })).toBe(false);
  });

  it('for signing in, accepts any mailbox Google runs, including staff on LASU’s Workspace', () => {
    const signIn = { jamb: true, signIn: true };
    expect(googleProvesEmail(who('staff@lasu.edu.ng', 'lasu.edu.ng'), signIn)).toBe(true);
    expect(googleProvesEmail(who('ada@gmail.com', null), signIn)).toBe(true);
    expect(googleProvesEmail(who('staff@lasu.edu.ng', null), signIn)).toBe(false);
    expect(googleProvesEmail(who('staff@lasu.edu.ng', 'other.edu.ng'), signIn)).toBe(false);
    expect(googleProvesEmail(who('ada@outlook.com', null), signIn)).toBe(false);
    expect(googleProvesEmail(who('ada@st.lasu.edu.ng', null), signIn)).toBe(false);
  });

  it('without personal addresses allowed, accepts only the LASU student address', () => {
    expect(googleProvesEmail(who('ada@gmail.com', null), { jamb: false })).toBe(false);
  });
});
