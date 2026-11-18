import { beforeEach, describe, expect, it } from 'vitest';
import { refreshSummary } from './checker.ts';
import { handle } from './index.ts';
import type { Incident } from './incidents.ts';
import { Store } from './store.ts';
import { memoryD1, testEnv } from './test-support.ts';

const NOW = Date.UTC(2026, 10, 10, 12, 0);

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'gh-9', number: 9, kind: 'incident', impact: 'major', title: 'Check-in <b>fails</b>', components: ['attendance'], automatic: false,
    createdAt: NOW - 20 * 60_000, resolvedAt: null, startsAt: null, endsAt: null,
    updates: [{ at: NOW - 5 * 60_000, stage: 'identified', body: 'Found it. <script>alert(1)</script>' }],
    ...overrides,
  };
}

describe('status page routes', () => {
  let db: ReturnType<typeof memoryD1>;
  const get = (path: string, method = 'GET') => handle(new Request(`https://status.test${path}`, { method }), testEnv(db), NOW);

  beforeEach(async () => {
    db = memoryD1();
    const store = new Store(db);
    await store.ready();
    await store.batch([store.saveIncident(incident(), 'x')]);
    await refreshSummary(store, NOW);
  });

  it('serves the page with a strict policy and a matching script nonce', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const policy = response.headers.get('content-security-policy')!;
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    const nonce = /'nonce-([^']+)'/.exec(policy)![1]!;
    const html = await response.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain('LASUATOS is having a major problem');
    expect(html).toContain('Check-in &lt;b&gt;fails&lt;/b&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Attendance check-in');
    expect(html).toContain('href="https://lasuatos.test"');
    expect((await get('/')).headers.get('content-security-policy')).not.toBe(policy);
  });

  it('serves an incident page, history and a 404', async () => {
    const page = await get('/incidents/gh-9');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Identified');
    expect((await get('/incidents/gh-10')).status).toBe(404);
    expect((await get('/incidents/../../etc')).status).toBe(404);
    expect((await get('/history')).status).toBe(200);
  });

  it('serves JSON for the app banner and other tools, open to any origin', async () => {
    const notices = await get('/api/notices.json');
    expect(notices.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await notices.json()) as { statusPageUrl: string; notices: Array<{ id: string; url: string }> };
    expect(body.statusPageUrl).toBe('https://status.test');
    expect(body.notices).toEqual([expect.objectContaining({ id: 'gh-9', url: 'https://status.test/incidents/gh-9' })]);
    const status = (await (await get('/api/status.json')).json()) as { status: string; components: unknown[] };
    expect(status.status).toBe('down');
    expect(status.components).toHaveLength(6);
  });

  it('serves the feed, badge, icon and robots', async () => {
    const feed = await (await get('/feed.atom')).text();
    expect(feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(feed).toContain('Identified: Check-in &lt;b&gt;fails&lt;/b&gt;');
    expect(feed).not.toContain('<script>');
    expect(await (await get('/badge.svg')).text()).toContain('outage');
    expect((await get('/favicon.svg')).headers.get('content-type')).toBe('image/svg+xml');
    expect(await (await get('/robots.txt')).text()).toContain('Allow: /');
  });

  it('only accepts reads', async () => {
    expect((await get('/', 'POST')).status).toBe(405);
    expect((await get('/', 'OPTIONS')).status).toBe(204);
  });

  it('builds the summary itself before the first run', async () => {
    db = memoryD1();
    const html = await (await get('/')).text();
    expect(html).toContain('Everything is working');
    expect(html).toContain('Waiting for the first check');
  });
});
