/**
 * Live guidance for the face camera: turns what the on-device face tracker
 * sees into one instruction at a time ("Move closer", "Hold still", "Turn a
 * little more") and says when a photo can be taken.
 *
 * Pure functions only, so they are unit-tested without a camera. The
 * tracker (lib/face-tracker.ts) produces a FaceObservation per video frame.
 *
 * Angles use the server's convention (apps/api/src/students/face.ts):
 * radians, positive yaw = the person turned to their own right, measured in
 * the raw (unmirrored) camera picture. The server measures with a different
 * model (Human's face mesh), which reads head turns smaller: on the same
 * photos its yaw was 0.68 to 0.92 times MediaPipe's (pitch about 0.65). The
 * limits below therefore sit well inside the server's, so a photo the phone
 * takes is one the server accepts:
 *   facing the camera: |yaw| <= 0.15 here, about 0.11 there (limit 0.2);
 *   turned:            yaw  >= 0.42 here, 0.29 or more there (limit 0.2).
 */

export type FaceStep = 'front' | 'blink' | 'left' | 'right';

export type FaceHint =
  | 'searching'
  | 'several'
  | 'center'
  | 'closer'
  | 'further'
  | 'dark'
  | 'bright'
  | 'tilt'
  | 'look_straight'
  | 'eyes'
  | 'still'
  | 'turn_more'
  | 'turn_less'
  | 'turn_wrong_way'
  | 'blink'
  | 'ok';

export interface FaceBox {
  /** Normalised to the video frame (0 to 1), unmirrored. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FaceObservation {
  /** Faces big enough to matter (at least 45% of the main face's width). */
  readonly faces: number;
  readonly box: FaceBox;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /** Eye closure, 0 (wide open) to 1 (shut), the mean of both eyes. */
  readonly blink: number;
  /** Nose tip, normalised to the video frame. */
  readonly nose: { readonly x: number; readonly y: number };
}

export const FACE_GUIDE = {
  frontYaw: 0.15,
  frontPitch: 0.35,
  maxRoll: 0.28,
  turnYaw: 0.42,
  maxTurnYaw: 1.0,
  /** Turned the wrong way by at least this much: say so. */
  wrongWay: 0.18,
  /** Face width as a share of the circle's diameter. */
  minFill: 0.4,
  maxFill: 0.86,
  /** Distance of the face centre from the circle centre, as a share of the diameter. */
  maxOffset: 0.17,
  /** Mean brightness of the face (0 to 255); the server allows 45 to 225. */
  minLuma: 60,
  maxLuma: 215,
  /** Above this eye closure the eyes count as closed for a photo. */
  eyesOpen: 0.5,
  /** Nose movement between frames, as a share of the face width. */
  maxMotion: 0.045,
  /** How long everything must stay right before the photo is taken. */
  holdFrontMs: 700,
  holdTurnMs: 300,
} as const;

/**
 * Where the face sits in the round viewfinder. The viewfinder is a square
 * showing the video with `object-fit: cover`, so only the middle square of
 * the frame is visible. Returns the face centre in viewfinder units (0 to 1,
 * unmirrored) and the face width as a share of the diameter.
 */
export function placeInCircle(box: FaceBox, video: { readonly width: number; readonly height: number }): { cx: number; cy: number; fill: number } {
  const side = Math.min(video.width, video.height);
  const cx = ((box.x + box.width / 2) * video.width - (video.width - side) / 2) / side;
  const cy = ((box.y + box.height / 2) * video.height - (video.height - side) / 2) / side;
  return { cx, cy, fill: (box.width * video.width) / side };
}

/** Yaw, pitch and roll from MediaPipe's 4 x 4 face transformation matrix (column-major), in the server's convention. */
export function poseFromMatrix(matrix: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  // Row r, column c is matrix[c * 4 + r].
  const r00 = matrix[0]!;
  const r10 = matrix[1]!;
  const r20 = matrix[2]!;
  const r21 = matrix[6]!;
  const r22 = matrix[10]!;
  return {
    yaw: Math.asin(clamp(r20)),
    pitch: Math.atan2(r21, r22),
    roll: -Math.atan2(r10, r00),
  };
}

export interface FaceAssessmentInput {
  readonly observation: FaceObservation | null;
  readonly step: FaceStep;
  readonly video: { readonly width: number; readonly height: number };
  /** Mean brightness of the face, or null when not measured yet. */
  readonly luma: number | null;
  /** Smoothed nose movement, as a share of the face width. */
  readonly motion: number;
}

/** The single most useful instruction right now; 'ok' when a photo can be taken (or, for 'blink', when waiting for the blink). */
export function assessFace(input: FaceAssessmentInput): FaceHint {
  const { observation: face, step, video, luma, motion } = input;
  if (!face) return 'searching';
  if (face.faces > 1) return 'several';
  const turning = step === 'left' || step === 'right';
  const place = placeInCircle(face.box, video);
  const offset = Math.hypot(place.cx - 0.5, place.cy - 0.5);
  // A turned head looks narrower and shifts sideways, so turns get more room.
  if (offset > FACE_GUIDE.maxOffset * (turning ? 1.7 : 1)) return 'center';
  if (place.fill < FACE_GUIDE.minFill * (turning ? 0.75 : 1)) return 'closer';
  if (place.fill > FACE_GUIDE.maxFill) return 'further';
  if (luma !== null && luma < FACE_GUIDE.minLuma) return 'dark';
  if (luma !== null && luma > FACE_GUIDE.maxLuma) return 'bright';
  if (Math.abs(face.roll) > FACE_GUIDE.maxRoll) return 'tilt';

  if (step === 'front') {
    if (Math.abs(face.yaw) > FACE_GUIDE.frontYaw || Math.abs(face.pitch) > FACE_GUIDE.frontPitch) return 'look_straight';
    if (face.blink > FACE_GUIDE.eyesOpen) return 'eyes';
    if (motion > FACE_GUIDE.maxMotion) return 'still';
    return 'ok';
  }
  if (step === 'blink') {
    return Math.abs(face.yaw) > FACE_GUIDE.frontYaw * 2.5 ? 'look_straight' : 'ok';
  }
  const turned = step === 'right' ? face.yaw : -face.yaw;
  if (turned < -FACE_GUIDE.wrongWay) return 'turn_wrong_way';
  if (turned < FACE_GUIDE.turnYaw) return 'turn_more';
  if (turned > FACE_GUIDE.maxTurnYaw) return 'turn_less';
  if (face.blink > FACE_GUIDE.eyesOpen + 0.15) return 'eyes';
  if (motion > FACE_GUIDE.maxMotion * 1.6) return 'still';
  return 'ok';
}

/** How far through the head turn the student is, 0 to 1, for the progress ring. */
export function turnProgress(face: FaceObservation | null, step: 'left' | 'right'): number {
  if (!face) return 0;
  const turned = step === 'right' ? face.yaw : -face.yaw;
  return Math.max(0, Math.min(1, turned / FACE_GUIDE.turnYaw));
}

/**
 * Notices one blink: the eyes open, then shut, then open again. The level
 * for "shut" adapts to the student's resting eyes (glasses and narrow eyes
 * rest higher), and a blink must take under 1.2 seconds.
 */
export class BlinkDetector {
  #rest = 0.15;
  #samples = 0;
  #phase: 'open' | 'closed' = 'open';
  #closedAt = 0;
  #openFrames = 0;

  /** Feeds one eye-closure reading; true when a full blink has just finished. */
  update(closure: number, now: number): boolean {
    const shut = Math.max(0.42, Math.min(0.75, this.#rest + 0.28));
    if (this.#phase === 'open') {
      if (closure < shut - 0.1) {
        // Learn the resting level from open eyes only.
        this.#samples += 1;
        const weight = Math.max(0.08, 1 / this.#samples);
        this.#rest += (closure - this.#rest) * weight;
        this.#openFrames += 1;
      }
      if (closure >= shut && this.#openFrames >= 2) {
        this.#phase = 'closed';
        this.#closedAt = now;
      }
      return false;
    }
    if (now - this.#closedAt > 1200) {
      // Eyes held shut (or a lost track): start again.
      this.#phase = 'open';
      this.#openFrames = 0;
      return false;
    }
    if (closure < this.#rest + 0.16) {
      this.#phase = 'open';
      this.#openFrames = 0;
      return true;
    }
    return false;
  }
}

/** Mean brightness and a sharpness score of a greyscale patch (RGBA pixels). */
export function patchStats(rgba: ArrayLike<number>, width: number, height: number): { luma: number; sharpness: number } {
  const grey = new Float32Array(width * height);
  let sum = 0;
  for (let index = 0; index < grey.length; index += 1) {
    const value = 0.299 * rgba[index * 4]! + 0.587 * rgba[index * 4 + 1]! + 0.114 * rgba[index * 4 + 2]!;
    grey[index] = value;
    sum += value;
  }
  // Variance of the Laplacian: high for crisp detail, low for blur.
  let total = 0;
  let totalSquared = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const laplacian = grey[at - width]! + grey[at + width]! + grey[at - 1]! + grey[at + 1]! - 4 * grey[at]!;
      total += laplacian;
      totalSquared += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = count ? total / count : 0;
  return { luma: grey.length ? sum / grey.length : 0, sharpness: count ? totalSquared / count - mean * mean : 0 };
}

export interface HintWords {
  readonly title: string;
  readonly detail: string;
}

const turnWords = (side: 'left' | 'right') => `Turn your head to your ${side}`;

/** What the screen says for a step, and for a problem when there is one. */
export function faceWords(step: FaceStep, hint: FaceHint): HintWords {
  const base: Record<FaceStep, HintWords> = {
    front: { title: 'Look straight at the camera', detail: 'Fit your face inside the circle.' },
    blink: { title: 'Now blink your eyes', detail: 'One normal blink is enough.' },
    left: { title: turnWords('left'), detail: 'Slowly, part of the way, as if looking at someone beside you.' },
    right: { title: turnWords('right'), detail: 'Slowly, part of the way, as if looking at someone beside you.' },
  };
  const words = base[step];
  switch (hint) {
    case 'searching': return { title: 'We can’t see your face', detail: 'Hold the phone at eye level, straight in front of you.' };
    case 'several': return { title: 'Only you, please', detail: 'Make sure nobody else is in the picture.' };
    case 'center': return { ...words, detail: 'Move your face to the middle of the circle.' };
    case 'closer': return { ...words, detail: 'Bring the phone a little closer.' };
    case 'further': return { ...words, detail: 'Hold the phone a little further away.' };
    case 'dark': return { ...words, detail: 'Too dark. Face a window or a light.' };
    case 'bright': return { ...words, detail: 'Too bright. Move out of direct light.' };
    case 'tilt': return { ...words, detail: 'Keep your head upright.' };
    case 'look_straight': return step === 'front' ? { ...words, detail: 'Face the camera straight on.' } : { ...words, detail: 'Look back at the screen first.' };
    case 'eyes': return { ...words, detail: 'Keep your eyes open.' };
    case 'still': return { ...words, detail: 'Hold still for a moment.' };
    case 'turn_more': return { ...words, detail: 'A little more…' };
    case 'turn_less': return { ...words, detail: 'Not so far. Turn back a little.' };
    case 'turn_wrong_way': return { title: turnWords(step === 'right' ? 'right' : 'left'), detail: 'The other way.' };
    case 'blink':
    case 'ok':
    default:
      return step === 'front' || step === 'left' || step === 'right' ? { ...words, detail: hint === 'ok' ? 'Hold still…' : words.detail } : words;
  }
}

/** The steps for a capture: each photo in order, with one blink after the first photo. */
export function captureSteps(poses: readonly ('front' | 'left' | 'right')[]): FaceStep[] {
  const steps: FaceStep[] = [];
  poses.forEach((pose, index) => {
    steps.push(pose);
    if (index === 0) steps.push('blink');
  });
  return steps;
}
