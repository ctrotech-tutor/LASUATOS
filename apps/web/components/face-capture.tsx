'use client';

import type { FaceFrame, FacePose } from '@lasuatos/contracts';
import { ArrowLeft, ArrowRight, Camera, RotateCcw, ScanFace, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Guided camera capture for the face check.
 *
 * The student sees themselves mirrored (like a selfie), inside an oval, and
 * follows one instruction at a time: look straight at the camera, then turn
 * the head part-way as asked. Each photo is taken after a short countdown,
 * so nobody has to tap with the phone held at arm's length.
 *
 * Photos are taken from the raw camera picture, never the mirrored preview,
 * so "turned to their left" stays the student's own left when the server
 * measures the head pose. Nothing is uploaded here: the parent receives the
 * frames and decides what to do with them. The camera is switched off as
 * soon as the photos are taken or the sheet closes.
 */

const MAX_EDGE = 720;
const JPEG_QUALITY = 0.86;
const FIRST_COUNTDOWN = 3;
const TURN_COUNTDOWN = 2;

type Stage =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'counting'; readonly index: number; readonly seconds: number }
  | { readonly kind: 'review' }
  | { readonly kind: 'error'; readonly message: string };

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

function instruction(pose: FacePose): { title: string; detail: string } {
  if (pose === 'front') return { title: 'Look straight at the camera', detail: 'Keep your whole face inside the oval.' };
  return {
    title: `Now turn your head to your ${pose}`,
    detail: 'Part of the way, like looking at someone beside you. Keep the phone still.',
  };
}

async function captureFrame(video: HTMLVideoElement): Promise<string> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The camera is not ready yet.');
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The photo could not be taken.');
  // Unmirrored on purpose (see the comment at the top).
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('The photo could not be taken.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

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
  const runRef = useRef(0);
  const [stage, setStage] = useState<Stage>({ kind: 'starting' });
  const [frames, setFrames] = useState<FaceFrame[]>([]);
  const [flash, setFlash] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStage({ kind: 'error', message: 'This browser cannot use the camera. Open LASUATOS in Chrome or Safari.' });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 1280 } },
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
        setStage({ kind: 'ready' });
      } catch (error) {
        if (!cancelled) setStage({ kind: 'error', message: cameraProblem(error) });
      }
    }
    void start();
    return () => {
      cancelled = true;
      runRef.current += 1;
      stopCamera();
    };
  }, [attempt, stopCamera]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const run = useCallback(async () => {
    const token = ++runRef.current;
    const taken: FaceFrame[] = [];
    setFrames([]);
    for (let index = 0; index < poses.length; index += 1) {
      const pose = poses[index]!;
      const seconds = index === 0 ? FIRST_COUNTDOWN : TURN_COUNTDOWN;
      for (let left = seconds; left > 0; left -= 1) {
        if (runRef.current !== token) return;
        setStage({ kind: 'counting', index, seconds: left });
        await sleep(1000);
      }
      if (runRef.current !== token) return;
      const video = videoRef.current;
      if (!video) return;
      try {
        taken.push({ pose, image: await captureFrame(video) });
      } catch (error) {
        setStage({ kind: 'error', message: error instanceof Error ? error.message : 'The photo could not be taken.' });
        return;
      }
      setFlash(true);
      window.setTimeout(() => setFlash(false), 180);
      if (navigator.vibrate) navigator.vibrate(30);
      setFrames([...taken]);
    }
    if (runRef.current !== token) return;
    if (review) {
      setStage({ kind: 'review' });
      return;
    }
    stopCamera();
    onDone(taken);
  }, [onDone, poses, review, stopCamera]);

  // A check-in starts by itself once the camera shows a picture; registration waits for "Start".
  const autoStarted = useRef(false);
  useEffect(() => {
    if (review || stage.kind !== 'ready' || autoStarted.current) return;
    autoStarted.current = true;
    const timer = window.setTimeout(() => void run(), 700);
    return () => window.clearTimeout(timer);
  }, [review, run, stage.kind]);

  const current = stage.kind === 'counting' ? poses[stage.index]! : poses[0]!;
  const words = instruction(current);
  const turning = stage.kind === 'counting' && current !== 'front';

  return (
    <div className="fx-overlay" role="dialog" aria-modal="true" aria-labelledby="fx-title">
      <div className="fx-sheet">
        <div className="fx-head">
          <h2 id="fx-title"><ScanFace size={18} aria-hidden="true" /> {title}</h2>
          <button className="fx-close" type="button" onClick={onCancel} aria-label="Close the camera"><X size={20} aria-hidden="true" /></button>
        </div>

        <div className={`fx-viewport${flash ? ' is-flash' : ''}${stage.kind === 'review' ? ' is-hidden' : ''}`}>
          <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" />
          <svg className="fx-oval" viewBox="0 0 100 130" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <mask id="fx-mask">
                <rect width="100" height="130" fill="#fff" />
                <ellipse cx="50" cy="60" rx="31" ry="41" fill="#000" />
              </mask>
            </defs>
            <rect width="100" height="130" fill="rgb(8 20 32 / 55%)" mask="url(#fx-mask)" />
            <ellipse className={`fx-oval-line${stage.kind === 'counting' ? ' is-active' : ''}`} cx="50" cy="60" rx="31" ry="41" />
          </svg>
          {turning ? (
            <span className={`fx-turn fx-turn-${current}`} aria-hidden="true">
              {current === 'left' ? <ArrowLeft size={34} /> : <ArrowRight size={34} />}
            </span>
          ) : null}
          {stage.kind === 'counting' ? <span className="fx-count" key={`${stage.index}-${stage.seconds}`} aria-hidden="true">{stage.seconds}</span> : null}
          {stage.kind === 'starting' ? <p className="fx-status">Starting the camera…</p> : null}
          {stage.kind === 'error' ? <p className="fx-status fx-status-error" role="alert">{stage.message}</p> : null}
        </div>

        {stage.kind === 'review' ? (
          <div className="fx-review">
            {frames.map((frame) => (
              <figure key={frame.pose}>
                <img src={`data:image/jpeg;base64,${frame.image}`} alt={frame.pose === 'front' ? 'Facing the camera' : `Turned to your ${frame.pose}`} />
                <figcaption>{frame.pose === 'front' ? 'Straight' : `Turned ${frame.pose}`}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}

        <div className="fx-guide" aria-live="polite">
          {stage.kind === 'review' ? (
            <>
              <strong>Check your photos</strong>
              <span>Your face clear and well lit in all {frames.length}? Use them, or take them again.</span>
            </>
          ) : stage.kind === 'error' ? null : (
            <>
              <strong>{stage.kind === 'counting' ? words.title : 'Get ready'}</strong>
              <span>{stage.kind === 'counting' ? words.detail : 'Face a light, hold the phone at eye level and keep only your face in view.'}</span>
            </>
          )}
          {stage.kind === 'counting' ? (
            <ol className="fx-steps" aria-label="Photos">
              {poses.map((pose, index) => (
                <li key={pose} className={index < stage.index ? 'is-done' : index === stage.index ? 'is-current' : ''}>
                  {pose === 'front' ? 'Straight' : pose === 'left' ? 'Left' : 'Right'}
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        <div className="fx-actions">
          {stage.kind === 'ready' && review ? (
            <button className="button button-primary lx-big-button" type="button" onClick={() => void run()}>
              <Camera size={18} aria-hidden="true" /> Start
            </button>
          ) : null}
          {stage.kind === 'review' ? (
            <>
              <button className="button button-primary lx-big-button" type="button" onClick={() => { stopCamera(); onDone(frames); }}>
                Use these photos
              </button>
              <button className="button button-secondary" type="button" onClick={() => void run()}>
                <RotateCcw size={16} aria-hidden="true" /> Take them again
              </button>
            </>
          ) : null}
          {stage.kind === 'error' ? (
            <button className="button button-primary lx-big-button" type="button" onClick={() => { setStage({ kind: 'starting' }); setAttempt((value) => value + 1); }}>
              Try again
            </button>
          ) : null}
          <button className="lx-link-button" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
