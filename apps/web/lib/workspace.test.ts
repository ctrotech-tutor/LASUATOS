import { describe, expect, it } from 'vitest';
import { primaryAction, workspacePath } from './workspace';

describe('primaryAction', () => {
  it('sends visitors and students (class reps included) to mark attendance', () => {
    for (const who of [undefined, null, 'student'] as const) {
      expect(primaryAction(who)).toMatchObject({ href: '/a', label: 'Mark attendance', short: 'Scan', icon: 'scan' });
    }
  });

  it('never offers staff a student check-in: they get their own work', () => {
    expect(primaryAction('lecturer')).toMatchObject({ href: '/sessions', label: 'Take attendance', icon: 'sessions' });
    expect(primaryAction('administrator')).toMatchObject({ href: '/admin', label: 'Administration', icon: 'admin' });
    for (const who of ['lecturer', 'administrator'] as const) {
      expect(primaryAction(who).href).not.toBe('/a');
      expect(primaryAction(who).href).toBe(workspacePath(who));
    }
  });

  it('keeps the short label short enough for a phone header', () => {
    for (const who of [null, 'student', 'lecturer', 'administrator'] as const) {
      expect(primaryAction(who).short.length).toBeLessThanOrEqual(9);
    }
  });
});
