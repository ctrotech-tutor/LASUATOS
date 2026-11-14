export declare const FACE_MODEL_ID: 'sface-2021dec';
export declare const SFACE_SHA256: string;
export declare const EMBEDDING_LENGTH: 128;

export interface FaceBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MeasuredFace {
  /** Detector confidence, 0–1. */
  readonly score: number;
  readonly box: FaceBox;
  /** Radians; positive yaw = the person turned to their own right. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /** Anti-spoof model: 1 = a real face, 0 = a photo or screen. */
  readonly real: number;
  /** Liveness model: 1 = live, 0 = not. */
  readonly live: number;
  /** Face width as a share of the photo width. */
  readonly sizeRatio: number;
  /** Mean luminance in the face box, 0–255. */
  readonly brightness: number;
  /** Variance of the Laplacian on the lined-up face; low = blurred. */
  readonly sharpness: number;
  /** L2-normalised 128-number SFace signature. */
  readonly embedding: number[];
}

export interface FaceAnalysis {
  readonly width: number;
  readonly height: number;
  /** Faces of a comparable size to the largest one. */
  readonly faceCount: number;
  readonly face: MeasuredFace | null;
  /** 200 x 250 JPEG around the face, when requested. */
  readonly portrait: Buffer | null;
}

export interface FaceEngine {
  readonly modelId: string;
  warm(): Promise<void>;
  analyze(bytes: Uint8Array, options?: { readonly portrait?: boolean }): Promise<FaceAnalysis>;
}

export declare class FaceImageError extends Error {}

export declare function createFaceEngine(): FaceEngine;
export declare function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number;
export declare function modelDirectory(): string;
export declare function decodeJpeg(bytes: Uint8Array): { width: number; height: number; data: Uint8Array };
export declare function similarityTransform(
  from: ReadonlyArray<readonly [number, number]>,
  to: ReadonlyArray<readonly [number, number]>,
): { a: number; b: number; tx: number; ty: number };
export declare function cropPortrait(
  image: { width: number; height: number; data: Uint8Array },
  box: FaceBox,
  options?: { width?: number; height?: number; quality?: number },
): Buffer;
