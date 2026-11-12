'use client';

import { AuthenticatedSessionSchema, extractCheckInChallenge } from '@lasuatos/contracts';
import { AlertTriangle, LoaderCircle, LogIn, MapPin, ScanLine } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkInWithChallenge, loadStudentOpenAttendanceSessions, type CheckInLocationInput } from '../lib/attendance-api';
import { savePendingCheckIn, takePendingCheckIn } from '../lib/check-in-device';
import { requestLocationSample } from '../lib/location';
import { QrScanner } from './qr-scanner';

type Phase =
  | { readonly kind: 'starting' }
  | { readonly kind: 'no_code' }
  | { readonly kind: 'signing_in' }
  | { readonly kind: 'wrong_account'; readonly accountType: string }
  | { readonly kind: 'locating' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'done'; readonly already: boolean; readonly course: string; readonly session: string; readonly venue: string | null; readonly at: string; readonly venueOutcome: string | null }
  | { readonly kind: 'failed'; readonly message: string };

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The check-in could not be completed. Check your connection and scan again.';
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en-NG', { timeStyle: 'short', dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date(value));
}

/**
 * Landing page for the link encoded in the lecturer's rotating QR code. The
 * challenge arrives in the URL fragment (never sent to the server), is
 * removed from the address bar immediately so it cannot be screenshotted
 * from there, and survives a detour through sign-in in sessionStorage.
 */
export function CheckInLanding() {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [scanning, setScanning] = useState(false);
  const started = useRef(false);

  const submit = useCallback(async (challenge: string | null) => {
    setScanning(false);
    if (!challenge) {
      setPhase({ kind: 'no_code' });
      return;
    }
    let session: Response;
    try {
      session = await fetch('/api/v1/auth/session', { cache: 'no-store' });
    } catch {
      setPhase({ kind: 'failed', message: 'LASUATOS did not respond. Check your connection and scan again.' });
      return;
    }
    if (session.status === 401) {
      savePendingCheckIn(challenge);
      setPhase({ kind: 'signing_in' });
      window.setTimeout(() => window.location.assign('/sign-in'), 900);
      return;
    }
    const parsed = AuthenticatedSessionSchema.safeParse(session.ok ? await session.json().catch(() => null) : null);
    if (!parsed.success) {
      setPhase({ kind: 'failed', message: 'Your account could not be confirmed. Sign in again, then scan the code.' });
      return;
    }
    if (parsed.data.account.accountType !== 'student') {
      setPhase({ kind: 'wrong_account', accountType: parsed.data.account.accountType });
      return;
    }

    try {
      // Only ask for location when the scanned session is venue-linked (or we cannot tell).
      const sessionId = challenge.split('.')[1]?.toLowerCase();
      let needsLocation = true;
      try {
        const open = await loadStudentOpenAttendanceSessions();
        const target = open.sessions.find((item) => item.attendanceSessionId === sessionId);
        if (target) needsLocation = target.locationRequired;
        else needsLocation = open.sessions.some((item) => item.locationRequired);
      } catch {
        needsLocation = true;
      }
      let location: CheckInLocationInput | undefined;
      if (needsLocation) {
        setPhase({ kind: 'locating' });
        const sample = await requestLocationSample();
        if (sample) location = sample;
      }
      setPhase({ kind: 'submitting' });
      const result = await checkInWithChallenge(challenge, location);
      setPhase({
        kind: 'done',
        already: result.status === 'already_checked_in',
        course: result.attendance.courseCode,
        session: result.attendance.sessionTitle,
        venue: result.attendance.venueName,
        at: result.attendance.checkedInAt,
        venueOutcome: result.attendance.venueOutcome,
      });
    } catch (caught) {
      setPhase({ kind: 'failed', message: failureMessage(caught) });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fromLink = window.location.hash.length > 1 ? extractCheckInChallenge(window.location.href) : null;
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, '', '/check-in');
    }
    void submit(fromLink ?? takePendingCheckIn());
  }, [submit]);

  const scanAgain = (
    <button className="button button-primary checkin-landing-scan" type="button" onClick={() => setScanning(true)}>
      <ScanLine size={18} aria-hidden="true" /> Scan the QR code
    </button>
  );

  return (
    <section className="checkin-landing" aria-live="polite">
      {phase.kind === 'starting' || phase.kind === 'submitting' ? (
        <div className="checkin-landing-card">
          <LoaderCircle className="course-spin checkin-landing-icon" size={34} aria-hidden="true" />
          <h2>Checking you in…</h2>
          <p>Keep this page open for a moment.</p>
        </div>
      ) : null}

      {phase.kind === 'locating' ? (
        <div className="checkin-landing-card">
          <span className="checkin-landing-locate" aria-hidden="true"><MapPin size={30} /></span>
          <h2>Confirming you are at the venue</h2>
          <p>This lecture is linked to a venue. If your browser asks to use your location, tap <strong>Allow</strong>.</p>
        </div>
      ) : null}

      {phase.kind === 'signing_in' ? (
        <div className="checkin-landing-card">
          <LogIn className="checkin-landing-icon" size={34} aria-hidden="true" />
          <h2>Sign in to finish checking in</h2>
          <p>Taking you to sign-in. The QR code changes every 20 seconds, so if it has changed by the time you are back, just scan it again.</p>
          <Link className="button button-primary" href="/sign-in">Sign in</Link>
        </div>
      ) : null}

      {phase.kind === 'done' ? (
        <div className="checkin-landing-card is-success">
          <span className="sx-result-mark checkin-landing-mark" aria-hidden="true">
            <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27 l7 7 l15 -16" /></svg>
          </span>
          <h2>{phase.already ? 'Already checked in' : 'You’re checked in'}</h2>
          <p className="checkin-landing-course">{phase.course} · {phase.session}</p>
          <p>
            {phase.already ? 'Your check-in was recorded at ' : 'Recorded at '}
            <strong>{formatTime(phase.at)}</strong>
            {phase.venue ? ` · ${phase.venue}` : ''}
            {phase.venueOutcome === 'within_boundary' ? ' · location within the venue' : ''}
            {phase.venueOutcome === 'inconclusive' ? ' · location reading was imprecise (recorded as inconclusive)' : ''}
          </p>
          <Link className="button button-primary" href="/attendance">Go to My attendance</Link>
        </div>
      ) : null}

      {phase.kind === 'failed' ? (
        <div className="checkin-landing-card is-error">
          <AlertTriangle className="checkin-landing-icon" size={34} aria-hidden="true" />
          <h2>Check-in not recorded</h2>
          <p role="alert">{phase.message}</p>
          {scanAgain}
          <Link className="checkin-landing-secondary" href="/attendance">Open My attendance</Link>
        </div>
      ) : null}

      {phase.kind === 'no_code' ? (
        <div className="checkin-landing-card">
          <ScanLine className="checkin-landing-icon" size={34} aria-hidden="true" />
          <h2>Scan your lecturer’s QR code</h2>
          <p>This page opens when you scan the attendance QR code shown in class. Tap below to scan it with your camera.</p>
          {scanAgain}
          <Link className="checkin-landing-secondary" href="/attendance">Type a session code instead</Link>
        </div>
      ) : null}

      {phase.kind === 'wrong_account' ? (
        <div className="checkin-landing-card is-error">
          <AlertTriangle className="checkin-landing-icon" size={34} aria-hidden="true" />
          <h2>This is a student check-in code</h2>
          <p>You are signed in as a {phase.accountType}. Students scan this code with their own phones to check in.</p>
          <Link className="checkin-landing-secondary" href="/">Back to LASUATOS</Link>
        </div>
      ) : null}

      {scanning ? <QrScanner onDetected={(challenge) => void submit(challenge)} onClose={() => setScanning(false)} /> : null}
    </section>
  );
}
