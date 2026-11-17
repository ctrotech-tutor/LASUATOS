import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, LectureRequestError, REQUEST_TIMEOUT_MS } from './lecture-api';

const Anything = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };

/** A fetch that never answers until its signal aborts, like a stalled phone connection. */
function stalledFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new DOMException('Aborted', 'AbortError')));
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('gives up on a stalled connection with a message, instead of spinning forever', async () => {
    vi.stubGlobal('fetch', stalledFetch());
    const pending = apiRequest('/api/v1/lecture/check-in', Anything, { json: { ticket: 't' } });
    const outcome = pending.then(() => 'answered', (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(LectureRequestError);
    expect((error as LectureRequestError).status).toBe(0);
    expect((error as LectureRequestError).message).toMatch(/taking too long/);
  });

  it('waits longer than the server ever does', () => {
    // The API function is cut off at 30 seconds; the client must not give up first.
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it('still lets the page cancel its own request', async () => {
    vi.stubGlobal('fetch', stalledFetch());
    const controller = new AbortController();
    const outcome = apiRequest('/api/v1/lecture/sessions', Anything, { signal: controller.signal }).then(() => 'answered', (error: unknown) => error);
    controller.abort();
    const error = await outcome;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('reads answers and server messages as before', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(apiRequest('/x', Anything)).resolves.toEqual({ ok: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Your face did not match.' }), { status: 403 })));
    await expect(apiRequest('/x', Anything)).rejects.toMatchObject({ status: 403, message: 'Your face did not match.' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(apiRequest('/x', Anything)).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/No connection/) });
  });
});

describe('conditional polls', () => {
  it('sends the tag back and hands back the very same answer on 304', async () => {
    const calls: Headers[] = [];
    let reply = () => new Response(JSON.stringify({ roster: ['Ada'] }), { status: 200, headers: { etag: 'W/"one"' } });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(new Headers(init?.headers));
      return reply();
    }));
    const first = await apiRequest('/api/v1/lecture/sessions/s1', Anything);
    expect(calls[0]?.get('if-none-match')).toBeNull();

    reply = () => new Response(null, { status: 304, headers: { etag: 'W/"one"' } });
    const second = await apiRequest('/api/v1/lecture/sessions/s1', Anything);
    expect(calls[1]?.get('if-none-match')).toBe('W/"one"');
    // The same object: a screen comparing answers sees nothing changed and does not redraw.
    expect(second).toBe(first);

    reply = () => new Response(JSON.stringify({ roster: ['Ada', 'Bola'] }), { status: 200, headers: { etag: 'W/"two"' } });
    const third = await apiRequest('/api/v1/lecture/sessions/s1', Anything);
    expect(third).toEqual({ roster: ['Ada', 'Bola'] });
    await apiRequest('/api/v1/lecture/sessions/s1', Anything);
    expect(calls[3]?.get('if-none-match')).toBe('W/"two"');
  });

  it('never makes writes or other schemas conditional', async () => {
    const calls: Headers[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(new Headers(init?.headers));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { etag: 'W/"x"' } });
    }));
    await apiRequest('/api/v1/thing', Anything);
    await apiRequest('/api/v1/thing', Anything, { json: { a: 1 } });
    expect(calls[1]?.get('if-none-match')).toBeNull();
    const Other = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };
    await apiRequest('/api/v1/thing', Other);
    expect(calls[2]?.get('if-none-match')).toBeNull();
  });
});
