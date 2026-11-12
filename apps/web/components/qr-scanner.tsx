'use client';

import { extractCheckInChallenge } from '@lasuatos/contracts';
import { Camera, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Full-screen camera scanner for the lecturer's rotating QR code.
 *
 * Decoding uses the browser's native BarcodeDetector where it exists (Chrome
 * on Android, recent desktop Chrome/Edge) and falls back to jsQR on a canvas
 * elsewhere — notably iOS Safari, which has no BarcodeDetector. jsQR is
 * loaded lazily so it never weighs on pages that don't scan.
 *
 * Accepts the check-in link the QR encodes or a bare `lasu1.` challenge, and
 * hands only the extracted challenge to the parent. Video never leaves the
 * device: frames are decoded in the page and the stream is stopped as soon as
 * a code is read or the scanner closes.
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

function cameraErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow the camera for this site in your browser settings, or open your phone’s camera app and scan the QR code there.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Open the QR link on a phone, or type the session code instead.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is being used by another app. Close it and try again.';
  }
  return 'The camera could not be started. Use your phone’s camera app to scan the QR code, or type the session code.';
}

export function QrScanner({
  onDetected,
  onClose,
}: Readonly<{ onDetected: (challenge: string) => void; onClose: () => void }>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const detectedRef = useRef(onDetected);
  detectedRef.current = onDetected;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    let lastRejected = '';
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    function stop() {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    function handleText(text: string): boolean {
      const challenge = extractCheckInChallenge(text);
      if (challenge) {
        stop();
        if (navigator.vibrate) navigator.vibrate(60);
        detectedRef.current(challenge);
        return true;
      }
      if (text !== lastRejected) {
        lastRejected = text;
        setHint('That QR code is not a LASUATOS check-in code. Point the camera at the code on your lecturer’s screen.');
      }
      return false;
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('error');
        setError(window.isSecureContext
          ? 'This browser cannot open the camera. Use your phone’s camera app to scan the QR code, or type the session code.'
          : 'The camera only works over a secure (https) connection.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (caught) {
        if (stopped) return;
        setState('error');
        setError(cameraErrorMessage(caught));
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      try {
        await video.play();
      } catch {
        // iOS may reject play() until metadata loads; decoding below waits for frames anyway.
      }
      setState('scanning');

      const detector = await nativeDetector();
      let jsQr: JsQr | null = null;
      if (!detector) {
        try {
          jsQr = (await import('jsqr')).default as unknown as JsQr;
        } catch {
          setState('error');
          setError('The scanner could not load. Check your connection, or type the session code.');
          stop();
          return;
        }
      }

      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            if (detector) {
              const codes = await detector.detect(video);
              for (const code of codes) if (handleText(code.rawValue)) return;
            } else if (jsQr && context) {
              // Decode the central square, downscaled, which is where students aim and is much faster.
              const side = Math.min(video.videoWidth, video.videoHeight);
              const scale = Math.min(1, MAX_DECODE_EDGE / side);
              const edge = Math.max(1, Math.round(side * scale));
              canvas.width = edge;
              canvas.height = edge;
              context.drawImage(
                video,
                (video.videoWidth - side) / 2,
                (video.videoHeight - side) / 2,
                side,
                side,
                0,
                0,
                edge,
                edge,
              );
              const image = context.getImageData(0, 0, edge, edge);
              const result = jsQr(image.data, edge, edge, { inversionAttempts: 'dontInvert' });
              if (result?.data && handleText(result.data)) return;
            }
          }
        } catch {
          // A dropped frame is harmless; keep scanning.
        }
        if (!stopped) timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    }

    void start();
    return stop;
  }, []);

  return (
    <div className="qr-scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="qr-scanner-title">
      <div className="qr-scanner-frame">
        <div className="qr-scanner-head">
          <h2 id="qr-scanner-title"><Camera size={18} aria-hidden="true" /> Scan the QR code</h2>
          <button ref={closeRef} className="qr-scanner-close" type="button" onClick={onClose} aria-label="Close scanner">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="qr-scanner-viewport">
          <video ref={videoRef} muted playsInline autoPlay aria-label="Camera preview" />
          {state === 'scanning' ? <span className="qr-scanner-target" aria-hidden="true" /> : null}
          {state === 'starting' ? (
            <p className="qr-scanner-status"><LoaderCircle className="course-spin" size={18} aria-hidden="true" /> Starting the camera…</p>
          ) : null}
          {state === 'error' ? <p className="qr-scanner-status qr-scanner-error" role="alert">{error}</p> : null}
        </div>
        <p className="qr-scanner-help" aria-live="polite">
          {hint || 'Hold your phone 30–60 cm from the screen so the whole code fits inside the frame. The code changes every 20 seconds — scan the one showing now.'}
        </p>
        <button className="attendance-secondary-button qr-scanner-cancel" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
