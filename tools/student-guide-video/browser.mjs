// Headless Chromium for capture and rendering, from npm only (no system browser needed).
// @sparticuz/chromium ships the browser plus the NSS libraries Debian images lack; we unpack
// those once and point the loader at them before launching.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const libs = join(here, 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br');
const libDir = join(process.env.TMPDIR ?? '/tmp', 'lasuatos-chromium-libs');

function unpackLibraries() {
  if (existsSync(join(libDir, 'lib', 'libnss3.so'))) return;
  mkdirSync(libDir, { recursive: true });
  const tar = join(libDir, 'al.tar');
  writeFileSync(tar, brotliDecompressSync(readFileSync(libs)));
  execFileSync('tar', ['xf', tar, '-C', libDir]);
}

export async function launch() {
  unpackLibraries();
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [...chromium.args, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--hide-scrollbars', '--font-render-hinting=none'],
    env: { ...process.env, LD_LIBRARY_PATH: [join(libDir, 'lib'), '/tmp', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  });
}
