// Captures real LASUATOS screens for the student walkthrough video.
//
// Runs against a local web app (`next dev`, see README.md). Every /api/v1 call is answered
// in the browser with made-up data for one example student, so no API, database or real
// account is involved, and the screens are exactly what students see.
//
//   node capture.mjs [baseUrl]      (default http://127.0.0.1:3100)
//
// Writes PNGs (1170x2532, an iPhone screen at 3x) to shots/.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
import { driveFaceCamera } from './face-sequence.mjs';
import { installFakeCamera, faceImages, qrImageDataUrl, SCAN_CHALLENGE, feed, hallImage } from './fake-media.mjs';
import { EXAMPLE, LECTURE, routes } from './mock-api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(here, 'shots');
mkdirSync(SHOTS, { recursive: true });
const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;



const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** waitForFunction with a useful dump when it times out (captures keep moving). */
async function waitText(page, regex, { timeout = 30_000, name = 'state' } = {}) {
  try {
    await page.waitForFunction((source) => new RegExp(source).test(document.body.innerText), { timeout }, regex.source);
  } catch (error) {
    await page.screenshot({ path: join(SHOTS, `debug-${name}.png`) }).catch(() => undefined);
    console.log(`stuck waiting for ${regex} (${name}):`, (await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n+/g, ' | '));
    throw error;
  }
}

/** A phone-sized page whose /api/v1 calls are answered by `api` (a mutable state machine). */
async function phonePage(browser, api, { camera = null } = {}) {
  const page = await browser.newPage();
  if (camera === 'face') await installFakeCamera(page, { faces: faceImages() });
  if (camera === 'scan') await installFakeCamera(page, { faces: faceImages(), hall: hallImage(), qr: await qrImageDataUrl(SCAN_CHALLENGE) });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36');
  await page.emulateTimezone('Africa/Lagos');
  // The Next.js dev badge and toasts from the dev overlay never belong in a frame.
  await page.evaluateOnNewDocument(() => {
    const style = () => {
      const tag = document.createElement('style');
      tag.textContent = 'nextjs-portal{display:none!important} *{caret-color:transparent!important}';
      document.documentElement.appendChild(tag);
    };
    if (document.documentElement) style();
    else document.addEventListener('DOMContentLoaded', style);
  });
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/v1/')) return request.continue();
    const answer = await api(request.method(), url.pathname, request.postData() ? JSON.parse(request.postData()) : null);
    if (answer.delay) await sleep(answer.delay);
    request.respond({
      status: answer.status ?? 200,
      contentType: (answer.status ?? 200) >= 400 ? 'application/problem+json' : 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(answer.body ?? {}),
    }).catch(() => undefined);
  });
  page.on('pageerror', (error) => console.warn('page error:', error.message.slice(0, 200)));
  return page;
}

async function shot(page, name, settle = 700) {
  if (only && !only.has(name.split('-')[0])) return;
  await sleep(settle);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  console.log('shot', name);
}

async function signUp(browser) {
  const api = routes({ signedIn: false });
  const page = await phonePage(browser, api, { camera: 'face' });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await shot(page, 'home-top', 1200);

  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await shot(page, 'matric-00', 900);
  const matric = await page.$('input[name="matricNumber"]');
  for (let index = 0; index < EXAMPLE.matric.length; index += 1) {
    await matric.type(EXAMPLE.matric[index]);
    await shot(page, `matric-${String(index + 1).padStart(2, '0')}`, index === EXAMPLE.matric.length - 1 ? 250 : 120);
  }
  await page.waitForSelector('.obf-id, [class*="id-card"], .obf-form', { timeout: 15_000 });
  await page.waitForFunction(() => document.body.innerText.includes('Is this you?'), { timeout: 15_000 });
  await shot(page, 'found-00', 1000);

  // "Yes, send my code" (pressed state first, for the tap).
  const send = await page.waitForSelector('xpath/.//button[contains(., "Yes, send my code")]');
  await send.click();
  await page.waitForFunction(() => document.body.innerText.includes('Check your email'), { timeout: 15_000 });
  await shot(page, 'code-00', 1000);
  const code = await page.$('input[name="code"], input[autocomplete="one-time-code"]');
  for (let index = 0; index < EXAMPLE.code.length; index += 1) {
    await code.type(EXAMPLE.code[index]);
    await shot(page, `code-${String(index + 1).padStart(2, '0')}`, index === EXAMPLE.code.length - 1 ? 250 : 120);
  }
  const openButton = await page.$('xpath/.//button[contains(., "Open my account")]');
  if (openButton && !(await openButton.evaluate((button) => button.disabled))) await openButton.click().catch(() => undefined);
  await page.waitForFunction(() => document.body.innerText.includes('Welcome,'), { timeout: 20_000 });
  await shot(page, 'password-00', 1200);

  const saved = await page.waitForSelector('xpath/.//button[contains(., "saved it")]');
  await saved.click();
  await page.waitForFunction(() => document.body.innerText.includes('Register your face'), { timeout: 15_000 });
  await shot(page, 'face-00', 1200);
  await page.evaluate(() => document.querySelector('.obf-consent input')?.click());
  await page.evaluate(() => document.querySelector('.obf-consent')?.scrollIntoView({ block: 'center' }));
  await shot(page, 'face-01', 800);

  // The face camera, driven by the prepared photos (see face-sequence.mjs).
  const openCamera = await page.waitForSelector('xpath/.//button[contains(., "Open the camera")]');
  await openCamera.click();
  try {
    await page.waitForSelector('.fx-screen', { timeout: 20_000 });
  } catch {
    await page.screenshot({ path: join(SHOTS, 'face-debug.png') });
    console.log('after click:', (await page.evaluate(() => document.body.innerText)).slice(0, 500));
    throw new Error('camera overlay did not open');
  }
  await shot(page, 'face-live-front', 2500); // the ring found the face
  const timeline = await driveFaceCamera(page, { onMoment: (name) => shot(page, name, 0) });
  console.log('face timeline', JSON.stringify(timeline));
  // The camera can end on its review step: approve the photos, as a student would.
  const usePhotos = await page.$('xpath/.//button[contains(., "Use these photos")]');
  if (usePhotos) {
    await shot(page, 'face-review', 600);
    await usePhotos.click();
  }
  await page.waitForFunction(() => document.body.innerText.includes('all set'), { timeout: 25_000 });
  await shot(page, 'done-00', 1200);
  await page.close();
}

/** Mark attendance: scan the hall QR, confirm the class, face check, marked present. */
async function scanCheckIn(browser) {
  const api = routes({ signedIn: true, lecture: true, lectureDelay: 2600 });
  const page = await phonePage(browser, api, { camera: 'scan' });
  await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);
  await page.setGeolocation({ latitude: LECTURE.latitude, longitude: LECTURE.longitude, accuracy: 12 });

  await page.goto(`${BASE}/a`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await shot(page, 'scan-00', 1000);

  await feed.mode(page, 'hall');
  await feed.qr(page, false);
  const startScan = await page.waitForSelector('xpath/.//button[contains(., "Scan the QR code")]');
  await startScan.click();
  await sleep(800); // the camera opens on the hall
  const qrAt = Date.now();
  await feed.qr(page, true); // the screen "refreshes": the QR fades in
  // Burst while the QR fades in: the decode lands near the end of the fade; the frames
  // just before it are the live viewfinder framing the QR. The resolve time is logged
  // by the mock; the best frame is picked when editing.
  for (let index = 0; index < 10; index += 1) {
    await sleep(150);
    await page.screenshot({ path: join(SHOTS, `scan-live-${String(index).padStart(2, '0')}.png`) });
  }
  console.log('qr flip at', qrAt, 'resolved around (see mock log above)');
  await shot(page, 'scan-01', 0);
  await waitText(page, /Mark me present/, { timeout: 25_000, name: 'checkin-form' });
  // Re-issue the fix: the app discards readings stamped before it started watching.
  await page.setGeolocation({ latitude: LECTURE.latitude, longitude: LECTURE.longitude, accuracy: 12 });
  await shot(page, 'checkin-00', 1200);

  await feed.mode(page, 'face');
  await feed.frame(page, 'front');
  const markMe = await page.waitForSelector('xpath/.//button[contains(., "Mark me present")]');
  await markMe.click();
  await page.setGeolocation({ latitude: LECTURE.latitude, longitude: LECTURE.longitude, accuracy: 10 });
  await page.waitForSelector('.fx-screen', { timeout: 20_000 });
  await shot(page, 'checkin-face', 1800);
  await driveFaceCamera(page, { onMoment: (name) => shot(page, `checkin-${name}`, 0) });
  await waitText(page, /marked present|Already marked/, { timeout: 30_000, name: 'checkin-done' });
  await shot(page, 'checkin-done', 1400);

  // "Phone dead? Borrow a classmate's": the same screen offers marking a classmate.
  const classmate = await page.$('xpath/.//button[contains(., "Mark a classmate")]');
  if (classmate) {
    await classmate.click();
    await page.waitForFunction(() => document.body.innerText.includes('sign in to mark yourself'), { timeout: 15_000 });
    const identifier = await page.$('input#sc-identifier, input[name="identifier"]');
    if (identifier) {
      await identifier.type(EXAMPLE.matric, { delay: 90 });
      const password = await page.$('input[type="password"]');
      if (password) await password.type(`LASU${EXAMPLE.matric}${EXAMPLE.surname}`, { delay: 60 });
    }
    await shot(page, 'checkin-classmate', 900);
  }
  await page.close();
}

/** The typed-code path (QR damaged): six characters under the QR on the screen. */
async function typedCode(browser) {
  const api = routes({ signedIn: true, lecture: true });
  const page = await phonePage(browser, api);
  await page.goto(`${BASE}/a`, { waitUntil: 'networkidle0', timeout: 120_000 });
  const input = await page.waitForSelector('#sc-code-input');
  await input.click();
  await input.type('K7M29Q', { delay: 140 });
  await shot(page, 'scan-code-typed', 900);
  await page.close();
}

/** My attendance: the 75% line, per-course standing, the history. */
async function attendancePage(browser) {
  const api = routes({ signedIn: true, history: true });
  const page = await phonePage(browser, api);
  await page.goto(`${BASE}/attendance`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => document.body.innerText.includes('My attendance') && document.body.innerText.includes('ECE 101'), { timeout: 25_000 });
  await shot(page, 'attendance-00', 1600);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight * 0.42, behavior: 'instant' }));
  await shot(page, 'attendance-01', 900);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await shot(page, 'attendance-02', 900);
  await page.close();
}

const FLOWS = (process.env.FLOWS ?? 'signup,scan,typed,attendance').split(',');
async function helpInstall(browser) {
  const api = routes({ signedIn: true });
  const page = await phonePage(browser, api);
  await page.goto(`${BASE}/help#install`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await sleep(800);
  await page.evaluate(() => document.querySelector('#install')?.scrollIntoView({ block: 'start' }));
  await shot(page, 'help-install', 1200);
  await page.close();
}

const browser = await launch();
try {
  if (FLOWS.includes('help')) await helpInstall(browser);
  if (FLOWS.includes('signup')) await signUp(browser);
  if (FLOWS.includes('scan')) await scanCheckIn(browser);
  if (FLOWS.includes('typed')) await typedCode(browser);
  if (FLOWS.includes('attendance')) await attendancePage(browser);
} finally {
  await browser.close();
}
