// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaceFrame } from '@lasuatos/contracts';

// No on-device tracker in tests: the camera falls back to its countdown mode, which takes the
// photos on a timer. The server's face engine is not woken.
vi.mock('../lib/face-tracker', () => ({
  loadFaceLandmarker: () => Promise.reject(new Error('no tracker in tests')),
  observeFace: () => null,
}));
vi.mock('../lib/student-api', () => ({ warmFaceChecks: () => undefined }));

const { FaceCapture } = await import('./face-capture');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root;
let host: HTMLElement;

function fakeCamera() {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get: () => null, set: () => undefined });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage: () => undefined, getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }) }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value(callback: BlobCallback) { setTimeout(() => callback(new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' })), 5); },
  });
  return { stop };
}

async function wait(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

const text = () => document.body.textContent ?? '';

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('FaceCapture without a review step (check-in)', () => {
  it('hands the photos over after "All done" instead of staying on "Checking your photos…"', async () => {
    const { stop } = fakeCamera();
    const onDone = vi.fn<(frames: FaceFrame[]) => void>();
    await act(async () => {
      root.render(createElement(FaceCapture, { poses: ['front', 'left'], title: 'Confirm it’s you', review: false, onDone, onCancel: () => undefined }));
    });
    // Camera on, tracker unavailable: the countdown runs (half a second, 3 s, then 2 s).
    await wait(500 + 3_000 + 2_000 + 100);
    expect(text()).toContain('Checking your photos');
    expect(stop).toHaveBeenCalled();
    await wait(600);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]![0].map((frame) => frame.pose)).toEqual(['front', 'left']);
    expect(onDone.mock.calls[0]![0].every((frame) => frame.image.length > 0)).toBe(true);
  });

  it('keeps its place when the page behind it re-renders with a new onDone', async () => {
    fakeCamera();
    const calls: FaceFrame[][] = [];
    const render = () => root.render(createElement(FaceCapture, {
      poses: ['front', 'right'],
      title: 'Register your face',
      review: false,
      // A new function every render, as parents write it.
      onDone: (frames: FaceFrame[]) => { calls.push(frames); },
      onCancel: () => undefined,
    }));
    await act(async () => { render(); });
    await wait(500 + 2_000);
    await act(async () => { render(); }); // mid-countdown
    await wait(1_000 + 2_000 + 100);
    await act(async () => { render(); }); // on "All done"
    await wait(600);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((frame) => frame.pose)).toEqual(['front', 'right']);
  });

  it('offers Cancel if the hand-over is ever slow', async () => {
    fakeCamera();
    const onCancel = vi.fn();
    // A parent that never closes the camera after the photos arrive.
    await act(async () => {
      root.render(createElement(FaceCapture, { poses: ['front', 'left'], title: 'Confirm it’s you', review: false, onDone: () => undefined, onCancel }));
    });
    await wait(500 + 3_000 + 2_000 + 100);
    const cancel = () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Cancel');
    expect(cancel()).toBeUndefined();
    await wait(8_100);
    expect(text()).toContain('taking too long');
    act(() => cancel()!.click());
    expect(onCancel).toHaveBeenCalled();
  });
});
