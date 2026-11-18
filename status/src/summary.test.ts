import { describe, expect, it } from 'vitest';
import { StatusNoticesSchema } from '../../packages/contracts/src/index.ts';
import type { Incident } from './incidents.ts';
import { COMPONENT_IDS, INITIAL, watDay, type ComponentId, type ComponentState } from './model.ts';
import { barState, buildSummary, notices, plain, underMaintenance, uptime } from './summary.ts';

const NOW = Date.UTC(2026, 10, 10, 12, 0);
const fine = Object.fromEntries(COMPONENT_IDS.map((id) => [id, INITIAL])) as Record<ComponentId, ComponentState>;

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'gh-1', number: 1, kind: 'incident', impact: 'minor', title: 'Emails are delayed', components: ['email'], automatic: true,
    createdAt: NOW - 30 * 60_000, resolvedAt: null, startsAt: null, endsAt: null,
    updates: [{ at: NOW - 10 * 60_000, stage: 'identified', body: 'Our **email provider** is slow. See [details](https://x.example/y).' }],
    ...overrides,
  };
}

describe('day bars and uptime', () => {
  it('shows the worst of a day, ignoring a stray minute', () => {
    expect(barState({ day: 'd', up: 0, degraded: 0, down: 0, maint: 0 })).toBe('none');
    expect(barState({ day: 'd', up: 1439, degraded: 1, down: 0, maint: 0 })).toBe('operational');
    expect(barState({ day: 'd', up: 1430, degraded: 10, down: 0, maint: 0 })).toBe('degraded');
    expect(barState({ day: 'd', up: 1439, degraded: 0, down: 1, maint: 0 })).toBe('degraded');
    expect(barState({ day: 'd', up: 1400, degraded: 0, down: 40, maint: 0 })).toBe('down');
    expect(barState({ day: 'd', up: 600, degraded: 0, down: 0, maint: 840 })).toBe('maintenance');
  });

  it('leaves maintenance and missing days out of uptime', () => {
    expect(uptime([])).toBeNull();
    expect(uptime([{ day: 'a', up: 990, degraded: 0, down: 10, maint: 500 }, { day: 'b', up: 0, degraded: 0, down: 0, maint: 0 }])).toBeCloseTo(0.99);
    expect(uptime([{ day: 'a', up: 900, degraded: 100, down: 0, maint: 0 }])).toBe(1);
  });
});

describe('buildSummary', () => {
  const base = { now: NOW, lastCheckAt: NOW - 30_000, states: fine, hidden: [] as ComponentId[], days: [], latency: [], incidents: [] as Incident[] };

  it('is all working with no data yet', () => {
    const summary = buildSummary(base);
    expect(summary.overall).toBe('operational');
    expect(summary.components).toHaveLength(6);
    expect(summary.components[0]!.days).toHaveLength(90);
    expect(summary.components[0]!.days.at(-1)!.day).toBe(watDay(NOW));
    expect(summary.components[0]!.uptime).toBeNull();
    expect(summary.latency.site).toHaveLength(288);
  });

  it('hides parts that are turned off and takes the worst state for the headline', () => {
    const summary = buildSummary({ ...base, hidden: ['face'], states: { ...fine, email: { ...INITIAL, state: 'degraded' } } });
    expect(summary.components.map((component) => component.id)).not.toContain('face');
    expect(summary.overall).toBe('degraded');
    expect(buildSummary({ ...base, states: { ...fine, sign_in: { ...INITIAL, state: 'down' } } }).overall).toBe('down');
    // One side part down is a partial problem, not a major one.
    expect(buildSummary({ ...base, states: { ...fine, email: { ...INITIAL, state: 'down' } } }).overall).toBe('degraded');
  });

  it('reflects open incidents even while checks look fine', () => {
    expect(buildSummary({ ...base, incidents: [incident()] }).overall).toBe('degraded');
    expect(buildSummary({ ...base, incidents: [incident({ impact: 'major' })] }).overall).toBe('down');
  });

  it('shows parts under maintenance as such', () => {
    const work = incident({ id: 'gh-2', kind: 'maintenance', impact: 'maintenance', components: [], startsAt: NOW - 60_000, endsAt: NOW + 3_600_000 });
    expect([...underMaintenance([work], NOW)]).toHaveLength(6);
    const summary = buildSummary({ ...base, incidents: [work] });
    expect(summary.overall).toBe('maintenance');
    expect(summary.components.every((component) => component.state === 'maintenance')).toBe(true);
  });

  it('sorts incidents into now, planned and recent', () => {
    const planned = incident({ id: 'gh-3', kind: 'maintenance', impact: 'maintenance', startsAt: NOW + 3_600_000, endsAt: NOW + 7_200_000 });
    const old = incident({ id: 'gh-4', resolvedAt: NOW - 86_400_000 });
    const ancient = incident({ id: 'gh-5', resolvedAt: NOW - 20 * 86_400_000 });
    const summary = buildSummary({ ...base, incidents: [incident(), planned, old, ancient] });
    expect(summary.active.map((item) => item.id)).toEqual(['gh-1']);
    expect(summary.upcoming.map((item) => item.id)).toEqual(['gh-3']);
    expect(summary.recent.map((item) => item.id)).toEqual(['gh-4']);
  });

  it('averages response times in five-minute buckets', () => {
    const bucket = Math.floor(NOW / 300_000);
    const summary = buildSummary({ ...base, latency: [{ bucket, site_sum: 900, site_n: 3, api_sum: 0, api_n: 0 }] });
    expect(summary.latency.site.at(-1)).toBe(300);
    expect(summary.latency.api.at(-1)).toBeNull();
  });
});

describe('notices for the app banner', () => {
  it('match the contract the API reads, with plain text', () => {
    const planned = incident({ id: 'gh-3', kind: 'maintenance', impact: 'maintenance', startsAt: NOW + 3_600_000, endsAt: NOW + 7_200_000 });
    const far = incident({ id: 'gh-6', kind: 'maintenance', impact: 'maintenance', startsAt: NOW + 3 * 86_400_000, endsAt: NOW + 3 * 86_400_000 + 3_600_000 });
    const summary = buildSummary({ now: NOW, lastCheckAt: NOW, states: fine, hidden: [], days: [], latency: [], incidents: [incident(), planned, far] });
    const body = { statusPageUrl: 'https://status.test', notices: notices(summary, 'https://status.test', NOW) };
    const parsed = StatusNoticesSchema.parse(body);
    expect(parsed.notices.map((notice) => notice.id)).toEqual(['gh-1', 'gh-3']);
    expect(parsed.notices[0]!.message).toBe('Our email provider is slow. See details.');
    expect(parsed.notices[0]!.url).toBe('https://status.test/incidents/gh-1');
  });

  it('flattens Markdown', () => {
    expect(plain('# Hi\n- **a**\n- `b`')).toBe('Hi a b');
  });
});
