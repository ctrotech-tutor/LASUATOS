'use client';

import { buildCheckInLink } from '@lasuatos/contracts';
import { AlertTriangle, Expand, KeyRound, Plus, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { loadSessionQrChallenge } from '../../lib/attendance-api';
import { formatClock } from '../../lib/lecture-api';
import { useVisiblePolling, useWakeLock } from '../../lib/use-live';
import { Button } from '../ds';
import { LiveCount } from '../ui/live-status';
import { useClock } from '../take-attendance/hooks';
import type { TypedCode } from './data';
import { formatCode, msUntilRotation, problemText, QR_WINDOW_MS, type CourseSession } from './model';

type Qr = { readonly challenge: string; readonly image: string };

/**
 * The current QR challenge for an open session, drawn as a code that opens the check-in page
 * from a plain phone camera. Fetched just after each change; paused while the tab is hidden.
 */
function useRotatingQr(sessionId: string) {
  const [qr, setQr] = useState<Qr | null>(null);
  const [fault, setFault] = useState('');
  const last = useRef('');
  useVisiblePolling(async (signal) => {
    try {
      const result = await loadSessionQrChallenge(sessionId, signal);
      if (signal.aborted) return null;
      setFault('');
      if (result.challenge !== last.current) {
        last.current = result.challenge;
        const image = await QRCode.toDataURL(buildCheckInLink(window.location.origin, result.challenge), {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 720,
          color: { dark: '#0c1b33', light: '#ffffff' },
        });
        if (signal.aborted) return null;
        setQr({ challenge: result.challenge, image });
      }
      return Math.min(5_000, Math.max(600, msUntilRotation(result.challenge, Date.now()) + 250));
    } catch (caught) {
      if (signal.aborted) return null;
      setFault(problemText(caught, 'The QR code did not load.'));
      return 4_000;
    }
  }, [sessionId]);
  return { qr, fault };
}

type StageProps = Readonly<{
  session: CourseSession;
  present: number;
  classSize: number | null;
  typed: TypedCode | null;
  busy: boolean;
  canExtend: boolean;
  onNewCode: () => void;
  onExtend: () => void;
  onClose: () => void;
}>;

/**
 * What the class sees: the QR code (tap or press F for full screen), the typed code when there
 * is one, and the controls a lecturer reaches for mid-class.
 */
export function Stage({ session, present, classSize, typed, busy, canExtend, onNewCode, onExtend, onClose }: StageProps) {
  const { qr, fault } = useRotatingQr(session.id);
  const [projecting, setProjecting] = useState(false);
  const now = useClock('second');
  const secondsLeft = qr && now ? Math.ceil(msUntilRotation(qr.challenge, now) / 1000) : null;
  useWakeLock(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        setProjecting(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const code = typed && !session.qrOnly ? typed.code : null;
  const timer = secondsLeft !== null ? <span className="tk-stage-timer" aria-hidden="true">New code in {secondsLeft}s</span> : null;
  const count = (
    <span className="tk-stage-count">
      <LiveCount value={present} />{classSize ? ` of ${classSize.toLocaleString('en-NG')}` : ''} present
    </span>
  );

  return (
    <section className="tk-stage-section" aria-labelledby="cs-qr-title">
      <div className="tk-section-head">
        <h2 className="tk-section-title" id="cs-qr-title">QR code</h2>
        {timer}
      </div>
      <div className="tk-stage">
        <div className="tk-stage-bar">{count}{timer}</div>

        {qr ? (
          <button className="tk-qr" type="button" onClick={() => setProjecting(true)} aria-label="Show the QR code full screen">
            <img src={qr.image} alt={`QR code for ${session.courseCode} attendance`} width={360} height={360} />
            {secondsLeft !== null ? (
              <span className="tk-qr-progress" aria-hidden="true">
                <span key={qr.challenge} style={{ transform: `scaleX(${Math.min(1, (secondsLeft * 1000) / QR_WINDOW_MS)})` }} />
              </span>
            ) : null}
          </button>
        ) : (
          <div className="tk-qr is-waiting">
            {fault ? (
              <span className="tk-qr-fault" role="alert"><AlertTriangle size={26} aria-hidden="true" />{fault}</span>
            ) : <span className="ds-skeleton tk-qr-bone" role="status" aria-label="Loading the QR code" />}
          </div>
        )}

        {session.qrOnly ? (
          <p className="tk-code-hint cs-code-hint">QR code only: typed codes are refused</p>
        ) : code ? (
          <>
            <p className="tk-attendance-code cs-typed" aria-label={`Typed code ${code.split('').join(' ')}`}>{formatCode(code)}</p>
            <p className="tk-code-hint">or type it in <strong>My attendance</strong></p>
          </>
        ) : (
          <button className="cs-code-reveal" type="button" onClick={onNewCode} disabled={busy}>
            <KeyRound size={16} strokeWidth={2.1} aria-hidden="true" />
            Show a code to type
          </button>
        )}

        <div className="tk-stage-actions">
          <Button className="tk-stage-primary" icon={<Expand size={18} strokeWidth={2.1} aria-hidden="true" />} disabled={!qr} onClick={() => setProjecting(true)}>
            Full screen <kbd className="tk-kbd" aria-hidden="true">F</kbd>
          </Button>
          <Button variant="gray" icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />} disabled={busy || !canExtend} onClick={onExtend}>
            15 min
          </Button>
          <Button variant="gray" className="tk-close-btn" disabled={busy} onClick={onClose}>Close</Button>
        </div>
      </div>
      {projecting && qr ? (
        <Projector session={session} image={qr.image} code={code} present={present} classSize={classSize} secondsLeft={secondsLeft} onClose={() => setProjecting(false)} />
      ) : null}
    </section>
  );
}

/** Matches the tk-projector-out animation in take.css. */
const EXIT_MS = 200;

/** The code full screen for a projector, a TV, or a phone held up to the room. */
function Projector({ session, image, code, present, classSize, secondsLeft, onClose }: Readonly<{
  session: CourseSession;
  image: string;
  code: string | null;
  present: number;
  classSize: number | null;
  secondsLeft: number | null;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  // The view re-renders every second; enter full screen once per opening, whatever onClose is.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const [leaving, setLeaving] = useState(false);
  const leave = useRef<() => void>(() => undefined);
  useEffect(() => {
    const element = ref.current;
    if (element?.requestFullscreen) void element.requestFullscreen().catch(() => undefined);
    element?.focus();
    let timer = 0;
    let gone = false;
    leave.current = () => {
      if (gone) return;
      gone = true;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        close.current();
        return;
      }
      setLeaving(true);
      timer = window.setTimeout(() => close.current(), EXIT_MS);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') leave.current(); };
    const onExit = () => { if (!document.fullscreenElement) leave.current(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onExit);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onExit);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  return (
    <div className={`tk-projector cs-projector${leaving ? ' is-leaving' : ''}`} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="QR code full screen">
      <button className="tk-projector-close" type="button" onClick={() => leave.current()} aria-label="Exit full screen"><X size={26} aria-hidden="true" /></button>
      <div className="tk-projector-course">
        <span>{session.courseCode} · {session.title}</span>
        <strong>{session.courseTitle}</strong>
      </div>
      <img src={image} alt="Attendance QR code" />
      <div className="tk-projector-foot">
        {code ? (
          <>
            <p>Scan with your phone camera, or type this in <strong>My attendance</strong></p>
            <p className="tk-projector-code">{formatCode(code)}</p>
          </>
        ) : <p>Scan with your phone camera and sign in to LASUATOS</p>}
        <p className="tk-projector-meta">
          <span className="tk-pulse" aria-hidden="true" />
          {present.toLocaleString('en-NG')}{classSize ? ` of ${classSize.toLocaleString('en-NG')}` : ''} present · open until {formatClock(session.endsAt)}
          {secondsLeft !== null ? ` · new code in ${secondsLeft}s` : ''}
        </p>
      </div>
    </div>
  );
}
