'use client';

import type { FaceFrame, FacePose } from '@lasuatos/contracts';
import { Check, ChevronLeft, ChevronRight, Lightbulb, LockKeyhole, RotateCcw, Timer, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BlinkDetector,
  FACE_GUIDE,
  assessFace,
  captureSteps,
  faceWords,
  patchStats,
  turnProgress,
  type FaceBox,
  type FaceHint,
  type FaceObservation,
  type FaceStep,
} from '../lib/face-guide';
import { loadFaceLandmarker, observeFace } from '../lib/face-tracker';
import { warmFaceChecks } from '../lib/student-api';

/**
 * The face camera: a full-screen, guided selfie capture in the style of
 * banking and wallet apps.
 *
 * An on-device face tracker (lib/face-tracker.ts) watches the camera and the
 * screen gives one instruction at a time: fit your face in the circle, move
 * closer, face a light, hold still. Each photo is taken by itself the moment
 * everything is right (the sharpest of a short burst), then the student
 * blinks once and turns their head as asked. Nobody taps a button with the
 * phone at arm's length.
 *
 * If the tracker cannot run on a phone (very old browsers), or a student is
 * stuck, the camera falls back to the simple mode: a countdown per photo.
 *
 * Photos are taken from the raw camera picture, never the mirrored preview,
 * so "turned to their left" stays the student's own left when the server
 * measures the head pose. The server checks every photo again; nothing here
 * is trusted. The camera is switched off as soon as the photos are taken or
 * the screen closes.
 */

const MAX_EDGE = 720;
const JPEG_QUALITY = 0.88;
const TRACKER_TIMEOUT_MS = 25_000;
const STUCK_MS = 22_000;
const BLINK_SKIP_MS = 9_000;
const ENCODE_TIMEOUT_MS = 4_000;
/** "All done" normally lasts half a second; past this the screen offers a way out. */
const HAND_OVER_SLOW_MS = 8_000;
const RING_LENGTH = 2 * Math.PI * 48;

type Mode = 'guided' | 'simple';

type Phase =
  | { readonly kind: 'starting' }
  | { readonly kind: 'live' }
  | { readonly kind: 'done' }
  | { readonly kind: 'review' }
  | { readonly kind: 'error'; readonly message: string };

interface Candidate {
  readonly canvas: HTMLCanvasElement;
  readonly sharpness: number;
}

interface LiveState {
  stepIndex: number;
  stepStartedAt: number;
  holdStartedAt: number;
  badFrames: number;
  lastDetectAt: number;
  interval: number;
  cost: number;
  prevNose: { x: number; y: number } | null;
  motion: number;
  luma: number | null;
  lumaAt: number;
  blink: BlinkDetector;
  candidates: Candidate[];
  frames: Promise<FaceFrame>[];
  finished: boolean;
}

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function cameraProblem(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access is blocked. Allow the camera for this site in your browser settings (tap the lock or “aA” beside the address), then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No front camera was found. Use a phone with a front camera.';
  if (name === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
  return 'The camera could not be started. Close other apps using it and try again.';
}

function freshLive(now: number): LiveState {
  return {
    stepIndex: 0,
    stepStartedAt: now,
    holdStartedAt: 0,
    badFrames: 0,
    lastDetectAt: 0,
    interval: 66,
    cost: 30,
    prevNose: null,
    motion: 0,
    luma: null,
    lumaAt: 0,
    blink: new BlinkDetector(),
    candidates: [],
    frames: [],
    finished: false,
  };
}

/** The whole (unmirrored) camera picture, scaled to at most MAX_EDGE. */
function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The camera is not ready yet.');
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The photo could not be taken.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encodeFrame(canvas: HTMLCanvasElement): Promise<string> {
  // Some phone browsers never call toBlob back under memory pressure: fall back to toDataURL
  // rather than leave the student on "Checking your photos…".
  const blob = await new Promise<Blob | null | 'slow'>((resolve) => {
    const timer = window.setTimeout(() => resolve('slow'), ENCODE_TIMEOUT_MS);
    canvas.toBlob((result) => { window.clearTimeout(timer); resolve(result); }, 'image/jpeg', JPEG_QUALITY);
  });
  if (blob === 'slow' || !blob) {
    const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const base64 = url.startsWith('data:image/jpeg;base64,') ? url.slice(url.indexOf(',') + 1) : '';
    if (!base64) throw new Error('The photo could not be taken.');
    return base64;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Brightness and sharpness of the face, from a small copy of it. */
function measureFace(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, box: FaceBox, patch: HTMLCanvasElement): { luma: number; sharpness: number } | null {
  const context = patch.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const size = patch.width;
  const x = Math.max(0, box.x * sourceWidth);
  const y = Math.max(0, box.y * sourceHeight);
  const width = Math.min(sourceWidth - x, box.width * sourceWidth);
  const height = Math.min(sourceHeight - y, box.height * sourceHeight);
  if (width < 8 || height < 8) return null;
  context.drawImage(source, x, y, width, height, 0, 0, size, size);
  return patchStats(context.getImageData(0, 0, size, size).data, size, size);
}

const stepLabel: Record<FaceStep, string> = { front: 'Straight', blink: 'Blink', left: 'Left', right: 'Right' };

export function FaceCapture({
  poses,
  title,
  review,
  onDone,
  onCancel,
}: Readonly<{
  /** In order. The first is always 'front'. */
  poses: readonly FacePose[];
  title: string;
  /** Show the photos for approval before handing them over (registration). */
  review: boolean;
  onDone: (frames: FaceFrame[]) => void;
  onCancel: () => void;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const patchRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<LiveState | null>(null);
  const runRef = useRef(0);
  /** The mode the camera effect reads (changing mode must not restart the camera). */
  const modeRef = useRef<Mode>('guided');
  /** Stops waiting for the tracker (a slow first download) and uses the countdown. */
  const skipRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [mode, setMode] = useState<Mode>('guided');
  const [attempt, setAttempt] = useState(0);
  const [steps] = useState<FaceStep[]>(() => captureSteps(poses));
  const [stepIndex, setStepIndex] = useState(0);
  const [hint, setHint] = useState<FaceHint>('searching');
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [frames, setFrames] = useState<FaceFrame[]>([]);
  const [flash, setFlash] = useState(false);
  const [slowStart, setSlowStart] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [tracker, setTracker] = useState<Awaited<ReturnType<typeof loadFaceLandmarker>> | null>(null);
  const [slowHandOver, setSlowHandOver] = useState(false);
  // The latest onDone, read when the photos are ready. Parents pass inline callbacks, and a new
  // one on every parent render must not restart the camera loops (which would throw away the
  // photos already taken).
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Full screen: nothing behind it scrolls, and the app's bars stay hidden.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('fx-lock');
    return () => root.classList.remove('fx-lock');
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Camera and tracker, started together. The server's face engine is woken at the same time.
  useEffect(() => {
    let cancelled = false;
    const slowTimer = window.setTimeout(() => { if (!cancelled) setSlowStart(true); }, 6000);
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase({ kind: 'error', message: 'This browser cannot use the camera. Open LASUATOS in Chrome or Safari.' });
        return;
      }
      if (attempt === 0) warmFaceChecks();
      const skip = new Promise<null>((resolve) => { skipRef.current = () => resolve(null); });
      const trackerReady = modeRef.current === 'guided'
        ? Promise.race([
          loadFaceLandmarker(),
          skip,
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), TRACKER_TIMEOUT_MS)),
        ]).catch(() => null)
        : Promise.resolve(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        const landmarker = await trackerReady;
        if (cancelled) return;
        if (!landmarker && modeRef.current === 'guided') {
          modeRef.current = 'simple';
          setMode('simple');
        }
        setTracker(landmarker);
        setPhase({ kind: 'live' });
      } catch (error) {
        if (!cancelled) setPhase({ kind: 'error', message: cameraProblem(error) });
      }
    }
    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      skipRef.current = null;
      runRef.current += 1;
      stopCamera();
    };
  }, [attempt, stopCamera]);

  const finish = useCallback(async (pending: Promise<FaceFrame>[], token: number) => {
    let taken: FaceFrame[];
    try {
      taken = await Promise.all(pending);
    } catch (error) {
      if (runRef.current === token) setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'The photo could not be taken.' });
      return;
    }
    if (runRef.current !== token) return;
    // Claim a run of its own for the hand-over. The phase change below re-runs the camera loop
    // effects, and their clean-up retires the loop's token; checking that token after the pause
    // would drop the photos and leave "Checking your photos…" on screen for good. Closing or
    // restarting the camera (the camera effect's clean-up) still cancels the hand-over.
    const handOver = ++runRef.current;
    setFrames(taken);
    stopCamera();
    if (review) {
      setPhase({ kind: 'review' });
      return;
    }
    setPhase({ kind: 'done' });
    await sleep(550);
    if (runRef.current === handOver) onDoneRef.current(taken);
  }, [review, stopCamera]);

  // The hand-over should take half a second. If the screen is still up, never leave the student
  // without a way out.
  useEffect(() => {
    if (phase.kind !== 'done') return;
    const timer = window.setTimeout(() => setSlowHandOver(true), HAND_OVER_SLOW_MS);
    return () => {
      window.clearTimeout(timer);
      setSlowHandOver(false);
    };
  }, [phase.kind]);

  const snap = useCallback(() => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 200);
    if (navigator.vibrate) navigator.vibrate(35);
  }, []);

  // Guided mode: the tracker loop.
  useEffect(() => {
    if (phase.kind !== 'live' || mode !== 'guided' || !tracker) return;
    const token = ++runRef.current;
    const live = freshLive(performance.now());
    liveRef.current = live;
    if (!patchRef.current) {
      patchRef.current = document.createElement('canvas');
      patchRef.current.width = 64;
      patchRef.current.height = 64;
    }
    const patch = patchRef.current;
    let frameId = 0;
    let shownHint: FaceHint = 'searching';
    let shownProgress = 0;
    let shownStuck = false;

    const show = (nextHint: FaceHint, nextProgress: number, isStuck: boolean) => {
      const rounded = Math.round(nextProgress * 20) / 20;
      if (nextHint !== shownHint) { shownHint = nextHint; setHint(nextHint); }
      if (rounded !== shownProgress) { shownProgress = rounded; setProgress(rounded); }
      if (isStuck !== shownStuck) { shownStuck = isStuck; setStuck(isStuck); }
    };

    const advance = (now: number) => {
      live.stepIndex += 1;
      live.stepStartedAt = now;
      live.holdStartedAt = 0;
      live.badFrames = 0;
      live.candidates = [];
      live.blink = new BlinkDetector();
      if (live.stepIndex >= steps.length) {
        live.finished = true;
        void finish(live.frames, token);
        return;
      }
      setStepIndex(live.stepIndex);
      show('searching', 0, false);
    };

    const tick = () => {
      if (runRef.current !== token || live.finished) return;
      frameId = window.requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const now = performance.now();
      if (now - live.lastDetectAt < live.interval) return;
      live.lastDetectAt = now;

      let observation: FaceObservation | null;
      try {
        observation = observeFace(tracker.detectForVideo(video, now));
      } catch {
        // The tracker failed on this phone: carry on with the countdown instead.
        modeRef.current = 'simple';
        setMode('simple');
        return;
      }
      // Slow phones check less often, so the screen stays smooth.
      live.cost = live.cost * 0.85 + (performance.now() - now) * 0.15;
      live.interval = live.cost > 60 ? 140 : live.cost > 35 ? 95 : 66;

      if (observation && live.prevNose) {
        const moved = Math.hypot(observation.nose.x - live.prevNose.x, observation.nose.y - live.prevNose.y) / Math.max(observation.box.width, 0.01);
        live.motion = live.motion * 0.55 + moved * 0.45;
      } else {
        live.motion = 0;
      }
      live.prevNose = observation ? observation.nose : null;
      if (!observation) live.luma = null;
      else if (now - live.lumaAt > 300) {
        live.luma = measureFace(video, video.videoWidth, video.videoHeight, observation.box, patch)?.luma ?? live.luma;
        live.lumaAt = now;
      }

      const step = steps[live.stepIndex]!;
      const videoSize = { width: video.videoWidth, height: video.videoHeight };
      const verdict = assessFace({ observation, step, video: videoSize, luma: live.luma, motion: live.motion });
      const isStuck = step !== 'blink' && now - live.stepStartedAt > STUCK_MS;

      if (step === 'blink') {
        if (observation && verdict === 'ok' && live.blink.update(observation.blink, now)) {
          if (navigator.vibrate) navigator.vibrate(20);
          advance(now);
          return;
        }
        // The blink is a quick extra cue, never a dead end.
        if (now - live.stepStartedAt > BLINK_SKIP_MS && observation) {
          advance(now);
          return;
        }
        show(verdict === 'ok' ? 'blink' : verdict, 0, false);
        return;
      }

      if (verdict !== 'ok' || !observation) {
        live.badFrames += 1;
        // One shaky frame does not restart the hold.
        if (live.badFrames >= 2) {
          live.holdStartedAt = 0;
          live.candidates = [];
        }
        const turning = step === 'left' || step === 'right' ? turnProgress(observation, step) * 0.7 : 0;
        show(live.holdStartedAt ? 'ok' : verdict, live.holdStartedAt ? shownProgress : turning, isStuck);
        return;
      }
      live.badFrames = 0;
      if (!live.holdStartedAt) live.holdStartedAt = now;
      const holdFor = step === 'front' ? FACE_GUIDE.holdFrontMs : FACE_GUIDE.holdTurnMs;
      const held = Math.min(1, (now - live.holdStartedAt) / holdFor);
      const shown = step === 'front' ? held : 0.7 + held * 0.3;

      // Keep the sharpest few frames from the end of the hold.
      if (held >= 0.45) {
        try {
          const canvas = grabFrame(video);
          const stats = measureFace(canvas, canvas.width, canvas.height, observation.box, patch);
          live.candidates.push({ canvas, sharpness: stats?.sharpness ?? 0 });
          if (live.candidates.length > 3) {
            live.candidates.sort((a, b) => b.sharpness - a.sharpness);
            live.candidates.length = 3;
          }
        } catch {
          // A frame that could not be copied is simply skipped.
        }
      }
      if (held >= 1 && live.candidates.length) {
        const best = live.candidates.reduce((top, candidate) => (candidate.sharpness > top.sharpness ? candidate : top));
        const pose = step as FacePose;
        live.frames.push(encodeFrame(best.canvas).then((image) => ({ pose, image })));
        snap();
        advance(now);
        return;
      }
      show('ok', shown, isStuck);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
      if (runRef.current === token) runRef.current += 1;
    };
  }, [finish, mode, phase.kind, snap, steps, tracker]);

  // Simple mode: a countdown per photo (no tracker).
  useEffect(() => {
    if (phase.kind !== 'live' || mode !== 'simple') return;
    const token = ++runRef.current;
    const photoSteps = steps.filter((step): step is FacePose => step !== 'blink');
    void (async () => {
      const pending: Promise<FaceFrame>[] = [];
      await sleep(500);
      for (let index = 0; index < photoSteps.length; index += 1) {
        const pose = photoSteps[index]!;
        if (runRef.current !== token) return;
        setStepIndex(steps.indexOf(pose));
        for (let left = index === 0 ? 3 : 2; left > 0; left -= 1) {
          if (runRef.current !== token) return;
          setCountdown(left);
          await sleep(1000);
        }
        if (runRef.current !== token) return;
        const video = videoRef.current;
        if (!video) return;
        try {
          const canvas = grabFrame(video);
          pending.push(encodeFrame(canvas).then((image) => ({ pose, image })));
        } catch (error) {
          setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'The photo could not be taken.' });
          return;
        }
        snap();
      }
      setCountdown(null);
      await finish(pending, token);
    })();
    return () => {
      if (runRef.current === token) runRef.current += 1;
    };
  }, [finish, mode, phase.kind, snap, steps]);

  const restart = () => {
    setFrames([]);
    setStepIndex(0);
    setProgress(0);
    setHint('searching');
    setStuck(false);
    setCountdown(null);
    setPhase({ kind: 'starting' });
    setAttempt((value) => value + 1);
  };

  /** The countdown instead of live guidance; the camera keeps running. */
  const switchToCountdown = () => {
    modeRef.current = 'simple';
    skipRef.current?.();
    setStuck(false);
    setProgress(0);
    setStepIndex(0);
    setHint('searching');
    setMode('simple');
  };

  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const words = phase.kind === 'starting'
    ? { title: 'Getting the camera ready', detail: slowStart ? 'Almost there. The first time takes a little longer.' : 'One moment…' }
    : phase.kind === 'done'
      ? { title: 'All done', detail: slowHandOver ? 'This is taking too long. Tap Cancel and try again.' : 'Checking your photos…' }
      : phase.kind === 'review'
        ? { title: 'Check your photos', detail: `Your face clear and well lit in all ${frames.length}? Use them, or take them again.` }
        : mode === 'simple'
          ? (step === 'front'
            ? { title: 'Look straight at the camera', detail: 'Keep your face in the circle. The photo is taken when the count ends.' }
            : { title: `Turn your head to your ${step}`, detail: 'Part of the way, and hold it until the count ends.' })
          : faceWords(step, hint);
  const turning = phase.kind === 'live' && (step === 'left' || step === 'right');
  const ringState = phase.kind === 'done'
    ? 'is-done'
    : phase.kind !== 'live'
      ? 'is-idle'
      : mode === 'simple'
        ? 'is-simple'
        : hint === 'ok'
          ? 'is-ok'
          : hint === 'blink'
            ? 'is-blink'
            : hint === 'searching'
              ? 'is-searching'
              : 'is-warn';
  const problem = phase.kind === 'live' && mode === 'guided' && hint !== 'ok' && hint !== 'blink' && hint !== 'searching';

  const screen = (
    <div className="fx-screen" role="dialog" aria-modal="true" aria-labelledby="fx-title">
      <header className="fx-top">
        <button className="fx-icon-button" type="button" onClick={onCancel} aria-label="Close the camera"><X size={22} aria-hidden="true" /></button>
        <span className="fx-top-title">{title}</span>
        <span className="fx-top-spacer" aria-hidden="true" />
      </header>

      <div className="fx-body">
        {phase.kind === 'error' ? (
          <div className="fx-error" role="alert">
            <h2 id="fx-title">The camera did not start</h2>
            <p>{phase.message}</p>
          </div>
        ) : (
          <>
            <div className="fx-words" aria-live="polite">
              <h2 id="fx-title" className="fx-title">{words.title}</h2>
              <p className={`fx-detail${problem ? ' is-problem' : ''}`}>{words.detail}</p>
            </div>

            {phase.kind === 'review' ? (
              <div className="fx-review">
                {frames.map((frame) => (
                  <figure key={frame.pose}>
                    <img src={`data:image/jpeg;base64,${frame.image}`} alt={frame.pose === 'front' ? 'Facing the camera' : `Turned to your ${frame.pose}`} />
                    <figcaption>{frame.pose === 'front' ? 'Straight' : `Turned ${frame.pose}`}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className={`fx-stage ${ringState}`}>
                <div className={`fx-lens${flash ? ' is-flash' : ''}`}>
                  <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" />
                  {phase.kind === 'starting' ? <span className="fx-lens-wait" aria-hidden="true" /> : null}
                  {ringState === 'is-searching' ? <span className="fx-scan" aria-hidden="true" /> : null}
                  {countdown !== null ? <span className="fx-count" key={`${stepIndex}-${countdown}`} aria-hidden="true">{countdown}</span> : null}
                  {phase.kind === 'done' ? <span className="fx-done" aria-hidden="true"><Check size={56} strokeWidth={2.6} /></span> : null}
                </div>
                <svg className="fx-ring" viewBox="0 0 100 100" aria-hidden="true">
                  <circle className="fx-ring-track" cx="50" cy="50" r="48" />
                  <circle
                    className="fx-ring-fill"
                    cx="50"
                    cy="50"
                    r="48"
                    strokeDasharray={RING_LENGTH}
                    strokeDashoffset={RING_LENGTH * (1 - (phase.kind === 'done' ? 1 : progress))}
                  />
                </svg>
                {turning ? (
                  <span className={`fx-arrows fx-arrows-${step}`} aria-hidden="true">
                    {step === 'left'
                      ? <><ChevronLeft size={30} /><ChevronLeft size={30} /></>
                      : <><ChevronRight size={30} /><ChevronRight size={30} /></>}
                  </span>
                ) : null}
              </div>
            )}

            {phase.kind !== 'review' ? (
              <ol className="fx-steps" aria-label="Steps">
                {steps.map((item, index) => {
                  if (mode === 'simple' && item === 'blink') return null;
                  const done = phase.kind === 'done' || index < stepIndex;
                  const current = phase.kind === 'live' && index === stepIndex;
                  return (
                    <li key={item} className={done ? 'is-done' : current ? 'is-current' : ''}>
                      <span className="fx-step-dot">{done ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}</span>
                      {stepLabel[item]}
                    </li>
                  );
                })}
              </ol>
            ) : null}

            {phase.kind === 'starting' && slowStart && mode === 'guided' ? (
              <div className="fx-stuck">
                <p><Timer size={16} aria-hidden="true" /> Slow connection? The live guide downloads once (about 6 MB).</p>
                <button className="lx-link-button" type="button" onClick={switchToCountdown}><Timer size={15} aria-hidden="true" /> Use a countdown instead</button>
              </div>
            ) : null}

            {stuck && mode === 'guided' && phase.kind === 'live' ? (
              <div className="fx-stuck">
                <p><Lightbulb size={16} aria-hidden="true" /> Face a light, take off a cap or face mask, and hold the phone at eye level.</p>
                <button className="lx-link-button" type="button" onClick={switchToCountdown}><Timer size={15} aria-hidden="true" /> Use a countdown instead</button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <footer className="fx-foot">
        {phase.kind === 'review' ? (
          <>
            <button className="button button-primary lx-big-button" type="button" onClick={() => onDoneRef.current(frames)}>
              Use these photos
            </button>
            <button className="button button-secondary" type="button" onClick={restart}>
              <RotateCcw size={16} aria-hidden="true" /> Take them again
            </button>
          </>
        ) : null}
        {phase.kind === 'error' ? (
          <button className="button button-primary lx-big-button" type="button" onClick={restart}>Try again</button>
        ) : null}
        {phase.kind !== 'review' ? (
          <p className="fx-privacy"><LockKeyhole size={14} aria-hidden="true" /> Your photos are only used to confirm it is you.</p>
        ) : null}
        {phase.kind !== 'done' || slowHandOver ? <button className="lx-link-button fx-cancel" type="button" onClick={onCancel}>Cancel</button> : null}
      </footer>
    </div>
  );

  return typeof document === 'undefined' ? screen : createPortal(screen, document.body);
}
