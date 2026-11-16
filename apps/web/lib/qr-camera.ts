'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The camera and QR decoding behind every scanner (the Scan screen's viewfinder and the course
 * check-in overlay).
 *
 * Decoding uses the browser's native BarcodeDetector where it exists (Chrome on Android, recent
 * desktop Chrome and Edge) and falls back to jsQR on a canvas elsewhere, notably iOS Safari. jsQR
 * is loaded lazily so it never weighs on pages that do not scan. Video never leaves the device:
 * frames are decoded in the page, and the stream stops as soon as a code is read, the scanner
 * closes, or the app goes to the background (it comes back when the app does).
 */

interface DetectedBarcode { readonly rawValue: string }
interface BarcodeDetectorInstance { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}
type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' }) => { data: string } | null;

const SCAN_INTERVAL_MS = 140;
const MAX_DECODE_EDGE = 720;

export type CameraState = 'idle' | 'starting' | 'scanning' | 'found' | 'error';
export type CameraProblem = 'blocked' | 'missing' | 'busy' | 'insecure' | 'unsupported' | 'failed';

async function nativeDetector(): Promise<BarcodeDetectorInstance | null> {
  const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const formats = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : ['qr_code'];
    if (!formats.includes('qr_code')) return null;
    return new Detector({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

export function cameraProblemOf(error: unknown): CameraProblem {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'NotReadableError') return 'busy';
  return 'failed';
}

/** One plain sentence per problem, for scanners that show a single message. */
export function cameraProblemText(problem: CameraProblem): string {
  switch (problem) {
    case 'blocked':
      return 'Camera access was blocked. Allow the camera for this site in your browser settings, or open your phone’s camera app and scan the QR code there.';
    case 'missing':
      return 'No camera was found on this device. Open the QR link on a phone, or type the session code instead.';
    case 'busy':
      return 'The camera is being used by another app. Close it and try again.';
    case 'insecure':
      return 'The camera only works over a secure (https) connection.';
    case 'unsupported':
      return 'This browser cannot open the camera. Use your phone’s camera app to scan the QR code, or type the session code.';
    default:
      return 'The camera could not be started. Use your phone’s camera app to scan the QR code, or type the session code.';
  }
}

/**
 * Whether this site may already use the camera, so a scanner can open without a tap (and without
 * a surprise permission prompt). False when the browser cannot say.
 */
export async function cameraAlreadyAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

export function useQrCamera({
  accept,
  onDetected,
  rejectedHint,
  startNow = false,
}: Readonly<{
  /** The value to hand to onDetected, or null to keep scanning. */
  accept: (text: string) => string | null;
  onDetected: (value: string) => void;
  /** Shown when a QR code is read that `accept` turns down. */
  rejectedHint: string;
  /** Opens the camera straight away instead of waiting for start(). */
  startNow?: boolean;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Each start is a new run; 0 is off. The effect below owns the stream for one run.
  const [run, setRun] = useState(startNow ? 1 : 0);
  const [state, setState] = useState<CameraState>(startNow ? 'starting' : 'idle');
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [hint, setHint] = useState('');
  const [torch, setTorch] = useState<{ readonly available: boolean; readonly on: boolean }>({ available: false, on: false });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const latest = useRef({ accept, onDetected, rejectedHint });
  useEffect(() => {
    latest.current = { accept, onDetected, rejectedHint };
  }, [accept, onDetected, rejectedHint]);

  const start = useCallback(() => {
    setProblem(null);
    setHint('');
    setState('starting');
    setRun((value) => value + 1);
  }, []);

  const stop = useCallback(() => {
    setRun(0);
    setState('idle');
    setHint('');
    setTorch({ available: false, on: false });
  }, []);

  useEffect(() => {
    if (!run) return undefined;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let closed = false;
    // Bumped whenever the stream is released, so a decode loop from an older stream stops.
    let generation = 0;
    let lastRejected = '';
    let detector: BarcodeDetectorInstance | null | undefined;
    let jsQr: JsQr | null = null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    function release() {
      generation += 1;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      trackRef.current = null;
    }

    function fail(next: CameraProblem) {
      release();
      setState('error');
      setProblem(next);
    }

    function handleText(text: string): boolean {
      const value = latest.current.accept(text);
      if (value) {
        release();
        closed = true;
        setState('found');
        if (navigator.vibrate) navigator.vibrate(60);
        latest.current.onDetected(value);
        return true;
      }
      if (text !== lastRejected) {
        lastRejected = text;
        setHint(latest.current.rejectedHint);
      }
      return false;
    }

    async function acquire() {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail(window.isSecureContext ? 'unsupported' : 'insecure');
        return;
      }
      const mine = generation;
      let next: MediaStream;
      try {
        next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (caught) {
        if (!closed && mine === generation) fail(cameraProblemOf(caught));
        return;
      }
      if (closed || mine !== generation || document.visibilityState === 'hidden') {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = next;
      const video = videoRef.current;
      if (!video) {
        release();
        return;
      }
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      try {
        await video.play();
      } catch {
        // Autoplay can be refused before the first frame; the muted preview starts anyway.
      }
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const capabilities = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
      setTorch({ available: capabilities.torch === true, on: false });
      setState('scanning');

      if (detector === undefined) detector = await nativeDetector();
      if (!detector && !jsQr) {
        try {
          jsQr = (await import('jsqr')).default as unknown as JsQr;
        } catch {
          fail('failed');
          return;
        }
      }

      const tick = async () => {
        if (closed || mine !== generation) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            if (detector) {
              const codes = await detector.detect(video);
              for (const code of codes) if (handleText(code.rawValue)) return;
            } else if (jsQr && context) {
              // Decode the central square, downscaled: where students aim, and much faster.
              const side = Math.min(video.videoWidth, video.videoHeight);
              const scale = Math.min(1, MAX_DECODE_EDGE / side);
              const edge = Math.max(1, Math.round(side * scale));
              canvas.width = edge;
              canvas.height = edge;
              context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, edge, edge);
              const image = context.getImageData(0, 0, edge, edge);
              const result = jsQr(image.data, edge, edge, { inversionAttempts: 'dontInvert' });
              if (result?.data && handleText(result.data)) return;
            }
          }
        } catch {
          // A dropped frame is harmless; keep scanning.
        }
        if (!closed && mine === generation) timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    }

    // In the background the camera is released (battery, privacy); it comes back with the app.
    const onVisibility = () => {
      if (closed) return;
      if (document.visibilityState === 'hidden') {
        release();
        setTorch({ available: false, on: false });
      } else if (!stream) {
        setState('starting');
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    void acquire();
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [run]);

  const toggleTorch = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const on = !torch.on;
    track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      .then(() => setTorch({ available: true, on }))
      .catch(() => setTorch({ available: false, on: false }));
  }, [torch.on]);

  return { videoRef, state, problem, hint, torch, start, stop, toggleTorch };
}
