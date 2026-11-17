import { describe, expect, it } from 'vitest';
import { backFor, crumbsFor, isActive, navigationFor, titleFor } from './nav-model';

const admin = navigationFor({ role: 'administrator', pathname: '/admin', capabilities: null, openDisputes: 0, institutionAdmin: true });

describe('pages below a menu page', () => {
  it('goes back from a register to the registers, titled with the course code', () => {
    expect(backFor('/registers/ECE305', admin)).toEqual({ href: '/registers', label: 'Registers' });
    expect(titleFor('/registers/ECE305', admin)).toBe('ECE 305');
    expect(crumbsFor('/registers/ECE305', admin)).toEqual([{ label: 'Course registers', href: '/registers' }, { label: 'ECE 305' }]);
  });

  it('keeps the list itself a top-level page', () => {
    expect(backFor('/registers', admin)).toBeNull();
    expect(titleFor('/registers', admin)).toBe('Course registers');
  });

  it('goes back from a course class to Course sessions', () => {
    const lecturer = navigationFor({
      role: 'lecturer',
      pathname: '/lecturer/attendance',
      capabilities: { usesEnrolledCourses: true } as Parameters<typeof navigationFor>[0]['capabilities'],
      openDisputes: 0,
      institutionAdmin: false,
    });
    const path = '/lecturer/attendance/00000000-0000-4000-8000-000000000070';
    expect(backFor(path, lecturer)).toEqual({ href: '/lecturer/attendance', label: 'Sessions' });
    expect(titleFor(path, lecturer)).toBe('Class');
    expect(crumbsFor(path, lecturer)).toEqual([{ label: 'Course sessions', href: '/lecturer/attendance' }, { label: 'Class' }]);
    expect(backFor('/lecturer/attendance', lecturer)).toBeNull();
  });

  it('puts a course report under Attendance reports', () => {
    const lecturer = navigationFor({
      role: 'lecturer',
      pathname: '/lecturer/reports',
      capabilities: { usesEnrolledCourses: true } as Parameters<typeof navigationFor>[0]['capabilities'],
      openDisputes: 0,
      institutionAdmin: false,
    });
    const path = '/lecturer/reports/00000000-0000-4000-8000-000000000040';
    expect(backFor(path, lecturer)).toEqual({ href: '/lecturer/reports', label: 'Reports' });
    expect(titleFor(path, lecturer)).toBe('Report');
    expect(crumbsFor(path, lecturer)).toEqual([{ label: 'Attendance reports', href: '/lecturer/reports' }, { label: 'Report' }]);
    expect(backFor('/lecturer/reports', lecturer)).toBeNull();
  });

  it('survives a malformed address', () => {
    expect(titleFor('/registers/%E0%A4%A', admin)).toBe('Register');
  });
});

describe('the Scan screen', () => {
  const student = navigationFor({ role: 'student', pathname: '/a', capabilities: null, openDisputes: 0, institutionAdmin: false });

  it('is the student’s Scan tab, poster links included', () => {
    expect(titleFor('/a', student)).toBe('Mark attendance');
    expect(titleFor('/a/K7M29QXD', student)).toBe('Mark attendance');
    expect(backFor('/a/K7M29QXD', student)).toBeNull();
  });

  it('names itself for staff and for visitors who are not signed in', () => {
    expect(titleFor('/a', admin)).toBe('Mark attendance');
    expect(titleFor('/a/K7M29QXD', [])).toBe('Mark attendance');
  });
});

describe('the active tab', () => {
  it('keeps a course code check-in under Scan', () => {
    expect(isActive('/a', '/check-in')).toBe(true);
    expect(isActive('/a', '/attendance')).toBe(false);
    expect(isActive('/attendance', '/check-in')).toBe(false);
    expect(isActive('/admin', '/admin/venues')).toBe(false);
  });
});

describe('class rep menus', () => {
  const caps = (overrides: Record<string, unknown>) => ({
    canTakeAttendance: true, role: 'hoc', roleLabel: 'HOC', canManageClassReps: false, canManageAssistants: true,
    canKeepClassList: true, assistantOf: null, attendanceScopeLabel: null, usesEnrolledCourses: false, ...overrides,
  }) as Parameters<typeof navigationFor>[0]['capabilities'];
  const menu = (capabilities: Parameters<typeof navigationFor>[0]['capabilities']) =>
    navigationFor({ role: 'student', pathname: '/sessions', capabilities, openDisputes: 0, institutionAdmin: false });

  it('gives a HOC the class list and Assistants', () => {
    const items = menu(caps({}));
    expect(items.filter((item) => item.group === 'HOC').map((item) => item.href)).toEqual(['/sessions', '/registers', '/class-list', '/assistants']);
  });

  it('gives an assistant their team, and the class list only when allowed', () => {
    const items = menu(caps({ role: 'ahoc', canManageAssistants: false, canKeepClassList: false, assistantOf: 'ADEYEMI Tola' }));
    expect(items.filter((item) => item.group === 'AHOC').map((item) => [item.href, item.label])).toEqual([
      ['/sessions', 'Take attendance'], ['/registers', 'Course registers'], ['/assistants', 'My team'],
    ]);
    const allowed = menu(caps({ role: 'aghoc', canManageAssistants: false, canKeepClassList: true, canManageClassReps: true, assistantOf: 'OKAFOR Ngozi' }));
    expect(allowed.filter((item) => item.group === 'AGHOC').map((item) => item.href)).toEqual(['/sessions', '/registers', '/class-list', '/class-reps', '/assistants']);
  });
});
