import { build } from 'esbuild';
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
  external: ['pg-native'],
  // Bundled CommonJS dependencies call require(); give ESM output a real one.
  banner: {
    js: "import { createRequire as __lasuatosCreateRequire } from 'node:module'; const require = __lasuatosCreateRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('Bundled the embedded API to apps/api/dist/embedded.mjs');
