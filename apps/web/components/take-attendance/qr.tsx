'use client';

import type { LectureQrFrame, LectureQrMode, LectureSessionSummary } from '@lasuatos/contracts';
import { AlertTriangle, Download, Expand, Plus, Printer, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { failureText, formatAttendanceCode, formatClock, formatDay, loadLectureFrame } from '../../lib/lecture-api';
import { useVisiblePolling, useWakeLock } from '../../lib/use-live';
import { Button } from '../ds';
import { LiveCount } from '../ui/live-status';
import { numberFormat } from './format';
import { useClock } from './hooks';

const ROTATION_SECONDS = 30;

function useQrFrame(sessionId: string, mode: LectureQrMode, status: string) {
  const [frame, setFrame] = useState<LectureQrFrame | null>(null);
  const [image, setImage] = useState('');
  const [fault, setFault] = useState('');
  const lastPath = useRef('');

  useVisiblePolling(async (signal) => {
    if (status !== 'open') return null;
    try {
      const next = await loadLectureFrame(sessionId, signal);
      setFault('');
      setFrame(next);
      if (next.path !== lastPath.current) {
        lastPath.current = next.path;
        const url = `${window.location.origin}${next.path}`;
        const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 720, color: { dark: '#0c1b33', light: '#ffffff' } });
        if (!signal.aborted) setImage(dataUrl);
      }
      if (next.status !== 'open') return null;
      if (next.mode === 'dynamic' && next.rotatesAt) {
        // The next frame just after the change, and at least every 10 s to keep the count fresh.
        return Math.min(10_000, Math.max(500, new Date(next.rotatesAt).getTime() - Date.now() + 300));
      }
      return 15_000;
    } catch (caught) {
      if (signal.aborted) return null;
      setFault(failureText(caught));
      return 5_000;
    }
  }, [sessionId, mode, status]);

  return { frame, image, fault };
}

/**
 * The QR code students scan, the code to type, and the controls a lecturer reaches for during
 * class. Tap the code (or press F) to show it full screen.
 */
export function QrStage({ session, busy, onExtend, onClose }: Readonly<{
  session: LectureSessionSummary;
  busy: boolean;
  onExtend: () => void;
  onClose: () => void;
}>) {
  const { frame, image, fault } = useQrFrame(session.id, session.qrMode, session.status);
  const [projecting, setProjecting] = useState(false);
  const now = useClock('second');
  const secondsLeft = frame?.rotatesAt && now ? Math.max(0, Math.ceil((new Date(frame.rotatesAt).getTime() - now) / 1000)) : null;
  const host = typeof window === 'undefined' ? '' : window.location.host;
  // Keep the lecturer's screen (or the projector laptop) awake while the code is up.
  useWakeLock(true);

  useEffect(() => {
    // Desktop shortcut: F shows the code full screen.
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

  const ready = Boolean(image && frame);
  const count = frame?.presentCount ?? session.presentCount;

  const timer = secondsLeft !== null
    ? <span className="tk-stage-timer" aria-hidden="true">New code in {secondsLeft}s</span>
    : session.qrMode === 'static' ? <span className="tk-stage-timer">Poster</span> : null;

  return (
    <section className="tk-stage-section" aria-labelledby="tk-qr-title">
      {/* Same head as the columns beside it, so the cards start level. */}
      <div className="tk-section-head">
        <h2 className="tk-section-title" id="tk-qr-title">QR code</h2>
        {timer}
      </div>
      <div className="tk-stage">
        {/* Phones show one panel at a time and no section heads: the count and timer go here. */}
        <div className="tk-stage-bar">
          <span className="tk-stage-count"><LiveCount value={count} format={(value) => numberFormat.format(value)} /> present</span>
          {timer}
        </div>

        {ready && frame ? (
          <>
            <button className="tk-qr" type="button" onClick={() => setProjecting(true)} aria-label="Show the QR code full screen">
              <img src={image} alt={`QR code for ${session.courseCode} attendance`} width={360} height={360} />
              {secondsLeft !== null ? (
                <span className="tk-qr-progress" aria-hidden="true">
                  <span key={frame.code} style={{ transform: `scaleX(${Math.min(1, secondsLeft / ROTATION_SECONDS)})` }} />
                </span>
              ) : null}
            </button>
            <p className="tk-attendance-code" aria-label={`Code ${frame.code.split('').join(' ')}`}>{formatAttendanceCode(frame.code)}</p>
            <p className="tk-code-hint">or type it at <strong>{host}/a</strong></p>
          </>
        ) : (
          <div className="tk-qr is-waiting">
            {fault ? (
              <span className="tk-qr-fault" role="alert"><AlertTriangle size={26} aria-hidden="true" />{fault}</span>
            ) : <span className="ds-skeleton tk-qr-bone" role="status" aria-label="Loading the QR code" />}
          </div>
        )}

        <div className={`tk-stage-actions${session.qrMode === 'static' ? ' has-poster' : ''}`}>
          {session.qrMode === 'static' && frame ? (
            <PosterButtons session={session} frame={frame} />
          ) : (
            <Button className="tk-stage-primary" icon={<Expand size={18} strokeWidth={2.1} aria-hidden="true" />} disabled={!ready} onClick={() => setProjecting(true)}>
              Full screen <kbd className="tk-kbd" aria-hidden="true">F</kbd>
            </Button>
          )}
          <Button variant="gray" icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />} disabled={busy} onClick={onExtend}>
            15 min
          </Button>
          <Button variant="gray" className="tk-close-btn" disabled={busy} onClick={onClose}>Close</Button>
        </div>
      </div>
      {projecting && image && frame ? (
        <ProjectorView session={session} frame={frame} image={image} secondsLeft={secondsLeft} onClose={() => setProjecting(false)} />
      ) : null}
    </section>
  );
}

/** Matches the tk-projector-out animation in take.css. */
const PROJECTOR_EXIT_MS = 200;

function ProjectorView({ session, frame, image, secondsLeft, onClose }: Readonly<{
  session: LectureSessionSummary;
  frame: LectureQrFrame;
  image: string;
  secondsLeft: number | null;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  // The view re-renders every second (the countdown) with a new onClose. Keep the latest in a
  // ref so entering full screen happens once per opening: re-running the effect would leave
  // full screen and close the view a moment after it opened.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  // Opening fades and scales in (CSS). Leaving goes out of full screen first, so the page does
  // not jump behind the view, then fades out before the view unmounts.
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
      timer = window.setTimeout(() => close.current(), PROJECTOR_EXIT_MS);
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
  const host = typeof window === 'undefined' ? '' : window.location.host;
  return (
    <div className={`tk-projector${leaving ? ' is-leaving' : ''}`} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="QR code full screen">
      <button className="tk-projector-close" type="button" onClick={() => leave.current()} aria-label="Exit full screen"><X size={26} aria-hidden="true" /></button>
      <div className="tk-projector-course">
        <span>{session.courseCode}</span>
        <strong>{session.courseTitle}</strong>
      </div>
      <img src={image} alt="Attendance QR code" />
      <div className="tk-projector-foot">
        <p>Scan with your phone camera, or go to <strong>{host}/a</strong> and type</p>
        <p className="tk-projector-code">{formatAttendanceCode(frame.code)}</p>
        <p className="tk-projector-meta">
          <span className="tk-pulse" aria-hidden="true" />
          {numberFormat.format(frame.presentCount)} present · open until {formatClock(frame.endsAt)}
          {secondsLeft !== null ? ` · new code in ${secondsLeft}s` : ''}
        </p>
      </div>
    </div>
  );
}

/* Printable poster ------------------------------------------------- */

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (context.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

async function drawPoster(session: LectureSessionSummary, frame: LectureQrFrame): Promise<string> {
  const width = 1240;
  const height = 1754;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser cannot draw the poster.');
  const font = (weight: number, size: number) => `${weight} ${size}px "Plus Jakarta Sans", "Inter", Arial, sans-serif`;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#153b5b';
  context.fillRect(0, 0, width, 230);
  context.fillStyle = '#c59a42';
  context.fillRect(0, 230, width, 12);

  context.textAlign = 'center';
  context.fillStyle = '#ffffff';
  context.font = font(800, 76);
  context.fillText('Mark your attendance', width / 2, 128);
  context.font = font(500, 34);
  context.fillText('LASUATOS · Lagos State University', width / 2, 186);

  context.fillStyle = '#c59a42';
  context.font = font(800, 58);
  context.fillText(session.courseCode, width / 2, 340);
  context.fillStyle = '#10283d';
  context.font = font(700, 48);
  let y = 410;
  for (const line of wrapText(context, session.courseTitle, width - 200)) {
    context.fillText(line, width / 2, y);
    y += 60;
  }

  const qrSize = 820;
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, `${window.location.origin}${frame.path}`, { errorCorrectionLevel: 'Q', margin: 1, width: qrSize, color: { dark: '#0c1b33', light: '#ffffff' } });
  const qrTop = Math.max(y + 10, 520);
  context.drawImage(qr, (width - qrSize) / 2, qrTop, qrSize, qrSize);

  let footer = qrTop + qrSize + 90;
  context.fillStyle = '#10283d';
  context.font = font(700, 40);
  context.fillText('Scan with your phone camera and sign in to mark yourself', width / 2, footer);
  footer += 70;
  context.fillStyle = '#4a5d6b';
  context.font = font(500, 34);
  context.fillText(`No camera? Go to ${window.location.host}/a and type`, width / 2, footer);
  footer += 100;
  context.fillStyle = '#153b5b';
  context.font = `800 96px "SFMono-Regular", Consolas, "Liberation Mono", monospace`;
  context.fillText(formatAttendanceCode(frame.code), width / 2, footer);
  footer += 80;
  context.fillStyle = '#4a5d6b';
  context.font = font(500, 32);
  context.fillText(`${formatDay(session.startsAt)} · open until ${formatClock(session.endsAt)}`, width / 2, Math.min(footer, height - 50));
  return canvas.toDataURL('image/png');
}

function PosterButtons({ session, frame }: Readonly<{ session: LectureSessionSummary; frame: LectureQrFrame }>) {
  const [poster, setPoster] = useState('');
  const [error, setError] = useState('');

  async function ensurePoster(): Promise<string> {
    if (poster) return poster;
    const created = await drawPoster(session, frame);
    setPoster(created);
    return created;
  }

  async function download() {
    try {
      const url = await ensurePoster();
      const link = document.createElement('a');
      link.href = url;
      link.download = `${session.courseCode.replace(/[^A-Za-z0-9]+/g, '-')}-attendance-qr.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (caught) {
      setError(failureText(caught));
    }
  }

  async function print() {
    try {
      await ensurePoster();
      // The print stylesheet shows only the poster image.
      window.setTimeout(() => window.print(), 150);
    } catch (caught) {
      setError(failureText(caught));
    }
  }

  return (
    <>
      <Button className="tk-stage-primary" icon={<Download size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => void download()}>
        Poster
      </Button>
      <Button variant="gray" icon={<Printer size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => void print()}>
        Print
      </Button>
      {error ? <p className="tk-error" role="alert">{error}</p> : null}
      {poster ? <div className="lx-print-poster" aria-hidden="true"><img src={poster} alt="" /></div> : null}
    </>
  );
}
