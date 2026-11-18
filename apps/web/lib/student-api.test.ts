import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LectureRequestError, type CheckInWaiting } from './lecture-api';
import { registerFace } from './student-api';

const problem = (status: number) => JSON.stringify({ type: 'about:blank', title: 'Service unavailable', status });
const busy = (seconds: number) => new Response(problem(503), { status: 503, headers: { 'retry-after': String(seconds) } });
const registered = () => new Response(JSON.stringify({ status: 'registered', enrolledAt: new Date().toISOString() }), { status: 201 });
const frames = [
  { pose: 'front' as const, image: 'A'.repeat(1200) },
  { pose: 'left' as const, image: 'B'.repeat(1200) },
  { pose: 'right' as const, image: 'C'.repeat(1200) },
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('registering a face while the server is busy', () => {
  it('sends the same photos again by itself, telling the page how long it waits', async () => {
    const bodies: string[] = [];
    const answers = [busy(4), busy(4), registered()];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return answers.shift()!;
    }));
    const waiting: CheckInWaiting[] = [];
    const outcome = registerFace(frames, { onWaiting: (state) => waiting.push(state) });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(outcome).resolves.toMatchObject({ status: 'registered' });
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
    expect(waiting.map(({ busy: isBusy, attempt }) => ({ busy: isBusy, attempt }))).toEqual([{ busy: true, attempt: 1 }, { busy: true, attempt: 2 }]);
    expect(waiting[0]!.retryInSeconds).toBeGreaterThanOrEqual(4);
  });

  it('shows any other failure at once, even a dropped connection (the photos may have been saved)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(problem(504), { status: 504 })));
    const outcome = registerFace(frames).then(() => 'saved', (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toBeInstanceOf(LectureRequestError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
