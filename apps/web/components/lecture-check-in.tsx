'use client';

import { readAttendanceScan, type CheckInLocationSample, type FaceFrame, type FacePose, type LectureCheckInResult, type ResolvedLecture } from '@lasuatos/contracts';
import { formatAccuracy, type CombinedFix } from '@lasuatos/verification/venue-area';
import { AlertTriangle, Clock3, Keyboard, MapPin, MapPinCheck, ScanFace, ScanLine, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { forgetSession, lookupSession } from '../lib/current-account';
import {
  failureText,
  forgetOldGuestDetails,
  formatClock,
  resolveLecture,
  submitLectureCheckIn,
} from '../lib/lecture-api';
import { PasswordField } from './password-field';
import { locationSettingsHelp, phonePlatform, toCheckInLocation, useLiveLocation, type LocationStatus } from '../lib/location';
import { previewPresence, venueAreaFromGuide } from '../lib/venue-presence';
import { LocationCheck } from './location-check';
import { haptic } from '../lib/use-live';
import { Bone, SkeletonRegion } from './ui/skeleton';
import { InstallAppButton } from './install-app';
import { QrScanner } from './qr-scanner';
import { FaceCapture } from './face-capture';

type Phase =
  | { readonly kind: 'start' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'form'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'locating'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'saving'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'done'; readonly result: LectureCheckInResult; readonly signedInHere: boolean; readonly keptSignedIn: boolean; readonly lecture: ResolvedLecture }
  | { readonly kind: 'failed'; readonly message: string };

function acceptScan(text: string): string | null {
  return readAttendanceScan(text) ? text : null;
}

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

/** Longest the button waits for a usable position after it is tapped. */
const MAX_LOCATE_WAIT_MILLISECONDS = 15_000;

/**
 * Who is signed in on this phone, as far as the check-in is concerned. A staff
 * account cannot be marked present, so it is treated like no account.
 */
type PhoneAccount = 'student' | 'staff' | 'none';

/** Whose attendance the form marks: the phone's student, or someone signing in here. */
type Marking = 'me' | 'sign-in';

/**
 * Marking attendance at a lecture: scan the QR code (or type the code), check
 * the course, and confirm. Students mark only themselves, with their own
 * account: the one signed in on the phone, or (for a classmate without their
 * phone) by signing in just for this check-in, which leaves the phone's own
 * sign-in alone and keeps nothing of theirs.
 */
export function LectureCheckIn({ initialCode }: Readonly<{ initialCode?: string }>) {
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  const [scanning, setScanning] = useState(false);
  const [typedCode, setTypedCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [formError, setFormError] = useState('');
  const [phoneAccount, setPhoneAccount] = useState<PhoneAccount>('none');
  const [marking, setMarking] = useState<Marking>('me');
  const [identifier, setIdentifier] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const started = useRef(false);
  // The face check's camera, open while a check-in waits for its photos.
  const [faceRequest, setFaceRequest] = useState<{ readonly poses: readonly FacePose[]; readonly resolve: (frames: FaceFrame[] | null) => void } | null>(null);
  const captureFace = useCallback((lecture: ResolvedLecture) => new Promise<FaceFrame[] | null>((resolve) => {
    setFaceRequest({ poses: ['front', lecture.face.turn], resolve });
  }), []);
  const finishFace = useCallback((frames: FaceFrame[] | null) => {
    setFaceRequest((current) => {
      current?.resolve(frames);
      return null;
    });
  }, []);
  const cancelFace = useCallback(() => finishFace(null), [finishFace]);

  // Venue check: watch the position from the moment the form opens, so GPS has
  // settled by the time the student has typed their details.
  const activeLecture = phase.kind === 'form' || phase.kind === 'locating' || phase.kind === 'saving' ? phase.lecture : null;
  const checksVenue = Boolean(activeLecture?.session.requireVenue);
  const live = useLiveLocation(checksVenue);
  const area = useMemo(() => venueAreaFromGuide(activeLecture?.session.venueGuide ?? null), [activeLecture]);
  const presence = previewPresence(area, live.fix, live.updatedAt);
  const statusRef = useRef<LocationStatus>('idle');
  const trackingSinceRef = useRef<number | null>(null);
  useEffect(() => {
    statusRef.current = live.status;
    trackingSinceRef.current = live.startedAt;
  }, [live.status, live.startedAt]);
  const { fixRef } = live;

  /**
   * Waits (briefly) for a position worth sending: one the preview confirms,
   * or the best available once GPS has had time, or a clear "outside". The
   * server makes the decision either way.
   */
  const waitForFix = useCallback(async (lecture: ResolvedLecture): Promise<CombinedFix | null> => {
    const lectureArea = venueAreaFromGuide(lecture.session.venueGuide);
    const tappedAt = Date.now();
    for (;;) {
      const now = Date.now();
      const status = statusRef.current;
      if (status === 'denied' || status === 'unsupported') return null;
      const fix = fixRef.current;
      const sinceTap = now - tappedAt;
      if (fix) {
        const preview = previewPresence(lectureArea, fix, now);
        // GPS keeps sharpening for the first seconds; give it a moment unless the fix is already good.
        const trackedFor = now - (trackingSinceRef.current ?? tappedAt);
        if (preview?.outcome === 'within' && (fix.accuracyMeters <= 35 || trackedFor >= 5_000)) return fix;
        if (preview?.reason === 'outside' && sinceTap >= 3_000) return fix;
        if (sinceTap >= 8_000) return fix;
      }
      if (sinceTap >= MAX_LOCATE_WAIT_MILLISECONDS) return fix;
      await sleep(250);
    }
  }, [fixRef]);

  const submit = useCallback(async (lecture: ResolvedLecture, signIn: { identifier: string; password: string } | null) => {
    setFormError('');
    // The face first, while the student is looking at the phone; GPS keeps settling meanwhile.
    let face: { frames: FaceFrame[] } | undefined;
    if (lecture.face.required) {
      const frames = await captureFace(lecture);
      if (!frames) return;
      face = { frames };
    }
    let location: CheckInLocationSample | undefined;
    if (lecture.session.requireVenue) {
      setPhase({ kind: 'locating', lecture });
      const fix = await waitForFix(lecture);
      if (!fix) {
        setPhase({ kind: 'form', lecture });
        const platform = phonePlatform();
        setFormError(
          statusRef.current === 'denied'
            ? `Location is blocked, so we cannot confirm you are in ${lecture.session.venueName ?? 'the venue'}. ${locationSettingsHelp(platform, 'denied')}`
            : `We could not get your location to confirm you are in ${lecture.session.venueName ?? 'the venue'}. ${locationSettingsHelp(platform, 'off')} Then tap the button again.`,
        );
        return;
      }
      location = toCheckInLocation(fix);
    }
    setPhase({ kind: 'saving', lecture });
    try {
      const result = await submitLectureCheckIn({
        ticket: lecture.ticket,
        ...(signIn ? { signIn } : {}),
        ...(location ? { location } : {}),
        ...(face ? { face } : {}),
      });
      haptic([16, 60, 24]);
      // The phone's owner asked to stay signed in: sign in for real too. Only
      // offered when nobody is signed in, so it never replaces someone's account.
      let keptSignedIn = false;
      if (signIn && keepSignedIn && phoneAccount === 'none') {
        try {
          const response = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: signIn.identifier, password: signIn.password }),
          });
          if (response.ok) {
            forgetSession();
            keptSignedIn = true;
          }
        } catch {
          // Attendance is saved; staying signed in is a convenience only.
        }
      }
      setPhase({ kind: 'done', result, signedInHere: signIn !== null, keptSignedIn, lecture });
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
  }, [captureFace, keepSignedIn, phoneAccount, waitForFix]);

  const open = useCallback(async (input: { challenge?: string; code?: string; scanned?: boolean }) => {
    setScanning(false);
    setCodeError('');
    setPhase({ kind: 'opening' });
    try {
      const [lecture, session] = await Promise.all([resolveLecture(input), lookupSession()]);
      const account: PhoneAccount = lecture.student
        ? 'student'
        : session.kind === 'signed_in' ? 'staff' : 'none';
      setPhoneAccount(account);
      setMarking(account === 'student' ? 'me' : 'sign-in');
      setFormError('');
      if (lecture.alreadyCheckedInAt && lecture.student) {
        setPhase({
          kind: 'done',
          signedInHere: false,
          keptSignedIn: false,
          lecture,
          result: {
            status: 'already_checked_in',
            courseCode: lecture.session.courseCode,
            courseTitle: lecture.session.courseTitle,
            fullName: lecture.student.fullName,
            matricNumber: lecture.student.matricNumber,
            checkedInAt: lecture.alreadyCheckedInAt,
            venueOutcome: null,
            locationAccuracyMeters: null,
            faceScore: null,
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
    forgetOldGuestDetails();
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
    // Deferred so the first render matches the server; the URL fragment is client-only.
    window.setTimeout(() => {
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

  // The phone's own student has no registered face yet: send them to register it first.
  const needsFaceSetup = activeLecture !== null && marking === 'me' && activeLecture.face.required && activeLecture.face.registered === false;

  function submitForm(event: FormEvent<HTMLFormElement>, lecture: ResolvedLecture) {
    event.preventDefault();
    if (marking === 'me' && lecture.student) {
      void submit(lecture, null);
      return;
    }
    const form = new FormData(event.currentTarget);
    const typed = identifier.trim();
    const password = String(form.get('password') ?? '');
    if (typed.length < 3) {
      setFormError('Enter your email address or matric number.');
      return;
    }
    if (!password) {
      setFormError('Enter your password.');
      return;
    }
    void submit(lecture, { identifier: typed, password });
  }

  function switchMarking(next: Marking) {
    setMarking(next);
    setIdentifier('');
    setKeepSignedIn(false);
    setFormError('');
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
          <p>Scan the QR code on the screen or the poster in your lecture hall. You mark yourself with your student account.</p>
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
          <p className="lx-fine">Sign in once on your phone and you only scan next time. <Link href="/sign-in?next=/a">Sign in</Link> · <Link href="/sign-up">Open your account</Link></p>
        </div>
      ) : null}

      {phase.kind === 'opening' ? (
        <SkeletonRegion label="Opening the class…" className="lx-card lx-form">
          <Bone width={86} height={24} style={{ borderRadius: 999 }} />
          <Bone width="72%" height={22} />
          <Bone width="46%" height={12} />
          <Bone width="28%" height={12} style={{ marginTop: 8 }} />
          <Bone height={48} />
          <Bone width="28%" height={12} />
          <Bone height={48} />
          <Bone height={52} style={{ marginTop: 6, borderRadius: 12 }} />
        </SkeletonRegion>
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

          {marking === 'me' && phase.lecture.student ? (
            <div className="lx-me">
              <UserRound size={20} aria-hidden="true" />
              <div>
                <strong>{phase.lecture.student.fullName}</strong>
                <span>{phase.lecture.student.matricNumber}</span>
              </div>
            </div>
          ) : (
            <div className="lx-sign-in">
              <div className="lx-sign-in-head">
                {phoneAccount === 'student' ? <UsersRound size={20} aria-hidden="true" /> : <ShieldCheck size={20} aria-hidden="true" />}
                <div>
                  <strong>{phoneAccount === 'student' ? 'Classmate, sign in to mark yourself' : 'Sign in to mark your attendance'}</strong>
                  <span>
                    {phoneAccount === 'student'
                      ? 'Only for this check-in. The phone stays signed in as its owner and nothing of yours is kept on it.'
                      : phoneAccount === 'staff'
                        ? 'This phone is signed in with a staff account. Sign in with your student account; the phone stays as it is.'
                        : 'Use your student account. Each student marks only themselves.'}
                  </span>
                </div>
              </div>
              <label className="account-field">
                <span>Email or matric number</span>
                <input
                  name="identifier"
                  autoComplete={phoneAccount === 'none' ? 'username' : 'off'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={320}
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="e.g. 220591001"
                  required
                />
              </label>
              <PasswordField label="Password" name="password" autoComplete="current-password" />
              {phoneAccount === 'none' ? (
                <label className="lx-check">
                  <input type="checkbox" checked={keepSignedIn} onChange={(event) => setKeepSignedIn(event.target.checked)} />
                  <span>This is my phone: keep me signed in<small>Leave this off on a classmate’s phone.</small></span>
                </label>
              ) : null}
              <p className="lx-fine">No account yet? <Link href="/sign-up">Open yours</Link> with your matric number, then scan again. <Link href="/forgot-password">Forgot password?</Link></p>
            </div>
          )}

          {phase.lecture.session.requireVenue ? (
            <LocationCheck live={live} presence={presence} venueName={phase.lecture.session.venueName ?? 'the venue'} />
          ) : null}
          {needsFaceSetup ? (
            <div className="lx-face-setup" role="alert">
              <ScanFace size={22} aria-hidden="true" />
              <div>
                <strong>Register your face first</strong>
                <span>Attendance now checks it is really you. It takes about 30 seconds, then scan the QR code again.</span>
                <Link className="button button-primary" href="/account/setup?next=/a">Register my face</Link>
              </div>
            </div>
          ) : phase.lecture.face.required ? (
            <p className="lx-face-note"><ScanFace size={16} aria-hidden="true" /> You will look at the camera, then turn your head to your {phase.lecture.face.turn}, to confirm it is you.</p>
          ) : null}
          {formError ? <p className="lx-error" role="alert">{formError}</p> : null}

          <button className="button button-primary lx-big-button" type="submit" disabled={phase.kind !== 'form' || needsFaceSetup}>
            {phase.kind === 'locating'
              ? 'Confirming your location…'
              : phase.kind === 'saving'
                ? (phase.lecture.face.required ? 'Checking it is you…' : 'Saving…')
                : marking === 'me' && phase.lecture.student ? 'Mark me present' : 'Sign in and mark me present'}
          </button>
          {phoneAccount === 'student' ? (
            marking === 'me' ? (
              <button className="lx-link-button" type="button" onClick={() => switchMarking('sign-in')} disabled={phase.kind !== 'form'}>
                A classmate without their phone? Let them sign in here
              </button>
            ) : (
              <button className="lx-link-button" type="button" onClick={() => switchMarking('me')} disabled={phase.kind !== 'form'}>
                Back to marking {phase.lecture.student?.fullName.split(' ')[0] ?? 'me'}
              </button>
            )
          ) : null}
          <button className="lx-link-button" type="button" onClick={startOver}>Wrong class? Scan again</button>
          <p className="lx-fine lx-privacy-line">Your name and matric number go to the person taking attendance for this class. A phone can mark its owner and one classmate per class. <Link href="/privacy">Privacy</Link></p>
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
          {phase.result.faceScore != null ? (
            <p className="lx-confirmed"><ScanFace size={16} aria-hidden="true" /> Face confirmed</p>
          ) : null}
          {phase.result.venueOutcome === 'within' ? (
            <p className="lx-confirmed">
              <MapPinCheck size={16} aria-hidden="true" />
              {phase.result.locationAccuracyMeters != null
                ? <>Location confirmed · accurate to {formatAccuracy(phase.result.locationAccuracyMeters)}</>
                : <>Location confirmed inside the venue</>}
            </p>
          ) : null}
          <InstallAppButton className="button button-secondary lx-install" label="Add LASUATOS to my phone" />
          {phase.keptSignedIn ? (
            <>
              <p className="lx-fine">You are now signed in on this phone. Next time you only scan.</p>
              <Link className="button button-secondary" href="/attendance">See my attendance</Link>
            </>
          ) : phase.signedInHere && phoneAccount !== 'student' ? (
            <p className="lx-fine">Done. You were signed in only for this check-in. Sign in on your own phone and next time you only scan.</p>
          ) : phase.signedInHere ? (
            <>
              <p className="lx-fine">Done, {phase.result.fullName.split(' ')[0]}. You were signed in only for this check-in: hand the phone back.</p>
              <button className="button button-secondary" type="button" onClick={startOver}>Back to the start</button>
            </>
          ) : (
            <>
              <Link className="button button-secondary" href="/attendance">See my attendance</Link>
              {phoneAccount === 'student' ? (
                <button
                  className="lx-link-button"
                  type="button"
                  onClick={() => {
                    switchMarking('sign-in');
                    setPhase({ kind: 'form', lecture: phase.lecture });
                  }}
                >
                  A classmate without their phone? Let them sign in here
                </button>
              ) : null}
            </>
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
      {faceRequest ? <FaceCapture poses={faceRequest.poses} title="Confirm it is you" review={false} onDone={finishFace} onCancel={cancelFace} /> : null}
    </section>
  );
}
