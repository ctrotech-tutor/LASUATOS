// A fake camera for captures: replaces getUserMedia with a canvas-drawn stream we
// control, so the real app (MediaPipe guidance, QR scanning) runs against a scripted
// but moving picture: a student facing the camera, blinking and turning for the face
// steps, or the lecture hall with the class QR code for the scanner.
//
// The stream is a real MediaStream (canvas.captureStream), so everything downstream —
// the app's video element, the face landmarker, the QR reader — works exactly as with
// a physical camera. Photos the app takes from it are the prepared face images.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require2 = createRequire(join(here, '..', '..', 'apps', 'web', 'package.json'));
const QRCode = require2('qrcode');

const dataUrl = (name) => `data:image/jpeg;base64,${readFileSync(join(here, 'media', name)).toString('base64')}`;

export const hallImage = () => dataUrl('lecture-hall.jpg');

export function faceImages() {
  return {
    front: dataUrl('student-front.jpg'),
    blink: dataUrl('student-blink.jpg'),
    // The tracker reads yaw in the unmirrored-camera convention: the app's 'left'
    // step needs a negative yaw, which is the photo of the head turned toward the
    // viewer's right (measured with face-probe.mjs: step-right.jpg = -0.85,
    // step-left.jpg = +0.85; the steps pass at +/-0.42, wrong-way below -0.18).
    left: dataUrl('student-step-right.jpg'),
    right: dataUrl('student-step-left.jpg'),
  };
}

/** The QR payload the scanner reads: a challenge in the real format (the resolve call is mocked). */
export const SCAN_CHALLENGE = 'lasu2.1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d.1731600000000.Kx29QmV7pLwR4sTuYzA1Bc';

export async function qrImageDataUrl(text) {
  return QRCode.toDataURL(text, { width: 560, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#101418', light: '#ffffff' } });
}

/**
 * Installs the fake camera for every document this page loads. Must run before the app's
 * scripts (right after newPage, before goto). Control it later from Node with feedSet().
 */
export async function installFakeCamera(page, { faces = null, hall = null, qr = null } = {}) {
  await page.evaluateOnNewDocument((facesIn, hallIn, qrIn) => {
    const state = {
      mode: 'face', // 'face' | 'hall'
      frame: 'front',
      zoom: 1.25,
      fade: 1, // 0..1 progress into the current frame swap
      prev: null,
      pan: 0, // -1..1 while turning, eases back
      panTarget: 0,
      qrOn: true, // the QR can appear a beat after the camera opens (the screen "refreshing")
      qrAlpha: 1,
    };
    const images = {};
    const load = (key, url) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
      images[key] = img;
    });
    const ready = (async () => {
      const jobs = [];
      if (facesIn) for (const [name, url] of Object.entries(facesIn)) jobs.push(load(`face:${name}`, url));
      if (hallIn) jobs.push(load('hall', hallIn));
      if (qrIn) jobs.push(load('qr', qrIn));
      await Promise.all(jobs);
    })();

    const WIDTH = 768;
    const HEIGHT = 1024;
    const streams = [];

    // Face centre in each photo (fractions of the image, measured with face-probe.mjs).
    // The painter puts that point at the middle of the app's round viewfinder, whatever
    // the zoom, so 'Move your face to the middle of the circle' never fires.
    const FOCUS = {
      'face:front': [0.51, 0.505],
      'face:blink': [0.505, 0.515],
      'face:left': [0.56, 0.48],
      'face:right': [0.45, 0.49],
    };
    const drawCover = (ctx, img, { key, zoom = 1, panX = 0, sway = 0, breathe = 0 } = {}) => {
      const scale = Math.max(HEIGHT / img.height, WIDTH / img.width) * zoom * (1 + breathe);
      const w = img.width * scale;
      const h = img.height * scale;
      const focus = FOCUS[key] ?? [0.5, 0.42];
      const x = WIDTH * 0.5 - focus[0] * w + panX * WIDTH * 0.06 + sway * WIDTH * 0.004;
      const y = HEIGHT * 0.5 - focus[1] * h;
      ctx.drawImage(img, x, y, w, h);
    };

    let t0 = performance.now();
    const paint = (ctx) => {
      const t = (performance.now() - t0) / 1000;
      const sway = Math.sin(t * 0.9) + Math.sin(t * 1.7) * 0.4; // handheld drift
      const breathe = Math.sin(t * 1.1) * 0.006;
      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      if (state.mode === 'hall' && images.hall?.complete) {
        drawCover(ctx, images.hall, { key: 'hall', sway: sway * 0.6, breathe });
        if (!state.qrOn) state.qrAlpha = 0; // off is instant: no decodable frame while it fades
        else if (state.qrAlpha < 1) state.qrAlpha = Math.min(1, state.qrAlpha + 0.05);
        const qr = images.qr;
        if (qr?.complete && state.qrAlpha > 0) {
          ctx.globalAlpha = state.qrAlpha;
          const size = WIDTH * 0.42;
          // The QR sits where the projector screen is in the hall photo.
          const x = (WIDTH - size) / 2 + sway * WIDTH * 0.004;
          const y = HEIGHT * 0.26 + Math.sin(t * 1.3) * 2;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,.35)';
          ctx.shadowBlur = 24;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - 14, y - 14, size + 28, size + 28);
          ctx.shadowBlur = 0;
          ctx.drawImage(qr, x, y, size, size);
          ctx.restore();
          ctx.globalAlpha = 1;
        }
        return;
      }
      const current = images[`face:${state.frame}`];
      const previous = state.prev ? images[`face:${state.prev}`] : null;
      if (previous?.complete && state.fade < 1) {
        ctx.globalAlpha = 1;
        drawCover(ctx, previous, { key: `face:${state.prev}`, zoom: state.zoom, panX: state.pan * (1 - state.fade), sway, breathe });
        ctx.globalAlpha = state.fade;
      }
      if (current?.complete) drawCover(ctx, current, { key: `face:${state.frame}`, zoom: state.zoom, panX: state.pan * state.fade, sway, breathe });
      ctx.globalAlpha = 1;
    };

    const startPainter = () => {
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d');
      const tick = () => {
        if (state.fade < 1) state.fade = Math.min(1, state.fade + 0.16);
        paint(ctx);
      };
      const timer = setInterval(tick, 66); // ~15 fps
      tick();
      const stream = canvas.captureStream(15);
      streams.push({ stream, timer });
      return stream;
    };

    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints?.video) return ready.then(() => Promise.resolve(startPainter()));
      return real(constraints);
    };

    window.__feed = {
      ready,
      setMode: (mode) => { state.mode = mode; },
      set(frame) {
        if (state.frame === frame) return;
        state.prev = state.frame;
        state.frame = frame;
        state.fade = 0;
        state.pan = frame === 'left' ? -1 : frame === 'right' ? 1 : 0;
      },
      setZoom: (zoom) => { state.zoom = Math.min(2.4, Math.max(0.8, zoom)); return state.zoom; },
      getZoom: () => state.zoom,
      now: () => state.frame,
      hall: (on) => { state.mode = on ? 'hall' : 'face'; },
      showQr: (on) => { state.qrOn = on; if (!on) state.qrAlpha = 0; },
    };
  }, faces, hall, qr);
}

/** Node-side helpers, matching the injected control. */
export const feed = {
  mode: (page, mode) => page.evaluate((m) => window.__feed?.setMode(m), mode),
  qr: (page, on) => page.evaluate((value) => window.__feed?.showQr(value), on),
  frame: (page, frame) => page.evaluate((f) => window.__feed?.set(f), frame),
  zoom: (page, zoom) => page.evaluate((z) => window.__feed?.setZoom(z) ?? z, zoom),
  currentZoom: (page) => page.evaluate(() => window.__feed?.getZoom() ?? 1),
};
