import { describe, expect, it } from 'vitest';
import {
  autoBody, autoTitle, COMPONENT_IDS, deepDue, duration, evaluate, impactOf, INITIAL, planAutoIncident, step, watDay,
  type ComponentId, type ComponentState, type DeepReport, type Probe,
} from './model.ts';

const ok: Probe = { ok: true, ms: 300, status: 200 };
const fail: Probe = { ok: false, ms: null, status: 0 };
const fine: DeepReport = { core: 'operational', errors: 'operational', email: 'operational', google: 'operational', face: 'operational' };

function states(overrides: Partial<Record<ComponentId, Partial<ComponentState>>> = {}): Record<ComponentId, ComponentState> {
  return Object.fromEntries(COMPONENT_IDS.map((id) => [id, { ...INITIAL, ...overrides[id] }])) as Record<ComponentId, ComponentState>;
}

describe('evaluate', () => {
  it('maps a healthy run to every part working', () => {
    const result = evaluate(ok, ok, fine);
    expect(result.states).toEqual({ website: 'operational', sign_in: 'operational', attendance: 'operational', google: 'operational', face: 'operational', email: 'operational' });
    expect(result.hidden).toEqual([]);
  });

  it('takes every API part down when the API does not answer, whatever the last report said', () => {
    const result = evaluate(ok, fail, fine);
    expect(result.states.website).toBe('operational');
    for (const id of ['sign_in', 'google', 'attendance', 'face', 'email'] as const) expect(result.states[id]).toBe('down');
  });

  it('hides parts LASUATOS has turned off', () => {
    const result = evaluate(ok, ok, { ...fine, google: 'off', face: 'off' });
    expect(result.hidden).toEqual(['google', 'face']);
    expect(result.states.google).toBe('operational');
  });

  it('only reports problems on a light run (no deep report)', () => {
    expect(evaluate(ok, ok, null).states).toEqual({ website: 'operational' });
    expect(evaluate(ok, { ok: true, ms: 9_000, status: 200 }, null).states).toEqual({ website: 'operational', sign_in: 'degraded', attendance: 'degraded' });
  });

  it('marks slow pages and failing parts', () => {
    const result = evaluate({ ok: true, ms: 7_000, status: 200 }, ok, { ...fine, core: 'down', email: 'degraded' });
    expect(result.states.website).toBe('degraded');
    expect(result.states.sign_in).toBe('down');
    expect(result.states.attendance).toBe('down');
    expect(result.states.email).toBe('degraded');
    // Google and face depend on LASUATOS answering, not on its database.
    expect(result.states.google).toBe('operational');
  });

  it('counts a burst of server errors against sign-in and attendance', () => {
    expect(evaluate(ok, ok, { ...fine, errors: 'degraded' }).states.attendance).toBe('degraded');
  });
});

describe('step', () => {
  it('shows a worse state at once and a better one after two fine runs', () => {
    let state = step(INITIAL, 'down', 1_000);
    expect(state).toMatchObject({ state: 'down', since: 1_000, bad: 1 });
    state = step(state, 'operational', 2_000);
    expect(state.state).toBe('down');
    state = step(state, 'operational', 3_000);
    expect(state).toMatchObject({ state: 'operational', since: 3_000, good: 2, bad: 0 });
  });

  it('keeps the shown state when the part was not measured', () => {
    const state = { state: 'degraded' as const, since: 5, bad: 3, good: 0 };
    expect(step(state, undefined, 10)).toBe(state);
  });

  it('needs two runs for a partial recovery from down to degraded', () => {
    let state = step(INITIAL, 'down', 1);
    state = step(state, 'degraded', 2);
    expect(state.state).toBe('down');
    state = step(state, 'degraded', 3);
    expect(state.state).toBe('degraded');
  });

  it('does not reset the since time while a part stays fine', () => {
    const state = step({ state: 'operational', since: 100, bad: 0, good: 9 }, 'operational', 500);
    expect(state.since).toBe(100);
  });
});

describe('planAutoIncident', () => {
  it('waits for two bad runs before opening', () => {
    expect(planAutoIncident(states({ email: { state: 'down', bad: 1 } }), null, []).action).toBe('none');
    expect(planAutoIncident(states({ email: { state: 'down', bad: 2 } }), null, [])).toEqual({ action: 'open', components: ['email'], impact: 'minor' });
  });

  it('widens the open incident when another part breaks', () => {
    const plan = planAutoIncident(states({ email: { state: 'down', bad: 5 }, face: { state: 'degraded', bad: 2 } }), { components: ['email'] }, []);
    expect(plan).toMatchObject({ action: 'update', components: ['email', 'face'] });
  });

  it('closes only after everything has been fine for three runs', () => {
    expect(planAutoIncident(states({ email: { good: 2 } }), { components: ['email'] }, []).action).toBe('none');
    const allGood = Object.fromEntries(COMPONENT_IDS.map((id) => [id, { good: 3 }]));
    expect(planAutoIncident(states(allGood), { components: ['email'] }, []).action).toBe('close');
  });

  it('ignores hidden parts and parts under maintenance', () => {
    expect(planAutoIncident(states({ face: { state: 'down', bad: 9 } }), null, ['face']).action).toBe('none');
  });

  it('calls it major when students cannot use LASUATOS', () => {
    expect(impactOf(['attendance'], states({ attendance: { state: 'down' } }))).toBe('major');
    expect(impactOf(['email'], states({ email: { state: 'down' } }))).toBe('minor');
    expect(impactOf(['email', 'face'], states({ email: { state: 'down' }, face: { state: 'down' } }))).toBe('major');
    expect(impactOf(['website'], states({ website: { state: 'degraded' } }))).toBe('minor');
  });
});

describe('incident text', () => {
  it('writes plain titles', () => {
    expect(autoTitle(['website'], states({ website: { state: 'down' } }))).toBe('LASUATOS is not loading');
    expect(autoTitle(['email'], states({ email: { state: 'degraded' } }))).toBe('Emails are delayed');
    expect(autoTitle(['face'], states({ face: { state: 'down' } }))).toBe('Face check is not working');
    expect(autoTitle(['google', 'face'], states({ google: { state: 'degraded' }, face: { state: 'degraded' } }))).toBe('Google sign-in and face check are slow');
  });

  it('tells people what to do meanwhile and keeps maintainer notes private', () => {
    const body = autoBody(['face'], states({ face: { state: 'down' } }), Date.UTC(2026, 10, 10, 9, 5));
    expect(body).toContain('10:05 WAT');
    expect(body).toContain('mark students present by hand');
    expect(body).toMatch(/<!--[\s\S]*-->/);
  });
});

describe('time helpers', () => {
  it('uses West Africa Time for the day', () => {
    expect(watDay(Date.UTC(2026, 10, 10, 23, 30))).toBe('2026-11-11');
    expect(duration(45)).toBe('45 min');
    expect(duration(120)).toBe('2 h');
    expect(duration(135)).toBe('2 h 15 min');
  });

  it('runs the deep check by day, less at night, and every run while troubled', () => {
    const day = Date.UTC(2026, 10, 10, 9, 0); // 10:00 WAT
    const night = Date.UTC(2026, 10, 10, 1, 0); // 02:00 WAT
    expect(deepDue(day, null, false, 5, 30)).toBe(true);
    expect(deepDue(day, day - 4 * 60_000, false, 5, 30)).toBe(false);
    expect(deepDue(day, day - 5 * 60_000 + 5_000, false, 5, 30)).toBe(true);
    expect(deepDue(night, night - 10 * 60_000, false, 5, 30)).toBe(false);
    expect(deepDue(night, night - 30 * 60_000, false, 5, 30)).toBe(true);
    expect(deepDue(night, night - 60_000, true, 5, 30)).toBe(true);
  });
});
