import { describe, expect, it } from 'vitest';
import { assistantShort, orderedPermissions, powersLine, principalFrom, sessionsLine, togglePermission } from './assistant-model';

describe('assistant permissions', () => {
  it('ties setup codes to the class list', () => {
    expect(togglePermission(['registers', 'class_list', 'setup_codes'], 'class_list', false)).toEqual(['registers']);
    expect(togglePermission(['registers'], 'setup_codes', true)).toEqual(['registers', 'class_list', 'setup_codes']);
    expect(togglePermission(['class_list'], 'registers', true)).toEqual(['registers', 'class_list']);
  });

  it('orders and offers only what the post allows', () => {
    expect(orderedPermissions(['hocs', 'registers', 'class_list', 'setup_codes'])).toEqual(['registers', 'class_list', 'setup_codes', 'hocs']);
    expect(orderedPermissions(['class_list', 'registers'])).toEqual(['registers', 'class_list']);
  });

  it('says what an assistant can do in one sentence', () => {
    expect(powersLine([])).toBe('Takes attendance.');
    expect(powersLine(['registers'])).toBe('Takes attendance and sees the registers.');
    expect(powersLine(['registers', 'class_list', 'setup_codes', 'hocs'])).toBe('Takes attendance, sees the registers, keeps the class list with setup codes and appoints HOCs.');
  });
});

describe('assistant labels', () => {
  it('names the post and reads the address', () => {
    expect(assistantShort('hoc')).toBe('AHOC');
    expect(assistantShort('ghoc')).toBe('AGHOC');
    expect(sessionsLine({ recentSessions: 1, lastSessionAt: '2026-11-01T09:00:00.000Z' })).toBe('1 session in 30 days');
    expect(sessionsLine({ recentSessions: 0, lastSessionAt: null })).toBe('No sessions yet');
    expect(principalFrom('00000000-0000-4000-8000-0000000000AB')).toBe('00000000-0000-4000-8000-0000000000ab');
    expect(principalFrom('nope')).toBeNull();
    expect(principalFrom(null)).toBeNull();
  });
});
