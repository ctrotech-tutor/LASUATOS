/**
 * Entry point of the deployment build (apps/api/scripts/bundle-embedded.mjs):
 * one file with every dependency inside, and the models and wasm files it
 * needs copied beside it:
 *
 *   face.mjs
 *   models/  blazeface, facemesh, antispoof, liveness (Human) + SFace
 *   wasm/    tfjs-backend-wasm-simd.wasm, ort-wasm-simd-threaded.{mjs,wasm}
 *
 * Plain files and no package lookups at run time, so a serverless function
 * only has to ship this one folder.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web';
// Resolved by the bundler to @vladmandic/human/dist/human.node-wasm.js.
import * as human from 'lasuatos-human-node-wasm';
import { useFaceRuntime } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

useFaceRuntime({
  jpeg: jpeg.default ?? jpeg,
  ort: ort.default?.InferenceSession ? ort.default : ort,
  human: human.default?.Human ? human.default : human,
  modelDirectory: path.join(here, 'models'),
  tfjsWasmDirectory: path.join(here, 'wasm'),
  ortWasmDirectory: path.join(here, 'wasm'),
});

export * from './index.js';
