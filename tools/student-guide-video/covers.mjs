// Designs the cover (poster) images for the student guide videos.
// Each cover = the real video frame + a designed overlay (title, part, duration),
// so what students see before pressing play actually says what the video is.
//
//   node covers.mjs            # writes into ../../apps/web/public/media/
//   node covers.mjs --preview  # writes into out/covers/ only
//
// Palette: warm cream + gold + leaf green on a deep moss scrim — deliberately
// NOT the navy used across the app chrome, so the covers read as editorial
// artwork rather than another screen of the app.
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(HERE, '../../apps/web/public/media');
const PREVIEW = process.argv.includes('--preview');
const OUT = PREVIEW ? path.join(HERE, 'out/covers') : MEDIA;

const BRAND_SVG = `<svg viewBox="0 0 48 48" fill="none" style="width:100%;height:100%"><rect x="1" y="1" width="46" height="46" rx="14" fill="#123f2e"/><path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke="#F7F8F4" stroke-width="2.2" stroke-linecap="round"/><path d="M18.5 35V25h12v10" stroke="#F7F8F4" stroke-width="2.2" stroke-linejoin="round"/><path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#E9C06A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="34.5" cy="12.5" r="2.3" fill="#E9C06A"/></svg>`;

const COVERS = [
  {
    file: 'student-guide-poster.jpg',
    kicker: 'The full guide',
    title: 'Three minutes, then you know LASUATOS.',
    meta: '3 MIN · ANY PHONE',
  },
  {
    file: 'student-guide-open-account.jpg',
    kicker: 'Part 1',
    title: 'Open your account',
    meta: '1 MIN',
  },
  {
    file: 'student-guide-face.jpg',
    kicker: 'Part 2',
    title: 'Register your face',
    meta: '20 SEC',
  },
  {
    file: 'student-guide-mark.jpg',
    kicker: 'Part 3',
    title: 'Install & mark attendance',
    meta: '35 SEC',
  },
  {
    file: 'student-guide-problems.jpg',
    kicker: 'Part 4',
    title: 'When it goes wrong',
    meta: '40 SEC',
  },
];

const page = (frameDataUri, { kicker, title, meta }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Inter var'; src: url('${HERE}/../../apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
  @font-face { font-family: 'Plus Jakarta Sans var'; src: url('${HERE}/../../apps/web/node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; }
  body {
    position: relative; font-family: 'Inter var', sans-serif;
    background:
      radial-gradient(1100px 800px at 85% -10%, rgba(233,192,106,.20), transparent 60%),
      radial-gradient(900px 900px at -20% 110%, rgba(46,125,91,.35), transparent 55%),
      linear-gradient(168deg, #0d251a 0%, #123f2e 58%, #0e2c20 100%);
  }
  .ribbon {
    position: absolute; top: 72px; left: 72px; right: 72px;
    display: flex; align-items: center; gap: 22px;
  }
  .mark { width: 92px; height: 92px; border-radius: 26px; overflow: hidden; box-shadow: 0 16px 36px rgba(0,0,0,.4); flex: none; background: #123f2e; }
  .ribbon-text .a { color: #fbf8ef; font: 800 34px 'Plus Jakarta Sans var'; letter-spacing: .02em; }
  .ribbon-text .b { margin-top: 5px; color: #e9c06a; font: 700 23px 'Inter var'; letter-spacing: .24em; text-transform: uppercase; }
  .title-block { position: absolute; top: 268px; left: 72px; right: 72px; }
  .kicker {
    display: inline-flex; align-items: center;
    padding: 13px 26px; border-radius: 999px;
    background: #e9c06a; color: #1d2a12;
    font: 800 27px 'Inter var'; letter-spacing: .15em; text-transform: uppercase;
  }
  h1 {
    margin-top: 32px; max-width: 14ch;
    color: #fbf8ef; font-family: 'Plus Jakarta Sans var';
    font-size: ${title.length > 30 ? 92 : 104}px; font-weight: 800; letter-spacing: -0.035em; line-height: 1.03;
  }
  .meta {
    position: absolute; left: 72px; top: ${title.length > 30 ? 726 : 668}px;
    display: inline-flex; align-items: center; gap: 14px;
    padding: 16px 28px; border-radius: 999px;
    background: rgba(251,248,239,.10); border: 2px solid rgba(251,248,239,.28);
    color: #fbf8ef; font: 750 29px 'Inter var'; letter-spacing: .12em;
  }
  .meta svg { width: 30px; height: 30px; }
  .window {
    position: absolute; left: 50%; bottom: -140px; width: 800px; height: 1050px;
    transform: translateX(-50%) rotate(-2.5deg);
    border-radius: 64px; overflow: hidden;
    border: 3px solid rgba(251,248,239,.16);
    box-shadow: 0 60px 120px -30px rgba(0,0,0,.6);
  }
  .window img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
</style></head><body>
  <div class="ribbon">
    <span class="mark">${BRAND_SVG}</span>
    <div class="ribbon-text"><div class="a">LASUATOS</div><div class="b">Student guide</div></div>
  </div>
  <div class="title-block">
    <span class="kicker">${kicker}</span>
    <h1>${title}</h1>
  </div>
  <div class="meta"><svg viewBox="0 0 24 24" fill="none" stroke="#e9c06a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>${meta}</div>
  <div class="window"><img src="${frameDataUri}" alt=""></div>
</body></html>`;

const browser = await launch();
const page_ = await browser.newPage();
await page_.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await mkdir(OUT, { recursive: true });

for (const cover of COVERS) {
  const frame = await readFile(path.join(MEDIA, cover.file));
  const dataUri = `data:image/jpeg;base64,${frame.toString('base64')}`;
  await page_.setContent(page(dataUri, cover), { waitUntil: 'load', timeout: 60000 });
  await page_.evaluate(async () => {
    await document.fonts.ready;
    const img = document.querySelector('img.frame');
    if (img && !img.complete) await new Promise((res) => { img.onload = res; img.onerror = res; });
    await img?.decode?.().catch(() => {});
  });
  const out = path.join(OUT, cover.file);
  await page_.screenshot({ path: out, type: 'jpeg', quality: 90 });
  console.log('cover', out);
}

await browser.close();
console.log('COVERS DONE');
