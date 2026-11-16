import { describe, expect, it } from 'vitest';
import { cleanCode, closingLabel, courseLine, faceSetupHref, looksLikeLink, readTypedCode, ticketInitials } from './model';

const CHALLENGE = 'lasu2.0f8fad5b-d9cb-469f-a165-70867728950e.1234567.abcdefghijklmnopqrstuv';

describe('cleanCode', () => {
  it('keeps capitals and digits only, up to 12', () => {
    expect(cleanCode('k7m 29q')).toBe('K7M29Q');
    expect(cleanCode('k7m2-9qxd')).toBe('K7M29QXD');
    expect(cleanCode('abcdefghijklmnop')).toBe('ABCDEFGHIJKL');
  });
});

describe('looksLikeLink', () => {
  it('tells a pasted link from a typed code', () => {
    expect(looksLikeLink('https://lasuatos.app/a/K7M29QXD')).toBe(true);
    expect(looksLikeLink(CHALLENGE)).toBe(true);
    expect(looksLikeLink('K7M29Q')).toBe(false);
  });
});

describe('readTypedCode', () => {
  it('accepts a screen code and a poster code', () => {
    expect(readTypedCode('k7m 29q')).toEqual({ kind: 'lecture', source: { code: 'K7M29Q' } });
    expect(readTypedCode('K7M2-9QXD')).toEqual({ kind: 'lecture', source: { code: 'K7M29QXD' } });
  });

  it('turns down other lengths with a reason', () => {
    expect(readTypedCode('K7M2').kind).toBe('invalid');
    expect(readTypedCode('').kind).toBe('invalid');
    expect(readTypedCode('K7M29QXDA').kind).toBe('invalid');
  });

  it('reads pasted links', () => {
    expect(readTypedCode('https://lasuatos.app/a/k7m29qxd')).toEqual({ kind: 'lecture', source: { code: 'K7M29QXD' } });
    expect(readTypedCode(`https://lasuatos.app/a#${CHALLENGE}`)).toEqual({ kind: 'lecture', source: { challenge: CHALLENGE } });
    expect(readTypedCode('https://example.com/elsewhere').kind).toBe('invalid');
  });
});

describe('faceSetupHref', () => {
  it('returns to a poster class, otherwise to the scanner', () => {
    expect(faceSetupHref({ code: 'K7M29QXD', scanned: true })).toBe('/account/setup?next=%2Fa%2FK7M29QXD');
    expect(faceSetupHref({ code: 'K7M29Q' })).toBe('/account/setup?next=%2Fa');
    expect(faceSetupHref({ challenge: CHALLENGE })).toBe('/account/setup?next=%2Fa');
    expect(faceSetupHref(null)).toBe('/account/setup?next=%2Fa');
  });
});

describe('closingLabel', () => {
  const clock = () => '11:41';
  const ends = '2026-11-10T10:41:00.000Z';
  const at = (iso: string) => Date.parse(iso);

  it('shows the closing time, then a countdown in the last hour', () => {
    expect(closingLabel(ends, at('2026-11-10T08:00:00.000Z'), clock)).toBe('Open until 11:41');
    expect(closingLabel(ends, at('2026-11-10T10:29:00.000Z'), clock)).toBe('Closes in 12 min');
    expect(closingLabel(ends, at('2026-11-10T10:40:30.000Z'), clock)).toBe('Closes in under a minute');
    expect(closingLabel(ends, at('2026-11-10T10:42:00.000Z'), clock)).toBe('Closing now');
  });

  it('falls back to the time before the clock starts', () => {
    expect(closingLabel(ends, 0, clock)).toBe('Open until 11:41');
  });
});

describe('courseLine and ticketInitials', () => {
  it('joins what is known', () => {
    expect(courseLine({ lecturerName: 'Dr. Ada Bello', venueName: 'Signals Laboratory' })).toBe('Dr. Ada Bello · Signals Laboratory');
    expect(courseLine({ lecturerName: null, venueName: 'LT1' })).toBe('LT1');
    expect(courseLine({ lecturerName: null, venueName: null })).toBe('');
  });

  it('uses the first and last names', () => {
    expect(ticketInitials('Tolulope Adesewa Oyelaran')).toBe('TO');
    expect(ticketInitials('Kunle')).toBe('K');
    expect(ticketInitials('')).toBe('?');
  });
});
