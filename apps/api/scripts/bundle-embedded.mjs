import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Bundles the API (src/embedded.ts and everything it imports, including the
 * workspace packages and npm dependencies) into one ESM file that the Next.js
 * route app/api/v1/[...path]/route.ts can load. The source uses NodeNext-style
 * ".js" import specifiers for ".ts" files, which esbuild resolves and the Next.js
 * bundler does not. Output: apps/api/dist/embedded.mjs (git-ignored, rebuilt by
 * every `pnpm build` and by the web app's build script).
 */
const apiRoot = path.resolve(import.meta.dirname, '..');

await build({
  entryPoints: [path.join(apiRoot, 'src/embedded.ts')],
  outfile: path.join(apiRoot, 'dist/embedded.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // pg only loads pg-native when explicitly asked to; it is never installed.
  // The face engine is built separately below and loaded at run time.
  external: ['pg-native', '@lasuatos/face'],
  // Tells apps/api/src/students/face.ts to load the engine from dist/face.
  define: { __LASUATOS_EMBEDDED__: 'true' },
  // Bundled CommonJS dependencies call require(); give ESM output a real one.
  banner: {
    js: "import { createRequire as __lasuatosCreateRequire } from 'node:module'; const require = __lasuatosCreateRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('Bundled the embedded API to apps/api/dist/embedded.mjs');

/**
 * The face engine (packages/face) as one self-contained folder,
 * apps/api/dist/face: face.mjs with Human, TensorFlow.js, onnxruntime-web and
 * jpeg-js inside, plus the models and the only two wasm builds it runs. The
 * web deployment ships this folder with the API function
 * (outputFileTracingIncludes in apps/web/next.config.ts) and the API loads it
 * on the first face check (apps/api/src/students/face.ts).
 */
const facePackage = path.resolve(apiRoot, '../../packages/face');
const faceOut = path.join(apiRoot, 'dist/face');
const fromFace = createRequire(path.join(facePackage, 'package.json'));
const humanMain = fromFace.resolve('@vladmandic/human');
const tfjsWasm = path.dirname(fromFace.resolve('@tensorflow/tfjs-backend-wasm'));
const ortDist = path.dirname(fromFace.resolve('onnxruntime-web'));

await rm(faceOut, { recursive: true, force: true });
await build({
  entryPoints: [path.join(facePackage, 'src/bundle.js')],
  outfile: path.join(faceOut, 'face.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  alias: { 'lasuatos-human-node-wasm': path.join(path.dirname(humanMain), 'human.node-wasm.js') },
  // Human's other builds reference these; the wasm build never loads them.
  external: ['@tensorflow/tfjs-node', '@tensorflow/tfjs-node-gpu'],
  banner: {
    // The bundled CommonJS code uses require, __dirname and __filename.
    js: [
      "import { createRequire as __faceCreateRequire } from 'node:module';",
      "import { fileURLToPath as __faceFileUrlToPath } from 'node:url';",
      "import { dirname as __faceDirname } from 'node:path';",
      'const require = __faceCreateRequire(import.meta.url);',
      'const __filename = __faceFileUrlToPath(import.meta.url);',
      'const __dirname = __faceDirname(__filename);',
    ].join(' '),
  },
  legalComments: 'none',
  logLevel: 'error',
});
await mkdir(path.join(faceOut, 'models'), { recursive: true });
await mkdir(path.join(faceOut, 'wasm'), { recursive: true });
for (const name of [
  'blazeface.json', 'blazeface.bin', 'facemesh.json', 'facemesh.bin',
  'antispoof.json', 'antispoof.bin', 'liveness.json', 'liveness.bin', 'sface-2021dec.onnx',
]) {
  await copyFile(path.join(facePackage, 'models', name), path.join(faceOut, 'models', name));
}
await copyFile(path.join(tfjsWasm, 'tfjs-backend-wasm-simd.wasm'), path.join(faceOut, 'wasm', 'tfjs-backend-wasm-simd.wasm'));
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(path.join(ortDist, name), path.join(faceOut, 'wasm', name));
}
console.log('Bundled the face engine to apps/api/dist/face');
