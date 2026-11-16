'use client';

import { X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef } from 'react';
import { useWakeLock } from '../../lib/use-live';
import { formatJoinCode, joinLink, longDate, type Offering } from './model';

/**
 * The join code full screen, for a projector or a phone held up in class: the code in large
 * groups of four, and a QR code that opens My courses with the code filled in. The screen
 * stays awake while it shows. Escape or Close returns to the sheet.
 */
export function PresentCode({ offering, code, onClose }: Readonly<{ offering: Offering; code: string; onClose: () => void }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useWakeLock(true);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    void QRCode.toCanvas(target, joinLink(window.location.origin, code), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 560,
      color: { dark: '#0c1b33', light: '#ffffff' },
    }).catch(() => undefined);
  }, [code]);

  const host = typeof window === 'undefined' ? 'LASUATOS' : window.location.host;

  return (
    <dialog
      ref={dialog}
      className="lct-present"
      aria-labelledby="lct-present-title"
      onClose={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <button className="lct-present-close" type="button" onClick={onClose}>
        <X size={18} strokeWidth={2.4} aria-hidden="true" /> Close
      </button>
      <div className="lct-present-body">
        <div className="lct-present-text">
          <p className="lct-present-eyebrow">Join {offering.courseCode} on LASUATOS</p>
          <h2 className="lct-present-title" id="lct-present-title">{offering.courseTitle}</h2>
          <p className="lct-present-code" aria-label={`Join code ${code.split('').join(' ')}`}>
            {formatJoinCode(code).split('-').map((part, index) => <span key={index}>{part}</span>)}
          </p>
          <ol className="lct-present-steps">
            <li>Open <strong>{host}</strong> and sign in</li>
            <li>Go to <strong>My courses</strong></li>
            <li>Type the code, or scan the QR code with your camera</li>
          </ol>
          <p className="lct-present-fine">Works until {longDate(offering.semesterEndsAt)}</p>
        </div>
        <div className="lct-present-qr">
          <canvas ref={canvas} role="img" aria-label="QR code that opens My courses with this code filled in" />
        </div>
      </div>
    </dialog>
  );
}
