import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FacePose, FaceTurn } from '@lasuatos/contracts';
import type { FaceAnalysis, FaceEngine, MeasuredFace } from '@lasuatos/face';

/**
 * Face checks for student registration and lecture check-in.
 *
 * Signatures come from OpenCV's SFace model (128 numbers, compared by cosine
 * similarity); detection, head pose and the liveness scores come from Human.
 * The limits below were set from measurements on real and generated faces
 * (see docs/FACE_VERIFICATION.md): different people of similar appearance
 * scored up to 0.48, the same person 0.62–0.82 facing the camera.
 */
export const FACE_LIMITS = {
  /**
   * A check-in passes when the photo facing the camera is at least this
   * similar to the registered face (the hardest impostor measured: 0.48).
   */
  match: 0.52,
  /** The turned photo must also look like the registered face, at least this much. */
  turnMatch: 0.45,
  /** Below this (but at least `match`) the check-in passes and a photo is kept for review. */
  clearMatch: 0.6,
  /**
   * Photos taken in one go must be of one person: above the hardest impostor
   * pair measured (0.48), below the same person facing vs turned (about 0.67).
   */
  sameCapture: 0.5,
  /** A new registration this close to another student's face is refused. */
  duplicate: 0.62,
  /** Liveness model (1 = live). Real faces score 0.86–1.00. */
  live: 0.5,
  /** Anti-spoof model (1 = real). Weak on its own, so the bar is low. */
  real: 0.3,
  detector: 0.6,
  /** Face width as a share of the photo width. */
  minSize: 0.16,
  maxSize: 0.9,
  minBrightness: 45,
  maxBrightness: 225,
  minSharpness: 200,
  /** Radians. Facing the camera: |yaw| up to this. */
  frontYaw: 0.2,
  frontPitch: 0.5,
  maxRoll: 0.4,
  /** A turned head: |yaw| at least this, and not a full profile. */
  turnYaw: 0.2,
  maxTurnYaw: 1.1,
} as const;

/** A face check failed for a reason the student can do something about. */
export class FaceCheckError extends Error {
  readonly exposeDetail = true;
  constructor(readonly statusCode: number, message: string, readonly reason: string) {
    super(message);
    this.name = 'FaceCheckError';
  }
}

/**
 * Which way to turn for a check-in, decided by the check-in ticket so the
 * server can confirm it without storing anything, and an old video of the
 * student turning one way passes only half the time on any scan.
 */
export function turnForTicket(ticket: string): FaceTurn {
  return (createHash('sha256').update(`face-turn:${ticket}`).digest()[0]! & 1) === 1 ? 'right' : 'left';
}

export interface FaceFrameInput {
  readonly pose: FacePose;
  /** Base64 JPEG. */
  readonly image: string;
}

export interface MeasuredFrame {
  readonly pose: FacePose;
  readonly face: MeasuredFace;
  readonly portrait: Buffer | null;
}

export interface Enrolment {
  readonly model: string;
  readonly templates: number[][];
  readonly centroid: number[];
  readonly photo: Buffer;
  readonly quality: Record<string, number>;
}

export interface FaceVerdict {
  readonly score: number;
  readonly real: number;
  readonly live: number;
  readonly needsReview: boolean;
  /** The front photo, kept only when `needsReview`. */
  readonly photo: Buffer | null;
}

const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

function normalized(vector: number[]): number[] {
  const length = Math.hypot(...vector);
  return length ? vector.map((value) => value / length) : vector;
}

function mean(vectors: readonly number[][]): number[] {
  const sum = new Array<number>(vectors[0]!.length).fill(0);
  for (const vector of vectors) vector.forEach((value, index) => { sum[index]! += value; });
  return normalized(sum.map((value) => value / vectors.length));
}

const poseWords: Record<FacePose, string> = {
  front: 'looking straight at the camera',
  left: 'turned to your left',
  right: 'turned to your right',
};

export interface FaceVerifierOptions {
  /** Loads the engine on first use (the models take a second or two to load). */
  readonly engine: () => Promise<FaceEngine>;
}

export class FaceVerifier {
  readonly #loadEngine: () => Promise<FaceEngine>;
  #engine: Promise<FaceEngine> | null = null;

  constructor(options: FaceVerifierOptions) {
    this.#loadEngine = options.engine;
  }

  #getEngine(): Promise<FaceEngine> {
    if (!this.#engine) {
      this.#engine = this.#loadEngine().catch((error: unknown) => {
        this.#engine = null;
        throw error;
      });
    }
    return this.#engine;
  }

  async modelId(): Promise<string> {
    return (await this.#getEngine()).modelId;
  }

  /** Measures one photo and checks the things every photo needs. */
  async #measure(frame: FaceFrameInput, portrait: boolean): Promise<MeasuredFrame> {
    const engine = await this.#getEngine().catch(() => {
      throw new FaceCheckError(503, 'Face checks are not available right now. Try again in a minute.', 'engine_unavailable');
    });
    const bytes = Buffer.from(frame.image, 'base64');
    let analysis: FaceAnalysis;
    try {
      analysis = await engine.analyze(bytes, { portrait });
    } catch {
      throw new FaceCheckError(422, 'The camera photo could not be read. Try again.', 'unreadable');
    }
    const face = analysis.face;
    const where = poseWords[frame.pose];
    if (!face || face.score < FACE_LIMITS.detector) {
      throw new FaceCheckError(422, `We could not see a face in the photo ${where}. Hold the phone at eye level in good light and try again.`, 'no_face');
    }
    if (analysis.faceCount > 1) {
      throw new FaceCheckError(422, 'More than one face is in the photo. Make sure only you are in the frame.', 'several_faces');
    }
    if (face.sizeRatio < FACE_LIMITS.minSize) throw new FaceCheckError(422, 'Your face is too small in the photo. Bring the phone closer.', 'too_far');
    if (face.sizeRatio > FACE_LIMITS.maxSize) throw new FaceCheckError(422, 'Your face is too close to the camera. Hold the phone a little further away.', 'too_close');
    if (face.brightness < FACE_LIMITS.minBrightness) throw new FaceCheckError(422, 'The photo is too dark. Face a window or a light and try again.', 'too_dark');
    if (face.brightness > FACE_LIMITS.maxBrightness) throw new FaceCheckError(422, 'The photo is too bright. Move out of direct light and try again.', 'too_bright');
    if (face.sharpness < FACE_LIMITS.minSharpness) throw new FaceCheckError(422, 'The photo is blurred. Hold the phone still and try again.', 'blurred');
    if (Math.abs(face.roll) > FACE_LIMITS.maxRoll) throw new FaceCheckError(422, 'Keep your head upright, not tilted to one side.', 'tilted');
    if (frame.pose === 'front') {
      if (Math.abs(face.yaw) > FACE_LIMITS.frontYaw || Math.abs(face.pitch) > FACE_LIMITS.frontPitch) {
        throw new FaceCheckError(422, 'Look straight at the camera for the first photo.', 'not_front');
      }
    } else {
      // Positive yaw = the person turned to their own right (in the camera's unmirrored image).
      const turned = frame.pose === 'right' ? face.yaw : -face.yaw;
      if (turned < FACE_LIMITS.turnYaw) {
        throw new FaceCheckError(422, `Turn your head a little more to your ${frame.pose} when asked.`, 'turn_missing');
      }
      if (turned > FACE_LIMITS.maxTurnYaw) {
        throw new FaceCheckError(422, `You turned too far. Turn your head only part of the way to your ${frame.pose}.`, 'turn_too_far');
      }
    }
    if (face.live < FACE_LIMITS.live || face.real < FACE_LIMITS.real) {
      throw new FaceCheckError(422, 'This did not look like a live face. Use the camera directly (not a photo or a screen), in good light.', 'not_live');
    }
    return { pose: frame.pose, face, portrait: analysis.portrait };
  }

  /** Every photo of one capture must be of the same person. */
  #assertSamePerson(frames: readonly MeasuredFrame[]): void {
    for (let i = 0; i < frames.length; i += 1) {
      for (let j = i + 1; j < frames.length; j += 1) {
        if (cosine(frames[i]!.face.embedding, frames[j]!.face.embedding) < FACE_LIMITS.sameCapture) {
          throw new FaceCheckError(422, 'The photos do not all look like the same person. Keep only your face in view and try again.', 'mixed_people');
        }
      }
    }
  }

  /**
   * Registration: a photo facing the camera, then turned left and right.
   * Returns what to store; the caller checks for duplicates.
   */
  async enrol(frames: readonly FaceFrameInput[]): Promise<Enrolment> {
    for (const pose of ['front', 'left', 'right'] as const) {
      if (!frames.some((frame) => frame.pose === pose)) {
        throw new FaceCheckError(422, 'Take all three photos: straight on, turned left and turned right.', 'missing_pose');
      }
    }
    const measured: MeasuredFrame[] = [];
    for (const frame of frames) measured.push(await this.#measure(frame, frame.pose === 'front'));
    this.#assertSamePerson(measured);
    const front = measured.filter((frame) => frame.pose === 'front');
    const photo = front.find((frame) => frame.portrait)?.portrait;
    if (!photo) throw new FaceCheckError(422, 'The photo facing the camera could not be used. Try again.', 'no_portrait');
    const engineModel = await this.modelId();
    const first = front[0]!.face;
    return {
      model: engineModel,
      templates: measured.map((frame) => frame.face.embedding.map((value) => round(value, 6))),
      centroid: mean(front.map((frame) => frame.face.embedding)).map((value) => round(value, 6)),
      photo,
      quality: {
        real: round(Math.min(...measured.map((frame) => frame.face.real))),
        live: round(Math.min(...measured.map((frame) => frame.face.live))),
        brightness: round(first.brightness, 1),
        sharpness: round(first.sharpness, 0),
        sizeRatio: round(first.sizeRatio),
        leftYaw: round(measured.find((frame) => frame.pose === 'left')!.face.yaw),
        rightYaw: round(measured.find((frame) => frame.pose === 'right')!.face.yaw),
      },
    };
  }

  /**
   * How much a new registration looks like an existing one: the best match
   * of the new front-facing signature (its centroid) against the old
   * signatures. Used before replacing a registered face.
   */
  similarity(enrolment: Pick<Enrolment, 'centroid'>, templates: readonly number[][]): number {
    const scores = templates.filter((template) => template.length === enrolment.centroid.length).map((template) => cosine(enrolment.centroid, template));
    return scores.length ? round(Math.max(...scores)) : 0;
  }

  /** The highest similarity of `centroid` among other students' faces. */
  duplicateOf<T extends { readonly centroid: readonly number[] }>(centroid: readonly number[], others: readonly T[]): { readonly match: T; readonly score: number } | null {
    let best: { match: T; score: number } | null = null;
    for (const other of others) {
      if (other.centroid.length !== centroid.length) continue;
      const score = cosine(centroid, other.centroid);
      if (score >= FACE_LIMITS.duplicate && (!best || score > best.score)) best = { match: other, score };
    }
    return best;
  }

  /**
   * Check-in: a photo facing the camera and one turned the way `turn` says,
   * compared with the registered signatures.
   */
  async verify(input: {
    readonly frames: readonly FaceFrameInput[];
    readonly turn: FaceTurn;
    readonly templates: readonly number[][];
    readonly model: string;
  }): Promise<FaceVerdict> {
    const front = input.frames.find((frame) => frame.pose === 'front');
    const turned = input.frames.find((frame) => frame.pose === input.turn);
    if (!front || !turned) {
      throw new FaceCheckError(422, `Look at the camera, then turn your head to your ${input.turn} when asked.`, 'missing_pose');
    }
    if (input.model !== await this.modelId()) {
      throw new FaceCheckError(409, 'Your registered face needs to be taken again. Ask an administrator to reset it, then register it from your account.', 'model_changed');
    }
    const measuredFront = await this.#measure(front, true);
    const measuredTurn = await this.#measure(turned, false);
    this.#assertSamePerson([measuredFront, measuredTurn]);
    // Who it is rests on the photo facing the camera. The turned photo proves
    // a live head moved the way asked, and must be the same registered person
    // too, so a held-up photo of the student turning cannot carry someone else.
    const score = Math.max(...input.templates.map((template) => cosine(measuredFront.face.embedding, template)));
    const turnScore = Math.max(...input.templates.map((template) => cosine(measuredTurn.face.embedding, template)));
    if (score < FACE_LIMITS.match || turnScore < FACE_LIMITS.turnMatch) {
      throw new FaceCheckError(403, 'Your face does not match the face registered on this account. Try again facing the camera in good light. If it keeps failing, ask the person taking attendance to add you.', 'mismatch');
    }
    const needsReview = score < FACE_LIMITS.clearMatch;
    return {
      score: round(score),
      real: round(Math.min(measuredFront.face.real, measuredTurn.face.real)),
      live: round(Math.min(measuredFront.face.live, measuredTurn.face.live)),
      needsReview,
      photo: needsReview ? measuredFront.portrait : null,
    };
  }
}

/** Set by apps/api/scripts/bundle-embedded.mjs in the deployment bundle only. */
declare const __LASUATOS_EMBEDDED__: boolean | undefined;

/**
 * Where the deployment's face engine folder (apps/api/dist/face) is. The web
 * app runs from apps/web, so it is ../api/dist/face there; FACE_ENGINE_PATH
 * overrides it.
 */
export function faceBundleCandidates(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    ...(env.FACE_ENGINE_PATH ? [path.resolve(cwd, env.FACE_ENGINE_PATH)] : []),
    path.resolve(cwd, '../api/dist/face/face.mjs'),
    path.resolve(cwd, 'apps/api/dist/face/face.mjs'),
    path.resolve(cwd, 'dist/face/face.mjs'),
  ];
}

type FaceModule = typeof import('@lasuatos/face');

async function importFaceModule(): Promise<FaceModule> {
  // Opaque to bundlers on purpose: the engine is never bundled into the API.
  const load = (specifier: string) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ specifier) as Promise<FaceModule>;
  if (typeof __LASUATOS_EMBEDDED__ !== 'undefined' && __LASUATOS_EMBEDDED__) {
    const bundle = faceBundleCandidates().find((candidate) => existsSync(candidate));
    if (!bundle) throw new Error(`The face engine was not found (looked in ${faceBundleCandidates().join(', ')}).`);
    return load(pathToFileURL(bundle).href);
  }
  return load('@lasuatos/face');
}

/** Loads the real engine on first use, so nothing else waits for the models. */
export function loadFaceEngine(): Promise<FaceEngine> {
  return importFaceModule().then(async (module) => {
    const engine = module.createFaceEngine();
    await engine.warm();
    return engine;
  });
}
