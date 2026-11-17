import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { poseFromMatrix, type FaceObservation } from './face-guide';

/**
 * The on-device face tracker behind the face camera's live guidance:
 * Google's MediaPipe Face Landmarker (478 face points, eye blink scores and
 * the head's 3-D pose, about 15 to 30 times a second on a phone).
 *
 * Everything is served from this site (see scripts/copy-face-assets.mjs):
 * no camera picture leaves the phone for tracking, and the library's usage
 * logging is blocked by the Content Security Policy (connect-src allows no Google analytics host).
 * About 6 MB is downloaded once, then the browser (and the service worker)
 * keep it. The server still checks every photo itself: tracking only makes
 * taking good photos quick and easy.
 */

/** Must match FACE_RUNTIME_VERSION in scripts/copy-face-assets.mjs. */
export const FACE_RUNTIME_VERSION = '0.10.35';
const RUNTIME_PATH = `/face/wasm-${FACE_RUNTIME_VERSION}`;
const MODEL_PATH = '/face/face-landmarker-v1.task';

let loading: Promise<FaceLandmarker> | null = null;

/** Loads (once) and returns the tracker. Rejects on browsers that cannot run it. */
export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!loading) {
    loading = (async () => {
      const { FaceLandmarker: Landmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(RUNTIME_PATH);
      return Landmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 2,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    })().catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

/**
 * Starts downloading the tracker in the background (when the page is idle),
 * so the camera opens with guidance straight away. Skipped when the phone
 * asks to save data; the tracker then loads when the camera opens.
 */
export function preloadFaceTracker(): void {
  if (typeof window === 'undefined' || loading) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const start = () => { void loadFaceLandmarker().catch(() => undefined); };
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 1500);
}

/** One video frame in, one observation of the main face out (or null). */
export function observeFace(result: FaceLandmarkerResult): FaceObservation | null {
  const all = result.faceLandmarks;
  if (!all.length) return null;
  const boxes = all.map((points) => {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  });
  let main = 0;
  boxes.forEach((box, index) => { if (box.width > boxes[main]!.width) main = index; });
  const box = boxes[main]!;
  const faces = boxes.filter((other) => other.width >= box.width * 0.45).length;
  const matrix = result.facialTransformationMatrixes?.[main]?.data;
  const pose = matrix && matrix.length >= 16 ? poseFromMatrix(matrix) : { yaw: 0, pitch: 0, roll: 0 };
  const shapes = result.faceBlendshapes?.[main]?.categories ?? [];
  const score = (name: string) => shapes.find((category) => category.categoryName === name)?.score ?? 0;
  const nose = all[main]![1] ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return {
    faces,
    box,
    ...pose,
    blink: (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2,
    nose: { x: nose.x, y: nose.y },
  };
}
