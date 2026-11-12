'use client';

import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Copy,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Maximize2,
  Play,
  QrCode,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  Smartphone,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react';
import { buildCheckInLink } from '@lasuatos/contracts';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useVisiblePolling, useWakeLock } from '../lib/use-live';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  closeAttendanceSession,
  createAttendanceSession,
  loadLecturerAttendanceSession,
  loadLecturerAttendanceSessions,
  loadSessionQrChallenge,
  rotateAttendanceCode,
  updateAttendanceSessionSettings,
} from '../lib/attendance-api';
import { loadLecturerOfferings } from '../lib/course-api';
import { loadLecturerActiveVenues } from '../lib/venue-api';
import { Select } from './ui/select';

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Check your connection and try again.';
}

function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date(value));
}

function statusLabel(status: 'open' | 'closed' | 'expired'): string {
  if (status === 'open') return 'Open';
  if (status === 'expired') return 'Expired';
  return 'Closed';
}

const QR_WINDOW_MS = 20_000;

/** Milliseconds until the challenge's 20-second window ends (when the display rotates). */
function msUntilRotation(challenge: string): number {
  const windowIndex = Number(challenge.split('.')[2]);
  if (!Number.isFinite(windowIndex)) return 0;
  return Math.max(0, (windowIndex + 1) * QR_WINDOW_MS - Date.now());
}

interface RotatingQr {
  readonly link: string;
  readonly challenge: string;
  readonly dataUrl: string;
  readonly sessionEndsAt: string;
}

/**
 * Polls the current challenge for an open session and renders it as a QR
 * image encoding the check-in link (so a plain phone camera opens it).
 */
function useRotatingQr(sessionId: string, size: number) {
  const [current, setCurrent] = useState<RotatingQr | null>(null);
  const [fault, setFault] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);

  const lastChallenge = useRef('');
  // Pauses while the tab is hidden; resumes (and catches up) the moment it is shown.
  useVisiblePolling(async (signal) => {
    try {
      const result = await loadSessionQrChallenge(sessionId);
      if (signal.aborted) return null;
      setFault('');
      if (result.challenge !== lastChallenge.current) {
        lastChallenge.current = result.challenge;
        const link = buildCheckInLink(window.location.origin, result.challenge);
        const dataUrl = await QRCode.toDataURL(link, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: size,
          color: { dark: '#0c1b33', light: '#ffffff' },
        });
        if (signal.aborted) return null;
        setCurrent({ link, challenge: result.challenge, dataUrl, sessionEndsAt: result.sessionEndsAt });
      }
      // Poll shortly after the next rotation instead of every few seconds.
      return Math.min(5_000, Math.max(600, msUntilRotation(result.challenge) + 250));
    } catch (caught) {
      if (!signal.aborted) setFault(failureMessage(caught));
      return 4_000;
    }
  }, [sessionId, size]);
  useWakeLock(true);

  useEffect(() => {
    if (!current) return;
    const tick = () => setSecondsLeft(Math.ceil(msUntilRotation(current.challenge) / 1000));
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [current]);

  return { current, fault, secondsLeft };
}

/** The rotating QR code shown inside the lecturer's session detail. */
function SessionQrPanel({
  sessionId,
  qrOnly,
  onProject,
}: { readonly sessionId: string; readonly qrOnly: boolean; readonly onProject: () => void }) {
  const { current, fault, secondsLeft } = useRotatingQr(sessionId, 320);

  if (fault) {
    return (
      <div className="attendance-qr-panel" data-testid="session-qr-panel">
        <QrCode size={18} aria-hidden="true" />
        <p>QR check-in is unavailable for this session right now: {fault}</p>
      </div>
    );
  }
  if (!current) {
    return (
      <div className="attendance-qr-panel" data-testid="session-qr-panel">
        <LoaderCircle className="course-spin" size={18} aria-hidden="true" />
        <p>Preparing the rotating QR code…</p>
      </div>
    );
  }
  return (
    <div className="attendance-qr-panel" data-testid="session-qr-panel">
      <div className="attendance-qr-copy">
        <p className="section-kicker">ROTATING QR CHECK-IN{qrOnly ? ' · QR ONLY' : ''}</p>
        <h3>Project this for your class</h3>
        <p>
          Students point their phone camera at this code (or use <strong>Scan QR code</strong> under My attendance) and
          the check-in page opens by itself. The code changes every 20 seconds, so a forwarded screenshot soon stops
          working. Next change in <strong>{secondsLeft} s</strong>; the session ends {formatTimestamp(current.sessionEndsAt)}.
        </p>
        <button className="button button-primary attendance-project-button" type="button" onClick={onProject}>
          <Maximize2 size={16} aria-hidden="true" /> Project full screen
        </button>
      </div>
      <img src={current.dataUrl} alt="Rotating attendance QR code" className="attendance-qr-image" width={260} height={260} />
    </div>
  );
}

/**
 * Projector view: a large rotating QR with the course, a countdown and the
 * live check-in count, sized for a classroom screen. Uses the Fullscreen API
 * where available and keeps the screen awake while open.
 */
function ProjectorView({
  sessionId,
  heading,
  subheading,
  qrOnly,
  onClose,
}: {
  readonly sessionId: string;
  readonly heading: string;
  readonly subheading: string;
  readonly qrOnly: boolean;
  readonly onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { current, fault, secondsLeft } = useRotatingQr(sessionId, 720);
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<'open' | 'closed' | 'expired'>('open');

  useEffect(() => {
    const root = rootRef.current;
    let wakeLock: { release: () => Promise<void> } | null = null;
    if (root?.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen().catch(() => undefined);
    }
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((lock) => { wakeLock = lock; }).catch(() => undefined);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      void wakeLock?.release().catch(() => undefined);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  useVisiblePolling(async (signal) => {
    try {
      const detail = await loadLecturerAttendanceSession(sessionId);
      if (signal.aborted) return null;
      setCount(detail.session.attendanceCount);
      setStatus(detail.session.status);
      return detail.session.status === 'open' ? 5_000 : null;
    } catch {
      // The QR keeps working without the counter.
      return 10_000;
    }
  }, [sessionId]);

  const ended = status !== 'open';
  return (
    <div className="projector-view" ref={rootRef} role="dialog" aria-modal="true" aria-label="Projected attendance QR code">
      <button className="projector-close" type="button" onClick={onClose} aria-label="Exit projector view">
        <X size={22} aria-hidden="true" />
      </button>
      <div className="projector-copy">
        <p className="projector-kicker">LASUATOS ATTENDANCE{qrOnly ? ' · QR ONLY' : ''}</p>
        <h2>{heading}</h2>
        <p className="projector-sub">{subheading}</p>
        <ol className="projector-steps">
          <li>Open your phone camera and point it at the code.</li>
          <li>Tap the link that appears, allow location if asked.</li>
          <li>No link? In LASUATOS go to <strong>My attendance → Scan QR code</strong>.</li>
        </ol>
        <div className="projector-stats">
          <div>
            <span className="projector-stat-value" aria-live="polite">{count ?? '—'}</span>
            <span className="projector-stat-label">checked in</span>
          </div>
          <div>
            <span className="projector-stat-value">{ended ? '—' : `${secondsLeft}s`}</span>
            <span className="projector-stat-label">until the code changes</span>
          </div>
        </div>
        {current ? <p className="projector-ends">Check-in closes {formatTimestamp(current.sessionEndsAt)}</p> : null}
      </div>
      <div className="projector-code">
        {ended ? (
          <p className="projector-message">This session has {status === 'closed' ? 'been closed' : 'ended'}. Check-in is no longer available.</p>
        ) : fault ? (
          <p className="projector-message">QR check-in is unavailable right now: {fault}</p>
        ) : current ? (
          <img src={current.dataUrl} alt="Rotating attendance QR code" />
        ) : (
          <p className="projector-message"><LoaderCircle className="course-spin" size={22} aria-hidden="true" /> Preparing the code…</p>
        )}
      </div>
    </div>
  );
}

export function LecturerAttendanceWorkspace() {
  const [offerings, setOfferings] = useState<Awaited<ReturnType<typeof loadLecturerOfferings>>['offerings']>([]);
  const [venues, setVenues] = useState<Awaited<ReturnType<typeof loadLecturerActiveVenues>>['venues']>([]);
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof loadLecturerAttendanceSessions>>['sessions']>([]);
  const [selectedOfferingId, setSelectedOfferingId] = useState('');
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadLecturerAttendanceSession>> | null>(null);
  const [activeCode, setActiveCode] = useState<{ sessionId: string; code: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [projecting, setProjecting] = useState(false);
  const closeProjector = useCallback(() => setProjecting(false), []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [offeringResult, sessionResult, venueResult] = await Promise.all([
        loadLecturerOfferings(signal),
        loadLecturerAttendanceSessions(undefined, signal),
        loadLecturerActiveVenues(signal),
      ]);
      if (signal?.aborted) return;
      setOfferings(offeringResult.offerings);
      setSessions(sessionResult.sessions);
      setVenues(venueResult.venues);
      setSelectedOfferingId((current) => current || offeringResult.offerings[0]?.courseOfferingId || '');
      setSelectedSessionId((current) => current || sessionResult.sessions[0]?.id || '');
    } catch (caught) {
      if (!signal?.aborted) setError(failureMessage(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      loadLecturerOfferings(controller.signal),
      loadLecturerAttendanceSessions(undefined, controller.signal),
      loadLecturerActiveVenues(controller.signal),
    ])
      .then(([offeringResult, sessionResult, venueResult]) => {
        if (controller.signal.aborted) return;
        setOfferings(offeringResult.offerings);
        setSessions(sessionResult.sessions);
        setVenues(venueResult.venues);
        setSelectedOfferingId((current) => current || offeringResult.offerings[0]?.courseOfferingId || '');
        setSelectedSessionId((current) => current || sessionResult.sessions[0]?.id || '');
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    const controller = new AbortController();
    void loadLecturerAttendanceSession(selectedSessionId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      });
    return () => controller.abort();
  }, [selectedSessionId]);

  const liveSessionId = selectedSessionId && detail?.session.status === 'open' ? selectedSessionId : '';
  useVisiblePolling(async (signal) => {
    if (!liveSessionId) return null;
    // The first run happens right after the detail loaded; wait one interval before refreshing.
    await new Promise((resolve) => window.setTimeout(resolve, 15_000));
    if (signal.aborted) return null;
    try {
      setDetail(await loadLecturerAttendanceSession(liveSessionId));
    } catch (caught) {
      setError(failureMessage(caught));
    }
    return 0;
  }, [liveSessionId]);

  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const venueId = String(form.get('venueId') ?? '');
      const result = await createAttendanceSession({
        courseOfferingId: String(form.get('courseOfferingId') ?? ''),
        venueId: venueId || null,
        title: String(form.get('title') ?? ''),
        durationMinutes: Number(form.get('durationMinutes')),
        qrOnly: form.get('qrOnly') === 'on',
      });
      setSelectedOfferingId(result.session.courseOfferingId);
      setDetail(null);
      setSelectedSessionId(result.session.id);
      setActiveCode({ sessionId: result.session.id, code: result.code, expiresAt: result.session.endsAt });
      setMessage(result.session.qrOnly
        ? 'Attendance is open in QR-only mode. Project the rotating QR code below; typed codes will be refused.'
        : 'Attendance is open. Project the rotating QR code below, or share the session code.');
      await refresh();
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleRotateCode(sessionId: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await rotateAttendanceCode(sessionId);
      setActiveCode({ sessionId, code: result.code, expiresAt: result.expiresAt });
      setMessage('A new code is ready. The previous code no longer works.');
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleQrOnly(sessionId: string, qrOnly: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await updateAttendanceSessionSettings(sessionId, { qrOnly });
      setDetail((current) => (current && current.session.id === sessionId
        ? { ...current, session: { ...current.session, qrOnly: result.session.qrOnly } }
        : current));
      setSessions((current) => current.map((session) => (session.id === sessionId ? { ...session, qrOnly: result.session.qrOnly } : session)));
      setMessage(result.session.qrOnly
        ? 'QR-only is on. Typed session codes are now refused; students must scan the code on screen.'
        : 'QR-only is off. Students can scan the QR code or type the session code.');
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(sessionId: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await closeAttendanceSession(sessionId);
      if (activeCode?.sessionId === sessionId) setActiveCode(null);
      setMessage(result.status === 'already_closed' ? 'This session was already closed.' : 'Attendance session closed.');
      await refresh();
      setSelectedSessionId(sessionId);
      await refreshRoster(sessionId);
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refreshRoster(sessionId: string) {
    try {
      const result = await loadLecturerAttendanceSession(sessionId);
      setDetail(result);
    } catch (caught) {
      setError(failureMessage(caught));
    }
  }

  async function handleRefresh() {
    setLoading(true);
    setError('');
    await refresh();
    if (selectedSessionId) await refreshRoster(selectedSessionId);
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(formatCode(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Copy is unavailable in this browser. Select the code and copy it manually.');
    }
  }

  const openSession = sessions.find((session) => session.id === selectedSessionId && session.status === 'open');

  return (
    <div className="attendance-workspace">
      <details className="sx-evidence-note">
        <summary><ShieldAlert size={16} aria-hidden="true" /><span>Check-in records evidence, not proof of presence</span></summary>
        <p>A code or QR scan records enrolled code use and time. When a session is tied to a venue, the student’s device location is recorded as supporting evidence — clearly outside readings are declined and coarse readings are marked inconclusive, never fake-confirmed. Student identity is not verified against LASU records.</p>
      </details>

      {error ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {message ? <p className="course-alert course-alert-success" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}

      <div className="attendance-create-grid">
        <section className="attendance-panel attendance-create-panel" aria-labelledby="attendance-create-title">
          <div className="attendance-panel-heading">
            <span className="attendance-icon"><Play size={17} aria-hidden="true" /></span>
            <div>
              <p className="section-kicker">LECTURER CONTROL</p>
              <h2 id="attendance-create-title">Open an attendance session</h2>
            </div>
          </div>
          {offerings.length ? (
            <form className="attendance-form" onSubmit={submitSession}>
              <label>
                <span>Course offering</span>
                <Select
                  name="courseOfferingId"
                  required
                  value={selectedOfferingId}
                  onValueChange={setSelectedOfferingId}
                  placeholder="Choose a course"
                  options={offerings.map((offering) => ({ value: offering.courseOfferingId, label: offering.courseCode, description: offering.courseTitle }))}
                />
              </label>
              <label>
                <span>Venue (optional)</span>
                <Select
                  name="venueId"
                  value={selectedVenueId}
                  onValueChange={setSelectedVenueId}
                  options={[
                    { value: '', label: 'No venue', description: 'Code check-in only' },
                    ...venues.map((venue) => ({ value: venue.id, label: `${venue.code} · ${venue.name}`, ...(venue.buildingName ? { description: venue.buildingName } : {}) })),
                  ]}
                />
              </label>
              <label>
                <span>Session label</span>
                <input name="title" type="text" maxLength={160} placeholder="e.g. Week 4 lecture" required />
              </label>
              <label>
                <span>Check-in window</span>
                <Select
                  name="durationMinutes"
                  defaultValue="60"
                  options={[
                    { value: '30', label: '30 minutes' },
                    { value: '60', label: '60 minutes' },
                    { value: '90', label: '90 minutes' },
                    { value: '120', label: '2 hours' },
                    { value: '240', label: '4 hours' },
                  ]}
                />
              </label>
              <label className="attendance-checkbox">
                <input name="qrOnly" type="checkbox" />
                <span>
                  <strong>QR only</strong>
                  <small>Refuse typed session codes, so a code forwarded on WhatsApp is useless. Students must scan the rotating QR in the room.</small>
                </span>
              </label>
              <button className="button button-primary attendance-submit" type="submit" disabled={busy || !selectedOfferingId}>
                {busy ? <LoaderCircle className="course-spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                Open session &amp; generate code
              </button>
            </form>
          ) : loading ? (
            <div className="course-empty-state"><LoaderCircle className="course-spin" size={20} aria-hidden="true" /><p>Loading your assigned courses…</p></div>
          ) : (
            <div className="course-empty-state"><CalendarClock size={21} aria-hidden="true" /><p>Create or receive an assigned course offering first, then open an attendance session for it.</p></div>
          )}
        </section>

        <aside className="attendance-panel attendance-guidance">
          <span className="attendance-guidance-icon"><Clock3 size={19} aria-hidden="true" /></span>
          <p className="section-kicker">HOW IT WORKS</p>
          <h2>One window. One roster.</h2>
          <ol>
            <li>Choose your course — and optionally an active venue — and open a timed session.</li>
            <li>Project the rotating QR code — students scan it with their phone camera. The typed code is a fallback you can switch off (QR only).</li>
            <li>Watch the roster update, then close the session.</li>
          </ol>
          <p className="attendance-guidance-foot">Codes are stored as hashes and can be rotated. QR codes change every 20 seconds and expire within a minute. Venue-linked sessions record device location as evidence only. If one phone checks in several students, the roster flags it.</p>
        </aside>
      </div>

      {activeCode ? (
        <section className="attendance-code-card" aria-labelledby="attendance-code-heading">
          <div className="attendance-code-copy">
            <p className="section-kicker">ACTIVE CHECK-IN CODE</p>
            <h2 id="attendance-code-heading">Share this with your class</h2>
            <p>
              {sessions.find((session) => session.id === activeCode.sessionId)?.qrOnly
                ? 'This session is QR only, so typed codes are refused. Keep this code for yourself in case you switch QR-only off.'
                : `Students can type this code under My attendance if they cannot scan. It expires ${formatTimestamp(activeCode.expiresAt)}.`}
            </p>
          </div>
          <output className="attendance-code-value" aria-label="Attendance code">{formatCode(activeCode.code)}</output>
          <button className="attendance-secondary-button" type="button" onClick={() => void copyCode(activeCode.code)}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy code'}
          </button>
          <button className="attendance-secondary-button" type="button" onClick={() => void handleRotateCode(activeCode.sessionId)} disabled={busy}>
            <RotateCw size={15} aria-hidden="true" /> Rotate
          </button>
          <p className="attendance-code-foot"><ShieldAlert size={14} aria-hidden="true" /> Share only with enrolled students during this lecture.</p>
        </section>
      ) : null}

      <section className="attendance-panel attendance-sessions-panel" aria-labelledby="attendance-sessions-title">
        <div className="attendance-panel-heading attendance-list-heading">
          <div>
            <p className="section-kicker">LECTURE RECORDS</p>
            <h2 id="attendance-sessions-title">Attendance sessions</h2>
          </div>
          <button className="course-refresh-button" type="button" onClick={() => void handleRefresh()} disabled={loading}>
            <RefreshCw className={loading ? 'course-spin' : ''} size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
        {loading && !sessions.length ? (
          <div className="course-empty-state"><LoaderCircle className="course-spin" size={20} aria-hidden="true" /><p>Loading attendance sessions…</p></div>
        ) : sessions.length ? (
          <div className="attendance-session-layout">
            <div className="attendance-session-list" aria-label="Select an attendance session">
              {sessions.map((session) => (
                <button
                  className={`attendance-session-item${selectedSessionId === session.id ? ' is-selected' : ''}`}
                  type="button"
                  key={session.id}
                  onClick={() => { setDetail(null); setSelectedSessionId(session.id); }}
                  aria-pressed={selectedSessionId === session.id}
                >
                  <span className={`attendance-state-dot is-${session.status}`} />
                  <span className="attendance-session-item-copy">
                    <strong>{session.courseCode} · {session.title}</strong>
                    <small>{formatTimestamp(session.startsAt)}</small>
                  </span>
                  <span className="attendance-session-count"><UsersRound size={14} aria-hidden="true" />{session.attendanceCount}</span>
                </button>
              ))}
            </div>
            {detail ? (
              <div className="attendance-session-detail">
                <div className="attendance-detail-heading">
                  <div>
                    <span className={`attendance-status-pill is-${detail.session.status}`}>{statusLabel(detail.session.status)}</span>
                    <h3>{detail.session.courseCode} · {detail.session.title}</h3>
                    <p>{detail.session.courseTitle} · Ends {formatTimestamp(detail.session.endsAt)}</p>
                  </div>
                  {openSession?.id === detail.session.id && detail.session.status === 'open' ? (
                    <div className="attendance-detail-actions">
                      <label className="attendance-toggle">
                        <input
                          type="checkbox"
                          checked={detail.session.qrOnly}
                          disabled={busy}
                          onChange={(event) => void handleQrOnly(detail.session.id, event.target.checked)}
                        />
                        <span>QR only</span>
                      </label>
                      <button className="attendance-secondary-button" type="button" onClick={() => void handleRotateCode(detail.session.id)} disabled={busy}>
                        <RotateCw size={14} aria-hidden="true" />
                        {activeCode?.sessionId === detail.session.id ? 'Rotate code' : 'Generate new code'}
                      </button>
                      <button className="attendance-close-button" type="button" onClick={() => void handleClose(detail.session.id)} disabled={busy}>
                        <LockKeyhole size={14} aria-hidden="true" /> Close session
                      </button>
                    </div>
                  ) : null}
                </div>
                {detail.session.venueName ? (
                  <p className="attendance-venue-line">
                    <MapPin size={14} aria-hidden="true" />
                    {detail.session.venueName}{detail.session.locationRequired ? ' · location required to check in' : ' · location optional'}
                  </p>
                ) : null}
                {detail.session.status === 'open' ? (
                  <SessionQrPanel sessionId={detail.session.id} qrOnly={detail.session.qrOnly} onProject={() => setProjecting(true)} />
                ) : null}
                {projecting && detail.session.status === 'open' ? (
                  <ProjectorView
                    sessionId={detail.session.id}
                    heading={`${detail.session.courseCode} · ${detail.session.title}`}
                    subheading={`${detail.session.courseTitle}${detail.session.venueName ? ` · ${detail.session.venueName}` : ''}`}
                    qrOnly={detail.session.qrOnly}
                    onClose={closeProjector}
                  />
                ) : null}
                {detail.session.sharedDeviceCount ? (
                  <p className="attendance-shared-notice" role="note">
                    <Smartphone size={15} aria-hidden="true" />
                    <span>
                      <strong>{detail.session.sharedDeviceCount} check-ins came from a browser that also checked in someone else.</strong>{' '}
                      This can be innocent (a borrowed phone when a battery died) — treat it as a reason to look, not as proof. You can revoke a check-in with a reason from Attendance reports.
                    </span>
                  </p>
                ) : null}
                {detail.attendees.length ? (
                  <div className="attendance-roster-wrap">
                    <table className="attendance-roster-table responsive-table">
                      <thead><tr><th>Student</th><th>Matric no.</th><th>Level</th><th>Checked in</th><th>Record</th></tr></thead>
                      <tbody>
                        {detail.attendees.map((attendee) => (
                          <tr key={attendee.studentId} className={attendee.status === 'revoked' ? 'is-revoked' : undefined}>
                            <td data-label="Student">{attendee.displayName}</td>
                            <td data-label="Matric no." className="attendance-matric">{attendee.studentNumber}</td>
                            <td data-label="Level">{attendee.levelLabel}</td>
                            <td data-label="Checked in">{formatTimestamp(attendee.checkedInAt)}</td>
                            <td data-label="Record">
                              {attendee.status === 'revoked' ? (
                                <span className="attendance-record-badge is-revoked">
                                  <XCircle size={13} aria-hidden="true" /> Revoked{attendee.revokedAt ? ` ${formatTimestamp(attendee.revokedAt)}` : ''}
                                </span>
                              ) : (
                                <span className="attendance-record-badge">
                                  <CheckCircle2 size={13} aria-hidden="true" />
                                  {attendee.method === 'qr_code' ? 'QR scan' : attendee.method === 'manual' ? 'Recorded by lecturer' : 'Code used'}
                                  {attendee.venueOutcome === 'within_boundary' ? ' · within boundary' : null}
                                  {attendee.venueOutcome === 'inconclusive' ? ' · location inconclusive' : null}
                                </span>
                              )}
                              {attendee.sharedDevice ? (
                                <span className="attendance-record-badge is-shared" data-tip="Another student in this session checked in from the same browser.">
                                  <Smartphone size={13} aria-hidden="true" /> Shared device
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="course-empty-state attendance-no-records"><UsersRound size={20} aria-hidden="true" /><p>No students have checked in yet.</p></div>
                )}
                <p className="attendance-report-link">
                  Need to record a missed check-in or revoke one? Use{' '}
                  <Link href="/lecturer/reports">Attendance reports</Link> — every correction needs a reason and is permanently logged.
                </p>
              </div>
            ) : (
              <div className="course-empty-state attendance-no-records"><LoaderCircle className="course-spin" size={20} aria-hidden="true" /><p>Loading the selected roster…</p></div>
            )}
          </div>
        ) : (
          <div className="course-empty-state"><ClipboardCheck size={21} aria-hidden="true" /><p>No attendance sessions yet. Open one above when your lecture is ready.</p></div>
        )}
      </section>
    </div>
  );
}
