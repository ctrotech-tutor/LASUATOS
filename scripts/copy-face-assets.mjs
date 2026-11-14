/**
 * Puts the on-device face tracker's files where the browser loads them:
 * apps/web/public/face/wasm-<version>/ (MediaPipe Tasks Vision WebAssembly,
 * copied from node_modules, not committed) beside the committed model
 * apps/web/public/face/face-landmarker-v1.task (checked here by sha256;
 * a different model gets a new file name).
 *
 * Run by the web app's dev and build scripts. The version in the folder
 * name must match FACE_RUNTIME_VERSION in apps/web/lib/face-tracker.ts, so a
 * new release is a new URL and phones never mix old and new files.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FACE_RUNTIME_VERSION = '0.10.35';
/** Google's face_landmarker.task (float16, released 2023-05-03), unmodified. */
export const FACE_MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../apps/web');
const publicFace = path.join(web, 'public/face');

export function copyFaceAssets() {
  const require = createRequire(path.join(web, 'package.json'));
  const entry = require.resolve('@mediapipe/tasks-vision');
  let root = path.dirname(entry);
  while (!existsSync(path.join(root, 'package.json'))) root = path.dirname(root);
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (version !== FACE_RUNTIME_VERSION) {
    throw new Error(`@mediapipe/tasks-vision is ${version}, but the face tracker expects ${FACE_RUNTIME_VERSION}. Update FACE_RUNTIME_VERSION here and in apps/web/lib/face-tracker.ts together.`);
  }

  const model = path.join(publicFace, 'face-landmarker-v1.task');
  const digest = createHash('sha256').update(readFileSync(model)).digest('hex');
  if (digest !== FACE_MODEL_SHA256) throw new Error(`apps/web/public/face/face-landmarker-v1.task has sha256 ${digest}, expected ${FACE_MODEL_SHA256}.`);

  const target = path.join(publicFace, `wasm-${FACE_RUNTIME_VERSION}`);
  mkdirSync(target, { recursive: true });
  for (const file of FILES) {
    const from = path.join(root, 'wasm', file);
    const to = path.join(target, file);
    if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
  }
  // Drop folders of earlier versions.
  for (const name of readdirSync(publicFace)) {
    if (name.startsWith('wasm-') && name !== `wasm-${FACE_RUNTIME_VERSION}`) rmSync(path.join(publicFace, name), { recursive: true, force: true });
  }
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = copyFaceAssets();
  console.log(`Face tracker files ready in ${path.relative(process.cwd(), target) || target}`);
}
