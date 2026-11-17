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

describe('the match lines at check-in', () => {
  // Registered: straight on, and turned each way. Today's straight photo scores
  // `similarity` against the registered straight one; today's turned photo is
  // given separately so each line can be tried on its own.
  async function checkIn(similarity: number, turned: number[] | 'same') {
    const today = signature(similarity, 5);
    const shots = shotsFrom({
      front: { yaw: 0, embedding: signature(1, 1) },
      left: { yaw: -0.4, embedding: signature(0.66, 2) },
      right: { yaw: 0.4, embedding: signature(0.66, 3) },
      today: { yaw: 0, embedding: today },
      turned: { yaw: 0.4, embedding: turned === 'same' ? today : turned },
    });
    const verifier = new FaceVerifier({ engine: async () => engineFor(shots) });
    const enrolment = await verifier.enrol([
      { pose: 'front', image: photo('front') },
      { pose: 'left', image: photo('left') },
      { pose: 'right', image: photo('right') },
    ]);
    return verifier.verify({
      frames: [{ pose: 'front', image: photo('today') }, { pose: 'right', image: photo('turned') }],
      turn: 'right',
      templates: enrolment.templates,
      model: enrolment.model,
    });
  }

  it('pass at 0.60, clear at 0.68, and a review band between', () => {
    expect(FACE_LIMITS.match).toBe(0.6);
    expect(FACE_LIMITS.clearMatch).toBe(0.68);
    // Nobody can register a face that would pass as someone else's.
    expect(FACE_LIMITS.duplicate).toBe(FACE_LIMITS.match);
  });

  it('refuses a lookalike just under the pass line (like the 0.551 seen in real use)', async () => {
    await expect(checkIn(0.551, 'same')).rejects.toMatchObject({ reason: 'mismatch' });
    await expect(checkIn(FACE_LIMITS.match - 0.001, 'same')).rejects.toMatchObject({ reason: 'mismatch' });
  });

  it('passes from the pass line, keeping a photo for review below the clear line', async () => {
    const close = await checkIn(FACE_LIMITS.match + 0.001, 'same');
    expect(close).toMatchObject({ needsReview: true });
    expect(close.photo).not.toBeNull();
    expect(await checkIn(FACE_LIMITS.clearMatch - 0.001, 'same')).toMatchObject({ needsReview: true });
    const clear = await checkIn(FACE_LIMITS.clearMatch + 0.001, 'same');
    expect(clear).toMatchObject({ needsReview: false, photo: null });
  });

  it('refuses when the turned photo does not look like the registered face', async () => {
    // The same person as today's straight photo (so one capture), but below the
    // turned line against every registered photo: the hardest different person
    // turned measured 0.484.
    await expect(checkIn(1, signature(0.52, 6))).rejects.toMatchObject({ reason: 'mismatch' });
    expect(await checkIn(1, signature(FACE_LIMITS.turnMatch + 0.01, 6))).toMatchObject({ needsReview: false });
  });
});
