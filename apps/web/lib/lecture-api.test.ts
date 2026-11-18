import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiRequest,
  CHECK_IN_RETRY_WINDOW_MS,
  LectureRequestError,
  nextCheckInRetry,
  REQUEST_TIMEOUT_MS,
  submitLectureCheckIn,
  type CheckInWaiting,
} from './lecture-api';

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

describe('check-in during the lecture-start rush', () => {
  const problem = (status: number) => JSON.stringify({ type: 'about:blank', title: 'Service unavailable', status });
  const busy = (seconds: number) => new Response(problem(503), { status: 503, headers: { 'retry-after': String(seconds) } });
  const saved = () => new Response(JSON.stringify({
    status: 'checked_in',
    courseCode: 'CSC 301',
    courseTitle: 'Operating Systems',
    fullName: 'Ada Obi',
    matricNumber: '240591001',
    checkedInAt: new Date().toISOString(),
    venueOutcome: null,
    locationAccuracyMeters: null,
    faceScore: 0.8,
  }), { status: 201 });

  it('waits as the server asks when it is busy, longer each time, with a little random spread', () => {
    const state = { busy: 0, other: 0 };
    const error = new LectureRequestError(503, 'busy', 4);
    expect(nextCheckInRetry(error, state, 0, () => 0)).toEqual({ delayMs: 4_000, busy: true });
    // The second "busy": 4.5 s by the growing wait, more than the 4 s asked.
    expect(nextCheckInRetry(error, state, 10_000, () => 0)).toEqual({ delayMs: 4_500, busy: true });
    // Never more than a quarter extra at random.
    expect(nextCheckInRetry(error, state, 20_000, () => 1)?.delayMs).toBe(Math.round(6_750 * 1.25));
    // The growing wait stops at 30 s; a longer Retry-After (up to 60 s) is still honoured.
    expect(nextCheckInRetry(error, { busy: 20, other: 0 }, 0, () => 0)?.delayMs).toBe(30_000);
    expect(nextCheckInRetry(new LectureRequestError(503, 'busy', 45), { busy: 0, other: 0 }, 0, () => 0)?.delayMs).toBe(45_000);
  });

  it('tries a dropped connection, a timeout or a gateway error again three times', () => {
    const state = { busy: 0, other: 0 };
    for (const [status, delay] of [[0, 2_000], [504, 4_000], [502, 8_000]] as const) {
      expect(nextCheckInRetry(new LectureRequestError(status, 'x'), state, 0, () => 0)).toEqual({ delayMs: delay, busy: false });
    }
    expect(nextCheckInRetry(new LectureRequestError(0, 'x'), state, 0, () => 0)).toBeNull();
  });

  it('never sends again after a real answer, or past three minutes', () => {
    for (const status of [400, 403, 409, 410, 422, 429, 500]) {
      expect(nextCheckInRetry(new LectureRequestError(status, 'x', 5), { busy: 0, other: 0 }, 0)).toBeNull();
    }
    expect(nextCheckInRetry(new Error('x'), { busy: 0, other: 0 }, 0)).toBeNull();
    expect(nextCheckInRetry(new LectureRequestError(503, 'busy', 10), { busy: 0, other: 0 }, CHECK_IN_RETRY_WINDOW_MS - 5_000, () => 0)).toBeNull();
  });

  it('sends the same photos again by itself until they are saved, telling the page it is waiting', async () => {
    const bodies: string[] = [];
    const answers = [busy(3), new Response(problem(504), { status: 504 }), saved()];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return answers.shift()!;
    }));
    const waiting: CheckInWaiting[] = [];
    const frames = [{ pose: 'front' as const, image: 'A'.repeat(1200) }, { pose: 'right' as const, image: 'B'.repeat(1200) }];
    const outcome = submitLectureCheckIn({ ticket: 'ticket-1', face: { frames } }, { onWaiting: (state) => waiting.push(state) });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(outcome).resolves.toMatchObject({ status: 'checked_in' });
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
    expect(waiting.map(({ busy, attempt }) => ({ busy, attempt }))).toEqual([{ busy: true, attempt: 1 }, { busy: false, attempt: 2 }]);
    expect(waiting[0]!.retryInSeconds).toBeGreaterThanOrEqual(3);
  });

  it('stops waiting when the page is left', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => busy(10)));
    const controller = new AbortController();
    const outcome = submitLectureCheckIn({ ticket: 'ticket-1' }, { signal: controller.signal }).then(() => 'saved', (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    const error = await outcome;
    expect(error).toBeInstanceOf(DOMException);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives up with the busy answer after three minutes of busy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => busy(30)));
    const outcome = submitLectureCheckIn({ ticket: 'ticket-1' }).then(() => 'saved', (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(CHECK_IN_RETRY_WINDOW_MS + 60_000);
    const error = await outcome;
    expect(error).toMatchObject({ status: 503, retryAfterSeconds: 30 });
    const sends = vi.mocked(fetch).mock.calls.length;
    expect(sends).toBeGreaterThan(3);
    expect(sends).toBeLessThan(10);
  });
});
