import type { AuditLogEntry } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import {
  actorLabel, dayLabel, EMPTY_VIEW, entryText, firstChange, groupByDay, initials, isFiltered, listKey, periodRange, prettyRecord, queryOf,
  readView, resultLine, rowTime, shortName, trendLabel, viewHref,
} from './format';

const ACTOR = '22222222-2222-4222-8222-222222222222';
const ENTRY = 'student:11111111-1111-4111-8111-111111111111';
// Monday 16 November 2026, 10:00 in Lagos (09:00 UTC).
const NOW = Date.parse('2026-11-16T09:00:00Z');

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: ENTRY,
  category: 'structure',
  action: 'department_updated',
  summary: 'Changed a department',
  actorName: 'Kunle Bakare',
  actorId: ACTOR,
  subject: 'Electronic and Computer Engineering',
  subjectSearch: 'Electronic and Computer Engineering',
  facts: [{ label: 'Name', value: 'ECE', previous: null }, { label: 'Programme length', value: '5 years', previous: '4 years' }],
  note: null,
  links: [],
  notable: false,
  details: '{"before":{"years":4},"after":{"years":5}}',
  at: '2026-11-16T08:30:00Z',
  ...over,
});

const params = (search: string) => new URLSearchParams(search);

describe('audit address', () => {
  it('reads and writes every filter, leaving defaults out', () => {
    const view = readView(params(`show=notable&category=faces&period=7d&q=2502&actor=${ACTOR}&entry=${ENTRY}`));
    expect(view).toEqual({ show: 'notable', category: 'faces', period: '7d', from: '', to: '', q: '2502', actor: ACTOR, entry: ENTRY });
    expect(viewHref('/admin/audit', view)).toBe(`/admin/audit?show=notable&category=faces&period=7d&q=2502&actor=${ACTOR}&entry=${ENTRY}`);
    expect(viewHref('/admin/audit', EMPTY_VIEW)).toBe('/admin/audit');
  });

  it('ignores values it does not know', () => {
    expect(readView(params('show=maybe&category=nope&period=year&actor=me&entry=bad&from=11/02/2026'))).toEqual(EMPTY_VIEW);
    expect(readView(null)).toEqual(EMPTY_VIEW);
  });

  it('treats dates as a custom period, and keeps an empty custom period', () => {
    const view = readView(params('from=2026-11-02&to=2026-11-09'));
    expect(view.period).toBe('custom');
    expect(viewHref('/a', view)).toBe('/a?from=2026-11-02&to=2026-11-09');
    expect(viewHref('/a', { ...EMPTY_VIEW, period: 'custom' })).toBe('/a?period=custom');
    expect(readView(params('period=custom')).period).toBe('custom');
  });

  it('knows when the list is narrowed', () => {
    expect(isFiltered(EMPTY_VIEW)).toBe(false);
    expect(isFiltered({ ...EMPTY_VIEW, entry: ENTRY })).toBe(false);
    expect(isFiltered({ ...EMPTY_VIEW, q: '  ' })).toBe(false);
    expect(isFiltered({ ...EMPTY_VIEW, actor: ACTOR })).toBe(true);
  });
});

describe('periods in Lagos', () => {
  it('turns presets into dates relative to today', () => {
    expect(periodRange({ period: 'today', from: '', to: '' }, NOW)).toEqual({ from: '2026-11-16', to: '2026-11-16' });
    expect(periodRange({ period: '7d', from: '', to: '' }, NOW)).toEqual({ from: '2026-11-10', to: '2026-11-16' });
    expect(periodRange({ period: '30d', from: '', to: '' }, NOW)).toEqual({ from: '2026-10-18', to: '2026-11-16' });
    expect(periodRange({ period: 'all', from: '2026-01-01', to: '' }, NOW)).toEqual({});
    expect(periodRange({ period: 'custom', from: '2026-11-02', to: '' }, NOW)).toEqual({ from: '2026-11-02' });
  });

  it('uses the Lagos day just after midnight there', () => {
    // 23:30 UTC on the 15th is 00:30 on the 16th in Lagos.
    expect(periodRange({ period: 'today', from: '', to: '' }, Date.parse('2026-11-15T23:30:00Z'))).toEqual({ from: '2026-11-16', to: '2026-11-16' });
  });

  it('builds the API query and a cache key from it', () => {
    const view = { ...EMPTY_VIEW, show: 'notable' as const, category: 'faces' as const, period: '7d' as const, q: ' Chioma ', actor: ACTOR };
    expect(queryOf(view, NOW)).toEqual({ category: 'faces', q: 'Chioma', from: '2026-11-10', to: '2026-11-16', actor: ACTOR, notable: 'true' });
    expect(listKey(view, NOW)).toBe(`admin:audit:list:faces:chioma:2026-11-10:2026-11-16:${ACTOR}:true`);
    expect(listKey(EMPTY_VIEW, NOW)).toBe('admin:audit:list::::::');
  });
});

describe('words', () => {
  it('names days and times like a phone', () => {
    expect(dayLabel('2026-11-16T07:00:00Z', NOW)).toBe('Today');
    expect(dayLabel('2026-11-15T07:00:00Z', NOW)).toBe('Yesterday');
    expect(dayLabel('2026-11-12T07:00:00Z', NOW)).toBe('Thursday');
    expect(dayLabel('2026-11-05T07:00:00Z', NOW)).toBe('Thu 5 Nov');
    expect(dayLabel('2025-11-05T07:00:00Z', NOW)).toBe('Wed 5 Nov 2025');
    expect(rowTime('2026-11-16T08:05:00Z', NOW)).toBe('09:05');
    expect(rowTime('2026-11-15T08:05:00Z', NOW)).toBe('Yesterday 09:05');
    expect(rowTime('2026-11-01T08:05:00Z', NOW)).toBe('1 Nov');
  });

  it('groups entries by Lagos day, newest first', () => {
    const groups = groupByDay([
      entry({ id: 'a', at: '2026-11-16T08:00:00Z' }),
      entry({ id: 'b', at: '2026-11-15T23:30:00Z' }), // 00:30 on the 16th in Lagos
      entry({ id: 'c', at: '2026-11-15T10:00:00Z' }),
    ], NOW);
    expect(groups.map((group) => [group.label, group.entries.map((item) => item.id)])).toEqual([['Today', ['a', 'b']], ['Yesterday', ['c']]]);
  });

  it('compares the week with the one before', () => {
    expect(trendLabel(12, 0)).toBe('none the week before');
    expect(trendLabel(0, 0)).toBe('none the week before either');
    expect(trendLabel(10, 10)).toBe('same as the week before');
    expect(trendLabel(15, 10)).toBe('5 more than the week before');
    expect(trendLabel(3, 10)).toBe('7 fewer than the week before');
  });

  it('says what the list shows', () => {
    expect(resultLine(EMPTY_VIEW, 50, true, null)).toBe('50 entries+');
    expect(resultLine({ ...EMPTY_VIEW, show: 'notable', category: 'faces', period: '7d', q: '2502', actor: ACTOR }, 1, false, 'Kunle Bakare'))
      .toBe('1 entry worth a look in faces by Kunle Bakare matching “2502” in the last 7 days');
    expect(resultLine({ ...EMPTY_VIEW, period: 'custom', from: '2026-11-02', to: '2026-11-09' }, 3, false, null)).toBe('3 entries between 2 Nov and 9 Nov');
  });

  it('shortens names', () => {
    expect(initials('Dr. Ada Bello-Ojo')).toBe('AB');
    expect(initials('Kunle')).toBe('K');
    expect(shortName('Dr. Ada Bello-Ojo')).toBe('Dr Bello-Ojo');
    expect(shortName('Kunle Bakare')).toBe('Kunle');
    expect(actorLabel({ actorName: null, category: 'retention' })).toBe('Scheduled clean-up');
    expect(actorLabel({ actorName: null, category: 'faces' })).toBe('LASUATOS');
  });
});

describe('one entry', () => {
  it('lays out the stored record', () => {
    expect(prettyRecord('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    expect(prettyRecord('{not json')).toBe('{not json');
    expect(prettyRecord('rows: 62')).toBe('rows: 62');
    expect(prettyRecord('  ')).toBe('');
  });

  it('finds the first change and copies as text', () => {
    expect(firstChange(entry())).toEqual({ label: 'Programme length', value: '5 years', previous: '4 years' });
    expect(firstChange(entry({ facts: [] }))).toBeNull();
    const text = entryText(entry({ note: 'New CCMAS rules' }), 'https://lasuatos.app');
    expect(text).toContain('Changed a department\nWhen: Mon 16 Nov 2026 at 09:30\nBy: Kunle Bakare\nAbout: Electronic and Computer Engineering');
    expect(text).toContain('Programme length: 4 years to 5 years');
    expect(text).toContain('Note: New CCMAS rules');
    expect(text).toContain(`Entry: https://lasuatos.app/admin/audit?entry=${ENTRY}`);
  });
});
