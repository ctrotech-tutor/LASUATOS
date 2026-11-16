'use client';

import { CameraOff, Flashlight, FlashlightOff, LoaderCircle, QrCode, RotateCcw, X } from 'lucide-react';
import { useEffect } from 'react';
import { cameraAlreadyAllowed, useQrCamera, type CameraProblem } from '../../lib/qr-camera';

const PROBLEMS: Record<CameraProblem, { readonly title: string; readonly detail: string }> = {
  blocked: {
    title: 'Camera is blocked',
    detail: 'Allow the camera for this site in your browser settings, or scan with your phone’s camera app. You can also type the code below.',
  },
  missing: { title: 'No camera found', detail: 'Type the code shown under the QR code instead.' },
  busy: { title: 'Camera in use', detail: 'Another app is using the camera. Close it, then try again.' },
  insecure: { title: 'Camera unavailable', detail: 'The camera only works on a secure (https) page. Type the code instead.' },
  unsupported: { title: 'This browser can’t scan', detail: 'Scan with your phone’s camera app, or type the code below.' },
  failed: { title: 'Camera didn’t start', detail: 'Try again, or type the code below.' },
};

/** Four rounded corners: the scanner's frame. */
function Brackets() {
  return (
    <svg className="sc-finder-brackets" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path vectorEffect="non-scaling-stroke" d="M2 24 V16 A14 14 0 0 1 16 2 H24 M76 2 H84 A14 14 0 0 1 98 16 V24 M98 76 V84 A14 14 0 0 1 84 98 H76 M24 98 H16 A14 14 0 0 1 2 84 V76" />
    </svg>
  );
}

/**
 * The Scan screen's camera, in the page rather than over it (like a native scanner tab). It opens
 * by itself on phones that have already allowed the camera, otherwise on a tap, and stops when
 * the class opens, the person turns it off, or the app goes to the background.
 */
export function Viewfinder({
  accept,
  onDetected,
  autoStart,
}: Readonly<{
  accept: (text: string) => string | null;
  onDetected: (text: string) => void;
  /** Start now (the person asked to scan again), rather than only when the camera is already allowed. */
  autoStart: boolean;
}>) {
  const { videoRef, state, problem: cameraProblem, hint, torch, start, stop, toggleTorch } = useQrCamera({
    accept,
    onDetected,
    rejectedHint: 'That isn’t a LASUATOS code. Point at the code on the screen or the poster.',
    startNow: autoStart,
  });

  // On a phone that already allowed the camera, open it without a tap, as a native scanner does.
  // Laptops wait for a tap: their camera faces the person, not the screen.
  useEffect(() => {
    if (autoStart || !window.matchMedia('(pointer: coarse)').matches) return undefined;
    let cancelled = false;
    void cameraAlreadyAllowed().then((allowed) => {
      if (allowed && !cancelled) start();
    });
    return () => {
      cancelled = true;
    };
  }, [autoStart, start]);

  const problem = cameraProblem ? PROBLEMS[cameraProblem] : null;
  const live = state === 'scanning' || state === 'found';

  return (
    <div className="sc-finder" data-state={state}>
      <video ref={videoRef} className="sc-finder-video" muted playsInline autoPlay aria-hidden="true" />

      {state === 'idle' ? (
        <button className="sc-finder-start" type="button" onClick={start}>
          <span className="sc-finder-glyph" aria-hidden="true">
            <Brackets />
            <QrCode size={38} strokeWidth={1.7} />
          </span>
          <strong>Scan the QR code</strong>
          <span>On the screen or the poster in your hall</span>
          <span className="sc-finder-pill" aria-hidden="true">Open camera</span>
        </button>
      ) : null}

      {state === 'starting' ? (
        <p className="sc-finder-status" role="status">
          <LoaderCircle className="sc-spin" size={22} aria-hidden="true" />
          Starting the camera…
        </p>
      ) : null}

      {live ? (
        <>
          <span className="sc-finder-target" aria-hidden="true"><Brackets /><span className="sc-finder-sweep" /></span>
          <button className="sc-finder-tool sc-finder-off" type="button" onClick={stop} aria-label="Turn off the camera">
            <X size={20} strokeWidth={2.2} aria-hidden="true" />
          </button>
          {torch.available ? (
            <button
              className="sc-finder-tool sc-finder-torch"
              type="button"
              onClick={toggleTorch}
              aria-pressed={torch.on}
              aria-label="Torch"
            >
              {torch.on ? <FlashlightOff size={19} aria-hidden="true" /> : <Flashlight size={19} aria-hidden="true" />}
            </button>
          ) : null}
          <p className={`sc-finder-caption${hint ? ' is-hint' : ''}`} role="status">
            {hint || 'Fit the whole code inside the frame'}
          </p>
        </>
      ) : null}

      {state === 'error' && problem ? (
        <div className="sc-finder-problem" role="alert">
          <CameraOff size={28} aria-hidden="true" />
          <strong>{problem.title}</strong>
          <span>{problem.detail}</span>
          {cameraProblem === 'missing' || cameraProblem === 'insecure' || cameraProblem === 'unsupported' ? null : (
            <button className="sc-finder-pill" type="button" onClick={start}>
              <RotateCcw size={15} aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
