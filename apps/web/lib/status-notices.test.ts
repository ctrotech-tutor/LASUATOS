import type { StatusNotice } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { maintenanceWindow, noticeKey, pickNotice } from './status-notices';

const NOW = Date.parse('2026-11-10T12:00:00Z');

function notice(overrides: Partial<StatusNotice> = {}): StatusNotice {
  return {
    id: 'gh-1', kind: 'incident', impact: 'minor', title: 'Emails are delayed', message: 'Use Continue with Google.',
    startsAt: null, endsAt: null, updatedAt: '2026-11-10T11:50:00.000Z', url: 'https://status.example/incidents/gh-1',
    ...overrides,
  };
}

describe('status notices', () => {
  it('shows what is happening now before what is planned, major first', () => {
    const planned = notice({ id: 'gh-2', kind: 'maintenance', impact: 'maintenance', startsAt: '2026-11-10T21:00:00.000Z', endsAt: '2026-11-10T22:30:00.000Z' });
    const major = notice({ id: 'gh-3', impact: 'major' });
    expect(pickNotice([planned, notice(), major], new Set(), NOW)?.id).toBe('gh-3');
    expect(pickNotice([planned, notice()], new Set(), NOW)?.id).toBe('gh-1');
    expect(pickNotice([planned], new Set(), NOW)?.id).toBe('gh-2');
    expect(pickNotice([], new Set(), NOW)).toBeNull();
  });

  it('keeps a notice dismissed until its next update', () => {
    const first = notice();
    expect(pickNotice([first], new Set([noticeKey(first)]), NOW)).toBeNull();
    const updated = notice({ updatedAt: '2026-11-10T11:58:00.000Z' });
    expect(pickNotice([updated], new Set([noticeKey(first)]), NOW)?.id).toBe('gh-1');
  });

  it('writes the maintenance window in Lagos time', () => {
    expect(maintenanceWindow(notice({ startsAt: '2026-11-14T21:00:00.000Z', endsAt: '2026-11-14T22:30:00.000Z' }))).toBe('Sat 14 Nov, 22:00–23:30');
    expect(maintenanceWindow(notice())).toBeNull();
  });
});
