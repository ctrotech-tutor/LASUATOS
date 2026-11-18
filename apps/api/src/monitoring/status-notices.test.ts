import { describe, expect, it, vi } from 'vitest';
import { NOTICE_STALE_LIMIT, NOTICE_TTL, StatusNoticeSource } from './status-notices.js';

const url = 'https://status.example.net';
const notice = {
  id: 'gh-12',
  kind: 'incident',
  impact: 'major',
  title: 'Emails are delayed',
  message: 'Sign-in codes are slow to arrive. Use Continue with Google meanwhile.',
  startsAt: null,
  endsAt: null,
  updatedAt: '2026-11-10T09:00:00.000Z',
  url: `${url}/incidents/gh-12`,
};

function answering(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('status page notices for the app banner (ADR 034)', () => {
  it('is empty and makes no request when no status page is set', async () => {
    const fetcher = answering({ notices: [notice] });
    const source = new StatusNoticeSource({ statusPageUrl: undefined, fetch: fetcher });
    expect(await source.current()).toEqual({ statusPageUrl: null, notices: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads the notices, keeps only well-formed ones that link to the status page, and reuses them for a minute', async () => {
    let clock = 0;
    const fetcher = answering({ notices: [notice, { ...notice, id: 'x', url: 'https://evil.example/phish' }, { title: 'broken' }] });
    const source = new StatusNoticeSource({ statusPageUrl: `${url}/`, fetch: fetcher, now: () => clock });
    expect(await source.current()).toEqual({ statusPageUrl: url, notices: [notice] });
    expect(fetcher).toHaveBeenCalledWith(`${url}/api/notices.json`, expect.objectContaining({ redirect: 'error' }));
    clock += NOTICE_TTL - 1;
    await source.current();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good answer for a while when the status page is unreachable, then shows nothing', async () => {
    let clock = 0;
    let fail = false;
    const fetcher = vi.fn(async () => {
      if (fail) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ notices: [notice] }));
    });
    const source = new StatusNoticeSource({ statusPageUrl: url, fetch: fetcher, now: () => clock });
    await source.current();
    fail = true;
    clock += NOTICE_TTL + 1;
    expect((await source.current()).notices).toHaveLength(1);
    clock += NOTICE_STALE_LIMIT;
    expect((await source.current()).notices).toEqual([]);
  });

  it('never throws on a bad answer', async () => {
    const source = new StatusNoticeSource({ statusPageUrl: url, fetch: answering('not json at all', 500) });
    await expect(source.current()).resolves.toEqual({ statusPageUrl: url, notices: [] });
  });
});
