// Pulls the real video frames that covers.mjs embeds in its preview windows.
// Frames are sampled PAST each clip's opening title card, so the window shows
// actual app content. Needs the web dev server on :3100 (it serves /media).
//
//   node frames.mjs            # writes out/frames/*.jpg, then run covers.mjs
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out/frames');
const ORIGIN = process.env.FRAMES_ORIGIN ?? 'http://127.0.0.1:3100';

/* Seconds into each video where a real screen (not a title card) is showing. */
const SHOTS = [
  { video: 'student-guide.mp4', at: 62, out: 'student-guide-poster.jpg' },
  { video: 'student-guide-open-account.mp4', at: 9, out: 'student-guide-open-account.jpg' },
  { video: 'student-guide-face.mp4', at: 7, out: 'student-guide-face.jpg' },
  { video: 'student-guide-mark.mp4', at: 20, out: 'student-guide-mark.jpg' },
  { video: 'student-guide-problems.mp4', at: 11, out: 'student-guide-problems.jpg' },
];

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await mkdir(OUT, { recursive: true });

for (const shot of SHOTS) {
  await page.setContent(
    `<body style="margin:0;background:#000"><video src="${ORIGIN}/media/${shot.video}" style="display:block;width:1080px;height:1920px;object-fit:cover" preload="auto" muted></video></body>`,
    { waitUntil: 'load', timeout: 60000 },
  );
  await page.evaluate(async (t) => {
    const v = document.querySelector('video');
    if (v.readyState < 1) {
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video failed')); });
    }
    const seeked = new Promise((res) => { v.addEventListener('seeked', res, { once: true }); });
    v.currentTime = Math.min(t, (v.duration || t) - 0.2);
    await seeked;
  }, shot.at);
  const out = path.join(OUT, shot.out);
  await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
  console.log('frame', out);
}

await browser.close();
console.log('FRAMES DONE');
