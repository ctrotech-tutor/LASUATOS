'use client';

import { DEFAULT_ATTENDANCE_THRESHOLD, readAttendanceScan, type StudentAttendanceHistoryEntry, type StudentLectureHistory, type StudentOpenAttendanceSession } from '@lasuatos/contracts';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Info,
  KeyRound,
  LoaderCircle,
  MapPin,
  QrCode,
  RefreshCw,
  ScanLine,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  checkInWithAttendanceCode,
  checkInWithChallenge,
  loadStudentAttendance,
  loadStudentAttendanceSummary,
  loadStudentOpenAttendanceSessions,
  type CheckInLocationInput,
} from '../lib/attendance-api';
import { loadStudentLectureHistory } from '../lib/lecture-api';
import { requestLocationSample } from '../lib/location';
import { haptic, useVisiblePolling } from '../lib/use-live';
import { StudentDisputePanel } from './attendance-disputes';
import { QrScanner } from './qr-scanner';
import { VenueGuide } from './venue-guide';

type CourseSummary = Awaited<ReturnType<typeof loadStudentAttendanceSummary>>['courses'][number];
type CheckInResult = Awaited<ReturnType<typeof checkInWithChallenge>>;

const LAGOS = 'Africa/Lagos';
const timeFormat = new Intl.DateTimeFormat('en-NG', { timeStyle: 'short', timeZone: LAGOS });
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: LAGOS });
const dayLabelFormat = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: LAGOS });

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Check your connection and try again.';
}

function rateTone(rate: number | null): 'none' | 'good' | 'warn' | 'low' {
  if (rate == null) return 'none';
  if (rate >= 75) return 'good';
  if (rate >= 50) return 'warn';
  return 'low';
}

function formatRate(rate: number | null): string {
  if (rate == null) return '—';
  return `${rate.toFixed(rate % 1 === 0 ? 0 : 1)}%`;
}

function closesIn(endsAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((Date.parse(endsAt) - now) / 60_000));
  if (minutes < 1) return 'Closing now';
  if (minutes < 60) return `Closes in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `Closes in ${hours}h${rest ? ` ${rest}m` : ''}`;
}

function dayLabel(value: string, now: number): string {
  const key = dayKeyFormat.format(new Date(value));
  if (key === dayKeyFormat.format(new Date(now))) return 'Today';
  if (key === dayKeyFormat.format(new Date(now - 86_400_000))) return 'Yesterday';
  return dayLabelFormat.format(new Date(value));
}

function methodLabel(record: StudentAttendanceHistoryEntry): string {
  if (record.method === 'manual') return 'Recorded by lecturer';
  if (record.method === 'qr_code') return 'QR scan';
  return 'Session code';
}

/** Re-renders every 30 seconds so countdowns stay honest without a page refresh. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ProgressRing({ rate, size = 92 }: Readonly<{ rate: number | null; size?: number }>) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = rate == null ? 0 : Math.min(100, Math.max(0, rate)) / 100;
  return (
    <svg className={`sx-ring is-${rateTone(rate)}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="sx-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
      <circle
        className="sx-ring-value"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - filled)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function LiveSessionCard({
  session,
  record,
  now,
  busy,
  onScan,
}: Readonly<{
  session: StudentOpenAttendanceSession;
  record: StudentAttendanceHistoryEntry | undefined;
  now: number;
  busy: boolean;
  onScan: () => void;
}>) {
  const present = record?.status === 'present';
  return (
    <article className={`sx-live-card${present ? ' is-done' : ''}`}>
      <div className="sx-live-top">
        <span className="sx-live-badge"><i aria-hidden="true" />Live</span>
        <span className="sx-live-countdown"><Clock3 size={13} aria-hidden="true" />{closesIn(session.endsAt, now)}</span>
      </div>
      <p className="sx-live-code">{session.courseCode}</p>
      <h3>{session.sessionTitle}</h3>
      <p className="sx-live-course">{session.courseTitle}</p>
      {session.locationRequired || session.qrOnly ? (
        <div className="sx-live-tags">
          {session.locationRequired ? <span><MapPin size={12} aria-hidden="true" />Location needed</span> : null}
          {session.qrOnly ? <span><QrCode size={12} aria-hidden="true" />QR only</span> : null}
        </div>
      ) : null}
      {present && record ? (
        <p className="sx-live-done">
          <CheckCircle2 size={20} aria-hidden="true" />
          <span>
            <strong>You’re checked in</strong>
            <small>
              {timeFormat.format(new Date(record.checkedInAt))} · {methodLabel(record)}
              {record.venueOutcome === 'within_boundary' ? ' · at the venue' : ''}
              {record.venueOutcome === 'inconclusive' ? ' · location imprecise' : ''}
            </small>
          </span>
        </p>
      ) : (
        <button className="sx-live-scan" type="button" onClick={onScan} disabled={busy}>
          {busy ? <LoaderCircle className="course-spin" size={20} aria-hidden="true" /> : <ScanLine size={20} aria-hidden="true" />}
          {busy ? 'Checking in…' : 'Scan QR to check in'}
        </button>
      )}
      {session.venueName ? (
        <div className="sx-live-venue">
          <VenueGuide venueName={session.venueName} guide={session.venueGuide} />
        </div>
      ) : null}
    </article>
  );
}

export function StudentAttendanceWorkspace() {
  const [records, setRecords] = useState<StudentAttendanceHistoryEntry[]>([]);
  const [openSessions, setOpenSessions] = useState<StudentOpenAttendanceSession[]>([]);
  const [summary, setSummary] = useState<CourseSummary[]>([]);
  const [openLoading, setOpenLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [scanning, setScanning] = useState(false);
  // The check-in page links here with #code when a student wants to type the code.
  const [codeOpen, setCodeOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#code');
  const now = useNow();
  const closeScanner = useCallback(() => setScanning(false), []);
  // Students who only use quick lecture QR codes have nothing in the course-enrolment sections.
  const [lectureEntries, setLectureEntries] = useState<number | null>(null);
  const onlyLectures = !loading && summary.length === 0 && records.length === 0 && (lectureEntries ?? 0) > 0;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [history, summaryResult] = await Promise.all([
        loadStudentAttendance(signal),
        loadStudentAttendanceSummary(signal),
      ]);
      if (!signal?.aborted) {
        setRecords(history.records);
        setSummary(summaryResult.courses);
      }
    } catch (caught) {
      if (!signal?.aborted) setError(failureMessage(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useVisiblePolling(async (signal) => {
    try {
      const open = await loadStudentOpenAttendanceSessions();
      if (!signal.aborted) setOpenSessions(open.sessions);
    } catch {
      // Open-session hints are a convenience; a failure must not block check-in.
    } finally {
      if (!signal.aborted) setOpenLoading(false);
    }
    return 15_000;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      loadStudentAttendance(controller.signal),
      loadStudentAttendanceSummary(controller.signal),
    ])
      .then(([history, summaryResult]) => {
        if (controller.signal.aborted) return;
        setRecords(history.records);
        setSummary(summaryResult.courses);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const recordBySession = useMemo(
    () => new Map(records.map((record) => [record.attendanceSessionId, record])),
    [records],
  );

  const totals = useMemo(() => {
    const held = summary.reduce((sum, course) => sum + course.sessionsHeld, 0);
    const attended = summary.reduce((sum, course) => sum + course.attended, 0);
    return { held, attended, rate: held ? Math.round((attended / held) * 1000) / 10 : null };
  }, [summary]);

  const historyGroups = useMemo(() => {
    const groups: { label: string; items: StudentAttendanceHistoryEntry[] }[] = [];
    for (const record of records) {
      const label = dayLabel(record.startsAt, now);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(record);
      else groups.push({ label, items: [record] });
    }
    return groups;
  }, [records, now]);

  const allQrOnly = openSessions.length > 0 && openSessions.every((session) => session.qrOnly);
  const anyNeedsLocation = openSessions.some((session) => session.locationRequired);

  function acceptAnyScan(text: string): string | null {
    return readAttendanceScan(text) ? text : null;
  }

  function handleScan(text: string) {
    const scan = readAttendanceScan(text);
    if (!scan) return;
    if (scan.kind === 'course') {
      void submitChallenge(scan.challenge);
      return;
    }
    // Lecture QR codes (from a lecturer or class rep) are marked on the quick check-in page.
    setScanning(false);
    window.location.assign(scan.kind === 'lecture' ? `/a#${scan.challenge}` : `/a/${scan.code}`);
  }

  function startScan() {
    setError('');
    setResult(null);
    setScanning(true);
  }

  async function finish(outcome: CheckInResult) {
    setResult(outcome);
    haptic([16, 60, 24]);
    await refresh();
  }

  async function submitChallenge(challenge: string) {
    setScanning(false);
    setBusy(true);
    setError('');
    setResult(null);
    try {
      // The challenge names its session; ask for location only when that session needs it.
      const sessionId = challenge.split('.')[1]?.toLowerCase();
      const target = openSessions.find((session) => session.attendanceSessionId === sessionId);
      let location: CheckInLocationInput | undefined;
      if (target ? target.locationRequired : anyNeedsLocation) {
        const sample = await requestLocationSample();
        if (sample) location = sample;
      }
      await finish(await checkInWithChallenge(challenge, location));
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError('');
    setResult(null);
    try {
      let location: CheckInLocationInput | undefined;
      if (anyNeedsLocation) {
        const sample = await requestLocationSample();
        if (sample) location = sample;
      }
      await finish(await checkInWithAttendanceCode(String(form.get('code') ?? ''), location));
      formElement.reset();
      setCodeOpen(false);
    } catch (caught) {
      setError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sx-stack">
      {result ? (
        <section className="sx-result" role="status" aria-live="polite">
          <span className="sx-result-mark" aria-hidden="true">
            <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27 l7 7 l15 -16" /></svg>
          </span>
          <div>
            <h2>{result.status === 'checked_in' ? 'You’re checked in' : 'Already checked in'}</h2>
            <p><strong>{result.attendance.courseCode}</strong> · {result.attendance.sessionTitle}</p>
            <small>
              {result.status === 'checked_in' ? 'Recorded at ' : 'Recorded earlier at '}
              {timeFormat.format(new Date(result.attendance.checkedInAt))}
              {result.attendance.venueName ? ` · ${result.attendance.venueName}` : ''}
              {result.attendance.venueOutcome === 'inconclusive' ? ' · location reading was imprecise' : ''}
            </small>
          </div>
          <button className="sx-icon-button" type="button" onClick={() => setResult(null)} aria-label="Dismiss">
            <X size={18} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      {error ? (
        <p className="sx-alert" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{error}</span>
          <button className="sx-icon-button" type="button" onClick={() => setError('')} aria-label="Dismiss">
            <X size={16} aria-hidden="true" />
          </button>
        </p>
      ) : null}

      <section className="sx-section" aria-labelledby="sx-live-heading" aria-live="polite">
        <div className="sx-section-head">
          <h2 id="sx-live-heading">Live now</h2>
          <span className="sx-section-meta"><span className="sx-pulse" aria-hidden="true" />Updates on its own</span>
        </div>
        {openLoading ? (
          <div className="skeleton-block sx-live-skeleton" />
        ) : openSessions.length ? (
          <div className="sx-live-list">
            {openSessions.map((session) => (
              <LiveSessionCard
                key={session.attendanceSessionId}
                session={session}
                record={recordBySession.get(session.attendanceSessionId)}
                now={now}
                busy={busy}
                onScan={startScan}
              />
            ))}
          </div>
        ) : (
          <div className="sx-empty-live">
            <span className="sx-empty-icon" aria-hidden="true"><Clock3 size={22} /></span>
            <div>
              <h3>Scan the QR code in class</h3>
              <p>Point your camera at the QR code on the screen or poster. Course check-ins you are enrolled in also appear here when they open.</p>
            </div>
            <button className="sx-secondary-button" type="button" onClick={startScan} disabled={busy}>
              <ScanLine size={17} aria-hidden="true" /> Scan a QR code
            </button>
          </div>
        )}

        {allQrOnly ? (
          <p className="sx-hint"><QrCode size={15} aria-hidden="true" />This lecture accepts the QR code only, so scan it in the room.</p>
        ) : (
          <div className={`sx-code${codeOpen ? ' is-open' : ''}`}>
            <button className="sx-code-toggle" type="button" onClick={() => setCodeOpen((value) => !value)} aria-expanded={codeOpen} aria-controls="sx-code-panel">
              <KeyRound size={16} aria-hidden="true" />
              <span>Type a session code instead</span>
              <ChevronDown className="sx-chevron" size={17} aria-hidden="true" />
            </button>
            {codeOpen ? (
              <form id="sx-code-panel" className="sx-code-form" onSubmit={submitCode}>
                <label htmlFor="attendance-session-code">Session code from the lecturer’s screen</label>
                <div className="sx-code-row">
                  <input
                    id="attendance-session-code"
                    name="code"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="7K9M-PQ2R-4XBD"
                    maxLength={24}
                    required
                    autoFocus
                  />
                  <button className="sx-primary-button" type="submit" disabled={busy}>
                    {busy ? <LoaderCircle className="course-spin" size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
                    {busy ? 'Checking' : 'Check in'}
                  </button>
                </div>
                <small>
                  This is the code under the QR, not the course code you used to join.
                  {anyNeedsLocation ? ' Your browser will ask for your location; tap Allow.' : ''}
                </small>
              </form>
            ) : null}
          </div>
        )}
        {scanning ? <QrScanner accept={acceptAnyScan} onDetected={handleScan} onClose={closeScanner} /> : null}
      </section>

      <LectureHistorySection onLoaded={setLectureEntries} />

      {onlyLectures ? null : (<>
      <section className="sx-section" aria-labelledby="sx-overview-heading">
        <div className="sx-section-head">
          <h2 id="sx-overview-heading">This semester</h2>
          <button
            className="sx-text-button"
            type="button"
            onClick={() => { setLoading(true); setError(''); void refresh(); }}
            disabled={loading}
            aria-label="Refresh attendance"
          >
            <RefreshCw className={loading ? 'course-spin' : ''} size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
        {loading && !summary.length ? (
          <div className="skeleton-block sx-overview-skeleton" />
        ) : summary.length ? (
          <div className="sx-card sx-overview">
            <div className="sx-overview-total">
              <div className="sx-ring-wrap">
                <ProgressRing rate={totals.rate} />
                <span className="sx-ring-label">{formatRate(totals.rate)}</span>
              </div>
              <div>
                <p className="sx-overview-big">{totals.attended}<span> of {totals.held}</span></p>
                <p className="sx-overview-caption">lectures attended across {summary.length} course{summary.length === 1 ? '' : 's'}</p>
              </div>
            </div>
            <ul className="sx-course-rates">
              {summary.map((course) => (
                <li key={course.courseOfferingId}>
                  <div className="sx-course-rate-top">
                    <span>
                      <strong>{course.courseCode}</strong>
                      <small>{course.courseTitle}</small>
                    </span>
                    <span className={`sx-rate is-${rateTone(course.rate)}`}>{formatRate(course.rate)}</span>
                  </div>
                  <span className={`sx-bar is-${rateTone(course.rate)}`} aria-hidden="true"><i style={{ width: `${course.rate ?? 0}%` }} /></span>
                  <small className="sx-course-rate-meta">
                    {course.sessionsHeld
                      ? `${course.attended} of ${course.sessionsHeld} lecture${course.sessionsHeld === 1 ? '' : 's'}`
                      : 'No lectures yet'}
                    {course.revoked ? ` · ${course.revoked} revoked` : ''}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="sx-card sx-empty-small">Join a course on <a href="/courses">My courses</a> to start tracking attendance.</div>
        )}
      </section>

      <section className="sx-section" aria-labelledby="sx-history-heading">
        <div className="sx-section-head">
          <h2 id="sx-history-heading">History</h2>
          {records.length ? <span className="sx-section-meta">{records.length} record{records.length === 1 ? '' : 's'}</span> : null}
        </div>
        {loading && !records.length ? (
          <div className="skeleton-block sx-overview-skeleton" />
        ) : records.length ? (
          <div className="sx-card sx-history">
            {historyGroups.map((group) => (
              <div className="sx-history-group" key={group.label}>
                <p className="sx-history-day">{group.label}</p>
                <ul>
                  {group.items.map((record) => {
                    const revoked = record.status === 'revoked';
                    return (
                      <li className={`sx-history-item${revoked ? ' is-revoked' : ''}`} key={record.attendanceSessionId}>
                        <span className="sx-history-icon" aria-hidden="true">
                          {revoked ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
                        </span>
                        <span className="sx-history-copy">
                          <strong>{record.courseCode} · {record.sessionTitle}</strong>
                          <small>
                            {timeFormat.format(new Date(record.checkedInAt))} · {methodLabel(record)}
                            {record.venueName ? ` · ${record.venueName}` : ''}
                          </small>
                          {revoked ? (
                            <a className="sx-history-action" href="#attendance-disputes">Revoked by your lecturer · Raise a concern</a>
                          ) : record.venueOutcome === 'inconclusive' ? (
                            <em className="sx-history-note">Location was imprecise; still counts as present</em>
                          ) : null}
                        </span>
                        <span className={`sx-history-status${revoked ? ' is-revoked' : ''}`}>{revoked ? 'Revoked' : 'Present'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="sx-card sx-empty-small">No check-ins yet. They appear here as soon as you scan your lecturer’s QR code.</div>
        )}
      </section>
      </>)}

      {onlyLectures ? null : <StudentDisputePanel />}

      <details className="sx-fineprint">
        <summary><Info size={15} aria-hidden="true" /> What a check-in proves</summary>
        <p>
          A QR scan or code records when you used it; for lectures linked to a venue, your phone also shares its location at that moment as
          supporting evidence. Your lecturer or class rep can see the list and remove entries that are wrong, and you are told when that happens.
          None of this proves who you are on its own, and an imprecise location still counts as present.
          See the <a href="/privacy">privacy notice</a> for what is stored and who can see it.
        </p>
      </details>
    </div>
  );
}

/** Lectures marked by scanning a lecturer's or class rep's QR code. */
function LectureHistorySection({ onLoaded }: Readonly<{ onLoaded: (entries: number) => void }>) {
  const [history, setHistory] = useState<StudentLectureHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadStudentLectureHistory(controller.signal)
      .then((result) => { setHistory(result); onLoaded(result.entries.length); })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); onLoaded(0); } });
    return () => controller.abort();
  }, [onLoaded]);
  if (failed || (history !== null && history.entries.length === 0)) return null;
  if (history === null) return <div className="skeleton-block sx-overview-skeleton" aria-hidden="true" />;

  const { entries, courses } = history;
  const held = courses.reduce((sum, course) => sum + course.held, 0);
  const attended = courses.reduce((sum, course) => sum + course.attended, 0);
  const overall = held ? Math.round((attended / held) * 1000) / 10 : null;
  const below = courses.filter((course) => course.rate < DEFAULT_ATTENDANCE_THRESHOLD);
  const shown = showAll ? entries : entries.slice(0, 6);

  return (
    <>
      <section className="sx-section" aria-labelledby="sx-lecture-rates-heading">
        <div className="sx-section-head">
          <h2 id="sx-lecture-rates-heading">Your attendance</h2>
          <span className="sx-section-meta">{DEFAULT_ATTENDANCE_THRESHOLD}% needed for exams</span>
        </div>
        <div className="sx-card sx-overview">
          <div className="sx-overview-total">
            <div className="sx-ring-wrap">
              <ProgressRing rate={overall} />
              <span className="sx-ring-label">{formatRate(overall)}</span>
            </div>
            <div>
              <p className="sx-overview-big">{attended}<span> of {held}</span></p>
              <p className="sx-overview-caption">lectures attended across {courses.length} course{courses.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          {below.length ? (
            <p className="sx-rate-warning" role="note">
              <AlertTriangle size={15} aria-hidden="true" />
              {below.length === 1 ? `${below[0]!.courseCode} is` : `${below.length} courses are`} below {DEFAULT_ATTENDANCE_THRESHOLD}%. Attend the next lectures to catch up.
            </p>
          ) : null}
          <ul className="sx-course-rates">
            {courses.map((course) => (
              <li key={course.courseCode}>
                <div className="sx-course-rate-top">
                  <span>
                    <strong>{course.courseCode}</strong>
                    <small>{course.courseTitle}</small>
                  </span>
                  <span className={`sx-rate is-${rateTone(course.rate)}`}>{formatRate(course.rate)}</span>
                </div>
                <span className={`sx-bar is-${rateTone(course.rate)}`} aria-hidden="true">
                  <i style={{ width: `${course.rate}%` }} />
                  <b style={{ left: `${DEFAULT_ATTENDANCE_THRESHOLD}%` }} />
                </span>
                <small className="sx-course-rate-meta">
                  {course.attended} of {course.held} lecture{course.held === 1 ? '' : 's'}
                  {course.rate < DEFAULT_ATTENDANCE_THRESHOLD && course.held > 0 ? ` · ${lecturesToReach(course.attended, course.held)} more in a row to reach ${DEFAULT_ATTENDANCE_THRESHOLD}%` : ''}
                </small>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="sx-section" aria-labelledby="sx-lectures-heading">
        <div className="sx-section-head">
          <h2 id="sx-lectures-heading">Lectures you marked</h2>
          <span className="sx-section-meta">{entries.filter((entry) => !entry.removed).length} present</span>
        </div>
        <div className="sx-card sx-history">
          <ul>
            {shown.map((entry) => (
              <li className={`sx-history-item${entry.removed ? ' is-revoked' : ''}`} key={entry.id}>
                <span className="sx-history-icon" aria-hidden="true">{entry.removed ? <XCircle size={18} /> : <CheckCircle2 size={18} />}</span>
                <span className="sx-history-copy">
                  <strong>{entry.courseCode} · {entry.courseTitle}</strong>
                  <small>
                    {dayLabelFormat.format(new Date(entry.checkedInAt))} · {timeFormat.format(new Date(entry.checkedInAt))} · {lectureMethodLabel(entry.method)}
                    {entry.venueName ? ` · ${entry.venueName}` : ''}
                  </small>
                  {entry.removed ? <em className="sx-history-note">Removed by the lecturer or class rep. Speak to them if this is a mistake.</em> : null}
                </span>
                <span className={`sx-history-status${entry.removed ? ' is-revoked' : ''}`}>{entry.removed ? 'Removed' : 'Present'}</span>
              </li>
            ))}
          </ul>
          {entries.length > shown.length || showAll ? (
            <button className="sx-text-button sx-show-all" type="button" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
              {showAll ? 'Show fewer' : `Show all ${entries.length}`}
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}

function lectureMethodLabel(method: StudentLectureHistory['entries'][number]['method']): string {
  if (method === 'manual') return 'Added by lecturer';
  return method === 'qr' ? 'QR scan' : 'Typed code';
}

/** Consecutive lectures needed to reach the threshold if the student attends every one from now. */
function lecturesToReach(attended: number, held: number): number {
  const target = DEFAULT_ATTENDANCE_THRESHOLD / 100;
  return Math.max(0, Math.ceil((target * held - attended) / (1 - target)));
}
