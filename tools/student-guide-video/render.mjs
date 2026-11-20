// Renders the student guide video: scrubs scenes.js frame by frame in headless
// Chromium and pipes PNGs to ffmpeg, then muxes the narration. Also cuts the
// four short clips from the master.
//
//   node render.mjs still <segmentIndex> <t>   one frame as PNG (for reviewing the edit)
//   node render.mjs segment <n>                one segment as mp4 (no audio)
//   node render.mjs full                       the whole film + the 4 clips, into out/
//
// ffmpeg comes from imageio-ffmpeg (python3), already used by the older tooling.
import { execFileSync, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });

const FFMPEG = execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
const FPS = 24;

// The storyboard is the source of truth for lengths; read it from the page after load.
let SEGMENTS = [];
let starts = [];
let TOTAL = 0;
function readTimeline(segments) {
  SEGMENTS = segments;
  starts.length = 0;
  SEGMENTS.forEach((seg, i) => { starts.push(i === 0 ? 0 : starts[i - 1] + SEGMENTS[i - 1].len); });
  TOTAL = SEGMENTS.reduce((sum, seg) => sum + seg.len, 0);
}

/** Clips cut from the master: [name, firstSegmentIndex, lastSegmentIndexInclusive]. */
const CLIPS = [
  ['clip-a-open-account', 1, 4],
  ['clip-b-face', 5, 5],
  ['clip-c-mark', 6, 7],
  ['clip-d-problems', 8, 9],
];

async function stage() {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto(`file://${join(here, 'scenes.html')}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const segments = await page.evaluate(() => window.__SEGMENTS);
  return { browser, page, segments };
}

/** Encode frames [t0, t1) to an mp4, with the given audio files (concatenated). */
async function encode(page, t0, t1, audioFiles, outFile) {
  const frames = Math.round((t1 - t0) * FPS);
  const args = [
    '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    ...audioFiles.flatMap((file) => ['-i', file]),
    ...(audioFiles.length
      ? ['-filter_complex', audioFiles.map((_, i) => `[${i + 1}:a]`).join('') + `concat=n=${audioFiles.length}:v=0:a=1[a]`]
      : []),
    '-map', '0:v',
    ...(audioFiles.length ? ['-map', '[a]'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-r', String(FPS),
    '-movflags', '+faststart',
    ...(audioFiles.length ? ['-c:a', 'aac', '-b:a', '128k'] : []),
    '-shortest',
    outFile,
  ];
  const ff = execFile(FFMPEG, args, (error) => { if (error) console.error('ffmpeg:', error.message.slice(0, 400)); });
  ff.stdin.on('error', () => undefined); // EPIPE if ffmpeg dies first
  const wall0 = Date.now();
  for (let frame = 0; frame < frames; frame += 1) {
    const t = t0 + frame / FPS;
    await page.evaluate((time) => window.setTime(time), t);
    const png = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise((resolve) => ff.stdin.once('drain', resolve));
    if (frame % 240 === 0) console.log(`  frame ${frame}/${frames} (${((Date.now() - wall0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((resolve, reject) => ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
}

async function main() {
  const [mode, arg1, arg2] = process.argv.slice(2);
  const { browser, page, segments } = await stage();
  readTimeline(segments);
  try {
    if (mode === 'still') {
      const seg = SEGMENTS[Number(arg1)];
      const t = starts[Number(arg1)] + Number(arg2);
      const info = await page.evaluate((time) => window.setTime(time), t);
      const file = join(OUT, `still-${seg.id}-${Number(arg2).toFixed(2)}.png`);
      writeFileSync(file, await page.screenshot({ type: 'png' }));
      console.log('still', file, JSON.stringify(info));
      return;
    }
    if (mode === 'segment') {
      const index = Number(arg1);
      await encode(page, starts[index], starts[index] + SEGMENTS[index].len, [], join(OUT, `segment-${SEGMENTS[index].id}.mp4`));
      console.log('segment done', SEGMENTS[index].id);
      return;
    }
    if (mode === 'full') {
      await encode(page, 0, TOTAL, SEGMENTS.map((seg) => join(here, 'audio', `${seg.id}.mp3`)), join(OUT, 'lasuatos-student-guide.mp4'));
      console.log('master done', join(OUT, 'lasuatos-student-guide.mp4'), 'cutting clips');
      for (const [name, from, to] of CLIPS) {
        const start = starts[from];
        const end = starts[to] + SEGMENTS[to].len;
        execFileSync(FFMPEG, [
          '-y', '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', join(OUT, 'lasuatos-student-guide.mp4'),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium',
          '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
          join(OUT, `${name}.mp4`),
        ], { stdio: 'inherit' });
        console.log('clip', name);
      }
      return;
    }
    console.error('usage: still <segmentIndex> <t> | segment <n> | full');
  } finally {
    await browser.close();
  }
}

await main();
