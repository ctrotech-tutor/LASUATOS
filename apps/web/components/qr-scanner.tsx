'use client';

import { extractCheckInChallenge } from '@lasuatos/contracts';
import { Camera, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cameraProblemText, useQrCamera } from '../lib/qr-camera';

/**
 * Full-screen camera scanner for a course's rotating QR code (/check-in). The camera and the
 * decoding live in lib/qr-camera.ts, shared with the Scan screen's viewfinder.
 *
 * Accepts the check-in link the QR encodes or a bare challenge, and hands only the extracted
 * value to the parent.
 */
export function QrScanner({
  onDetected,
  onClose,
  accept,
}: Readonly<{
  onDetected: (challenge: string) => void;
  onClose: () => void;
  /** Returns the value to hand to onDetected, or null to keep scanning. Defaults to course check-in codes. */
  accept?: (text: string) => string | null;
}>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { videoRef, state, problem: cameraProblem, hint } = useQrCamera({
    accept: accept ?? extractCheckInChallenge,
    onDetected,
    rejectedHint: 'That QR code is not a LASUATOS check-in code. Point the camera at the code on your lecturer’s screen.',
    startNow: true,
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          {state === 'error' && cameraProblem ? <p className="qr-scanner-status qr-scanner-error" role="alert">{cameraProblemText(cameraProblem)}</p> : null}
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
