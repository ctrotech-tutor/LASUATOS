import type { LectureCatalogCourse } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import {
  checksFor,
  checkText,
  countCourses,
  courseSlug,
  findBySlug,
  groupByLevel,
  joinWords,
  kindOf,
  matchesQuery,
  matchesShow,
  originLine,
  prefixCounts,
  prefixOf,
  readView,
  renameProblem,
  taughtLabel,
  unitsLabel,
  viewHref,
  wasCode,
} from './format';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const DAY = 86_400_000;

function course(code: string, extra: Partial<LectureCatalogCourse> = {}): LectureCatalogCourse {
  return {
    id: null,
    code,
    title: `${code} title`,
    units: 3,
    level: Number(code.match(/\d/)?.[0] ?? 0) * 100 || null,
    semester: 1,
    group: 'Engineering',
    source: 'standard',
    addedByName: null,
    canEdit: true,
    builtInCode: null,
    hidden: false,
    sessionCount: 0,
    lastSessionAt: null,
    ...extra,
  };
}

const builtIn = course('GET 209');
const recoded = course('MEE 201', { id: 'a', source: 'institution', builtInCode: 'GET 201' });
const retitled = course('GET 307', { id: 'b', source: 'institution', builtInCode: 'GET 307', title: 'Engineering Mathematics III' });
const added = course('ECE 305', { id: 'c', source: 'institution', title: 'Digital Electronics', addedByName: 'Dr. Tunde Adeyemi' });
const twin = course('CPE 305', { id: 'd', source: 'institution', title: 'Digital  electronics.' });
const unitless = course('GET 203', { units: null });
const hidden = course('ECE 210', { id: 'e', source: 'institution', hidden: true, units: null, sessionCount: 14 });

describe('kinds', () => {
  it('tells built-in, changed and added courses apart', () => {
    expect(kindOf(builtIn)).toBe('built_in');
    expect(kindOf(recoded)).toBe('changed');
    expect(kindOf(retitled)).toBe('changed');
    expect(kindOf(added)).toBe('added');
  });

  it('names the old code only when it changed', () => {
    expect(wasCode(recoded)).toBe('GET 201');
    expect(wasCode(retitled)).toBeNull();
    expect(originLine(recoded)).toBe('Was GET 201');
    expect(originLine(retitled)).toBe('Built-in, changed here');
    expect(originLine(added)).toBe('Added by Dr. Tunde Adeyemi');
    expect(originLine(twin)).toBe('Added here');
    expect(originLine(builtIn)).toBe('Built-in');
  });

  it('says when a course was last taught by the Lagos calendar, without a clock time', () => {
    expect(taughtLabel(null, NOW)).toBe('Never');
    expect(taughtLabel('2026-11-10T08:00:00Z', NOW)).toBe('Today');
    expect(taughtLabel('2026-11-09T23:30:00Z', NOW)).toBe('Today');
    expect(taughtLabel('2026-11-09T08:00:00Z', NOW)).toBe('Yesterday');
    expect(taughtLabel('2026-11-06T08:00:00Z', NOW)).toBe('Friday');
    expect(taughtLabel('2026-10-14T08:00:00Z', NOW)).toBe('14 Oct');
    expect(taughtLabel('2025-10-14T08:00:00Z', NOW)).toBe('14 Oct 2025');
  });

  it('reads the prefix and the units', () => {
    expect(prefixOf('ece305')).toBe('ECE');
    expect(unitsLabel(null)).toBe('Units not set');
    expect(unitsLabel(1)).toBe('1 unit');
    expect(unitsLabel(3)).toBe('3 units');
  });
});

describe('what needs a look', () => {
  const all = [builtIn, recoded, added, twin, unitless, hidden];
  const checks = checksFor(all);

  it('flags missing units and the same title under two codes', () => {
    expect(checks.get('GET203')).toEqual([{ kind: 'no_units' }]);
    expect(checks.get('ECE305')).toEqual([{ kind: 'same_title', others: ['CPE 305'] }]);
    expect(checks.get('CPE305')).toEqual([{ kind: 'same_title', others: ['ECE 305'] }]);
    expect(checks.has('GET209')).toBe(false);
  });

  it('ignores hidden courses, which nobody can pick', () => {
    expect(checks.has('ECE210')).toBe(false);
    const hiddenTwin = course('CPE 306', { hidden: true, title: 'Digital Electronics' });
    expect(checksFor([added, hiddenTwin]).has('ECE305')).toBe(false);
  });

  it('explains each check in plain words', () => {
    expect(checkText({ kind: 'no_units' }).title).toBe('Units not set');
    expect(checkText({ kind: 'same_title', others: ['CPE 305', 'MCT 305'] }).title).toBe('Same title as CPE 305 and MCT 305');
    expect(joinWords(['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinWords([])).toBe('');
  });

  it('counts what can be picked, what was set here and what was taught lately', () => {
    const taught = course('GET 301', { sessionCount: 6, lastSessionAt: new Date(NOW - 3 * DAY).toISOString() });
    const old = course('MEE 305', { sessionCount: 3, lastSessionAt: new Date(NOW - 45 * DAY).toISOString() });
    const list = [...all, taught, old];
    expect(countCourses(list, checksFor(list), NOW)).toEqual({
      pickable: 7, builtIn: 4, added: 2, changed: 1, hidden: 1, check: 3, recent: 1, total: 8,
    });
  });
});

describe('finding', () => {
  it('filters by what the segment shows', () => {
    expect(matchesShow('all', hidden, [])).toBe(true);
    expect(matchesShow('hidden', hidden, [])).toBe(true);
    expect(matchesShow('added', hidden, [])).toBe(false);
    expect(matchesShow('added', added, [])).toBe(true);
    expect(matchesShow('changed', recoded, [])).toBe(true);
    expect(matchesShow('check', builtIn, [])).toBe(false);
    expect(matchesShow('check', unitless, [{ kind: 'no_units' }])).toBe(true);
  });

  it('searches code, title, old code and who added it', () => {
    expect(matchesQuery(added, 'ece3')).toBe(true);
    expect(matchesQuery(added, 'ECE 305')).toBe(true);
    expect(matchesQuery(added, 'digital adeyemi')).toBe(true);
    expect(matchesQuery(recoded, 'get 201')).toBe(true);
    expect(matchesQuery(added, 'mee')).toBe(false);
    expect(matchesQuery(added, '  ')).toBe(true);
  });

  it('lists prefixes in use, hidden courses left out', () => {
    expect(prefixCounts([builtIn, recoded, added, twin, unitless, hidden])).toEqual([
      { prefix: 'CPE', count: 1 },
      { prefix: 'ECE', count: 1 },
      { prefix: 'GET', count: 2 },
      { prefix: 'MEE', count: 1 },
    ]);
  });

  it('groups by level, lowest first, courses without a level last', () => {
    const other = course('GST 111', { level: null });
    const groups = groupByLevel([added, builtIn, twin, other, recoded]);
    expect(groups.map((group) => group.title)).toEqual(['200 level', '300 level', 'Other courses']);
    expect(groups[1]?.courses.map((item) => item.code)).toEqual(['CPE 305', 'ECE 305']);
  });
});

describe('the address bar', () => {
  it('reads and writes a clean view', () => {
    const params = new URLSearchParams('show=check&prefix=ECE&course=ece305');
    expect(readView(params)).toEqual({ show: 'check', prefix: 'ece', course: 'ece305' });
    expect(viewHref('/admin/courses', { show: 'check', prefix: 'ece', course: 'ece305' })).toBe('/admin/courses?show=check&prefix=ece&course=ece305');
    expect(viewHref('/admin/courses', { show: 'all', prefix: null, course: null })).toBe('/admin/courses');
  });

  it('drops anything it does not understand', () => {
    expect(readView(new URLSearchParams('show=everything&prefix=e1&course=<b>'))).toEqual({ show: 'all', prefix: null, course: null });
    expect(readView(null)).toEqual({ show: 'all', prefix: null, course: null });
  });

  it('finds a course by its slug', () => {
    expect(courseSlug('ECE 305')).toBe('ece305');
    expect(findBySlug('mee201', [builtIn, recoded])).toBe(recoded);
    expect(findBySlug('get201', [builtIn, recoded])).toBeNull();
    expect(findBySlug(null, [builtIn])).toBeNull();
  });
});

describe('renaming a prefix', () => {
  it('says what is missing before a preview', () => {
    expect(renameProblem('', 'MEE')).toBe('Choose the prefix to rename.');
    expect(renameProblem('GET', 'M')).toMatch(/2 to 5 letters/);
    expect(renameProblem('GET', 'GET')).toMatch(/same/);
    expect(renameProblem('GET', 'MEE')).toBeNull();
  });
});
