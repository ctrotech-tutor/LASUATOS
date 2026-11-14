'use client';

import {
  checkMatricNumber,
  checkPersonName,
  type LectureAttendee,
  type LectureCapabilities,
  type LectureCatalogCourse,
  type LectureQrFrame,
  type LectureQrMode,
  type LectureSessionDetail,
  type LectureSessionSummary,
  type LectureVenueOptions,
} from '@lasuatos/contracts';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock3,
  Download,
  Expand,
  MapPin,
  MonitorPlay,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  UserPlus,
  UserRoundX,
  Users,
  X,
  ScanFace,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { formatAccuracy, formatMeters } from '@lasuatos/verification/venue-area';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { forgetSession, lookupSession } from '../lib/current-account';
import { toCheckInLocation, useLiveLocation } from '../lib/location';
import { LocationCheck } from './location-check';
import {
  addLectureAttendee,
  correctLectureAttendee,
  createLectureSession,
  deleteLectureSession,
  failureText,
  formatAttendanceCode,
  formatClock,
  formatDay,
  loadLectureCapabilities,
  loadLectureFrame,
  loadFaceReviews,
  loadLectureSession,
  loadLectureSessions,
  loadLectureVenues,
  setLectureAttendeeRemoved,
  updateLectureSession,
} from '../lib/lecture-api';
import { useVisiblePolling, useWakeLock } from '../lib/use-live';
import { WorkspaceSkeleton } from './account-gate';
import { useFeedback } from './feedback';
import { HelpRequestsPanel } from './lecture-help-requests';
import { SessionsTabs } from './sessions-tabs';
import { Select } from './ui/select';
import { CoursePicker, recentLecturerFor, useCourseCatalog } from './course-picker';
import { SearchField } from './ui/search-field';
import { EditButton, EditDialog } from './ui/edit-dialog';
import { Bone, ListSkeleton } from './ui/skeleton';

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

export type Access =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly capabilities: LectureCapabilities }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' };

export function useTakerAccess(): { access: Access; retry: () => void } {
  const [access, setAccess] = useState<Access>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await lookupSession();
      if (!active) return;
      if (session.kind === 'signed_out') {
        window.location.replace(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (session.kind === 'unavailable') {
        setAccess({ kind: 'unavailable' });
        return;
      }
      try {
        const capabilities = await loadLectureCapabilities();
        if (!active) return;
        setAccess(capabilities.canTakeAttendance ? { kind: 'ready', capabilities } : { kind: 'denied' });
      } catch {
        if (active) setAccess({ kind: 'unavailable' });
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    forgetSession();
    setAccess({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, []);
  return { access, retry };
}

export function AccessMessage({ access, retry }: Readonly<{ access: Access; retry: () => void }>) {
  if (access.kind === 'loading') return <WorkspaceSkeleton label="Opening attendance…" />;
  if (access.kind === 'denied') {
    return (
      <section className="workspace-message" role="status">
        <span className="workspace-message-icon" aria-hidden="true">i</span>
        <div>
          <h2>Only lecturers and class reps take attendance</h2>
          <p>If you are your class’s HOC or GHOC, ask your GHOC or an administrator to add you as a class rep. To mark your own attendance, scan the QR code in class.</p>
          <div className="workspace-message-actions">
            <Link className="button button-primary" href="/a">Mark my attendance</Link>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="workspace-message" role="status">
      <span className="workspace-message-icon" aria-hidden="true">!</span>
      <div>
        <h2>We couldn’t reach LASUATOS</h2>
        <p>You are still signed in. Check your connection and try again.</p>
        <div className="workspace-message-actions">
          <button className="button button-primary" type="button" onClick={retry}>Try again</button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sessions home: start a session, see recent ones                     */
/* ------------------------------------------------------------------ */

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr${hours === 1 ? '' : 's'}` : `${Math.floor(hours)} hr ${minutes % 60} min`;
}

export function LectureSessionsHome() {
  const { access, retry } = useTakerAccess();
  if (access.kind !== 'ready') return <AccessMessage access={access} retry={retry} />;
  return <SessionsHomeReady capabilities={access.capabilities} />;
}

function SessionsHomeReady({ capabilities }: Readonly<{ capabilities: LectureCapabilities }>) {
  const [sessions, setSessions] = useState<LectureSessionSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [searching, setSearching] = useState(false);
  const [pendingFaces, setPendingFaces] = useState(0);
  const everLoaded = useRef(false);
  const canReview = capabilities.role === 'lecturer' || capabilities.role === 'administrator';

  // Close face matches waiting for a decision: a reminder above the list.
  useEffect(() => {
    if (!canReview) return undefined;
    const controller = new AbortController();
    loadFaceReviews({ status: 'pending' }, controller.signal)
      .then((result) => setPendingFaces(result.pendingCount))
      .catch(() => undefined);
    return () => controller.abort();
  }, [canReview]);

  // Search on the server (it covers every session, not just the ones loaded), shortly after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(query.trim()), query.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const started = window.setTimeout(() => setSearching(true), 0);
    void loadLectureSessions(controller.signal, { q: searched })
      .then((result) => {
        setSessions(result.sessions);
        setHasMore(result.hasMore);
        setListError('');
        if (!everLoaded.current && !searched && result.sessions.length === 0) setShowForm(true);
        everLoaded.current = true;
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setListError(failureText(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => {
      window.clearTimeout(started);
      controller.abort();
    };
  }, [searched]);

  async function loadMore() {
    const last = sessions?.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const result = await loadLectureSessions(undefined, { before: last.startsAt, q: searched });
      setSessions((current) => [...(current ?? []), ...result.sessions.filter((item) => !current?.some((existing) => existing.id === item.id))]);
      setHasMore(result.hasMore);
    } catch (caught) {
      setListError(failureText(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  const [onlyMine, setOnlyMine] = useState(false);
  const othersCount = sessions?.filter((session) => !session.canManage).length ?? 0;
  const shown = (sessions ?? []).filter((session) => !onlyMine || session.canManage);
  const open = shown.filter((session) => session.status === 'open');
  const past = shown.filter((session) => session.status !== 'open');

  return (
    <div className="page-stack lx-page">
      <section className="page-heading lx-heading">
        <div>
          <p className="page-eyebrow">{capabilities.roleLabel ?? 'ATTENDANCE'}</p>
          <h1>Take attendance</h1>
          <p className="page-lede">Pick the course, choose how long attendance stays open, and show or print the QR code. Students scan it and are marked with their own account.</p>
        </div>
        {!showForm ? (
          <button className="button button-primary lx-heading-action" type="button" onClick={() => setShowForm(true)}>
            <Plus size={18} aria-hidden="true" /> New session
          </button>
        ) : null}
      </section>

      <SessionsTabs active="sessions" faceChecks={canReview} />

      {pendingFaces > 0 ? (
        <Link className="lx-review-banner" href="/face-checks">
          <ScanFace size={18} aria-hidden="true" />
          <span><strong>{pendingFaces} face check{pendingFaces === 1 ? '' : 's'} to review.</strong> The face matched, but not clearly: compare the photos.</span>
        </Link>
      ) : null}

      {showForm ? <NewSessionForm capabilities={capabilities} onCancel={sessions && sessions.length > 0 ? () => setShowForm(false) : undefined} /> : null}

      {listError ? <p className="lx-error" role="alert">{listError}</p> : null}
      {sessions === null && !listError ? <ListSkeleton label="Loading sessions…" rows={3} /> : null}

      {othersCount > 0 && capabilities.attendanceScopeLabel ? (
        <div className="lx-scope-bar">
          <p>
            Showing attendance taken in <strong>{capabilities.attendanceScopeLabel}</strong>. Sessions others took are view only.
          </p>
          <div className="lx-chips" role="radiogroup" aria-label="Which sessions">
            <button type="button" role="radio" aria-checked={!onlyMine} className={`lx-chip-button${!onlyMine ? ' is-selected' : ''}`} onClick={() => setOnlyMine(false)}>
              Everyone&apos;s
            </button>
            <button type="button" role="radio" aria-checked={onlyMine} className={`lx-chip-button${onlyMine ? ' is-selected' : ''}`} onClick={() => setOnlyMine(true)}>
              Only mine
            </button>
          </div>
        </div>
      ) : null}
      {sessions && (sessions.length > 5 || hasMore || query) ? (
        <div className="lx-list-search">
          <SearchField
            value={query}
            onValueChange={setQuery}
            placeholder="Find a course, e.g. CSC 301"
            aria-label="Find a session by course code or title"
          />
          <span className="lx-list-search-status" role="status">
            {searching ? 'Searching…' : searched ? `${shown.length}${hasMore ? '+' : ''} session${shown.length === 1 ? '' : 's'} for “${searched}”` : ''}
          </span>
        </div>
      ) : null}
      {sessions && shown.length === 0 && onlyMine && !searched ? <p className="lx-empty">You have not taken any sessions yet.</p> : null}
      {sessions && shown.length === 0 && searched && !searching ? <p className="lx-empty">No session matches “{searched}”. Try the course code without spaces, or part of the title.</p> : null}

      {open.length > 0 ? (
        <section className="lx-section" aria-labelledby="lx-open">
          <h2 id="lx-open">Open now</h2>
          <div className="lx-session-list">{open.map((session) => <SessionCard key={session.id} session={session} />)}</div>
        </section>
      ) : null}
      {past.length > 0 ? (
        <section className="lx-section" aria-labelledby="lx-past">
          <h2 id="lx-past">Earlier sessions</h2>
          <div className="lx-session-list">{past.map((session) => <SessionCard key={session.id} session={session} />)}</div>
        </section>
      ) : null}
      {hasMore ? (
        <button className="button button-secondary lx-load-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show older sessions'}
        </button>
      ) : null}
    </div>
  );
}

function SessionCard({ session }: Readonly<{ session: LectureSessionSummary }>) {
  return (
    <Link className={`lx-session-card${session.status === 'open' ? ' is-open' : ''}`} href={`/sessions/${session.id}`}>
      <div className="lx-session-main">
        <span className="lx-course-code">{session.courseCode}</span>
        <strong>{session.courseTitle}</strong>
        <span className="lx-session-meta">
          {formatDay(session.startsAt)} · {formatClock(session.startsAt)}–{formatClock(session.endsAt)}
          {session.venueName ? ` · ${session.venueName}` : ''}
        </span>
        {!session.canManage ? <span className="lx-session-by">Taken by {session.lecturerName ?? session.creatorName}</span> : null}
      </div>
      <div className="lx-session-side">
        <span className="lx-count"><Users size={15} aria-hidden="true" /> {session.presentCount}</span>
        <span className={`lx-chip${session.status === 'open' ? ' is-live' : ''}`}>{session.status === 'open' ? 'Open' : 'Closed'}</span>
        {!session.canManage ? <span className="lx-chip is-muted">View only</span> : null}
      </div>
    </Link>
  );
}

function NewSessionForm({ capabilities, onCancel }: Readonly<{ capabilities: LectureCapabilities; onCancel?: (() => void) | undefined }>) {
  const [courseCode, setCourseCode] = useState('');
  const [lecturerName, setLecturerName] = useState('');
  // Filled in for the person until they type their own; then left alone.
  const [lecturerTyped, setLecturerTyped] = useState(false);
  const [ownName, setOwnName] = useState('');
  const catalog = useCourseCatalog();
  const [duration, setDuration] = useState(60);
  const [qrMode, setQrMode] = useState<LectureQrMode>('dynamic');
  const [venueId, setVenueId] = useState('');
  const [requireVenue, setRequireVenue] = useState(false);
  const [venues, setVenues] = useState<LectureVenueOptions['venues']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const controller = new AbortController();
    // A lecturer is the lecturer: their name goes in the Lecturer field.
    if (capabilities.role === 'lecturer') {
      void lookupSession().then((result) => {
        if (controller.signal.aborted || result.kind !== 'signed_in') return;
        setOwnName(result.account.displayName);
        setLecturerName((value) => value || result.account.displayName);
      });
    }
    void loadLectureVenues(controller.signal).then((result) => setVenues(result.venues)).catch(() => undefined);
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(tick);
    };
  }, [capabilities.role]);

  const venue = venues.find((item) => item.id === venueId) ?? null;
  const endsAt = new Date(now.getTime() + duration * 60_000);

  function pickCourse(course: LectureCatalogCourse) {
    setCourseCode(course.code);
    setError('');
    if (lecturerTyped || catalog.state.kind !== 'ready') return;
    // Class reps and administrators: the lecturer they named last time for this course.
    const remembered = recentLecturerFor(catalog.state.catalog, course.code);
    setLecturerName(capabilities.role === 'lecturer' ? (ownName || remembered || '') : (remembered ?? ''));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!courseCode) {
      setError('Choose the course from the list. If it is not there, add it first.');
      return;
    }
    setBusy(true);
    try {
      const session = await createLectureSession({
        courseCode,
        ...(lecturerName.trim() ? { lecturerName: lecturerName.trim() } : {}),
        durationMinutes: duration,
        qrMode,
        ...(venueId ? { venueId, requireVenue: requireVenue && Boolean(venue?.hasBoundary) } : {}),
      });
      window.location.assign(`/sessions/${session.id}`);
    } catch (caught) {
      setError(failureText(caught));
      setBusy(false);
    }
  }

  return (
    <form className="lx-card lx-new" onSubmit={submit} noValidate>
      <div className="lx-new-head">
        <h2>New attendance session</h2>
        {onCancel ? <button className="lx-icon-button" type="button" onClick={onCancel} aria-label="Close"><X size={18} /></button> : null}
      </div>

      <CoursePicker
        state={catalog.state}
        value={courseCode}
        onPick={pickCourse}
        onCatalogChange={catalog.replace}
        onRetry={catalog.retry}
      />

      <label className="account-field">
        <span>Lecturer {capabilities.role === 'lecturer' ? null : <small className="lx-optional">optional</small>}</span>
        <input
          value={lecturerName}
          onChange={(event) => {
            setLecturerName(event.target.value);
            setLecturerTyped(true);
          }}
          placeholder="e.g. Dr. Adeyemi"
          autoComplete="off"
          maxLength={160}
        />
        {capabilities.role === 'lecturer' && ownName && lecturerName.trim() === ownName
          ? <small>Your name, from your account. Change it if a colleague is teaching this class.</small>
          : null}
      </label>

      <fieldset className="lx-fieldset">
        <legend>Attendance stays open for</legend>
        <div className="lx-chips" role="radiogroup">
          {DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="radio"
              aria-checked={duration === minutes}
              className={`lx-chip-button${duration === minutes ? ' is-selected' : ''}`}
              onClick={() => setDuration(minutes)}
            >
              {durationLabel(minutes)}
            </button>
          ))}
        </div>
        <p className="lx-window"><Clock3 size={15} aria-hidden="true" /> Today, {formatDay(now)} · <strong>{formatClock(now)} → {formatClock(endsAt)}</strong></p>
      </fieldset>

      <fieldset className="lx-fieldset">
        <legend>QR code</legend>
        <div className="lx-mode-grid">
          <label className={`lx-mode${qrMode === 'dynamic' ? ' is-selected' : ''}`}>
            <input type="radio" name="qrMode" value="dynamic" checked={qrMode === 'dynamic'} onChange={() => setQrMode('dynamic')} />
            <MonitorPlay size={22} aria-hidden="true" />
            <strong>On a screen</strong>
            <span>Changes every 30 seconds, so a photo sent to a group chat soon stops working. Use with a projector, TV or your phone.</span>
          </label>
          <label className={`lx-mode${qrMode === 'static' ? ' is-selected' : ''}`}>
            <input type="radio" name="qrMode" value="static" checked={qrMode === 'static'} onChange={() => setQrMode('static')} />
            <Printer size={22} aria-hidden="true" />
            <strong>Printed poster</strong>
            <span>One fixed QR code to download or print and paste at the door. No projector needed.</span>
          </label>
        </div>
      </fieldset>

      {venues.length > 0 ? (
        <div className="lx-grid-2">
          <label className="account-field">
            <span>Venue <small className="lx-optional">optional</small></span>
            <Select
              value={venueId}
              onValueChange={(next) => {
                setVenueId(next);
                // Checking the room is the point of picking a venue: on whenever it can be.
                setRequireVenue(Boolean(venues.find((item) => item.id === next)?.hasBoundary));
              }}
              options={[
                { value: '', label: 'No venue' },
                ...venues.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}`, ...(item.campusName ? { description: item.campusName } : {}) })),
              ]}
            />
          </label>
          {venue ? (
            <label className={`lx-check lx-venue-check${venue.hasBoundary ? '' : ' is-disabled'}`}>
              <input type="checkbox" checked={requireVenue} disabled={!venue.hasBoundary} onChange={(event) => setRequireVenue(event.target.checked)} />
              <span>
                Students must be in {venue.name}
                <small>{venue.hasBoundary ? 'Their phone’s location is checked when they mark attendance. Recommended.' : 'This venue’s location has not been registered yet.'}</small>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {qrMode === 'static' && !(venue?.hasBoundary && requireVenue) ? (
        <p className="lx-hint lx-hint-warn" role="note">
          A printed code never changes, so a photo of it works from anywhere. Pick a registered venue and keep
          “Students must be in the venue” on, or use the screen code instead.
        </p>
      ) : null}

      {error ? <p className="lx-error" role="alert">{error}</p> : null}
      <button className="button button-primary lx-big-button" type="submit" disabled={busy}>
        <QrCode size={20} aria-hidden="true" /> {busy ? 'Starting…' : 'Start attendance'}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* One session: QR code and the list of students                       */
/* ------------------------------------------------------------------ */

export function LectureSessionView({ sessionId }: Readonly<{ sessionId: string }>) {
  const { access, retry } = useTakerAccess();
  if (access.kind !== 'ready') return <AccessMessage access={access} retry={retry} />;
  return <SessionViewReady sessionId={sessionId} takerRole={access.capabilities.role} />;
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function remainingLabel(endsAt: string, now: Date): string {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return 'Closed';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min left`;
}

function SessionViewReady({ sessionId, takerRole }: Readonly<{ sessionId: string; takerRole: LectureCapabilities['role'] }>) {
  const [detail, setDetail] = useState<LectureSessionDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const now = useNow(15_000);
  const status = detail?.session.status;

  const dialogs = useFeedback();
  const router = useRouter();

  // Live while students are arriving; pauses when the tab is hidden.
  useVisiblePolling(async (signal) => {
    try {
      const result = await loadLectureSession(sessionId, signal);
      setDetail(result);
      setError('');
      return result.session.status === 'open' ? 4_000 : null;
    } catch (caught) {
      if (signal.aborted) return null;
      setError(failureText(caught));
      return 10_000;
    }
  }, [sessionId, reload]);

  async function change(label: string, input: Parameters<typeof updateLectureSession>[1], done?: string) {
    setBusy(label);
    try {
      await updateLectureSession(sessionId, input);
      setReload((value) => value + 1);
      if (done) dialogs.toast(done);
    } catch (caught) {
      dialogs.toast(failureText(caught), 'error');
    } finally {
      setBusy('');
    }
  }

  async function deleteNow() {
    if (!detail) return;
    const { session: current } = detail;
    const count = current.presentCount;
    let confirmCourseCode: string | undefined;
    if (count > 0) {
      const typed = await dialogs.prompt({
        title: `Delete ${current.courseCode} and its attendance?`,
        body: `${count} student${count === 1 ? ' is' : 's are'} on this list. Deleting takes ${count === 1 ? 'them' : 'all of them'} off the register and cannot be undone. Only do this for a session opened by mistake. Type ${current.courseCode} to confirm.`,
        label: 'Course code',
        placeholder: current.courseCode,
        maxLength: 40,
        confirmLabel: 'Delete session',
        tone: 'danger',
      });
      if (typed === null) return;
      if (typed.replace(/\s+/g, '').toUpperCase() !== current.courseCode.replace(/\s+/g, '').toUpperCase()) {
        dialogs.toast(`That does not match ${current.courseCode}. Nothing was deleted.`, 'error');
        return;
      }
      confirmCourseCode = typed;
    } else {
      const sure = await dialogs.confirm({
        title: `Delete ${current.courseCode}?`,
        body: 'No one has marked attendance yet. The session and its QR code will stop working.',
        confirmLabel: 'Delete session',
        tone: 'danger',
      });
      if (!sure) return;
    }
    setBusy('delete');
    try {
      await deleteLectureSession(current.id, confirmCourseCode);
      dialogs.toast(`${current.courseCode} was deleted.`);
      router.replace('/sessions');
    } catch (caught) {
      dialogs.toast(failureText(caught), 'error');
      setBusy('');
    }
  }

  async function closeNow() {
    const sure = await dialogs.confirm({
      title: 'Close attendance now?',
      body: 'Students will no longer be able to mark attendance. You can reopen it for 15 minutes later.',
      confirmLabel: 'Close attendance',
      tone: 'danger',
    });
    if (sure) await change('close', { close: true }, 'Attendance closed.');
  }

  if (!detail) {
    return error ? (
      <section className="workspace-message" role="alert">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div><h2>Session not available</h2><p>{error}</p><Link className="button button-primary" href="/sessions">Back to sessions</Link></div>
      </section>
    ) : <WorkspaceSkeleton label="Opening the session…" />;
  }

  const { session } = detail;
  return (
    <div className="page-stack lx-page">
      <Link className="back-link" href="/sessions"><ArrowLeft size={16} aria-hidden="true" /> All sessions</Link>
      <section className="lx-session-head">
        <div>
          <span className="lx-course-code">{session.courseCode}</span>
          <h1>{session.courseTitle}</h1>
          <p className="lx-session-meta">
            {formatDay(session.startsAt)} · {formatClock(session.startsAt)}–{formatClock(session.endsAt)}
            {session.lecturerName ? ` · ${session.lecturerName}` : ''}
            {session.venueName ? ` · ${session.venueName}` : ''}
          </p>
        </div>
        <div className="lx-session-stats">
          <span className={`lx-chip${status === 'open' ? ' is-live' : ''}`}>{status === 'open' ? remainingLabel(session.endsAt, now) : 'Closed'}</span>
          <span className="lx-big-count"><strong>{session.presentCount}</strong> present</span>
        </div>
      </section>

      {error ? <p className="lx-error" role="alert">{error}</p> : null}

      {!detail.canManage ? (
        <div className="lx-view-only">
          <div className="lx-view-only-main">
            <AttendeeList detail={detail} takerRole={takerRole} onChanged={() => setReload((value) => value + 1)} />
          </div>
          <aside className="lx-card lx-view-only-note" aria-label="About this session">
            <span className="lx-chip">View only</span>
            <p>
              Taken by <strong>{session.creatorName}</strong>{session.creatorRole === 'lecturer' ? ' (lecturer)' : session.creatorRole === 'administrator' ? ' (administrator)' : session.creatorRole === 'ghoc' ? ' (GHOC)' : ' (HOC)'}.
              You can see who attended and download the list. Only the person who took it, or an administrator, can change it.
            </p>
            {status === 'open' ? <p className="lx-fine">The QR code is shown on their screen. This list updates as students mark attendance.</p> : null}
          </aside>
        </div>
      ) : (
      <div className="lx-session-layout">
        <QrPanel session={session} />
        <div className="lx-side-stack">
          <section className="lx-card lx-controls" aria-label="Session controls">
            {status === 'open' ? (
              <>
                <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void change('extend', { extendMinutes: 15 }, 'Added 15 minutes.')}>
                  <Plus size={16} aria-hidden="true" /> 15 more minutes
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void change('mode', { qrMode: session.qrMode === 'dynamic' ? 'static' : 'dynamic' }, session.qrMode === 'dynamic' ? 'Switched to a printable QR code.' : 'Switched to a changing QR code.')}
                >
                  {session.qrMode === 'dynamic' ? <><Printer size={16} aria-hidden="true" /> Use a printable QR</> : <><MonitorPlay size={16} aria-hidden="true" /> Use a changing QR</>}
                </button>
                <button
                  className="button lx-danger"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void closeNow()}
                >
                  Close attendance
                </button>
              </>
            ) : (
              <button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void change('extend', { extendMinutes: 15 }, 'Attendance reopened for 15 minutes.')}>
                <RefreshCw size={16} aria-hidden="true" /> Reopen for 15 minutes
              </button>
            )}
            <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden="true" /> Edit details
            </button>
            <button className="lx-text-danger" type="button" disabled={Boolean(busy)} onClick={() => void deleteNow()}>
              <Trash2 size={15} aria-hidden="true" /> Delete session
            </button>
          </section>
          <HelpRequestsPanel
            session={session}
            requests={detail.helpRequests}
            isRep={takerRole === 'hoc' || takerRole === 'ghoc'}
            onChanged={() => setReload((value) => value + 1)}
          />
          <AttendeeList detail={detail} takerRole={takerRole} onChanged={() => setReload((value) => value + 1)} />
        </div>
      </div>
      )}
      {editing && detail.canManage ? (
        <EditSessionDialog
          session={session}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setDetail((current) => (current ? { ...current, session: { ...current.session, ...updated } } : current));
            setReload((value) => value + 1);
            setEditing(false);
            dialogs.toast('Session details updated.');
          }}
        />
      ) : null}
    </div>
  );
}

/** Corrects the course, title, lecturer and venue typed when the session was opened. */
function EditSessionDialog({
  session,
  onClose,
  onSaved,
}: Readonly<{ session: LectureSessionSummary; onClose: () => void; onSaved: (session: LectureSessionSummary) => void }>) {
  const [courseCode, setCourseCode] = useState(session.courseCode);
  const [lecturerName, setLecturerName] = useState(session.lecturerName ?? '');
  const [venueId, setVenueId] = useState(session.venueId ?? '');
  const [requireVenue, setRequireVenue] = useState(session.requireVenue);
  const catalog = useCourseCatalog();
  const [venues, setVenues] = useState<LectureVenueOptions['venues'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void loadLectureVenues(controller.signal).then((result) => setVenues(result.venues)).catch(() => setVenues([]));
    return () => controller.abort();
  }, []);

  const venueList = venues ?? [];
  const venue = venueList.find((item) => item.id === venueId) ?? null;
  // Keep the current venue choosable even if it is no longer in the active list.
  const venueOptions = [
    { value: '', label: 'No venue' },
    ...(session.venueId && !venueList.some((item) => item.id === session.venueId)
      ? [{ value: session.venueId, label: session.venueName ?? 'Current venue' }]
      : []),
    ...venueList.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}`, ...(item.campusName ? { description: item.campusName } : {}) })),
  ];
  const canRequire = venue ? venue.hasBoundary : venueId !== '' && session.requireVenue;

  async function save() {
    const input: Parameters<typeof updateLectureSession>[1] = {};
    const lecturer = lecturerName.trim().replace(/\s+/g, ' ');
    if (courseCode !== session.courseCode) input.courseCode = courseCode;
    if (lecturer !== (session.lecturerName ?? '')) input.lecturerName = lecturer || null;
    const nextVenue = venueId || null;
    const nextRequire = Boolean(nextVenue) && requireVenue && canRequire;
    if (nextVenue !== session.venueId) input.venueId = nextVenue;
    if (nextRequire !== session.requireVenue) input.requireVenue = nextRequire;
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      onSaved(await updateLectureSession(session.id, input));
    } catch (caught) {
      setError(failureText(caught));
      setBusy(false);
    }
  }

  return (
    <EditDialog
      title="Edit session details"
      description="Pick a different course, or fix the lecturer or venue. The attendance already marked stays with this session."
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      <CoursePicker
        state={catalog.state}
        value={courseCode}
        onPick={(course) => setCourseCode(course.code)}
        onCatalogChange={catalog.replace}
        onRetry={catalog.retry}
        current={{ code: session.courseCode, title: session.courseTitle }}
      />
      <label className="account-field">
        <span>Lecturer <small>optional</small></span>
        <input value={lecturerName} onChange={(event) => setLecturerName(event.target.value)} placeholder="e.g. Dr. Adeyemi" autoComplete="off" maxLength={160} />
      </label>
      {venues === null ? (
        <div className="sk-form" aria-hidden="true"><Bone width="30%" height={12} /><Bone height={46} /></div>
      ) : venueOptions.length > 1 ? (
        <>
          <label className="account-field">
            <span>Venue <small>optional</small></span>
            <Select
              value={venueId}
              onValueChange={(next) => { setVenueId(next); if (!next) setRequireVenue(false); }}
              options={venueOptions}
            />
          </label>
          {venueId ? (
            <label className={`lx-check lx-venue-check${canRequire ? '' : ' is-disabled'}`}>
              <input type="checkbox" checked={requireVenue && canRequire} disabled={!canRequire} onChange={(event) => setRequireVenue(event.target.checked)} />
              <span>
                Students must be in {venue?.name ?? session.venueName ?? 'the venue'}
                <small>{canRequire ? 'Applies to students who mark attendance from now on.' : 'This venue’s location has not been registered yet.'}</small>
              </span>
            </label>
          ) : null}
        </>
      ) : null}
    </EditDialog>
  );
}

function useQrFrame(sessionId: string, mode: LectureQrMode, status: string | undefined) {
  const [frame, setFrame] = useState<LectureQrFrame | null>(null);
  const [image, setImage] = useState('');
  const [fault, setFault] = useState('');
  const lastPath = useRef('');

  useVisiblePolling(async (signal) => {
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
        // Fetch the next frame just after the change, and at least every 10 s to keep the count fresh.
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

function QrPanel({ session }: Readonly<{ session: LectureSessionSummary }>) {
  const { frame, image, fault } = useQrFrame(session.id, session.qrMode, session.status);
  const [projecting, setProjecting] = useState(false);
  const now = useNow(1_000);
  const open = session.status === 'open';
  const secondsLeft = frame?.rotatesAt ? Math.max(0, Math.ceil((new Date(frame.rotatesAt).getTime() - now.getTime()) / 1000)) : null;
  const origin = typeof window === 'undefined' ? '' : window.location.host;
  // Keep the lecturer's screen (or projector laptop) from sleeping while the QR is up.
  useWakeLock(open);

  useEffect(() => {
    // Desktop shortcut: F shows the QR full screen.
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key === 'f' || event.key === 'F') { event.preventDefault(); setProjecting(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="lx-card lx-qr-panel" aria-label="QR code for students">
      {!open ? (
        <div className="lx-qr-closed">
          <QrCode size={40} aria-hidden="true" />
          <p>Attendance is closed. Reopen it to show the QR code again.</p>
        </div>
      ) : image && frame ? (
        <>
          <img className="lx-qr-image" src={image} alt={`QR code for ${session.courseCode} attendance`} width={360} height={360} />
          <p className="lx-qr-code-label">{frame.mode === 'dynamic' ? 'Or type this code' : 'Or type this code'}</p>
          <p className="lx-qr-code">{formatAttendanceCode(frame.code)}</p>
          <p className="lx-qr-hint">
            at <strong>{origin}/a</strong>
            {secondsLeft !== null ? <> · changes in <strong>{secondsLeft}s</strong></> : null}
          </p>
          <div className="lx-qr-actions">
            <button className="button button-primary" type="button" onClick={() => setProjecting(true)}>
              <Expand size={16} aria-hidden="true" /> Show full screen <kbd className="ui-kbd">F</kbd>
            </button>
            {frame.mode === 'static' ? <PosterButtons session={session} frame={frame} qrImage={image} /> : null}
          </div>
          {frame.mode === 'dynamic' ? (
            <p className="lx-fine"><Smartphone size={14} aria-hidden="true" /> No projector? Open this page on your phone and walk the QR code round, or switch to a printable QR.</p>
          ) : (
            <p className="lx-fine">The poster works until attendance closes at {formatClock(session.endsAt)}.</p>
          )}
        </>
      ) : (
        <div className="lx-qr-closed">{fault ? <><AlertTriangle size={30} aria-hidden="true" /><p>{fault}</p></> : <div className="skeleton-block lx-qr-skeleton" />}</div>
      )}

      {projecting && image && frame ? (
        <ProjectorView session={session} frame={frame} image={image} secondsLeft={secondsLeft} onClose={() => setProjecting(false)} />
      ) : null}
    </section>
  );
}

function ProjectorView({
  session,
  frame,
  image,
  secondsLeft,
  onClose,
}: Readonly<{ session: LectureSessionSummary; frame: LectureQrFrame; image: string; secondsLeft: number | null; onClose: () => void }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element?.requestFullscreen) void element.requestFullscreen().catch(() => undefined);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const onExit = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onExit);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onExit);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);
  const host = typeof window === 'undefined' ? '' : window.location.host;
  return (
    <div className="lx-projector" ref={ref} role="dialog" aria-modal="true" aria-label="QR code full screen">
      <button className="lx-projector-close" type="button" onClick={onClose} aria-label="Exit full screen"><X size={26} /></button>
      <div className="lx-projector-course">
        <span>{session.courseCode}</span>
        <strong>{session.courseTitle}</strong>
      </div>
      <img src={image} alt="Attendance QR code" />
      <div className="lx-projector-foot">
        <p>Scan with your phone camera, or go to <strong>{host}/a</strong> and type</p>
        <p className="lx-projector-code">{formatAttendanceCode(frame.code)}</p>
        <p className="lx-projector-meta">
          <Users size={22} aria-hidden="true" /> {frame.presentCount} present · open until {formatClock(frame.endsAt)}
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

function PosterButtons({ session, frame }: Readonly<{ session: LectureSessionSummary; frame: LectureQrFrame; qrImage: string }>) {
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
      <button className="button button-secondary" type="button" onClick={() => void download()}>
        <Download size={16} aria-hidden="true" /> Download poster
      </button>
      <button className="button button-secondary" type="button" onClick={() => void print()}>
        <Printer size={16} aria-hidden="true" /> Print
      </button>
      {error ? <p className="lx-error" role="alert">{error}</p> : null}
      {poster ? <div className="lx-print-poster" aria-hidden="true"><img src={poster} alt="" /></div> : null}
    </>
  );
}

/* Attendee list ---------------------------------------------------- */

function attendeeFlags(attendee: LectureAttendee, canReview: boolean): ReactNode[] {
  const flags: ReactNode[] = [];
  if (attendee.method === 'manual') {
    flags.push(<span key="manual" className="lx-flag is-manual"><UserPlus size={12} aria-hidden="true" /> Added by {attendee.addedByName ?? 'session taker'}</span>);
    if (attendee.addedAfterClose) flags.push(<span key="late" className="lx-flag is-warn"><Clock3 size={12} aria-hidden="true" /> Added after class</span>);
  } else if (!attendee.hasAccount) {
    flags.push(<span key="guest" className="lx-flag">Typed details</span>);
  }
  if (attendee.faceReview === 'approved') {
    flags.push(<span key="face" className="lx-flag is-ok" title="A close face match, approved after comparing the photos."><ScanFace size={12} aria-hidden="true" /> Face approved</span>);
  } else if (attendee.faceReview === 'rejected') {
    flags.push(<span key="face" className="lx-flag is-warn"><ScanFace size={12} aria-hidden="true" /> Face rejected</span>);
  } else if (attendee.faceNeedsReview && !canReview) {
    flags.push(<span key="face" className="lx-flag is-warn" title="The face matched, but not clearly. The lecturer reviews it."><ScanFace size={12} aria-hidden="true" /> Face: to review</span>);
  } else if (attendee.faceNeedsReview) {
    flags.push(
      <Link key="face" className="lx-flag is-warn" href="/face-checks" title="The face matched, but not clearly. Compare the check-in photo with the registered one.">
        <ScanFace size={12} aria-hidden="true" /> Face: review
      </Link>,
    );
  } else if (attendee.faceScore != null) {
    flags.push(<span key="face" className="lx-flag is-ok"><ScanFace size={12} aria-hidden="true" /> Face matched</span>);
  }
  if (attendee.sharedDeviceCount > 0) {
    flags.push(<span key="device" className="lx-flag is-warn"><Smartphone size={12} aria-hidden="true" /> Same phone as {attendee.sharedDeviceCount} other{attendee.sharedDeviceCount === 1 ? '' : 's'}</span>);
  }
  const accuracy = attendee.accuracyMeters != null ? ` · ${formatAccuracy(attendee.accuracyMeters)}` : '';
  if (attendee.venueOutcome === 'outside') {
    const how = attendee.outsideMeters ? `${formatMeters(attendee.outsideMeters)} outside` : 'Outside venue';
    flags.push(<span key="outside" className="lx-flag is-warn"><MapPin size={12} aria-hidden="true" /> {how}{accuracy}</span>);
  }
  if (attendee.venueOutcome === 'within') {
    flags.push(
      <span key="within" className="lx-flag is-ok" title={attendee.outsideMeters ? `${formatMeters(attendee.outsideMeters)} from the walls, inside the allowance` : 'Inside the venue'}>
        <Check size={12} aria-hidden="true" /> In venue{accuracy}
      </span>,
    );
  }
  if (attendee.venueOutcome === 'inconclusive') flags.push(<span key="unsure" className="lx-flag is-warn"><MapPin size={12} aria-hidden="true" /> Location unconfirmed{accuracy}</span>);
  return flags;
}

function csvCell(value: string): string {
  // Leading = + - @ would be read as a formula by spreadsheet apps.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Add a student by hand: their phone is dead, they have no smartphone, or the scan failed.
 * Stays open after each add so a lecturer can enter several names in a row.
 */
function AddStudentForm({
  session,
  isRep,
  onAdded,
  onClose,
}: Readonly<{ session: LectureSessionSummary; isRep: boolean; onAdded: () => void; onClose: () => void }>) {
  const [fullName, setFullName] = useState('');
  const [matricNumber, setMatricNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogs = useFeedback();
  // A class rep vouches that the student is in the room, so the rep's own
  // phone must be in the venue when the session checks it.
  const needsLocation = isRep && session.requireVenue && session.status === 'open';
  const live = useLiveLocation(needsLocation);
  const closedForLecturer = !isRep && session.status !== 'open';

  useEffect(() => { nameRef.current?.focus(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    // The server's rules, checked here first so a typo shows at once.
    const matric = checkMatricNumber(matricNumber);
    if (!matric.ok) {
      setError(matric.message.startsWith('Add') ? 'Enter the matric number: 9 digits, e.g. 250211184.' : matric.message);
      return;
    }
    const name = checkPersonName(fullName, 'student’s full name', 'several');
    if (!name.ok) {
      setError(name.message);
      return;
    }
    const fix = live.fixRef.current;
    if (needsLocation && !fix) {
      setError(live.status === 'denied'
        ? `Location is blocked. Class reps can add students only from inside ${session.venueName ?? 'the venue'}: allow location for this site and try again.`
        : `Still finding your location to confirm you are in ${session.venueName ?? 'the venue'}. Wait a few seconds and tap Add again.`);
      return;
    }
    setBusy(true);
    try {
      const result = await addLectureAttendee(session.id, {
        fullName: name.value,
        matricNumber: matric.value,
        ...(needsLocation && fix ? { location: toCheckInLocation(fix) } : {}),
      });
      dialogs.toast(result.status === 'restored' ? `${result.fullName} is back on the list.` : `${result.fullName} was added.`);
      setFullName('');
      setMatricNumber('');
      nameRef.current?.focus();
      onAdded();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lx-add-student" onSubmit={(event) => void submit(event)} aria-label="Add a student by hand">
      <p className="lx-fine">
        {isRep
          ? 'For a classmate who is here but can’t scan, even on a friend’s phone. You can add up to 10 while attendance is open; each is marked “Added by you” on the list and in exports.'
          : closedForLecturer
            ? 'Attendance has closed. A student you add now is marked “Added after class” on the list and in exports, so add only students you saw in class.'
            : 'For a student who is here but can’t scan — a dead phone or no smartphone. It is marked “Added by you” on the list and in exports.'}
      </p>
      <div className="lx-grid-2">
        <label className="account-field">
          <span>Full name</span>
          <input ref={nameRef} value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="off" autoCapitalize="words" maxLength={160} required placeholder="e.g. OKAFOR Adaeze" />
          <small>Surname and first name, letters only. Ignored when the student has an account.</small>
        </label>
        <label className="account-field">
          <span>Matric number</span>
          <input value={matricNumber} onChange={(event) => setMatricNumber(event.target.value)} autoComplete="off" inputMode="numeric" maxLength={20} required placeholder="e.g. 250211184" />
          <small>9 digits.</small>
        </label>
      </div>
      {needsLocation ? <LocationCheck live={live} presence={null} venueName={session.venueName ?? 'the venue'} /> : null}
      {error ? <p className="lx-error" role="alert">{error}</p> : null}
      <div className="lx-add-student-actions">
        <button className="button button-secondary" type="button" onClick={onClose}>Done</button>
        <button className="button button-primary" type="submit" disabled={busy}><UserPlus size={16} aria-hidden="true" /> {busy ? 'Adding…' : 'Add to list'}</button>
      </div>
    </form>
  );
}

function AttendeeList({
  detail,
  takerRole,
  onChanged,
}: Readonly<{ detail: LectureSessionDetail; takerRole: LectureCapabilities['role']; onChanged: () => void }>) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const dialogs = useFeedback();
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState<LectureAttendee | null>(null);
  const { session, attendees } = detail;
  const isRep = takerRole === 'hoc' || takerRole === 'ghoc';
  // After class only a lecturer or an administrator can add anyone.
  const canAdd = detail.canManage && (!isRep || session.status === 'open');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = [...attendees].reverse();
    if (!needle) return list;
    return list.filter((item) => item.fullName.toLowerCase().includes(needle) || item.matricNumber.toLowerCase().includes(needle));
  }, [attendees, query]);

  async function toggle(attendee: LectureAttendee) {
    let reason: string | undefined;
    if (!attendee.removed) {
      const answer = await dialogs.prompt({
        title: `Remove ${attendee.fullName}?`,
        body: `${attendee.matricNumber} will no longer count as present. You can put them back later.`,
        label: 'Reason (optional)',
        defaultValue: 'Not in class',
        suggestions: ['Not in class', 'Duplicate entry', 'Wrong course', 'Marked for someone else'],
        maxLength: 200,
        confirmLabel: 'Remove',
        tone: 'danger',
      });
      if (answer === null) return;
      reason = answer || undefined;
    }
    setBusy(attendee.id);
    setError('');
    try {
      await setLectureAttendeeRemoved(session.id, attendee.id, attendee.removed ? { restore: true } : reason ? { reason } : {});
      dialogs.toast(attendee.removed ? `${attendee.fullName} is back on the list.` : `${attendee.fullName} was removed.`);
      onChanged();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy('');
    }
  }

  function exportCsv() {
    const rows = [
      ['S/N', 'Full name', 'Matric number', 'Time', 'Method', 'Account', 'Venue check', 'Metres outside walls', 'GPS accuracy (m)', 'Status'],
      ...attendees.filter((item) => !item.removed).map((item, index) => [
        String(index + 1),
        item.fullName,
        item.matricNumber,
        formatClock(item.checkedInAt),
        item.method === 'qr' ? 'QR scan' : item.method === 'code' ? 'Typed code' : `Added by ${item.addedByName ?? 'session taker'}${item.addedAfterClose ? ' after class' : ''}`,
        item.hasAccount ? 'Yes' : 'No',
        item.venueOutcome ?? '',
        item.outsideMeters != null ? String(Math.round(item.outsideMeters)) : '',
        item.accuracyMeters != null ? String(Math.round(item.accuracyMeters)) : '',
        'Present',
      ]),
    ];
    const csv = `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const day = new Date(session.startsAt).toISOString().slice(0, 10);
    link.download = `${session.courseCode.replace(/[^A-Za-z0-9]+/g, '-')}-${day}-attendance.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="lx-card lx-attendees" aria-labelledby="lx-attendees-title">
      <div className="lx-attendees-head">
        <h2 id="lx-attendees-title">Students <span>{session.presentCount}</span></h2>
        <div className="lx-attendees-actions">
          {canAdd ? (
            <button className="button button-secondary lx-small-button" type="button" onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
              <UserPlus size={15} aria-hidden="true" /> Add student
            </button>
          ) : null}
          <button className="button button-secondary lx-small-button" type="button" onClick={exportCsv} disabled={session.presentCount === 0}>
            <Download size={15} aria-hidden="true" /> Excel / CSV
          </button>
        </div>
      </div>
      {adding && canAdd ? <AddStudentForm session={session} isRep={isRep} onAdded={onChanged} onClose={() => setAdding(false)} /> : null}
      {detail.canManage && isRep && session.status !== 'open' ? (
        <p className="lx-fine">Attendance has closed, so class reps can no longer add students. A student who was in class but not marked should ask the lecturer.</p>
      ) : null}
      {attendees.length > 6 ? (
        <label className="lx-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Find a student</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find by name or matric" />
        </label>
      ) : null}
      {error ? <p className="lx-error" role="alert">{error}</p> : null}
      {attendees.length === 0 ? (
        <p className="lx-empty">No one yet. Names appear here as students mark attendance.</p>
      ) : (
        <ol className="lx-attendee-list">
          {visible.map((attendee) => (
            <li key={attendee.id} className={attendee.removed ? 'is-removed' : undefined}>
              <div className="lx-attendee-main">
                <strong>{attendee.fullName}</strong>
                <span>{attendee.matricNumber} · {formatClock(attendee.checkedInAt)}</span>
                <span className="lx-flags">
                  {attendee.removed ? <span className="lx-flag is-warn">Removed{attendee.removedReason ? `: ${attendee.removedReason}` : ''}</span> : attendeeFlags(attendee, !isRep)}
                </span>
              </div>
              {detail.canManage && !attendee.hasAccount && !attendee.removed ? (
                <EditButton compact label={`Correct ${attendee.fullName}`} onClick={() => setCorrecting(attendee)} />
              ) : null}
              {detail.canManage ? (
                <button
                  className="lx-icon-button"
                  type="button"
                  disabled={busy === attendee.id}
                  onClick={() => void toggle(attendee)}
                  aria-label={attendee.removed ? `Put ${attendee.fullName} back` : `Remove ${attendee.fullName}`}
                  data-tip={attendee.removed ? 'Put back' : 'Remove'}
                >
                  {attendee.removed ? <RefreshCw size={16} /> : <UserRoundX size={16} />}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {correcting && detail.canManage ? (
        <CorrectAttendeeDialog
          sessionId={session.id}
          attendee={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => { setCorrecting(null); onChanged(); }}
        />
      ) : null}
    </section>
  );
}

/** Fixes a typo in what a guest typed when checking in. */
function CorrectAttendeeDialog({
  sessionId,
  attendee,
  onClose,
  onSaved,
}: Readonly<{ sessionId: string; attendee: LectureAttendee; onClose: () => void; onSaved: () => void }>) {
  const dialogs = useFeedback();
  const [fullName, setFullName] = useState(attendee.fullName);
  const [matricNumber, setMatricNumber] = useState(attendee.matricNumber);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const name = fullName.trim().replace(/\s+/g, ' ');
    const typedMatric = matricNumber.trim();
    const input: { fullName?: string; matricNumber?: string } = {};
    if (name !== attendee.fullName) {
      const checked = checkPersonName(name, 'student’s full name', 'several');
      if (!checked.ok) {
        setError(checked.message);
        return;
      }
      input.fullName = checked.value;
    }
    if (typedMatric.replace(/\s+/g, '') !== attendee.matricNumber) {
      const checked = checkMatricNumber(typedMatric);
      if (!checked.ok) {
        setError(checked.message.startsWith('Add') ? 'Enter the matric number: 9 digits, e.g. 250211184.' : checked.message);
        return;
      }
      if (checked.value !== attendee.matricNumber) input.matricNumber = checked.value;
    }
    if (!input.fullName && !input.matricNumber) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await correctLectureAttendee(sessionId, attendee.id, input);
      dialogs.toast(result.linked
        ? `${result.matricNumber} belongs to ${result.fullName}'s account. The entry is now theirs.`
        : `Saved: ${result.fullName} · ${result.matricNumber}.`);
      onSaved();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditDialog
      title="Correct this entry"
      description="Fix a typo in what the student typed. If the new matric number belongs to a student account, the entry moves to that account."
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      <label className="account-field">
        <span>Full name</span>
        <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={160} autoComplete="off" autoCapitalize="words" required />
      </label>
      <label className="account-field">
        <span>Matric number</span>
        <input
          value={matricNumber}
          onChange={(event) => setMatricNumber(event.target.value)}
          maxLength={20}
          inputMode="numeric"
          autoComplete="off"
          required
        />
      </label>
    </EditDialog>
  );
}
