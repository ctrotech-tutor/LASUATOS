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
  Play,
  QrCode,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  UsersRound,
  XCircle,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  checkInWithAttendanceCode,
  closeAttendanceSession,
  createAttendanceSession,
  loadLecturerAttendanceSession,
  loadLecturerAttendanceSessions,
  loadSessionQrChallenge,
  loadStudentAttendance,
  loadStudentOpenAttendanceSessions,
  rotateAttendanceCode,
  type CheckInLocationInput,
} from '../lib/attendance-api';
import { loadLecturerOfferings } from '../lib/course-api';
import { loadLecturerActiveVenues } from '../lib/venue-api';

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

/** Polls and projects the current rotating QR challenge for an open session. */
function SessionQrPanel({ sessionId }: { readonly sessionId: string }) {
  const [current, setCurrent] = useState<{ challenge: string; dataUrl: string; validUntil: string; sessionEndsAt: string } | null>(null);
  const [fault, setFault] = useState('');
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let active = true;
    async function pull() {
      try {
        const result = await loadSessionQrChallenge(sessionId);
        if (!active) return;
        const dataUrl = await QRCode.toDataURL(result.challenge, {
          margin: 1,
          width: 280,
          color: { dark: '#0c1b33', light: '#ffffff' },
        });
        if (!active) return;
        setCurrent({
          challenge: result.challenge,
          dataUrl,
          validUntil: result.validUntil,
          sessionEndsAt: result.sessionEndsAt,
        });
        setFault('');
      } catch (caught) {
        if (active) setFault(failureMessage(caught));
      }
    }
    void pull();
    const interval = window.setInterval(() => void pull(), 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!current) return;
    const tick = () => setCountdown(Math.max(0, Math.ceil((new Date(current.validUntil).getTime() - Date.now()) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [current?.validUntil]);

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
        <p className="section-kicker">ROTATING QR CHECK-IN</p>
        <h3>Project this for your class</h3>
        <p>
          Students scan this code to check in. It changes every 20 seconds — a screenshot of an older code will not work.
          This code rotates again in <strong>{countdown} s</strong> and the session ends {formatTimestamp(current.sessionEndsAt)}.
        </p>
      </div>
      <img src={current.dataUrl} alt="Rotating attendance QR code" className="attendance-qr-image" width={280} height={280} />
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

  useEffect(() => {
    if (!selectedSessionId || detail?.session.status !== 'open') return;
    const interval = window.setInterval(() => {
      void loadLecturerAttendanceSession(selectedSessionId)
        .then((result) => setDetail(result))
        .catch((caught: unknown) => setError(failureMessage(caught)));
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [selectedSessionId, detail?.session.status]);

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
      });
      setSelectedOfferingId(result.session.courseOfferingId);
      setDetail(null);
      setSelectedSessionId(result.session.id);
      setActiveCode({ sessionId: result.session.id, code: result.code, expiresAt: result.session.endsAt });
      setMessage('Attendance is open. Share this session code with enrolled students.');
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
      <section className="attendance-notice" aria-label="Attendance evidence note">
        <ShieldAlert size={18} aria-hidden="true" />
        <p><strong>Check-in records evidence, not proof of presence.</strong> A code or QR scan records enrolled code use and time. When a session is tied to a venue, the student’s device location is recorded as supporting evidence — clearly outside readings are declined and coarse readings are marked inconclusive, never fake-confirmed. Student identity is not verified against LASU records.</p>
      </section>

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
                <select name="courseOfferingId" value={selectedOfferingId} onChange={(event) => setSelectedOfferingId(event.target.value)} required>
                  {offerings.map((offering) => (
                    <option value={offering.courseOfferingId} key={offering.courseOfferingId}>
                      {offering.courseCode} · {offering.courseTitle}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Venue (optional)</span>
                <select name="venueId" value={selectedVenueId} onChange={(event) => setSelectedVenueId(event.target.value)}>
                  <option value="">No venue — code check-in only</option>
                  {venues.map((venue) => (
                    <option value={venue.id} key={venue.id}>
                      {venue.code} · {venue.name}{venue.buildingName ? ` · ${venue.buildingName}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Session label</span>
                <input name="title" type="text" maxLength={160} placeholder="e.g. Week 4 lecture" required />
              </label>
              <label>
                <span>Check-in window</span>
                <select name="durationMinutes" defaultValue="60">
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                  <option value="90">90 minutes</option>
                  <option value="120">2 hours</option>
                  <option value="240">4 hours</option>
                </select>
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
            <li>Share the generated code, or project the rotating QR code, with enrolled students.</li>
            <li>Watch the roster update, then close the session.</li>
          </ol>
          <p className="attendance-guidance-foot">Codes are stored as hashes and can be rotated. QR codes change every 20 seconds. Venue-linked sessions record device location as evidence only.</p>
        </aside>
      </div>

      {activeCode ? (
        <section className="attendance-code-card" aria-labelledby="attendance-code-heading">
          <div className="attendance-code-copy">
            <p className="section-kicker">ACTIVE CHECK-IN CODE</p>
            <h2 id="attendance-code-heading">Share this with your class</h2>
            <p>Students enter this code under My attendance. It expires {formatTimestamp(activeCode.expiresAt)}.</p>
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
                {detail.session.status === 'open' ? <SessionQrPanel sessionId={detail.session.id} /> : null}
                {detail.attendees.length ? (
                  <div className="attendance-roster-wrap">
                    <table className="attendance-roster-table">
                      <thead><tr><th>Student</th><th>Checked in</th><th>Record</th></tr></thead>
                      <tbody>
                        {detail.attendees.map((attendee, index) => (
                          <tr key={`${attendee.checkedInAt}-${index}`}>
                            <td>{attendee.displayName}</td>
                            <td>{formatTimestamp(attendee.checkedInAt)}</td>
                            <td>
                              <span className="attendance-record-badge">
                                <CheckCircle2 size={13} aria-hidden="true" />
                                {attendee.method === 'qr_code' ? 'QR scan' : 'Code used'}
                                {attendee.venueOutcome === 'within_boundary' ? ' · within boundary' : null}
                                {attendee.venueOutcome === 'inconclusive' ? ' · location inconclusive' : null}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="course-empty-state attendance-no-records"><UsersRound size={20} aria-hidden="true" /><p>No students have checked in yet.</p></div>
                )}
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

/**
 * Attempts to read the device's current position so venue-linked check-ins can
 * attach honest location evidence. Resolved as null when the browser cannot
 * or will not provide a reading — the server decides what the venue requires.
 */
function requestLocationSample(): Promise<CheckInLocationInput | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  });
}

export function StudentAttendanceWorkspace() {
  const [records, setRecords] = useState<Awaited<ReturnType<typeof loadStudentAttendance>>['records']>([]);
  const [openSessions, setOpenSessions] = useState<Awaited<ReturnType<typeof loadStudentOpenAttendanceSessions>>['sessions']>([]);
  const [openLoading, setOpenLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await loadStudentAttendance(signal);
      if (!signal?.aborted) setRecords(result.records);
    } catch (caught) {
      if (!signal?.aborted) setError(failureMessage(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function pollOpenSessions(signal?: AbortSignal) {
      try {
        const result = await loadStudentOpenAttendanceSessions(signal);
        if (!cancelled && !signal?.aborted) setOpenSessions(result.sessions);
      } catch {
        // Open-session hints are a convenience; a failure must not block check-in.
      } finally {
        if (!cancelled && !signal?.aborted) setOpenLoading(false);
      }
    }
    void pollOpenSessions();
    const interval = window.setInterval(() => void pollOpenSessions(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStudentAttendance(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRecords(result.records);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function submitCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      // Venue-linked sessions need device location; request it up front when any
      // open enrolled session requires it, and send the reading as evidence.
      let location: CheckInLocationInput | undefined;
      if (openSessions.some((openSession) => openSession.locationRequired)) {
        const sample = await requestLocationSample();
        if (sample) location = sample;
      }
      const result = await checkInWithAttendanceCode(String(form.get('code') ?? ''), location);
      const { courseCode, sessionTitle, checkedInAt } = result.attendance;
      setMessage(result.status === 'checked_in'
        ? `You checked in to ${courseCode} · ${sessionTitle} at ${formatTimestamp(checkedInAt)}.`
        : `Your check-in for ${courseCode} · ${sessionTitle} was already recorded.`);
      formElement.reset();
      await refresh();
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attendance-workspace">
      <section className="attendance-notice" aria-label="Attendance evidence note">
        <ShieldAlert size={18} aria-hidden="true" />
        <p>Check-in requires an active course enrollment. A session code or QR scan records code use and time; when your lecturer ties a session to a venue, your browser also shares its current location as supporting evidence. Neither establishes identity or proves presence on its own.</p>
      </section>
      {error ? <p className="course-alert course-alert-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {message ? <p className="course-alert course-alert-success" role="status"><Check size={16} aria-hidden="true" />{message}</p> : null}

      <section className="attendance-panel student-checkin-panel" aria-labelledby="student-checkin-heading">
        <div className="attendance-panel-heading">
          <span className="attendance-icon attendance-icon-student"><ClipboardCheck size={18} aria-hidden="true" /></span>
          <div>
            <p className="section-kicker">LIVE LECTURE</p>
            <h2 id="student-checkin-heading">Have a session code?</h2>
            <p>Enter the <strong>attendance session code</strong> shown on your lecturer’s screen right now. This is not the course join code you used to enroll.</p>
          </div>
        </div>
        <form className="attendance-checkin-form" onSubmit={submitCheckIn}>
          <label className="sr-only" htmlFor="attendance-session-code">Attendance session code</label>
          <input
            id="attendance-session-code"
            name="code"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="e.g. 7K9M-PQ2R-4XBD"
            maxLength={24}
            required
          />
          {openSessions.some((openSession) => openSession.locationRequired) ? (
            <p className="attendance-location-hint">
              <MapPin size={13} aria-hidden="true" />
              One of your open sessions is venue-linked. When you check in, your browser will ask to share your current location — allow it so the check-in can be recorded.
            </p>
          ) : null}
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="course-spin" size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            {busy ? 'Checking in' : 'Check in'}
          </button>
        </form>
      </section>

      <section className="attendance-panel student-open-panel" aria-labelledby="student-open-heading" aria-live="polite">
        <div className="attendance-panel-heading">
          <span className="attendance-icon attendance-icon-student"><Clock3 size={18} aria-hidden="true" /></span>
          <div>
            <p className="section-kicker">OPEN RIGHT NOW</p>
            <h2 id="student-open-heading">Sessions open in your courses</h2>
          </div>
        </div>
        {openLoading ? (
          <p className="student-open-empty"><LoaderCircle className="course-spin" size={16} aria-hidden="true" /> Checking for open sessions…</p>
        ) : openSessions.length ? (
          <ul className="student-open-list">
            {openSessions.map((session) => (
              <li className="student-open-item" key={session.attendanceSessionId}>
                <span className="attendance-state-dot is-open" aria-hidden="true" />
                <span className="student-open-copy">
                  <strong>{session.courseCode} · {session.sessionTitle}</strong>
                  <small>
                    {session.courseTitle} · closes {formatTimestamp(session.endsAt)}
                    {session.venueName ? ` · ${session.venueName}` : ''}
                    {session.locationRequired ? ' · location required' : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="student-open-empty">No open attendance sessions in your enrolled courses right now. If your lecturer has just opened one, this updates automatically within 15 seconds.</p>
        )}
      </section>

      <section className="attendance-panel student-history-panel" aria-labelledby="student-attendance-history-heading">
        <div className="attendance-panel-heading attendance-list-heading">
          <div>
            <p className="section-kicker">YOUR RECORD</p>
            <h2 id="student-attendance-history-heading">My attendance</h2>
          </div>
          <button className="course-refresh-button" type="button" onClick={() => { setLoading(true); setError(''); void refresh(); }} disabled={loading} aria-label="Refresh attendance history">
            <RefreshCw className={loading ? 'course-spin' : ''} size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
        {loading && !records.length ? (
          <div className="course-empty-state"><LoaderCircle className="course-spin" size={20} aria-hidden="true" /><p>Loading your attendance…</p></div>
        ) : records.length ? (
          <div className="attendance-roster-wrap">
            <table className="attendance-history-table">
              <thead><tr><th>Course</th><th>Session</th><th>Lecture time</th><th>Checked in</th><th>Record</th></tr></thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.attendanceSessionId}>
                    <td><strong>{record.courseCode}</strong><span>{record.courseTitle}</span></td>
                    <td>{record.sessionTitle}</td>
                    <td>{formatTimestamp(record.startsAt)}</td>
                    <td>{formatTimestamp(record.checkedInAt)}</td>
                    <td>
                      <span className="attendance-record-badge">
                        <CheckCircle2 size={13} aria-hidden="true" />
                        {record.venueName ? `${record.venueName}` : 'Check-in'}
                        {record.venueOutcome === 'within_boundary' ? ' · within boundary' : null}
                        {record.venueOutcome === 'inconclusive' ? ' · location inconclusive' : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="course-empty-state"><XCircle size={20} aria-hidden="true" /><p>No check-ins yet. Attendance will appear here after you submit a valid course session code.</p></div>
        )}
      </section>
    </div>
  );
}
