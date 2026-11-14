import { createHash } from 'node:crypto';
import type { FaceAnalysis, FaceEngine } from '@lasuatos/face';

/**
 * A stand-in for the face models that reads what a "photo" shows from the
 * photo itself, so the rules around faces (poses, liveness, matching,
 * duplicates) are tested without camera images.
 */

/** A deterministic 128-number signature per person, nudged a little per photo. */
export function signature(person: string, jitter: number): number[] {
  const values: number[] = [];
  for (let block = 0; values.length < 128; block += 1) {
    const digest = createHash('sha256').update(`${person}:${block}`).digest();
    for (const byte of digest) values.push(byte / 255 - 0.5);
  }
  const noise = createHash('sha256').update(`noise:${person}:${jitter}`).digest();
  const out = values.slice(0, 128).map((value, index) => value + ((noise[index % 32]! / 255) - 0.5) * 0.25);
  const length = Math.hypot(...out);
  return out.map((value) => value / length);
}

/** `blend` mixes in another person's signature, to make a close (not clear) match. */
export interface FakePhoto { person: string; yaw: number; live?: number; faces?: number; jitter?: number; blend?: { person: string; weight: number } }

function photoSignature(details: FakePhoto): number[] {
  const jitter = details.jitter ?? Math.round(details.yaw * 100);
  const own = signature(details.person, jitter);
  if (!details.blend) return own;
  const { person, weight } = details.blend;
  const other = signature(person, jitter);
  const mixed = own.map((value, index) => (1 - weight) * value + weight * other[index]!);
  const length = Math.hypot(...mixed);
  return mixed.map((value) => value / length);
}

export function photo(details: FakePhoto): string {
  return Buffer.from(JSON.stringify(details).padEnd(1200, ' ')).toString('base64');
}

export const fakeEngine: FaceEngine = {
  modelId: 'sface-2021dec',
  async warm() {},
  async analyze(bytes: Uint8Array): Promise<FaceAnalysis> {
    const details = JSON.parse(Buffer.from(bytes).toString('utf8')) as FakePhoto;
    return {
      width: 640,
      height: 480,
      faceCount: details.faces ?? 1,
      face: {
        score: 0.95,
        box: { x: 200, y: 100, width: 220, height: 260 },
        yaw: details.yaw,
        pitch: 0.12,
        roll: 0.02,
        real: 0.6,
        live: details.live ?? 0.97,
        sizeRatio: 0.34,
        brightness: 120,
        sharpness: 3000,
        embedding: photoSignature(details),
      },
      portrait: Buffer.from(`portrait:${details.person}`),
    };
  },
};

export const capture = (person: string, poses: ReadonlyArray<'front' | 'left' | 'right'> = ['front', 'left', 'right'], extra: Partial<FakePhoto> = {}) =>
  poses.map((pose) => ({ pose, image: photo({ person, yaw: pose === 'front' ? 0.02 : pose === 'right' ? 0.4 : -0.4, ...extra }) }));
