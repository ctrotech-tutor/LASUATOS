/**
 * Server-side face analysis for LASUATOS.
 *
 * One photo in, one measured face out:
 * - Human (MIT, @vladmandic/human) finds the faces, the 468-point face mesh,
 *   the head pose and two passive liveness scores (anti-spoof and liveness);
 * - the mesh gives the five points (eyes, nose tip, mouth corners) that line
 *   the face up to the standard 112 x 112 ArcFace template;
 * - OpenCV Zoo's SFace (Apache-2.0) turns the lined-up face into a 128-number
 *   signature. Two signatures of the same person have a high cosine
 *   similarity; OpenCV publishes 0.363 as its "same person" threshold.
 *
 * Everything runs on WebAssembly (tfjs-backend-wasm and onnxruntime-web), so
 * it works on Vercel's Node functions without native binaries. Plain
 * JavaScript, run as it is in development and tests; deployments use the
 * self-contained build from src/bundle.js (see apps/api/scripts/bundle-embedded.mjs).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/** Identifies the signature model; stored with every template so a future model change can re-enrol cleanly. */
export const FACE_MODEL_ID = 'sface-2021dec';
/** sha256 of OpenCV Zoo's face_recognition_sface_2021dec.onnx (matches the Git LFS pointer in opencv/opencv_zoo). */
export const SFACE_SHA256 = '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79';
export const EMBEDDING_LENGTH = 128;

/** The ArcFace 112 x 112 template: image-left eye, image-right eye, nose tip, image-left and image-right mouth corner. */
const TEMPLATE = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];
const ALIGNED = 112;
const MAX_MEGAPIXELS = 4;

/**
 * Where the dependencies and files come from. Unset: from node_modules and
 * ../models, as in development. The deployment bundle (src/bundle.js) sets
 * it, with everything inside the bundle and its files beside it.
 */
let runtime = null;

/** @internal Used by src/bundle.js only. */
export function useFaceRuntime(value) {
  runtime = value;
}

export function modelDirectory() {
  if (process.env.FACE_MODEL_DIR) return path.resolve(process.env.FACE_MODEL_DIR);
  return runtime?.modelDirectory ?? path.resolve(here, '../models');
}

/** Cosine similarity of two signatures (1 = identical direction). */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA > 0 && normB > 0 ? dot / Math.sqrt(normA * normB) : 0;
}

/* ------------------------------------------------------------------ */
/* Image helpers (pure JavaScript, no canvas).                          */
/* ------------------------------------------------------------------ */

let jpegModule = null;
function jpeg() {
  jpegModule ??= runtime?.jpeg ?? require('jpeg-js');
  return jpegModule;
}

export class FaceImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FaceImageError';
  }
}

/** Decodes a JPEG into packed RGB, refusing oversized images before allocating them. */
export function decodeJpeg(bytes) {
  try {
    const image = jpeg().decode(bytes, {
      useTArray: true,
      formatAsRGBA: false,
      maxResolutionInMP: MAX_MEGAPIXELS,
      maxMemoryUsageInMB: 160,
    });
    if (!image.width || !image.height || image.data.length < image.width * image.height * 3) {
      throw new FaceImageError('The photo could not be read.');
    }
    return { width: image.width, height: image.height, data: image.data };
  } catch (error) {
    if (error instanceof FaceImageError) throw error;
    throw new FaceImageError('The photo could not be read. Take it again.');
  }
}

function sample(image, x, y, channel) {
  const { width, height, data } = image;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx, yy) => {
    const cx = xx < 0 ? 0 : xx >= width ? width - 1 : xx;
    const cy = yy < 0 ? 0 : yy >= height ? height - 1 : yy;
    return data[(cy * width + cx) * 3 + channel];
  };
  return at(x0, y0) * (1 - fx) * (1 - fy)
    + at(x0 + 1, y0) * fx * (1 - fy)
    + at(x0, y0 + 1) * (1 - fx) * fy
    + at(x0 + 1, y0 + 1) * fx * fy;
}

/** Least-squares similarity transform (rotation, uniform scale, shift) taking `from` onto `to` (Umeyama, 2-D). */
export function similarityTransform(from, to) {
  const count = from.length;
  let fromX = 0;
  let fromY = 0;
  let toX = 0;
  let toY = 0;
  for (let index = 0; index < count; index += 1) {
    fromX += from[index][0];
    fromY += from[index][1];
    toX += to[index][0];
    toY += to[index][1];
  }
  fromX /= count;
  fromY /= count;
  toX /= count;
  toY /= count;
  let along = 0;
  let across = 0;
  let spread = 0;
  for (let index = 0; index < count; index += 1) {
    const x = from[index][0] - fromX;
    const y = from[index][1] - fromY;
    const u = to[index][0] - toX;
    const v = to[index][1] - toY;
    along += x * u + y * v;
    across += x * v - y * u;
    spread += x * x + y * y;
  }
  if (spread <= 0) throw new FaceImageError('The face could not be lined up.');
  const a = along / spread;
  const b = across / spread;
  return { a, b, tx: toX - (a * fromX - b * fromY), ty: toY - (b * fromX + a * fromY) };
}

/** The face warped onto the 112 x 112 template, as planar RGB floats (SFace's input layout). */
function alignFace(image, points) {
  const { a, b, tx, ty } = similarityTransform(points, TEMPLATE);
  const det = a * a + b * b;
  const plane = ALIGNED * ALIGNED;
  const out = new Float32Array(3 * plane);
  for (let v = 0; v < ALIGNED; v += 1) {
    for (let u = 0; u < ALIGNED; u += 1) {
      // Invert x' = a x - b y + tx, y' = b x + a y + ty.
      const dx = u - tx;
      const dy = v - ty;
      const x = (a * dx + b * dy) / det;
      const y = (-b * dx + a * dy) / det;
      const offset = v * ALIGNED + u;
      out[offset] = sample(image, x, y, 0);
      out[plane + offset] = sample(image, x, y, 1);
      out[2 * plane + offset] = sample(image, x, y, 2);
    }
  }
  return out;
}

/** Variance of the Laplacian of the aligned face: low values mean a blurred photo. */
function sharpness(aligned) {
  const plane = ALIGNED * ALIGNED;
  const gray = new Float32Array(plane);
  for (let index = 0; index < plane; index += 1) {
    gray[index] = 0.299 * aligned[index] + 0.587 * aligned[plane + index] + 0.114 * aligned[2 * plane + index];
  }
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < ALIGNED - 1; y += 1) {
    for (let x = 1; x < ALIGNED - 1; x += 1) {
      const index = y * ALIGNED + x;
      const value = 4 * gray[index] - gray[index - 1] - gray[index + 1] - gray[index - ALIGNED] - gray[index + ALIGNED];
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Mean luminance (0-255) inside the face box. */
function brightness(image, box) {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 48));
  let total = 0;
  let count = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const offset = (y * image.width + x) * 3;
      total += 0.299 * image.data[offset] + 0.587 * image.data[offset + 1] + 0.114 * image.data[offset + 2];
      count += 1;
    }
  }
  return count ? total / count : 0;
}

/**
 * A head-and-shoulders portrait cut around the face box (4:5), for the
 * registered-face photo the student's HOC can glance at.
 */
export function cropPortrait(image, box, { width = 200, height = 250, quality = 82 } = {}) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height * 0.45;
  const cropWidth = Math.max(box.width, box.height) * 1.75;
  const cropHeight = cropWidth * (height / width);
  const left = centerX - cropWidth / 2;
  const top = centerY - cropHeight / 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = left + ((x + 0.5) / width) * cropWidth;
      const sy = top + ((y + 0.5) / height) * cropHeight;
      const offset = (y * width + x) * 4;
      rgba[offset] = sample(image, sx, sy, 0);
      rgba[offset + 1] = sample(image, sx, sy, 1);
      rgba[offset + 2] = sample(image, sx, sy, 2);
      rgba[offset + 3] = 255;
    }
  }
  return Buffer.from(jpeg().encode({ data: rgba, width, height }, quality).data);
}

/* ------------------------------------------------------------------ */
/* Models                                                               */
/* ------------------------------------------------------------------ */

/**
 * Human's model loader uses fetch(); Node's fetch does not read file:// URLs.
 * Answer those from disk, only inside the model directory, and pass
 * everything else through untouched.
 */
function installModelFetch(directory) {
  const marker = Symbol.for('lasuatos.face.fetch');
  if (globalThis.fetch?.[marker]) return;
  const original = globalThis.fetch;
  const root = path.resolve(directory) + path.sep;
  const wrapped = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url === 'string' && url.startsWith('file://')) {
      const file = path.resolve(fileURLToPath(url));
      if (!file.startsWith(root)) return new Response(null, { status: 404 });
      const body = await readFile(file);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
      });
    }
    return original(input, init);
  };
  wrapped[marker] = true;
  globalThis.fetch = wrapped;
}

function humanConfig(directory, wasmDirectory) {
  return {
    backend: 'wasm',
    wasmPath: wasmDirectory.endsWith(path.sep) ? wasmDirectory : wasmDirectory + path.sep,
    modelBasePath: pathToFileURL(directory + path.sep).href,
    debug: false,
    async: false,
    warmup: 'none',
    // Every photo is analysed on its own: never reuse results from a previous one.
    cacheSensitivity: 0,
    skipAllowed: false,
    filter: { enabled: false },
    face: {
      enabled: true,
      detector: { modelPath: 'blazeface.json', rotation: true, maxDetected: 4, minConfidence: 0.45, iouThreshold: 0.1, return: false, skipFrames: 0, skipTime: 0 },
      mesh: { enabled: true, modelPath: 'facemesh.json' },
      attention: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false },
      antispoof: { enabled: true, modelPath: 'antispoof.json', skipFrames: 0, skipTime: 0 },
      liveness: { enabled: true, modelPath: 'liveness.json', skipFrames: 0, skipTime: 0 },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
    segmentation: { enabled: false },
  };
}

async function loadModels() {
  const directory = modelDirectory();
  const sfaceFile = path.join(directory, 'sface-2021dec.onnx');
  const sfaceBytes = readFileSync(sfaceFile);
  const digest = createHash('sha256').update(sfaceBytes).digest('hex');
  if (digest !== SFACE_SHA256) throw new Error(`Face model ${sfaceFile} does not match the published checksum.`);

  installModelFetch(directory);
  // Human's exports map cannot name its wasm build (its keys lack "./"), so
  // it is loaded from beside the main entry.
  const humanModule = runtime?.human ?? require(path.join(path.dirname(require.resolve('@vladmandic/human')), 'human.node-wasm.js'));
  const wasmDirectory = runtime?.tfjsWasmDirectory ?? path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm'));
  const human = new humanModule.Human(humanConfig(directory, wasmDirectory));
  await human.load();
  await human.tf.ready();

  const ort = runtime?.ort ?? require('onnxruntime-web');
  ort.env.logLevel = 'error';
  ort.env.wasm.numThreads = 1;
  if (runtime?.ortWasmDirectory) {
    const base = pathToFileURL(runtime.ortWasmDirectory + path.sep).href;
    ort.env.wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.mjs`, wasm: `${base}ort-wasm-simd-threaded.wasm` };
  }
  const session = await ort.InferenceSession.create(sfaceBytes, { logSeverityLevel: 3 });
  return { human, ort, session };
}

/* ------------------------------------------------------------------ */
/* Engine                                                               */
/* ------------------------------------------------------------------ */

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Creates the engine. Models load once, on the first analysis (about half a
 * second on a warm machine); analyses run one at a time per instance.
 */
export function createFaceEngine() {
  let models = null;
  let queue = Promise.resolve();

  const ready = () => {
    models ??= loadModels().catch((error) => {
      models = null;
      throw error;
    });
    return models;
  };

  async function analyzeNow(bytes, options) {
    const { human, ort, session } = await ready();
    const image = decodeJpeg(bytes);
    const tensor = human.tf.tensor3d(image.data, [image.height, image.width, 3], 'int32');
    let result;
    try {
      result = await human.detect(tensor);
    } finally {
      tensor.dispose();
    }
    const faces = (result.face ?? [])
      .filter((face) => face.mesh?.length >= 468 && face.box?.[2] > 0)
      .sort((left, right) => right.box[2] * right.box[3] - left.box[2] * left.box[3]);
    const main = faces[0];
    // Count only faces of a comparable size: a classmate far behind is not "two people".
    const meshWidth = (face) => {
      let low = Infinity;
      let high = -Infinity;
      for (const point of face.mesh) {
        if (point[0] < low) low = point[0];
        if (point[0] > high) high = point[0];
      }
      return high - low;
    };
    const mainWidth = main ? meshWidth(main) : 0;
    const faceCount = main ? faces.filter((face) => meshWidth(face) >= mainWidth * 0.45).length : 0;
    if (!main) return { width: image.width, height: image.height, faceCount: 0, face: null, portrait: null };

    const mesh = main.mesh;
    const middle = (first, second) => [(mesh[first][0] + mesh[second][0]) / 2, (mesh[first][1] + mesh[second][1]) / 2];
    const points = [
      middle(33, 133),
      middle(362, 263),
      [mesh[1][0], mesh[1][1]],
      [mesh[61][0], mesh[61][1]],
      [mesh[291][0], mesh[291][1]],
    ];
    const aligned = alignFace(image, points);
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', aligned, [1, 3, ALIGNED, ALIGNED]) });
    const raw = output[session.outputNames[0]].data;
    let norm = 0;
    for (let index = 0; index < raw.length; index += 1) norm += raw[index] * raw[index];
    norm = Math.sqrt(norm) || 1;
    const embedding = Array.from(raw, (value) => round(value / norm, 6));

    // The mesh outlines the face more tightly and reliably than the detector's box.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of mesh) {
      if (point[0] < minX) minX = point[0];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[1] > maxY) maxY = point[1];
    }
    const box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const angle = main.rotation?.angle ?? { yaw: 0, pitch: 0, roll: 0 };
    return {
      width: image.width,
      height: image.height,
      faceCount,
      face: {
        score: round(main.score ?? 0, 3),
        box: { x: round(box.x, 1), y: round(box.y, 1), width: round(box.width, 1), height: round(box.height, 1) },
        /** Radians; positive yaw = the person turned to their own right. */
        yaw: round(angle.yaw ?? 0, 3),
        pitch: round(angle.pitch ?? 0, 3),
        roll: round(angle.roll ?? 0, 3),
        /** Anti-spoof model: 1 = a real face, 0 = a photo or screen. */
        real: round(main.real ?? 0, 3),
        /** Liveness model: 1 = live, 0 = not. */
        live: round(main.live ?? 0, 3),
        /** Face width as a share of the photo width. */
        sizeRatio: round(box.width / image.width, 3),
        brightness: round(brightness(image, box), 1),
        sharpness: round(sharpness(aligned), 1),
        embedding,
      },
      portrait: options?.portrait ? cropPortrait(image, box) : null,
    };
  }

  return {
    modelId: FACE_MODEL_ID,
    /** Loads the models now (optional; the first analysis does it anyway). */
    warm: () => ready().then(() => undefined),
    /**
     * Measures the largest face in a JPEG. `portrait: true` also returns a
     * cropped JPEG of it. Throws FaceImageError for unreadable photos.
     */
    analyze(bytes, options) {
      const run = queue.then(() => analyzeNow(bytes, options));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
