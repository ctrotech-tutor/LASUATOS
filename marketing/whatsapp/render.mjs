// Renders the WhatsApp group graphics from src/card.html.
//   node render.mjs                          -> versions without a QR code
//   GROUP_LINK=https://chat.whatsapp.com/... node render.mjs  -> adds a "scan to join" QR code
// Needs puppeteer-core, a Chromium binary (CHROME=/path) and the qrcode package.
// The page.evaluate callbacks run in the browser, where these exist.
/* global document, getComputedStyle */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(process.env.MODULES ? join(process.env.MODULES, 'x.js') : import.meta.url);
const puppeteer = require('puppeteer-core');
const QRCode = require('qrcode');

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const link = process.env.GROUP_LINK?.trim();
const qr = link ? await QRCode.toDataURL(link, { margin: 0, width: 600, errorCorrectionLevel: 'M', color: { dark: '#153B5BFF', light: '#FFFFFFFF' } }) : '';

const jobs = [
  { v: 'post', w: 1080, h: 1350, name: 'lasuatos-whatsapp-post' },
  { v: 'status', w: 1080, h: 1920, name: 'lasuatos-whatsapp-status' },
  { v: 'icon', w: 640, h: 640, name: 'lasuatos-whatsapp-group-icon', noQr: true },
];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/tmp/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--font-render-hinting=none'],
});
try {
  for (const job of jobs) {
    const page = await browser.newPage();
    await page.setViewport({ width: job.w, height: job.h, deviceScaleFactor: 1 });
    const url = pathToFileURL(join(here, 'src', 'card.html'));
    url.searchParams.set('v', job.v);
    if (qr && !job.noQr) url.searchParams.set('qr', qr);
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector('.panel');
      const foot = document.querySelector('.foot');
      if (!panel || !foot) return false;
      const limit = panel.getBoundingClientRect().bottom - parseFloat(getComputedStyle(panel).paddingBottom);
      return foot.getBoundingClientRect().bottom > limit + 1 || document.querySelector('.spacer').offsetHeight < 20;
    });
    if (overflow) console.warn(`! ${job.name}: content overflows the panel`);
    const file = join(out, `${job.name}${qr && !job.noQr ? '-qr' : ''}.png`);
    await page.screenshot({ path: file, type: 'png' });
    console.log('wrote', file);
    await page.close();
  }
} finally {
  await browser.close();
}
