// Follows the app's guided face camera while the fake camera (fake-media.mjs) shows the
// matching photo for each step: straight on, a blink, the head turn the overlay asks for.
// The driver reads the overlay's own guidance text, so it follows the app whatever order
// the steps come in, and zooms when the guidance asks for closer/further.

import { feed } from './fake-media.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The step the app's camera overlay is asking for, read from its own title (#fx-title). */
export async function readFaceStep(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.fx-screen');
    if (!dialog) return 'absent';
    const title = dialog.querySelector('#fx-title')?.textContent ?? '';
    const detail = dialog.querySelector('.fx-detail')?.textContent ?? '';
    if (/All done|Checking your photos|Check your photos/i.test(title)) return 'done';
    if (/blink/i.test(title)) return 'blink';
    if (/to your left/i.test(title)) return 'left';
    if (/to your right/i.test(title)) return 'right';
    if (/closer/i.test(detail)) return 'closer';
    if (/further/i.test(detail)) return 'further';
    if (/Look straight/i.test(title)) return 'front';
    if (/can’t see your face|can't see your face|Getting the camera/i.test(title)) return 'waiting';
    return 'other';
  });
}

/** Raw overlay text, for debugging a stuck capture. */
export async function readFaceText(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.fx-screen');
    if (!dialog) return null;
    const title = dialog.querySelector('#fx-title')?.textContent ?? '';
    const detail = dialog.querySelector('.fx-detail')?.textContent ?? '';
    return { title, detail };
  });
}

/**
 * Drives the camera to the end. Takes screenshots along the way with `onMoment(name)`.
 * Resolves with a timeline of { at, step } entries (ms since the camera opened), or
 * throws on timeout.
 */
export async function driveFaceCamera(page, { onMoment, timeoutMs = 120_000 } = {}) {
  const started = Date.now();
  const timeline = [];
  let blinkedAt = 0;
  let zoom = 1;
  let lastStep = '';
  const note = (step) => {
    if (step !== lastStep) {
      timeline.push({ at: Date.now() - started, step });
      lastStep = step;
    }
  };
  for (;;) {
    const step = await readFaceStep(page);
    note(step);
    if (step === 'absent' || step === 'done') return timeline;
    if (Date.now() - started > timeoutMs) {
      console.log('timeline', JSON.stringify(timeline));
      console.log('overlay now:', JSON.stringify(await readFaceText(page)));
      throw new Error(`face camera stuck on "${step}" after ${timeoutMs}ms`);
    }
    if (step === 'closer' || step === 'further') {
      zoom = await feed.zoom(page, step === 'closer' ? zoom * 1.3 : zoom / 1.3);
    } else if (step === 'front' || step === 'waiting' || step === 'other') {
      await feed.frame(page, 'front');
    } else if (step === 'left' || step === 'right') {
      await feed.frame(page, step);
      if (onMoment && !timeline.some((m) => m.step === `${step}-shot`)) {
        timeline.push({ at: Date.now() - started, step: `${step}-shot` });
        await sleep(1000); // the turn plays, the ring reacts, then take the photo for the video
        await onMoment(`face-live-${step}`);
      }
    } else if (step === 'blink') {
      if (onMoment && !timeline.some((m) => m.step === 'front-shot')) {
        // The front photo is already taken by now; the camera sits locked on the face,
        // which is the right moment for the "look straight at it" shot.
        timeline.push({ at: Date.now() - started, step: 'front-shot' });
        await sleep(500);
        await onMoment('face-live-front');
      }
      if (Date.now() - blinkedAt > 1500) {
        blinkedAt = Date.now();
        await sleep(400); // read the words first, then blink
        await feed.frame(page, 'blink');
        if (onMoment) await onMoment('face-live-blink');
        await sleep(260); // a real blink: shut briefly, then open again (under the 1.2 s reset)
        await feed.frame(page, 'front');
      }
    }
    await sleep(180);
  }
}
