import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FACE_MATCH, type FacePose, type FaceTurn } from '@lasuatos/contracts';
import type { FaceAnalysis, FaceEngine, MeasuredFace } from '@lasuatos/face';

/**
 * Face checks for student registration and lecture check-in.
 *
 * Signatures come from OpenCV's SFace model (128 numbers, compared by cosine
 * similarity); detection, head pose and the liveness scores come from Human.
 * The limits below were set from measurements on real and generated faces
 * (see docs/FACE_VERIFICATION.md): different people scored up to 0.49 on the
 * test faces and 0.551 in real use; the same person 0.67–0.71 in two different
 * photos and 0.978 at a real check-in.
 */
export const FACE_LIMITS = {
  /**
   * A check-in passes when the photo facing the camera is at least this
   * similar to the registered face. Above every different person measured:
   * 0.49 on the test faces, 0.551 in real use (which the old 0.52 let through).
   * The same person in two different photos scores about 0.71; in real use 0.98.
   */
  match: FACE_MATCH.pass,
  /**
   * The turned photo must also look like the registered face, at least this
   * much: above a different person turned (up to 0.484), below the same
   * person turned vs facing (about 0.67; a registered turned photo scores higher).
   */
  turnMatch: 0.55,
  /** Below this (but at least `match`) the check-in passes and a photo is kept for review. */
  clearMatch: FACE_MATCH.clear,
  /**
   * Photos taken in one go must be of one person. Each turned photo is compared
   * with the straight one taken with it (never left with right: those show
   * opposite sides of the face, and a real person can score low on that pair).
   * Above the hardest impostor pair measured (0.489 straight, 0.484 straight vs
   * turned at 0.45 rad), below the same person facing vs turned (about 0.67).
   */
  sameCapture: 0.5,
  /**
   * A bigger turn shows less of the face the straight photo shows, so the
   * same person scores lower: the bar eases from `sameCapture` at
   * `sameCaptureEaseFrom` radians of turn down to this at `sameCaptureEaseTo`.
   */
  sameCaptureWide: 0.45,
  sameCaptureEaseFrom: 0.45,
  sameCaptureEaseTo: 0.8,
  /**
   * A new registration this close to another student's face is refused: the
   * same line as a check-in, so nobody can register a face that would pass as
   * someone else's.
   */
  duplicate: FACE_MATCH.pass,
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
  constructor(
    readonly statusCode: number,
    message: string,
    readonly reason: string,
    /** Sent as Retry-After: the phone tries again by itself after this many seconds. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'FaceCheckError';
  }
}

/**
 * How long a face check may wait for its turn on one server instance before
 * it is turned away with 503 and Retry-After. The phone then sends the same
 * photos again by itself (no new photos), and the platform starts more
 * instances when this one is busy. Without it, a crowd that lands on one
 * instance waits until the platform's 30-second limit cuts every request
 * off, and the photos still queued behind them are analysed for nobody.
 */
export const FACE_QUEUE_BUDGET_MILLISECONDS = 15_000;
const RECENT_TURNED_AWAY_HALF_LIFE_MILLISECONDS = 10_000;
/** The longest Retry-After a busy instance asks for (the phone keeps trying for 3 minutes). */
const MAX_RETRY_AFTER_SECONDS = 45;
/** Starting estimate of one photo's analysis (measured 150–250 ms; cold or slow CPUs are slower). */
const INITIAL_PHOTO_MILLISECONDS = 300;

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

/**
 * How similar a turned photo must be to the straight photo taken with it,
 * for a head turned `yaw` radians: `sameCapture` for a small turn, easing to
 * `sameCaptureWide` for a big one.
 */
export function sameCaptureFloor(yaw: number): number {
  const { sameCapture, sameCaptureWide, sameCaptureEaseFrom, sameCaptureEaseTo } = FACE_LIMITS;
  const turn = Math.abs(yaw);
  if (turn <= sameCaptureEaseFrom) return sameCapture;
  if (turn >= sameCaptureEaseTo) return sameCaptureWide;
  return sameCapture - ((sameCapture - sameCaptureWide) * (turn - sameCaptureEaseFrom)) / (sameCaptureEaseTo - sameCaptureEaseFrom);
}

const poseWords: Record<FacePose, string> = {
  front: 'looking straight at the camera',
  left: 'turned to your left',
  right: 'turned to your right',
};

export interface FaceVerifierOptions {
  /** Loads the engine on first use (the models take a second or two to load). */
  readonly engine: () => Promise<FaceEngine>;
  /** See FACE_QUEUE_BUDGET_MILLISECONDS. */
  readonly queueBudgetMilliseconds?: number;
  readonly now?: () => number;
  /** For tests: the spread of Retry-After. */
  readonly random?: () => number;
}

/** Load figures for one instance's face checks (System health and the load test read them). */
export interface FaceQueueStats {
  /** Check-ins and registrations waiting or being analysed now. */
  readonly waiting: number;
  /** Photos in them. */
  readonly waitingPhotos: number;
  /** Recent average analysis time of one photo. */
  readonly photoMilliseconds: number;
  readonly completed: number;
  /** Turned away because the wait would have been too long. */
  readonly turnedAway: number;
}

export class FaceVerifier {
  readonly #loadEngine: () => Promise<FaceEngine>;
  readonly #budget: number;
  /** The longest a queued check may actually wait (see #turn). */
  readonly #queueLimit: number;
  readonly #now: () => number;
  #engine: Promise<FaceEngine> | null = null;
  /** One check at a time per instance, in arrival order (see #turn). */
  #tail: Promise<void> = Promise.resolve();
  #waiting = 0;
  #waitingPhotos = 0;
  #photoMilliseconds = INITIAL_PHOTO_MILLISECONDS;
  #completed = 0;
  #turnedAway = 0;
  #lastFinished: number | null = null;
  /** Check-ins turned away lately (halving every 10 seconds); see #busy. */
  #recentTurnedAway = 0;
  #recentAt = 0;
  readonly #random: () => number;

  constructor(options: FaceVerifierOptions) {
    this.#loadEngine = options.engine;
    this.#budget = options.queueBudgetMilliseconds ?? FACE_QUEUE_BUDGET_MILLISECONDS;
    this.#queueLimit = Math.max(this.#budget, Math.min(this.#budget * 1.5, 24_000));
    this.#now = options.now ?? (() => performance.now());
    this.#random = options.random ?? Math.random;
  }

  stats(): FaceQueueStats {
    return {
      waiting: this.#waiting,
      waitingPhotos: this.#waitingPhotos,
      photoMilliseconds: Math.round(this.#photoMilliseconds),
      completed: this.#completed,
      turnedAway: this.#turnedAway,
    };
  }

  #busy(waitMilliseconds: number): FaceCheckError {
    this.#turnedAway += 1;
    // Phones turned away lately will all come back. Ask each to return when
    // the line should have room, spread at random over the time those
    // returning phones' photos would take, so they do not all come back in
    // the same second. In the load test a fixed few seconds made a crowd ask
    // again and again (tens of thousands of retries for 900 students), and
    // answering them took time from the face checks.
    const now = this.#now();
    const halfLives = (now - this.#recentAt) / RECENT_TURNED_AWAY_HALF_LIFE_MILLISECONDS;
    this.#recentTurnedAway = this.#recentTurnedAway * 0.5 ** Math.max(0, halfLives) + 1;
    this.#recentAt = now;
    const returning = this.#recentTurnedAway * 2 * this.#photoMilliseconds;
    const seconds = Math.ceil((Math.max(0, waitMilliseconds - this.#budget) + this.#random() * returning) / 1000) + 2;
    return new FaceCheckError(503, 'Face checks are busy right now. Your phone will try again in a few seconds.', 'busy', Math.max(3, Math.min(MAX_RETRY_AFTER_SECONDS, seconds)));
  }

  /**
   * Turns a check away at once when this instance's line is already too
   * long, before the request does any other work. The check-in calls it
   * first (before signing in with a password or reading the database), so
   * turning a crowd away costs next to nothing; #turn checks again.
   */
  assertRoom(photos: number): void {
    const expected = (this.#waitingPhotos + photos) * this.#photoMilliseconds;
    if (this.#waiting > 0 && expected > this.#budget) throw this.#busy(expected);
  }

  /**
   * Runs one check-in's or registration's photos together, one check at a
   * time, in arrival order. Before this, every photo joined one shared line,
   * so in a crowd each student's second photo waited behind everybody's
   * first and nearly everyone finished at the very end; now the first
   * arrivals finish first and the average wait halves. A check that would
   * wait longer than the budget is turned away at once (nothing analysed),
   * and so is one whose wait ran well over while it queued.
   */
  async #turn<T>(photos: number, work: () => Promise<T>): Promise<T> {
    this.assertRoom(photos);
    this.#waiting += 1;
    this.#waitingPhotos += photos;
    const queuedAt = this.#now();
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    try {
      await previous;
      // Admission already kept the expected wait within the budget; this
      // catches a line that moved much slower than expected. The margin
      // keeps a check that waited about as predicted from being thrown
      // away at the last moment, while still answering well within the
      // platform's 30 seconds.
      const waited = this.#now() - queuedAt;
      if (waited > this.#queueLimit) throw this.#busy(waited);
      // The first check also loads the models: keep that out of the average.
      await this.#getEngine().catch(() => undefined);
      const started = this.#now();
      try {
        return await work();
      } finally {
        // Time per photo as the line actually moves: from the previous check's
        // end when this one was already waiting, so the request thread's other
        // work between two checks (reading uploads, database calls, answering
        // scans) counts too. Timing the analysis alone under-estimated the
        // wait by about a third in the load test and admitted checks that then
        // timed out in the queue.
        const finished = this.#now();
        const from = this.#lastFinished !== null && this.#lastFinished > queuedAt ? Math.min(this.#lastFinished, started) : started;
        this.#lastFinished = finished;
        const perPhoto = (finished - from) / photos;
        this.#photoMilliseconds = this.#photoMilliseconds * 0.8 + perPhoto * 0.2;
        this.#completed += 1;
      }
    } finally {
      this.#waiting -= 1;
      this.#waitingPhotos -= photos;
      release();
    }
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

  /** Stops the face thread once loaded (server shutdown, tests). */
  async close(): Promise<void> {
    const engine = this.#engine;
    this.#engine = null;
    if (!engine) return;
    await engine.then((loaded) => loaded.close?.(), () => undefined);
  }

  async modelId(): Promise<string> {
    return (await this.#getEngine()).modelId;
  }

  /**
   * Loads the models now (a no-op once loaded), so the next photos are
   * checked without the cold-start wait. False when they cannot be loaded.
   */
  async warm(): Promise<boolean> {
    try {
      await this.#getEngine();
      return true;
    } catch {
      return false;
    }
  }

  /** The small photo kept for a reviewer: the front photo is read again, this time cutting the portrait. */
  async #portrait(frame: FaceFrameInput): Promise<Buffer | null> {
    try {
      const engine = await this.#getEngine();
      return (await engine.analyze(Buffer.from(frame.image, 'base64'), { portrait: true })).portrait;
    } catch {
      return null;
    }
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

  /**
   * Every photo of one capture must be of the same person. The straight
   * photos are compared with each other, and each turned photo with the
   * straight ones (the best of them), at a bar that eases for a bigger turn.
   * Turned photos are not compared with each other: left and right show
   * opposite sides of the face, and both already have to match the straight one.
   */
  #assertSamePerson(frames: readonly MeasuredFrame[]): void {
    const straight = frames.filter((frame) => frame.pose === 'front');
    for (let i = 0; i < straight.length; i += 1) {
      for (let j = i + 1; j < straight.length; j += 1) {
        if (cosine(straight[i]!.face.embedding, straight[j]!.face.embedding) < FACE_LIMITS.sameCapture) {
          throw new FaceCheckError(422, 'The photos do not all look like the same person. Keep only your face in view and try again.', 'mixed_people');
        }
      }
    }
    for (const turned of frames.filter((frame) => frame.pose !== 'front')) {
      const best = Math.max(...straight.map((frame) => cosine(frame.face.embedding, turned.face.embedding)));
      if (best < sameCaptureFloor(turned.face.yaw)) {
        throw new FaceCheckError(
          422,
          `The photo turned to your ${turned.pose} does not look like the same person as the straight one. Turn your head only part of the way, keep your whole face in view (no hand, mask or cap in the way) and try again.`,
          'mixed_people',
        );
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
    return this.#turn(frames.length, () => this.#enrolNow(frames));
  }

  async #enrolNow(frames: readonly FaceFrameInput[]): Promise<Enrolment> {
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
    return this.#turn(2, () => this.#verifyNow(front, turned, input.templates));
  }

  async #verifyNow(front: FaceFrameInput, turned: FaceFrameInput, templates: readonly number[][]): Promise<FaceVerdict> {
    // No portrait yet: it is needed only for a close match (below), which is rare.
    const measuredFront = await this.#measure(front, false);
    const measuredTurn = await this.#measure(turned, false);
    this.#assertSamePerson([measuredFront, measuredTurn]);
    // Who it is rests on the photo facing the camera. The turned photo proves
    // a live head moved the way asked, and must be the same registered person
    // too, so a held-up photo of the student turning cannot carry someone else.
    const score = Math.max(...templates.map((template) => cosine(measuredFront.face.embedding, template)));
    const turnScore = Math.max(...templates.map((template) => cosine(measuredTurn.face.embedding, template)));
    if (score < FACE_LIMITS.match || turnScore < FACE_LIMITS.turnMatch) {
      throw new FaceCheckError(403, 'Your face does not match the face registered on this account. Try again facing the camera in good light. If it keeps failing, ask the person taking attendance to add you.', 'mismatch');
    }
    const needsReview = score < FACE_LIMITS.clearMatch;
    return {
      score: round(score),
      real: round(Math.min(measuredFront.face.real, measuredTurn.face.real)),
      live: round(Math.min(measuredFront.face.live, measuredTurn.face.live)),
      needsReview,
      photo: needsReview ? await this.#portrait(front) : null,
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
