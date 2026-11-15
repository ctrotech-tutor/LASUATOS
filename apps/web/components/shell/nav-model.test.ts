import { describe, expect, it } from 'vitest';
import { backFor, crumbsFor, navigationFor, titleFor } from './nav-model';

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

  it('survives a malformed address', () => {
    expect(titleFor('/registers/%E0%A4%A', admin)).toBe('Register');
  });
});
