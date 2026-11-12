'use client';

import { readAttendanceScan, type CheckInLocationSample, type LectureCheckInResult, type ResolvedLecture } from '@lasuatos/contracts';
import { AlertTriangle, Clock3, Keyboard, LoaderCircle, MapPin, ScanLine, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  failureText,
  formatClock,
  rememberGuest,
  rememberedGuest,
  resolveLecture,
  submitLectureCheckIn,
} from '../lib/lecture-api';
import { requestLocationSample } from '../lib/location';
import { QrScanner } from './qr-scanner';

type Phase =
  | { readonly kind: 'start' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'form'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'locating'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'saving'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'done'; readonly result: LectureCheckInResult; readonly guest: boolean }
  | { readonly kind: 'failed'; readonly message: string };

function acceptScan(text: string): string | null {
  return readAttendanceScan(text) ? text : null;
}

/**
 * Marking attendance at a lecture: scan the QR code (or type the code), check
 * the course, and confirm. Signed-in students are marked with their account;
 * everyone else types a name and matric number, remembered on this phone.
 */
export function LectureCheckIn({ initialCode }: Readonly<{ initialCode?: string }>) {
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  const [scanning, setScanning] = useState(false);
  const [typedCode, setTypedCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [formError, setFormError] = useState('');
  const [guest, setGuest] = useState({ fullName: '', matricNumber: '' });
  const [remember, setRemember] = useState(true);
  const started = useRef(false);

  const submit = useCallback(async (lecture: ResolvedLecture, details: { fullName: string; matricNumber: string } | null) => {
    setFormError('');
    let location: CheckInLocationSample | undefined;
    if (lecture.session.requireVenue) {
      setPhase({ kind: 'locating', lecture });
      const sample = await requestLocationSample();
      if (!sample) {
        setPhase({ kind: 'form', lecture });
        setFormError(`Turn on location for this site so we can confirm you are in ${lecture.session.venueName ?? 'the venue'}, then tap the button again.`);
        return;
      }
      location = { ...sample, accuracyMeters: sample.accuracyMeters ?? null };
    }
    setPhase({ kind: 'saving', lecture });
    try {
      const result = await submitLectureCheckIn({
        ticket: lecture.ticket,
        ...(details ? { fullName: details.fullName, matricNumber: details.matricNumber } : {}),
        ...(location ? { location } : {}),
      });
      if (details) rememberGuest(remember ? details : null);
      setPhase({ kind: 'done', result, guest: details !== null });
    } catch (caught) {
      const message = failureText(caught, 'Your attendance was not saved. Try again.');
      // Expired page or closed session: start over. Anything else: let them fix the form.
      if (caught && typeof caught === 'object' && 'status' in caught && (caught.status === 410 || caught.status === 404)) {
        setPhase({ kind: 'failed', message });
      } else {
        setPhase({ kind: 'form', lecture });
        setFormError(message);
      }
    }
  }, [remember]);

  const open = useCallback(async (input: { challenge?: string; code?: string; scanned?: boolean }) => {
    setScanning(false);
    setCodeError('');
    setPhase({ kind: 'opening' });
    try {
      const lecture = await resolveLecture(input);
      if (lecture.alreadyCheckedInAt && lecture.student) {
        setPhase({
          kind: 'done',
          guest: false,
          result: {
            status: 'already_checked_in',
            courseCode: lecture.session.courseCode,
            courseTitle: lecture.session.courseTitle,
            fullName: lecture.student.fullName,
            matricNumber: lecture.student.matricNumber,
            checkedInAt: lecture.alreadyCheckedInAt,
            venueOutcome: null,
          },
        });
        return;
      }
      setPhase({ kind: 'form', lecture });
    } catch (caught) {
      setPhase({ kind: 'failed', message: failureText(caught, 'That code could not be opened. Scan it again.') });
    }
  }, []);

  const handleScan = useCallback((text: string) => {
    const scan = readAttendanceScan(text);
    if (!scan) return;
    if (scan.kind === 'course') {
      // A course attendance QR (students with enrolled courses): hand over to that page.
      window.location.assign(`/check-in#${scan.challenge}`);
      return;
    }
    void open(scan.kind === 'lecture' ? { challenge: scan.challenge } : { code: scan.code, scanned: true });
  }, [open]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const saved = rememberedGuest();
    let start: { challenge?: string; code?: string; scanned?: boolean } | null = initialCode ? { code: initialCode, scanned: true } : null;
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      // The rotating code is removed from the address bar so it cannot be shared from there.
      window.history.replaceState(null, '', window.location.pathname);
      let decoded = fragment;
      try {
        decoded = decodeURIComponent(fragment);
      } catch {
        decoded = fragment;
      }
      const scan = readAttendanceScan(decoded);
      if (scan?.kind === 'lecture') start = { challenge: scan.challenge };
    }
    // Deferred so the first render matches the server; storage and the URL fragment are client-only.
    window.setTimeout(() => {
      if (saved) setGuest(saved);
      if (start) void open(start);
    }, 0);
  }, [initialCode, open]);

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = typedCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6 && code.length !== 8) {
      setCodeError('The code has 6 or 8 letters and numbers. Check the screen or the poster.');
      return;
    }
    void open({ code });
  }

  function submitForm(event: FormEvent<HTMLFormElement>, lecture: ResolvedLecture) {
    event.preventDefault();
    if (lecture.student) {
      void submit(lecture, null);
      return;
    }
    const fullName = guest.fullName.trim().replace(/\s+/g, ' ');
    const matricNumber = guest.matricNumber.trim().replace(/\s+/g, '').toUpperCase();
    if (fullName.length < 3 || !fullName.includes(' ')) {
      setFormError('Enter your full name: first name and surname.');
      return;
    }
    if (!/^[A-Z0-9/-]{5,32}$/.test(matricNumber) || !/\d{3}/.test(matricNumber)) {
      setFormError('Check your matric number. It is the number on your school ID card, e.g. 220591001.');
      return;
    }
    void submit(lecture, { fullName, matricNumber });
  }

  const startOver = () => {
    setPhase({ kind: 'start' });
    setTypedCode('');
  };

  return (
    <section className="lx-checkin" aria-live="polite">
      {phase.kind === 'start' ? (
        <div className="lx-card lx-start">
          <h1>Mark your attendance</h1>
          <p>Scan the QR code on the screen or the poster in your lecture hall. No account needed.</p>
          <button className="button button-primary lx-big-button" type="button" onClick={() => setScanning(true)}>
            <ScanLine size={22} aria-hidden="true" /> Scan QR code
          </button>
          <div className="lx-divider"><span>or type the code</span></div>
          <form className="lx-code-form" onSubmit={submitCode} noValidate>
            <label className="sr-only" htmlFor="lx-code">Attendance code</label>
            <input
              id="lx-code"
              className="lx-code-input"
              value={typedCode}
              onChange={(event) => setTypedCode(event.target.value.toUpperCase())}
              placeholder="e.g. K7M29Q"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              inputMode="text"
            />
            <button className="button button-secondary" type="submit">
              <Keyboard size={18} aria-hidden="true" /> Continue
            </button>
          </form>
          {codeError ? <p className="lx-error" role="alert">{codeError}</p> : null}
          <p className="lx-fine">Have an account? <Link href="/sign-in?next=/a">Sign in</Link> and your name and matric number are filled in for you.</p>
        </div>
      ) : null}

      {phase.kind === 'opening' ? (
        <div className="lx-card lx-center">
          <LoaderCircle className="course-spin" size={34} aria-hidden="true" />
          <h2>Opening the class…</h2>
        </div>
      ) : null}

      {phase.kind === 'form' || phase.kind === 'locating' || phase.kind === 'saving' ? (
        <form className="lx-card lx-form" onSubmit={(event) => submitForm(event, phase.lecture)} noValidate>
          <div className="lx-course">
            <span className="lx-course-code">{phase.lecture.session.courseCode}</span>
            <h1>{phase.lecture.session.courseTitle}</h1>
            <p className="lx-course-meta">
              {phase.lecture.session.lecturerName ? <span>{phase.lecture.session.lecturerName}</span> : null}
              <span><Clock3 size={14} aria-hidden="true" /> Open until {formatClock(phase.lecture.session.endsAt)}</span>
              {phase.lecture.session.venueName ? <span><MapPin size={14} aria-hidden="true" /> {phase.lecture.session.venueName}</span> : null}
            </p>
          </div>

          {phase.lecture.student ? (
            <div className="lx-me">
              <UserRound size={20} aria-hidden="true" />
              <div>
                <strong>{phase.lecture.student.fullName}</strong>
                <span>{phase.lecture.student.matricNumber}</span>
              </div>
            </div>
          ) : (
            <>
              <label className="account-field">
                <span>Full name</span>
                <input
                  name="fullName"
                  autoComplete="name"
                  maxLength={160}
                  value={guest.fullName}
                  onChange={(event) => setGuest((value) => ({ ...value, fullName: event.target.value }))}
                  placeholder="First name and surname"
                  required
                />
              </label>
              <label className="account-field">
                <span>Matric number</span>
                <input
                  name="matricNumber"
                  autoComplete="off"
                  inputMode="numeric"
                  autoCapitalize="characters"
                  maxLength={32}
                  value={guest.matricNumber}
                  onChange={(event) => setGuest((value) => ({ ...value, matricNumber: event.target.value }))}
                  placeholder="e.g. 220591001"
                  required
                />
              </label>
              <label className="lx-check">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>Remember my details on this phone</span>
              </label>
            </>
          )}

          {phase.lecture.session.requireVenue ? (
            <p className="lx-note"><MapPin size={15} aria-hidden="true" /> Your location is checked once to confirm you are in {phase.lecture.session.venueName ?? 'the venue'}. Tap <strong>Allow</strong> if asked.</p>
          ) : null}
          {formError ? <p className="lx-error" role="alert">{formError}</p> : null}

          <button className="button button-primary lx-big-button" type="submit" disabled={phase.kind !== 'form'}>
            {phase.kind === 'locating' ? 'Checking your location…' : phase.kind === 'saving' ? 'Saving…' : 'Mark me present'}
          </button>
          <button className="lx-link-button" type="button" onClick={startOver}>Wrong class? Scan again</button>
        </form>
      ) : null}

      {phase.kind === 'done' ? (
        <div className="lx-card lx-center lx-done">
          <span className="sx-result-mark lx-mark" aria-hidden="true">
            <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27 l7 7 l15 -16" /></svg>
          </span>
          <h1>{phase.result.status === 'already_checked_in' ? 'You were already marked present' : 'You’re marked present'}</h1>
          <p className="lx-done-course"><strong>{phase.result.courseCode}</strong> · {phase.result.courseTitle}</p>
          <dl className="lx-receipt">
            <div><dt>Name</dt><dd>{phase.result.fullName}</dd></div>
            <div><dt>Matric</dt><dd>{phase.result.matricNumber}</dd></div>
            <div><dt>Time</dt><dd>{formatClock(phase.result.checkedInAt)}</dd></div>
          </dl>
          {phase.result.venueOutcome === 'within' ? <p className="lx-fine">Location confirmed inside the venue.</p> : null}
          {phase.guest ? (
            <p className="lx-fine">Tired of typing? <Link href="/sign-up">Create a free account</Link> and your details are filled in next time.</p>
          ) : (
            <Link className="button button-secondary" href="/attendance">See my attendance</Link>
          )}
        </div>
      ) : null}

      {phase.kind === 'failed' ? (
        <div className="lx-card lx-center lx-failed">
          <AlertTriangle size={34} aria-hidden="true" />
          <h2>Not marked yet</h2>
          <p role="alert">{phase.message}</p>
          <button className="button button-primary lx-big-button" type="button" onClick={() => { startOver(); setScanning(true); }}>
            <ScanLine size={20} aria-hidden="true" /> Scan again
          </button>
          <button className="lx-link-button" type="button" onClick={startOver}>Type the code instead</button>
        </div>
      ) : null}

      {scanning ? <QrScanner accept={acceptScan} onDetected={handleScan} onClose={() => setScanning(false)} /> : null}
    </section>
  );
}
