import { beforeEach, describe, expect, it } from 'vitest';
import { run } from './checker.ts';
import { GitHub } from './github.ts';
import { Store, type AutoIncident } from './store.ts';
import type { Summary } from './summary.ts';
import { FakeGitHub, fakeTarget, memoryD1, targetFetch, testEnv, type FakeTarget } from './test-support.ts';

const START = Date.UTC(2026, 10, 10, 9, 0); // 10:00 WAT

describe('checker runs', () => {
  let db: ReturnType<typeof memoryD1>;
  let target: FakeTarget;
  let hub: FakeGitHub;
  let clock: { t: number };
  let github: GitHub;

  beforeEach(() => {
    db = memoryD1();
    target = fakeTarget();
    hub = new FakeGitHub();
    clock = { t: START };
    hub.now = () => new Date(clock.t).toISOString();
    github = new GitHub({ repo: 'owner/repo', token: 'token', fetch: hub.fetch });
  });

  // Deep checks every minute unless a test says otherwise, so faults only they see show at once.
  async function minute(options: { github?: GitHub | null; deepEvery?: string } = {}) {
    clock.t = Math.ceil((clock.t + 1) / 60_000) * 60_000;
    const at = clock.t;
    const result = await run(testEnv(db, { DEEP_EVERY_DAY_MINUTES: options.deepEvery ?? '1' }), { at, fetch: targetFetch(target, clock), sleep: async () => undefined, now: () => clock.t, github: options.github === undefined ? github : options.github });
    clock.t = at;
    return result;
  }

  const store = () => new Store(db);
  const summary = async () => (await store().meta<Summary>('summary'))!;

  it('records a healthy minute, makes the labels and prepares the page', async () => {
    const result = await minute();
    expect(result.deep).toBe(true);
    expect(Object.values(result.states).every((state) => state.state === 'operational')).toBe(true);
    expect(hub.labels.has('status')).toBe(true);
    expect(hub.labels.has('component: sign-in')).toBe(true);
    const page = await summary();
    expect(page.overall).toBe('operational');
    expect(page.components[0]!.days.at(-1)).toMatchObject({ up: 1, down: 0 });
    expect(page.components[0]!.uptime).toBe(1);
    expect(page.lastCheckAt).toBe(clock.t);
  });

  it('skips the deep check between intervals during the day', async () => {
    await minute({ deepEvery: '5' });
    target.calls = [];
    const second = await minute({ deepEvery: '5' });
    expect(second.deep).toBe(false);
    expect(target.calls).not.toContain('/api/v1/status');
  });

  it('notices a fault only the deep check sees at the next deep check, then checks every minute', async () => {
    await minute({ deepEvery: '5' });
    target.deep = { core: 'down', errors: 'operational', email: 'operational', google: 'operational', face: 'operational' };
    for (let index = 0; index < 3; index += 1) expect((await minute({ deepEvery: '5' })).states.attendance.state).toBe('operational');
    const fourth = await minute({ deepEvery: '5' });
    expect(fourth.deep).toBe(false);
    const fifth = await minute({ deepEvery: '5' });
    expect(fifth.deep).toBe(true);
    expect(fifth.states.attendance.state).toBe('down');
    expect((await minute({ deepEvery: '5' })).deep).toBe(true);
    expect(hub.issues).toHaveLength(1);
    // Recovery is confirmed by deep checks every run, so the incident closes in three minutes.
    target.deep = { ...target.deep, core: 'operational' };
    for (let index = 0; index < 3; index += 1) expect((await minute({ deepEvery: '5' })).deep).toBe(true);
    expect(hub.issues[0]!.state).toBe('closed');
    expect((await minute({ deepEvery: '5' })).deep).toBe(false);
  });

  it('opens one GitHub incident after two bad runs, keeps it updated and closes it when all is well', async () => {
    await minute();
    target.deep = { core: 'operational', errors: 'operational', email: 'down', google: 'operational', face: 'operational' };
    await minute();
    expect(hub.issues).toHaveLength(0);
    await minute();
    expect(hub.issues).toHaveLength(1);
    const opened = hub.issues[0]!;
    expect(opened.title).toBe('Emails are not being sent');
    expect(opened.labels.map((label) => (typeof label === 'string' ? label : label.name))).toEqual(['status', 'auto', 'minor', 'component: email']);
    expect((await store().meta<AutoIncident>('auto'))?.issue).toBe(opened.number);
    let page = await summary();
    expect(page.overall).toBe('degraded');
    expect(page.active).toHaveLength(1);
    expect(page.active[0]!.updates[0]!.body).not.toContain('<!--');

    // A maintainer posts an update: it shows on the page.
    hub.addComment(opened.number, 'Identified: our email provider is rejecting messages.');
    await minute();
    page = await summary();
    expect(page.active[0]!.updates[0]).toMatchObject({ stage: 'identified', body: 'our email provider is rejecting messages.' });

    // Face breaks too: the same incident widens, no second one.
    target.deep = { ...target.deep, face: 'down' };
    await minute();
    await minute();
    expect(hub.issues).toHaveLength(1);
    expect(hub.issues[0]!.title).toBe('Emails and face check are not working');
    expect((hub.comments.get(opened.number) ?? []).some((item) => item.body?.startsWith('Update: also affected now: face'))).toBe(true);

    // Recovery: shown after two fine runs, closed after three.
    target.deep = { core: 'operational', errors: 'operational', email: 'operational', google: 'operational', face: 'operational' };
    await minute();
    await minute();
    expect(hub.issues[0]!.state).toBe('open');
    await minute();
    expect(hub.issues[0]!.state).toBe('closed');
    expect(await store().meta('auto')).toBeNull();
    page = await summary();
    expect(page.overall).toBe('operational');
    expect(page.active).toHaveLength(0);
    expect(page.recent[0]!.updates[0]!.stage).toBe('resolved');
    expect(page.recent[0]!.updates[0]!.body).toMatch(/^everything has been working normally again/);
    const email = page.components.find((component) => component.id === 'email')!;
    expect(email.days.at(-1)!.down).toBeGreaterThanOrEqual(5);
    expect(email.uptime).toBeLessThan(1);
  });

  it('takes everything down when LASUATOS does not answer and calls it major', async () => {
    await minute();
    target.site = 'down';
    target.api = 'down';
    await minute();
    await minute();
    expect(hub.issues[0]!.title).toBe('LASUATOS is not loading');
    expect(hub.issues[0]!.labels.map((label) => (typeof label === 'string' ? label : label.name))).toContain('major');
    expect((await summary()).overall).toBe('down');
  });

  it('treats a wrong page (the host’s error page) as the website being down', async () => {
    target.site = 'wrong';
    const result = await minute();
    expect(result.states.website.state).toBe('down');
  });

  it('keeps the incident on the page when GitHub is unreachable', async () => {
    hub.fail = true;
    await minute();
    target.deep = 'down';
    await minute();
    await minute();
    const auto = await store().meta<AutoIncident>('auto');
    expect(auto?.issue).toBeNull();
    expect(auto?.localId).toMatch(/^auto-/);
    const page = await summary();
    expect(page.active[0]!.title).toBe('LASUATOS is not working right now');
    target.deep = { core: 'operational', errors: 'operational', email: 'operational', google: 'operational', face: 'operational' };
    for (let index = 0; index < 3; index += 1) await minute();
    const after = await summary();
    expect(after.active).toHaveLength(0);
    expect(after.recent[0]!.updates[0]!.stage).toBe('resolved');
  });

  it('works without GitHub at all', async () => {
    await minute({ github: null });
    target.api = 'down';
    await minute({ github: null });
    await minute({ github: null });
    expect((await summary()).active).toHaveLength(1);
    expect(hub.requests).toHaveLength(0);
  });

  it('does not reopen an incident a maintainer closed while it is still failing', async () => {
    await minute();
    target.deep = { core: 'operational', errors: 'operational', email: 'degraded', google: 'operational', face: 'operational' };
    await minute();
    await minute();
    const number = hub.issues[0]!.number;
    hub.close(number);
    await minute();
    expect((await store().meta<AutoIncident>('auto'))?.suppressed).toBe(true);
    await minute();
    expect(hub.issues).toHaveLength(1);
    const commentsBefore = (hub.comments.get(number) ?? []).length;
    target.deep = { ...target.deep, email: 'operational' };
    for (let index = 0; index < 3; index += 1) await minute();
    expect(await store().meta('auto')).toBeNull();
    expect((hub.comments.get(number) ?? []).length).toBe(commentsBefore);
  });

  it('brings in maintenance from GitHub and does not count its minutes against uptime', async () => {
    hub.add({ title: 'Database upgrade', labels: ['status', 'maintenance'], body: `Starts: ${new Date(START - 3_600_000 + 3_600_000).toISOString().slice(0, 16).replace('T', ' ')}\nEnds: 2026-11-10 23:00\n\nShort pauses possible.` });
    hub.add({ title: 'Spam', labels: ['status'], association: 'NONE' });
    await minute();
    target.api = 'down';
    await minute();
    await minute();
    const page = await summary();
    expect(page.active.map((incident) => incident.title)).toEqual(['Database upgrade']);
    expect(page.overall).toBe('maintenance');
    expect(hub.issues.filter((issue) => issue.labels.some((label) => (typeof label === 'string' ? label : label.name) === 'auto'))).toHaveLength(0);
    const attendance = page.components.find((component) => component.id === 'attendance')!;
    expect(attendance.days.at(-1)).toMatchObject({ down: 0, maint: 2 });
    expect(attendance.uptime).toBe(1);
  });

  it('asks GitHub with the ETag and fetches comments only for changed issues', async () => {
    hub.add({ title: 'Slow check-in', labels: ['status', 'minor'] });
    await minute();
    hub.requests = [];
    await minute();
    expect(hub.requests).toEqual(['GET /repos/owner/repo/issues?labels=status&state=all&sort=updated&direction=desc&per_page=30']);
    hub.addComment(1, 'Monitoring: better now.');
    hub.requests = [];
    await minute();
    expect(hub.requests.filter((request) => request.includes('/comments'))).toHaveLength(1);
    expect((await summary()).active[0]!.updates[0]!.stage).toBe('monitoring');
  });

  it('drops an issue from the page when the status label is removed', async () => {
    const issue = hub.add({ title: 'Wrong one', labels: ['status'] });
    await minute();
    expect((await summary()).active).toHaveLength(1);
    hub.issues = hub.issues.map((item) => (item.number === issue.number ? { ...item, labels: [{ name: 'bug' }], updated_at: new Date(clock.t + 5).toISOString() } : item));
    hub.addComment(issue.number, 'x');
    await minute();
    expect((await summary()).active).toHaveLength(0);
  });
});
