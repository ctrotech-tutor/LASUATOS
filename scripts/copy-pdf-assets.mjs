/**
 * Puts pdf.js's worker where the browser loads it when a HOC uploads a class list as a PDF:
 * apps/web/public/pdf/pdf.worker-<version>.min.mjs (copied from node_modules, not committed).
 * The legacy build is used, as in apps/web/lib/class-import/pdf.ts, so older Android browsers
 * can read PDFs too.
 *
 * Run by the web app's dev and build scripts. The version in the file name must match
 * PDF_RUNTIME_VERSION in apps/web/lib/class-import/pdf.ts, so a new release is a new URL and
 * a phone never pairs an old worker with a new reader.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PDF_RUNTIME_VERSION = '6.5.438';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../apps/web');
const publicPdf = path.join(web, 'public/pdf');

export function copyPdfAssets() {
  const require = createRequire(path.join(web, 'package.json'));
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (version !== PDF_RUNTIME_VERSION) {
    throw new Error(`pdfjs-dist is ${version}, but the class-list reader expects ${PDF_RUNTIME_VERSION}. Update PDF_RUNTIME_VERSION here and in apps/web/lib/class-import/pdf.ts together.`);
  }
  const name = `pdf.worker-${PDF_RUNTIME_VERSION}.min.mjs`;
  const from = path.join(root, 'legacy/build/pdf.worker.min.mjs');
  const to = path.join(publicPdf, name);
  mkdirSync(publicPdf, { recursive: true });
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
  // Drop workers of earlier versions.
  for (const file of readdirSync(publicPdf)) if (file !== name) rmSync(path.join(publicPdf, file), { force: true, recursive: true });
  return to;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = copyPdfAssets();
  console.log(`PDF reader worker ready at ${path.relative(process.cwd(), target) || target}`);
}
