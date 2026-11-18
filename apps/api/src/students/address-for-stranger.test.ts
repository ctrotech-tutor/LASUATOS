import { describe, expect, it } from 'vitest';
import { addressForStranger } from './service.js';

describe('addresses shown to someone who typed a matric number (ADR 033)', () => {
  it('keeps LASU student addresses whole: they follow the listed name', () => {
    expect(addressForStranger('abraham.odejobi@st.lasu.edu.ng')).toBe('abraham.odejobi@st.lasu.edu.ng');
  });

  it('shows only enough of a personal address to recognise it', () => {
    expect(addressForStranger('kunle.adeyemi@gmail.com')).toBe('ku•••@gmail.com');
    expect(addressForStranger('ada@yahoo.com')).toBe('a•••@yahoo.com');
    expect(addressForStranger('a@x.ng')).toBe('a•••@x.ng');
    expect(addressForStranger('not-an-address')).toBe('•••');
  });
});
