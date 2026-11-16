import type { FaceAnalysis, FaceEngine } from '@lasuatos/face';
import { describe, expect, it } from 'vitest';
import { FACE_LIMITS, FaceVerifier, cosine, sameCaptureFloor } from './face.js';

/**
 * The capture rules with a stand-in engine, so each similarity is exact:
 * a photo is named by its text, and its signature is `similarity` along a
 * shared direction plus its own direction, so two photos made from the same
 * person score the product of their similarities to the straight photo.
 */
const LENGTH = 128;
function signature(similarity: number, axis: number): number[] {
  const vector = new Array<number>(LENGTH).fill(0);
  vector[0] = similarity;
  vector[axis] = Math.sqrt(1 - similarity * similarity);
  return vector;
}

interface Shot { readonly yaw: number; readonly embedding: number[] }

function engineFor(shots: Record<string, Shot>): FaceEngine {
  return {
    modelId: 'sface-2021dec',
    warm: async () => undefined,
    analyze: async (bytes: Uint8Array): Promise<FaceAnalysis> => {
      const shot = shots[Buffer.from(bytes).toString()]!;
      return {
        width: 640,
        height: 640,
        faceCount: 1,
        portrait: Buffer.from('ffd8ffe0', 'hex'),
        face: {
          score: 0.99, box: { x: 200, y: 200, width: 240, height: 300 },
          yaw: shot.yaw, pitch: 0, roll: 0, real: 0.9, live: 0.99,
          sizeRatio: 0.4, brightness: 120, sharpness: 500, embedding: shot.embedding,
        },
      };
    },
  };
}

const photo = (name: string) => Buffer.from(name.padEnd(8, '.')).toString('base64');
const shotsFrom = (shots: Record<string, Shot>) => Object.fromEntries(Object.entries(shots).map(([name, shot]) => [name.padEnd(8, '.'), shot]));

describe('photos taken in one go', () => {
  it('eases the bar for a bigger turn, never below the wide limit', () => {
    expect(sameCaptureFloor(0)).toBe(FACE_LIMITS.sameCapture);
    expect(sameCaptureFloor(-0.45)).toBe(FACE_LIMITS.sameCapture);
    expect(sameCaptureFloor(0.625)).toBeCloseTo(0.475, 5);
    expect(sameCaptureFloor(-0.8)).toBe(FACE_LIMITS.sameCaptureWide);
    expect(sameCaptureFloor(1.2)).toBe(FACE_LIMITS.sameCaptureWide);
  });

  it('registers one person whose left and right photos look unlike each other', async () => {
    const shots = shotsFrom({
      front: { yaw: 0.02, embedding: signature(1, 1) },
      left: { yaw: -0.5, embedding: signature(0.6, 2) },
      right: { yaw: 0.5, embedding: signature(0.58, 3) },
    });
    // Opposite sides of one face: well under the old all-pairs bar.
    expect(cosine(shots['left....']!.embedding, shots['right...']!.embedding)).toBeLessThan(FACE_LIMITS.sameCapture);
    const verifier = new FaceVerifier({ engine: async () => engineFor(shots) });
    const enrolment = await verifier.enrol([
      { pose: 'front', image: photo('front') },
      { pose: 'left', image: photo('left') },
      { pose: 'right', image: photo('right') },
    ]);
    expect(enrolment.templates).toHaveLength(3);
  });

  it('accepts a big turn a little under the straight bar, but not a small one', async () => {
    const shots = shotsFrom({
      front: { yaw: 0, embedding: signature(1, 1) },
      left: { yaw: -0.3, embedding: signature(0.7, 2) },
      wide: { yaw: 0.78, embedding: signature(0.47, 3) },
      small: { yaw: 0.4, embedding: signature(0.47, 4) },
    });
    const verifier = new FaceVerifier({ engine: async () => engineFor(shots) });
    await expect(verifier.enrol([
      { pose: 'front', image: photo('front') },
      { pose: 'left', image: photo('left') },
      { pose: 'right', image: photo('wide') },
    ])).resolves.toMatchObject({ model: 'sface-2021dec' });
    await expect(verifier.enrol([
      { pose: 'front', image: photo('front') },
      { pose: 'left', image: photo('left') },
      { pose: 'right', image: photo('small') },
    ])).rejects.toMatchObject({ reason: 'mixed_people', message: expect.stringContaining('turned to your right') });
  });

  it('still refuses someone else turning, however far', async () => {
    const shots = shotsFrom({
      front: { yaw: 0, embedding: signature(1, 1) },
      left: { yaw: -0.4, embedding: signature(0.66, 2) },
      // The hardest impostor measured straight vs turned scored 0.484 at 0.45 rad.
      other: { yaw: 0.45, embedding: signature(0.484, 3) },
      stranger: { yaw: 0.9, embedding: signature(0.4, 4) },
    });
    const verifier = new FaceVerifier({ engine: async () => engineFor(shots) });
    for (const name of ['other', 'stranger']) {
      await expect(verifier.enrol([
        { pose: 'front', image: photo('front') },
        { pose: 'left', image: photo('left') },
        { pose: 'right', image: photo(name) },
      ])).rejects.toMatchObject({ reason: 'mixed_people' });
    }
  });

  it('checks in with a big turn that matches the registered face', async () => {
    const shots = shotsFrom({
      front: { yaw: 0, embedding: signature(1, 1) },
      left: { yaw: -0.5, embedding: signature(0.62, 2) },
      right: { yaw: 0.5, embedding: signature(0.6, 3) },
      // Today's right turn is bigger: further from the straight photo, close to the registered right turn.
      today: { yaw: 0.78, embedding: [0.47, 0, 0, Math.sqrt(1 - 0.47 * 0.47), ...new Array<number>(LENGTH - 4).fill(0)] },
    });
    const verifier = new FaceVerifier({ engine: async () => engineFor(shots) });
    const enrolment = await verifier.enrol([
      { pose: 'front', image: photo('front') },
      { pose: 'left', image: photo('left') },
      { pose: 'right', image: photo('right') },
    ]);
    const verdict = await verifier.verify({
      frames: [{ pose: 'front', image: photo('front') }, { pose: 'right', image: photo('today') }],
      turn: 'right',
      templates: enrolment.templates,
      model: enrolment.model,
    });
    expect(verdict.score).toBeGreaterThanOrEqual(FACE_LIMITS.clearMatch);
  });
});
