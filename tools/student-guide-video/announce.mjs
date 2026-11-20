// Announcement graphics for sharing on WhatsApp (1080×1080 squares).
// Same editorial family as the video covers: moss green + gold + cream,
// deliberately away from the app's navy chrome.
//
//   node announce.mjs    # writes out/announce-guide.jpg + out/announce-passkeys.jpg
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

const BRAND_SVG = `<svg viewBox="0 0 48 48" fill="none" style="width:100%;height:100%"><rect x="1" y="1" width="46" height="46" rx="14" fill="#123f2e"/><path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke="#F7F8F4" stroke-width="2.2" stroke-linecap="round"/><path d="M18.5 35V25h12v10" stroke="#F7F8F4" stroke-width="2.2" stroke-linejoin="round"/><path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#E9C06A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="34.5" cy="12.5" r="2.3" fill="#E9C06A"/></svg>`;

const FINGERPRINT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="#e9c06a" stroke-width="1.6" stroke-linecap="round" style="width:100%;height:100%"><path d="M12 11a3 3 0 0 0-3 3c0 2.5-.6 4.5-1.6 6"/><path d="M12 11a3 3 0 0 1 3 3c0 1.2-.1 2.4-.3 3.5"/><path d="M12 11v4c0 2.8-.5 5-1.4 6.8"/><path d="M6.2 8.2A7 7 0 0 1 19 13c0 1.5-.1 2.8-.3 4"/><path d="M4.5 10.5A9 9 0 0 1 21 13c0 1.2 0 2.3-.1 3.3"/><path d="M5 13a7 7 0 0 1 .5-2.6M5 13c0 2.9-.8 5.4-2 7.3" opacity=".9"/></svg>`;

const shell = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Inter var'; src: url('${HERE}/../../apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
  @font-face { font-family: 'Plus Jakarta Sans var'; src: url('${HERE}/../../apps/web/node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; }
  body {
    position: relative; font-family: 'Inter var', sans-serif;
    background:
      radial-gradient(900px 620px at 90% -12%, rgba(233,192,106,.22), transparent 60%),
      radial-gradient(760px 700px at -18% 112%, rgba(46,125,91,.4), transparent 55%),
      linear-gradient(160deg, #0d251a 0%, #123f2e 55%, #0c231a 100%);
    color: #fbf8ef;
  }
  .ribbon { position: absolute; top: 56px; left: 64px; display: flex; align-items: center; gap: 18px; }
  .mark { width: 72px; height: 72px; border-radius: 21px; overflow: hidden; box-shadow: 0 12px 28px rgba(0,0,0,.4); }
  .ribbon .a { font: 800 27px 'Plus Jakarta Sans var'; }
  .ribbon .b { margin-top: 3px; color: #e9c06a; font: 700 18px 'Inter var'; letter-spacing: .24em; text-transform: uppercase; }
  .kicker {
    position: absolute; top: 208px; left: 64px;
    display: inline-flex; padding: 11px 22px; border-radius: 999px;
    background: #e9c06a; color: #1d2a12;
    font: 800 21px 'Inter var'; letter-spacing: .15em; text-transform: uppercase;
  }
  h1 {
    position: absolute; top: 268px; left: 64px; width: 780px;
    font-family: 'Plus Jakarta Sans var'; font-weight: 800;
    font-size: 76px; letter-spacing: -0.032em; line-height: 1.04;
  }
  .sub { position: absolute; left: 64px; width: 640px; color: #cfe3d6; font-size: 27px; line-height: 1.5; font-weight: 500; }
  .url {
    position: absolute; left: 64px; bottom: 64px;
    display: inline-flex; align-items: center; gap: 12px;
    padding: 16px 30px; border-radius: 999px;
    background: #fbf8ef; color: #123f2e;
    font: 800 30px 'Inter var'; letter-spacing: .01em;
    box-shadow: 0 18px 44px -12px rgba(0,0,0,.5);
  }
  .url small { color: #4f7a63; font-weight: 700; }
  .dots { position: absolute; right: 64px; top: 64px; display: grid; grid-template-columns: repeat(3, 10px); gap: 12px; opacity: .5; }
  .dots span { width: 10px; height: 10px; border-radius: 50%; background: #e9c06a; }
</style></head><body>${body}
  <div class="dots">${'<span></span>'.repeat(9)}</div>
</body></html>`;

const ribbon = (sub) => `
  <div class="ribbon">
    <span class="mark">${BRAND_SVG}</span>
    <div><div class="a">LASUATOS</div><div class="b">${sub}</div></div>
  </div>`;

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
await mkdir(OUT, { recursive: true });

async function render(file, bodyHtml) {
  await page.setContent(shell(bodyHtml), { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const img of Array.from(document.images)) {
      if (!img.complete) await new Promise((res) => { img.onload = res; img.onerror = res; });
    }
  });
  await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 92 });
  console.log('announce', file);
}

/* ── 1. Student guide ── */
const cover = await readFile(path.join(HERE, '../../apps/web/public/media/student-guide-poster.jpg'));
await render('announce-guide.jpg', `
  ${ribbon('Student guide')}
  <span class="kicker">New · For students</span>
  <h1 style="width:660px">Three minutes.<br>Then you know LASUATOS.</h1>
  <p class="sub" style="top: 528px; width: 580px">One short video: open your account, register your face, mark attendance in class. Send it to your class group.</p>
  <div class="url">lasuatos.com.ng/start</div>
  <div style="position:absolute; right:-46px; bottom:-120px; width:400px; height:711px; transform:rotate(7deg); border-radius:48px; overflow:hidden; border:3px solid rgba(251,248,239,.2); box-shadow:0 50px 100px -20px rgba(0,0,0,.6)">
    <img src="data:image/jpeg;base64,${cover.toString('base64')}" style="width:100%;height:100%;object-fit:cover" alt="">
  </div>
`);

/* ── 2. Passkeys (staff) ── */
await render('announce-passkeys.jpg', `
  ${ribbon('Lecturers & admins')}
  <span class="kicker">New · Sign-in</span>
  <h1 style="width:820px">Your fingerprint is your password now.</h1>
  <p class="sub" style="top: 470px; width: 600px">Add a passkey once, then sign in with your phone or computer&rsquo;s fingerprint, face or screen lock. A fake sign-in page can&rsquo;t steal it the way it steals passwords.</p>
  <div class="url">lasuatos.com.ng <small>· Account → Security → Passkeys</small></div>
  <div style="position:absolute; right:84px; bottom:96px; width:284px; height:284px; border-radius:50%; background:rgba(233,192,106,.1); border:2px solid rgba(233,192,106,.35); display:grid; place-items:center; padding:50px; transform:rotate(4deg)">
    ${FINGERPRINT_SVG}
  </div>
`);

await browser.close();
console.log('ANNOUNCE DONE');
