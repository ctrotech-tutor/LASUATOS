import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { FACE_LIMITS, FaceCheckError, FaceVerifier, cosine, loadFaceEngine, turnForTicket } from './face.js';

/**
 * The face rules with the real models (Human + SFace) on the fictional,
 * AI-generated test faces in packages/face/test/fixtures:
 *   a1  a man facing the camera     a2  the same man turned to his right
 *   a3  a2 mirrored (turned to his left)
 *   b1, b2  one woman                c1  another man
 */
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/face/test/fixtures');
const image = async (name: string) => (await readFile(path.join(fixtures, `${name}.jpg`))).toString('base64');

describe('face checks with the real models', () => {
  const verifier = new FaceVerifier({ engine: loadFaceEngine });
  const photos: Record<string, string> = {};

  beforeAll(async () => {
    for (const name of ['a1', 'a2', 'a3', 'b1', 'b2', 'c1']) photos[name] = await image(name);
    await verifier.modelId();
  }, 60_000);

  it('registers three poses of one person and refuses the wrong pose or a mix of people', async () => {
    const enrolment = await verifier.enrol([
      { pose: 'front', image: photos.a1! },
      { pose: 'right', image: photos.a2! },
      { pose: 'left', image: photos.a3! },
    ]);
    expect(enrolment.model).toBe('sface-2021dec');
    expect(enrolment.templates).toHaveLength(3);
    expect(enrolment.templates[0]).toHaveLength(128);
    expect(enrolment.photo.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(enrolment.quality.rightYaw).toBeGreaterThan(FACE_LIMITS.turnYaw);
    expect(enrolment.quality.leftYaw).toBeLessThan(-FACE_LIMITS.turnYaw);

    // Turned the wrong way: a2 is turned to his right, not his left.
    await expect(verifier.enrol([
      { pose: 'front', image: photos.a1! },
      { pose: 'right', image: photos.a2! },
      { pose: 'left', image: photos.a2! },
    ])).rejects.toMatchObject({ reason: 'turn_missing' });
    // A turned head is not a photo facing the camera.
    await expect(verifier.enrol([
      { pose: 'front', image: photos.a2! },
      { pose: 'right', image: photos.a2! },
      { pose: 'left', image: photos.a3! },
    ])).rejects.toMatchObject({ reason: 'not_front' });
  }, 60_000);

  it('matches the same person and keeps similar-looking people apart', async () => {
    const enrolment = await verifier.enrol([
      { pose: 'front', image: photos.b1! },
      { pose: 'right', image: photos.a2! },
      { pose: 'left', image: photos.a3! },
    ]).catch((error: unknown) => error);
    expect(enrolment).toBeInstanceOf(FaceCheckError);
    expect((enrolment as FaceCheckError).reason).toBe('mixed_people');

    const a = await verifier.enrol([
      { pose: 'front', image: photos.a1! },
      { pose: 'right', image: photos.a2! },
      { pose: 'left', image: photos.a3! },
    ]);
    // The same man passes a check-in.
    const verdict = await verifier.verify({
      frames: [{ pose: 'front', image: photos.a1! }, { pose: 'right', image: photos.a2! }],
      turn: 'right',
      templates: a.templates,
      model: a.model,
    });
    expect(verdict.score).toBeGreaterThanOrEqual(FACE_LIMITS.clearMatch);
    // Someone else facing the camera is refused, whoever they are.
    for (const other of ['b1', 'b2', 'c1']) {
      await expect(verifier.verify({
        frames: [{ pose: 'front', image: photos[other]! }, { pose: 'right', image: photos.a2! }],
        turn: 'right',
        templates: a.templates,
        model: a.model,
      })).rejects.toMatchObject({ reason: expect.stringMatching(/mixed_people|mismatch/) });
    }
    // The other man's centroid is not taken for a duplicate of this one.
    const c = await verifier.enrol([
      { pose: 'front', image: photos.c1! },
      { pose: 'right', image: photos.a2! },
      { pose: 'left', image: photos.a3! },
    ]).catch(() => null);
    expect(c).toBeNull();
    expect(verifier.duplicateOf(a.centroid, [{ centroid: a.centroid }])?.score).toBeCloseTo(1, 3);
  }, 90_000);

  it('the same woman scores as a match; different people stay below the match line', async () => {
    const engine = await loadFaceEngine();
    const embedding = async (name: string) => (await engine.analyze(Buffer.from(photos[name]!, 'base64'))).face!.embedding;
    const [a1, b1, b2, c1] = await Promise.all(['a1', 'b1', 'b2', 'c1'].map(embedding));
    expect(cosine(b1!, b2!)).toBeGreaterThanOrEqual(FACE_LIMITS.clearMatch);
    for (const [x, y] of [[a1, b1], [a1, b2], [a1, c1], [b1, c1], [b2, c1]] as const) {
      expect(cosine(x!, y!)).toBeLessThan(FACE_LIMITS.match);
    }
  }, 60_000);

  it('picks the turn from the check-in ticket', () => {
    const turns = new Set(Array.from({ length: 40 }, (_, index) => turnForTicket(`ticket-${index}`)));
    expect(turns).toEqual(new Set(['left', 'right']));
    expect(turnForTicket('same')).toBe(turnForTicket('same'));
  });
});
