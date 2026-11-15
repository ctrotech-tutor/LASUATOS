import { describe, expect, it } from 'vitest';
import { describeStructureChange } from './structure-history.js';

describe('describeStructureChange', () => {
  it('describes additions', () => {
    expect(describeStructureChange('faculty_created', { code: 'MGT', name: 'Faculty of Management Sciences' })).toBe('Added with the code MGT');
    expect(describeStructureChange('department_created', { code: 'CVE', name: 'Civil Engineering', programmeYears: 5 })).toBe('Added with the code CVE, 5 years');
  });

  it('describes renames, programme lengths and activation together', () => {
    expect(describeStructureChange('department_updated', { name: ['Department', 'Department of Testing'], programmeYears: [4, 5] }))
      .toBe('Renamed from Department; Programme length 4 → 5 years');
    expect(describeStructureChange('department_updated', { isActive: [true, false] })).toBe('Deactivated');
    expect(describeStructureChange('faculty_updated', { isActive: [false, true] })).toBe('Reactivated');
    expect(describeStructureChange('faculty_updated', {})).toBe('Details changed');
  });

  it('describes sessions', () => {
    expect(describeStructureChange('academic_session_created', { code: '2027/2028', makeCurrent: true, semesters: ['First', 'Second'] }))
      .toBe('Created with 2 semesters, made current');
    expect(describeStructureChange('academic_session_created', { code: '2027/2028', makeCurrent: false, semesters: [] })).toBe('Created');
    expect(describeStructureChange('academic_session_made_current', { previousCurrent: [] })).toBe('Made the current session');
    expect(describeStructureChange('academic_session_updated', {
      code: ['2026/27', '2026/2027'],
      endsAt: ['2027-07-30T22:59:00.000Z', '2027-08-27T22:59:00.000Z'],
      semesters: [{ id: 'a', endsAt: ['x', 'y'] }, { id: 'b', added: 'Third Semester' }],
    })).toBe('Renamed from 2026/27; Now ends 27 Aug 2027; Added Third Semester; A semester’s dates or name changed');
    expect(describeStructureChange('academic_session_updated', {
      startsAt: ['2026-09-06T23:00:00.000Z', '2026-09-13T23:00:00.000Z'],
      endsAt: ['2027-07-30T22:59:00.000Z', '2027-08-06T22:59:00.000Z'],
    })).toBe('Dates moved to 14 Sept 2026 – 6 Aug 2027');
  });

  it('never fails on unexpected details', () => {
    expect(describeStructureChange('something_new', { anything: 1 })).toBe('Changed');
    expect(describeStructureChange('department_updated', { name: 'not a pair' })).toBe('Details changed');
  });
});
