import { describe, expect, it } from 'vitest';
import {
  academicSessionStartYear,
  buildCheckInLink,
  deriveStudentLevel,
  entryYearFromMatric,
  extractCheckInChallenge,
  isLasuMatricNumber,
  normalizeMatricNumber,
  parseCourseLevel,
} from './index.js';

const challenge = 'lasu1.3f1c2a8e-9b7d-4c1e-a2f0-5d6e7f8a9b0c.89712345.abcdefghijABCDEFGHIJ_-';

describe('check-in links', () => {
  it('builds a fragment link so the challenge never reaches the server', () => {
    expect(buildCheckInLink('https://lasuatos.vercel.app/', challenge))
      .toBe(`https://lasuatos.vercel.app/check-in#${challenge}`);
  });

  it('extracts the challenge from a bare value, a fragment link or a ?c= link', () => {
    expect(extractCheckInChallenge(challenge)).toBe(challenge);
    expect(extractCheckInChallenge(`  ${challenge}\n`)).toBe(challenge);
    expect(extractCheckInChallenge(`https://lasuatos.vercel.app/check-in#${challenge}`)).toBe(challenge);
    expect(extractCheckInChallenge(`https://lasuatos.vercel.app/check-in#${encodeURIComponent(challenge)}`)).toBe(challenge);
    expect(extractCheckInChallenge(`http://localhost:3000/check-in?c=${challenge}`)).toBe(challenge);
  });

  it('rejects anything that is not a challenge', () => {
    expect(extractCheckInChallenge('')).toBeNull();
    expect(extractCheckInChallenge('ABCD-EFGH-JKLM')).toBeNull();
    expect(extractCheckInChallenge('https://example.com/check-in#hello')).toBeNull();
    expect(extractCheckInChallenge(`javascript:alert(1)//${challenge}`)).toBeNull();
    expect(extractCheckInChallenge('lasu1.not-a-uuid.1.abcdefghijABCDEFGHIJ_-')).toBeNull();
    expect(extractCheckInChallenge('x'.repeat(600))).toBeNull();
  });
});

describe('student level from matric number', () => {
  it('normalizes and recognises LASU matric numbers', () => {
    expect(normalizeMatricNumber(' 130 591-039 ')).toBe('130591039');
    expect(isLasuMatricNumber('130591039')).toBe(true);
    expect(isLasuMatricNumber('2105022067')).toBe(true);
    expect(isLasuMatricNumber('LASU/2020/001')).toBe(false);
    expect(isLasuMatricNumber('12345')).toBe(false);
  });

  it('reads the entry year with a sensible century pivot', () => {
    expect(entryYearFromMatric('130591039', 2026)).toBe(2013);
    expect(entryYearFromMatric('260591001', 2026)).toBe(2026);
    expect(entryYearFromMatric('270591001', 2026)).toBe(2027);
    expect(entryYearFromMatric('990591001', 2026)).toBe(1999);
    expect(entryYearFromMatric('abc', 2026)).toBeNull();
  });

  it('takes the session start year from the code, then the start date, then September', () => {
    expect(academicSessionStartYear({ code: '2024/2025', startsAt: new Date('2025-01-15T00:00:00Z') })).toBe(2024);
    expect(academicSessionStartYear({ code: 'Session A', startsAt: '2026-09-01T00:00:00Z' })).toBe(2026);
    expect(academicSessionStartYear({ now: new Date('2026-11-10T00:00:00Z') })).toBe(2026);
    expect(academicSessionStartYear({ now: new Date('2027-03-10T00:00:00Z') })).toBe(2026);
  });

  it('derives the level for UTME and Direct Entry students', () => {
    expect(deriveStudentLevel({ matricNumber: '260591001', sessionStartYear: 2026 }))
      .toMatchObject({ status: 'derived', level: 100, yearOfStudy: 1, label: '100 Level' });
    expect(deriveStudentLevel({ matricNumber: '240591001', sessionStartYear: 2026 }))
      .toMatchObject({ level: 300, label: '300 Level' });
    expect(deriveStudentLevel({ matricNumber: '250591001', entryLevel: 200, sessionStartYear: 2026 }))
      .toMatchObject({ level: 300 });
  });

  it('caps at the programme length and flags extra years', () => {
    expect(deriveStudentLevel({ matricNumber: '220591001', sessionStartYear: 2026 }))
      .toMatchObject({ status: 'extra_year', level: 400, label: '400 Level · extra year' });
    expect(deriveStudentLevel({ matricNumber: '220591001', programmeYears: 5, sessionStartYear: 2026 }))
      .toMatchObject({ status: 'derived', level: 500 });
  });

  it('reports unknown formats and future entry years without guessing', () => {
    expect(deriveStudentLevel({ matricNumber: 'ENG/22/001', sessionStartYear: 2026 }))
      .toMatchObject({ status: 'unknown', level: null, label: 'Level unknown' });
    expect(deriveStudentLevel({ matricNumber: '270591001', sessionStartYear: 2026 }))
      .toMatchObject({ status: 'not_started', level: null });
    expect(deriveStudentLevel({ matricNumber: 'ENG/22/001', entryYear: 2025, sessionStartYear: 2026 }))
      .toMatchObject({ status: 'derived', level: 200 });
  });

  it('parses course level labels', () => {
    expect(parseCourseLevel('300')).toBe(300);
    expect(parseCourseLevel('300L')).toBe(300);
    expect(parseCourseLevel('300 Level')).toBe(300);
    expect(parseCourseLevel('Postgraduate')).toBeNull();
  });
});
