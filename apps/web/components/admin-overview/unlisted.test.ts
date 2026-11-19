import type { AdministratorOverview, UnlistedStudent } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { attentionFor, UNLISTED_HREF } from './model';
import { sortUnlisted, unlistedAdvice, unlistedKind } from './unlisted';

const base: UnlistedStudent = {
  userId: 'd1111111-1111-4111-8111-111111111111',
  name: 'Ade Again',
  studentNumber: '240591030',
  email: 'ade@example.com',
  emailConfirmed: false,
  departmentName: 'Electronic and Computer Engineering',
  status: 'active',
  createdAt: '2026-11-01T09:00:00.000Z',
  lastSeenAt: null,
  attendanceRecords: 0,
  faceRegistered: false,
  isStaff: false,
  listed: null,
};
const listed = (linkedToAnother: boolean) => ({ departmentCode: 'ECE', departmentName: 'Electronic and Computer Engineering', entryYear: 2024, linkedToAnother });

describe('student accounts on no class list', () => {
  it('names a second account and points to the account already on the list', () => {
    const account = { ...base, listed: listed(true) };
    expect(unlistedKind(account)).toBe('second');
    const advice = unlistedAdvice(account);
    expect(advice).toMatchObject({ title: 'A second account for this number', suggestSuspend: true });
    expect(advice.text).toContain('Electronic and Computer Engineering, 2024/2025 set');
    expect(advice.link?.href).toBe('/class-list?department=ece&set=2024&student=240591030');
  });

  it('asks for the listed name to be opened when the number is on a list but not linked', () => {
    const advice = unlistedAdvice({ ...base, listed: listed(false) });
    expect(advice).toMatchObject({ title: 'On a list, but not linked', suggestSuspend: false });
    expect(advice.text).toMatch(/setup code/);
  });

  it('suggests suspending an unused account on no list, but not one with attendance', () => {
    expect(unlistedAdvice(base)).toMatchObject({ title: 'Not on any class list', link: null, suggestSuspend: true });
    const used = unlistedAdvice({ ...base, attendanceRecords: 4 });
    expect(used.suggestSuspend).toBe(false);
    expect(used.text).toMatch(/with its attendance/);
    expect(unlistedAdvice({ ...base, status: 'suspended' }).text).toMatch(/^It is suspended\..*then reactivate it\.$/);
  });

  it('puts accounts that can sign in first, newest first', () => {
    const sorted = sortUnlisted([
      { ...base, userId: 'a', status: 'suspended', createdAt: '2026-11-05T00:00:00.000Z' },
      { ...base, userId: 'b', createdAt: '2026-11-02T00:00:00.000Z' },
      { ...base, userId: 'c', createdAt: '2026-11-04T00:00:00.000Z' },
    ]);
    expect(sorted.map((account) => account.userId)).toEqual(['c', 'b', 'a']);
  });
});

describe('the Needs attention item', () => {
  const overview = (unlistedStudents: number, unlistedSuspended = 0): AdministratorOverview => ({
    metrics: { departments: 1, activeStudents: 313, activeLecturers: 4, courseOfferings: 0, activeEnrollments: 0, onClassLists: 424, openedAccounts: 312, unlistedStudents, unlistedSuspended },
    studentLevels: [],
    setup: { academicSession: null, classReps: 3, venues: 2, venuesWithoutLocation: 0, hasTakenAttendance: true },
  } as unknown as AdministratorOverview);
  const items = (value: AdministratorOverview) => attentionFor({
    overview: value, institutionAdmin: false, today: '', setupVisible: false, faceReviews: 0, newMessages: 0, openDisputes: 0, openAppeals: 0, sharedPhone: 0,
  });

  it('flags accounts that can sign in and are on no class list, and opens the sheet', () => {
    expect(items(overview(1))).toEqual([expect.objectContaining({ key: 'unlisted', title: 'Unlisted student account', count: 1, href: UNLISTED_HREF })]);
    expect(items(overview(3))[0]?.title).toBe('Unlisted student accounts');
  });

  it('stays quiet when the only ones left are suspended', () => {
    expect(items(overview(0, 2))).toEqual([]);
  });
});
