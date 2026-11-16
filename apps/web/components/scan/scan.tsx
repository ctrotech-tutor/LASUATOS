'use client';

import {
  readAttendanceScan,
  type CheckInLocationSample,
  type FaceFrame,
  type FacePose,
  type LectureCheckInResult,
  type LectureHelpRequestStatus,
  type ResolvedLecture,
} from '@lasuatos/contracts';
import { formatAccuracy, type CombinedFix } from '@lasuatos/verification/venue-area';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Keyboard,
  LocateFixed,
  MapPin,
  MapPinCheck,
  MapPinOff,
  Navigation,
  RotateCcw,
  ScanFace,
  ScanLine,
  ShieldCheck,
  UserRoundPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { firstName, forgetSession, lookupSession, useCurrentAccount } from '../../lib/current-account';
import { roleLabel, workspaceAction, workspacePath } from '../../lib/workspace';
import {
  failureText,
  forgetOldGuestDetails,
  LectureRequestError,
  loadLectureHelpStatus,
  requestLectureHelp,
  resolveLecture,
  submitLectureCheckIn,
} from '../../lib/lecture-api';
import { locationSettingsHelp, phonePlatform, toCheckInLocation, useLiveLocation, type LocationStatus } from '../../lib/location';
import { previewPresence, venueAreaFromGuide } from '../../lib/venue-presence';
import { haptic } from '../../lib/use-live';
import { preloadFaceTracker } from '../../lib/face-tracker';
import { useClock } from '../take-attendance/hooks';
import { describeLocation } from '../location-check';
import { PasswordField } from '../password-field';
import { InstallAppButton } from '../install-app';
import { FaceCapture } from '../face-capture';
import { SwitchField } from '../ui/switch';
import { Button, buttonClassName } from '../ds';
import { HelpOffer, HelpWait } from './help';
import { cleanCode, faceSetupHref, looksLikeLink, readTypedCode, type ScanSource } from './model';
import { CheckRow, PresentMark, StateView, Ticket, TicketSkeleton, type CheckTone } from './parts';
import { Viewfinder } from './viewfinder';
import './scan.css';

type Phase =
  | { readonly kind: 'start' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'form'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'locating'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'saving'; readonly lecture: ResolvedLecture }
  | { readonly kind: 'done'; readonly result: LectureCheckInResult; readonly signedInHere: boolean; readonly keptSignedIn: boolean; readonly lecture: ResolvedLecture }
  | { readonly kind: 'help'; readonly lecture: ResolvedLecture; readonly status: LectureHelpRequestStatus }
  | { readonly kind: 'failed'; readonly message: string };

function acceptScan(text: string): string | null {
  return readAttendanceScan(text) ? text : null;
}

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

/** Face-check failures (on this phone, for this class) before asking the session taker is offered. */
const FAILURES_BEFORE_HELP = 2;

/** Longest the button waits for a usable position after it is tapped. */
const MAX_LOCATE_WAIT_MILLISECONDS = 15_000;

/**
 * Who is signed in on this phone, as far as the check-in is concerned. A staff
 * account cannot be marked present, so it is treated like no account.
 */
type PhoneAccount = 'student' | 'staff' | 'none';

/** Whose attendance the form marks: the phone's student, or someone signing in here. */
type Marking = 'me' | 'sign-in';

const LOCATION_ICONS: Record<'ok' | 'wait' | 'warn' | 'bad', typeof CheckCircle2> = {
  ok: CheckCircle2,
  wait: LocateFixed,
  warn: Navigation,
  bad: AlertTriangle,
};

/**
 * The Scan screen (/a and /a/[code]): scan the class QR code (or type its code), confirm the
 * class on a ticket, and be marked present. Students mark only themselves, with their own
 * account: the one signed in on the phone, or (for a classmate without their phone) by signing
 * in just for this check-in, which leaves the phone's own sign-in alone and keeps nothing of
 * theirs.
 */
export function ScanScreen({ initialCode }: Readonly<{ initialCode?: string }>) {
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  // Who this phone is signed in as (undefined while loading, null when signed out): for the notes on the start screen.
  const phoneOwner = useCurrentAccount();
  const now = useClock('fifteen');
  const [source, setSource] = useState<ScanSource | null>(null);
  // Set by "Scan again": open the camera at once rather than waiting for a tap.
  const [cameraNow, setCameraNow] = useState(false);
  const [typedCode, setTypedCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [formError, setFormError] = useState('');
  const [phoneAccount, setPhoneAccount] = useState<PhoneAccount>('none');
  const [marking, setMarking] = useState<Marking>('me');
  const [identifier, setIdentifier] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  // Face checks that failed for the phone's own student in this class; two or more offer the help request.
  const [faceFailures, setFaceFailures] = useState(0);
  const [askingHelp, setAskingHelp] = useState(false);
  const started = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLElement>(null);
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
  // settled by the time the student has confirmed or typed their details.
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
      const at = Date.now();
      const status = statusRef.current;
      if (status === 'denied' || status === 'unsupported') return null;
      const fix = fixRef.current;
      const sinceTap = at - tappedAt;
      if (fix) {
        const preview = previewPresence(lectureArea, fix, at);
        // GPS keeps sharpening for the first seconds; give it a moment unless the fix is already good.
        const trackedFor = at - (trackingSinceRef.current ?? tappedAt);
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
      // A face that did not pass (403 mismatch, 422 photo problem, 429 too many tries) for the phone's own student.
      if (face && !signIn && caught instanceof LectureRequestError && [403, 422, 429].includes(caught.status)) {
        setFaceFailures((count) => (caught.status === 429 ? Math.max(count + 1, FAILURES_BEFORE_HELP) : count + 1));
      }
      // Expired page or closed session: start over. Anything else: let them fix the form.
      if (caught && typeof caught === 'object' && 'status' in caught && (caught.status === 410 || caught.status === 404)) {
        setPhase({ kind: 'failed', message });
      } else {
        haptic(30);
        setPhase({ kind: 'form', lecture });
        setFormError(message);
      }
    }
  }, [captureFace, keepSignedIn, phoneAccount, waitForFix]);

  /** Sends the help request, with the position when this class checks the venue (the taker sees it). */
  const askForHelp = useCallback(async (lecture: ResolvedLecture) => {
    setAskingHelp(true);
    setFormError('');
    try {
      let location: CheckInLocationSample | undefined;
      if (lecture.session.requireVenue) {
        const fix = fixRef.current ?? await waitForFix(lecture);
        if (fix) location = toCheckInLocation(fix);
      }
      const status = await requestLectureHelp({ ticket: lecture.ticket, ...(location ? { location } : {}) });
      haptic(18);
      setPhase({ kind: 'help', lecture, status });
    } catch (caught) {
      if (caught instanceof LectureRequestError && caught.status === 410) {
        setPhase({ kind: 'failed', message: caught.message });
      } else {
        setFormError(failureText(caught, 'Your request was not sent. Try again.'));
      }
    } finally {
      setAskingHelp(false);
    }
  }, [fixRef, waitForFix]);

  const open = useCallback(async (input: ScanSource) => {
    setCodeError('');
    setCameraNow(false);
    setSource(input);
    setPhase({ kind: 'opening' });
    try {
      const [lecture, session] = await Promise.all([resolveLecture(input), lookupSession()]);
      const account: PhoneAccount = lecture.student
        ? 'student'
        : session.kind === 'signed_in' ? 'staff' : 'none';
      setPhoneAccount(account);
      setMarking(account === 'student' ? 'me' : 'sign-in');
      setFormError('');
      setFaceFailures(0);
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
      // Came back after asking the session taker for help (reloaded or scanned again): show the request.
      if (lecture.student && lecture.face.required) {
        const pending = await loadLectureHelpStatus(lecture.session.id).catch(() => null);
        if (pending?.status === 'pending') {
          setPhase({ kind: 'help', lecture, status: pending });
          return;
        }
      }
      setPhase({ kind: 'form', lecture });
    } catch (caught) {
      haptic(30);
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
    let start: ScanSource | null = initialCode ? { code: initialCode, scanned: true } : null;
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
    const typed = readTypedCode(typedCode);
    if (typed.kind === 'invalid') {
      setCodeError(typed.message);
      codeInput.current?.focus();
      return;
    }
    if (typed.kind === 'course') {
      window.location.assign(`/check-in#${typed.challenge}`);
      return;
    }
    void open(typed.source);
  }

  function changeCode(value: string) {
    setCodeError('');
    // A pasted check-in link opens straight away; otherwise keep letters and numbers only.
    if (looksLikeLink(value)) {
      const typed = readTypedCode(value);
      if (typed.kind === 'lecture') {
        setTypedCode('');
        void open(typed.source);
        return;
      }
      if (typed.kind === 'course') {
        window.location.assign(`/check-in#${typed.challenge}`);
        return;
      }
    }
    setTypedCode(cleanCode(value));
  }

  // The phone's own student has no registered face yet: send them to register it first.
  const needsFaceSetup = activeLecture !== null && marking === 'me' && activeLecture.face.required && activeLecture.face.registered === false;
  // A face check is coming: fetch the camera's live guide while the student confirms the details.
  const faceCheckAhead = activeLecture !== null && activeLecture.face.required && !needsFaceSetup;
  useEffect(() => {
    if (faceCheckAhead) preloadFaceTracker();
  }, [faceCheckAhead]);

  // Each new step names itself: focus moves to its title, as a native screen push does, so a
  // screen reader hears the class, the result or the problem first.
  const lastPhase = useRef(phase.kind);
  useEffect(() => {
    if (lastPhase.current === phase.kind) return;
    lastPhase.current = phase.kind;
    if (phase.kind === 'start' || phase.kind === 'opening' || phase.kind === 'locating' || phase.kind === 'saving') return;
    const title = screen.current?.querySelector<HTMLElement>('h1');
    if (!title) return;
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }, [phase.kind]);

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

  const startOver = (withCamera = false) => {
    setPhase({ kind: 'start' });
    setTypedCode('');
    setCodeError('');
    setSource(null);
    setCameraNow(withCamera);
    // A poster's address (/a/K7M29QXD) would reopen the same class on reload: back to the scanner.
    if (window.location.pathname !== '/a') window.history.replaceState(null, '', '/a');
    window.scrollTo({ top: 0 });
  };

  const typeInstead = () => {
    startOver(false);
    window.setTimeout(() => codeInput.current?.focus(), 0);
  };

  return (
    <section className="sc" data-phase={phase.kind} ref={screen}>
      {phase.kind === 'start' ? (
        <div className="sc-start">
          <header className="sc-start-head">
            <h1 className="sc-large-title">Mark attendance</h1>
          </header>
          <Viewfinder accept={acceptScan} onDetected={handleScan} autoStart={cameraNow} />
          <div className="sc-start-side">
            <form className="sc-code" onSubmit={submitCode} noValidate>
              <label className="sc-code-label" htmlFor="sc-code-input">
                <Keyboard size={16} aria-hidden="true" /> Or type the code
              </label>
              <div className={`sc-code-field${codeError ? ' is-invalid' : ''}`}>
                <input
                  ref={codeInput}
                  id="sc-code-input"
                  className="sc-code-input"
                  value={typedCode}
                  onChange={(event) => changeCode(event.target.value)}
                  placeholder="K7M29Q"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  inputMode="text"
                  aria-invalid={codeError ? true : undefined}
                  aria-describedby="sc-code-hint"
                />
                <button
                  className={`sc-code-go${typedCode.length >= 6 ? ' is-ready' : ''}`}
                  type="submit"
                  aria-label="Open the class"
                >
                  <ArrowRight size={20} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </div>
              <p className={`sc-code-hint${codeError ? ' is-error' : ''}`} id="sc-code-hint" role={codeError ? 'alert' : undefined}>
                {codeError || 'It’s under the QR code: 6 characters on the screen, 8 on a poster.'}
              </p>
            </form>

            {phoneOwner && phoneOwner.accountType !== 'student' ? (
              // A lecturer's or administrator's phone: the page still works for a student who has no phone with them.
              <div className="sc-note">
                <ShieldCheck size={20} aria-hidden="true" />
                <div>
                  <strong>Signed in as {phoneOwner.accountType === 'administrator' ? 'an' : 'a'} {roleLabel(phoneOwner.accountType).toLowerCase()}</strong>
                  <span>A student without their phone can mark themselves here. They sign in just for this check-in; your sign-in stays as it is.</span>
                  <Link href={workspacePath(phoneOwner.accountType)}>{workspaceAction(phoneOwner.accountType)}</Link>
                </div>
              </div>
            ) : phoneOwner === null ? (
              <p className="sc-footnote">
                Sign in on your own phone once and next time you only scan. <Link href="/sign-in?next=/a">Sign in</Link>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase.kind === 'opening' ? <TicketSkeleton /> : null}

      {phase.kind === 'form' || phase.kind === 'locating' || phase.kind === 'saving' ? (() => {
        const { lecture } = phase;
        const { session } = lecture;
        const venueName = session.venueName ?? 'the venue';
        const markingMe = marking === 'me' && lecture.student !== null;
        const busy = phase.kind !== 'form';
        const location = session.requireVenue ? describeLocation(live, presence, venueName, live.updatedAt) : null;
        const locationTone: CheckTone = location ? location.tone : 'info';
        const LocationIcon = live.status === 'denied' || live.status === 'unsupported'
          ? MapPinOff
          : location ? LOCATION_ICONS[location.tone] : MapPin;
        const showChecks = session.requireVenue || lecture.face.required;
        return (
          <form className="sc-confirm" onSubmit={(event) => submitForm(event, lecture)} noValidate>
            <Ticket session={session} now={now} who={markingMe ? lecture.student : null} />

            {markingMe ? null : (
              <fieldset className="sc-signin" disabled={busy}>
                <legend className="sc-section-title">
                  {phoneAccount === 'student' ? 'Classmate, sign in to mark yourself' : 'Sign in to be marked'}
                </legend>
                <p className="sc-signin-intro">
                  {phoneAccount === 'student'
                    ? 'Only for this check-in. The phone stays signed in as its owner and nothing of yours is kept on it.'
                    : phoneAccount === 'staff'
                      ? 'This phone has a staff account. Sign in with your student account; the phone stays as it is.'
                      : 'Use your student account. Each student marks only themselves.'}
                </p>
                <div className="account-field">
                  <label htmlFor="sc-identifier">Email or matric number</label>
                  <input
                    id="sc-identifier"
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
                </div>
                <PasswordField label="Password" name="password" autoComplete="current-password" />
                {phoneAccount === 'none' ? (
                  <SwitchField
                    checked={keepSignedIn}
                    onCheckedChange={setKeepSignedIn}
                    label="Keep me signed in on this phone"
                    hint="Only on your own phone. Next time you just scan."
                  />
                ) : null}
                <p className="sc-footnote">
                  No account yet? <Link href="/sign-up">Open yours</Link> with your matric number, then scan again. <Link href="/forgot-password">Forgot password?</Link>
                </p>
              </fieldset>
            )}

            {showChecks ? (
              <section className="sc-checks" aria-labelledby="sc-checks-title">
                <h2 className="sc-section-title" id="sc-checks-title">Before you’re marked</h2>
                <ul className="sc-check-list">
                  {lecture.face.required ? (
                    needsFaceSetup ? (
                      <CheckRow
                        icon={<ScanFace size={19} />}
                        tone="warn"
                        title="Register your face first"
                        detail="Attendance checks it is really you. It takes about 30 seconds."
                      />
                    ) : (
                      <CheckRow
                        icon={<ScanFace size={19} />}
                        tone="info"
                        title="Face check"
                        detail={markingMe
                          ? `Look at the camera, then turn your head to your ${lecture.face.turn}.`
                          : `After signing in: look at the camera, then turn to your ${lecture.face.turn}.`}
                      />
                    )
                  ) : null}
                  {location ? (
                    <CheckRow
                      icon={<LocationIcon size={19} />}
                      tone={locationTone}
                      title={location.title}
                      detail={location.detail}
                      live
                      action={live.status === 'denied' || live.status === 'unavailable' ? (
                        <Button variant="gray" size="sm" onClick={live.restart} icon={<RotateCcw size={15} aria-hidden="true" />}>Retry</Button>
                      ) : null}
                    />
                  ) : null}
                </ul>
              </section>
            ) : null}

            {formError ? (
              <p className="sc-alert" role="alert"><AlertTriangle size={18} aria-hidden="true" /> <span>{formError}</span></p>
            ) : null}
            {markingMe && lecture.face.required && !needsFaceSetup && faceFailures >= FAILURES_BEFORE_HELP ? (
              <HelpOffer lecture={lecture} busy={askingHelp} onAsk={() => void askForHelp(lecture)} />
            ) : null}

            <div className="sc-confirm-actions">
              {needsFaceSetup ? (
                <Button variant="filled" size="lg" block href={faceSetupHref(source)} icon={<ScanFace size={19} aria-hidden="true" />}>
                  Register my face
                </Button>
              ) : (
                <Button variant="filled" size="lg" block type="submit" busy={busy} disabled={busy || askingHelp}>
                  {phase.kind === 'locating'
                    ? 'Confirming your location…'
                    : phase.kind === 'saving'
                      ? (lecture.face.required ? 'Checking it’s you…' : 'Marking you present…')
                      : markingMe ? 'Mark me present' : 'Sign in and mark me present'}
                </Button>
              )}
              <div className="sc-links">
                {phoneAccount === 'student' ? (
                  markingMe ? (
                    <Button variant="plain" size="sm" onClick={() => switchMarking('sign-in')} disabled={busy} icon={<UserRoundPlus size={16} aria-hidden="true" />}>
                      Mark a classmate instead
                    </Button>
                  ) : (
                    <Button variant="plain" size="sm" onClick={() => switchMarking('me')} disabled={busy}>
                      Back to marking {lecture.student ? firstName(lecture.student.fullName) : 'me'}
                    </Button>
                  )
                ) : null}
                <Button variant="plain" size="sm" onClick={() => startOver(true)} disabled={busy} icon={<ScanLine size={16} aria-hidden="true" />}>
                  Not this class? Scan again
                </Button>
              </div>
            </div>
            <p className="sc-footnote sc-privacy">
              Your name and matric number go to {session.takenBy}, who is taking attendance. A phone can mark its owner and one classmate per class. <Link href="/privacy">Privacy</Link>
            </p>
          </form>
        );
      })() : null}

      {phase.kind === 'done' ? (() => {
        const { result, lecture } = phase;
        const already = result.status === 'already_checked_in';
        const who = { fullName: result.fullName, matricNumber: result.matricNumber };
        const name = firstName(result.fullName);
        const proofs: { key: string; icon: typeof ScanFace; text: string }[] = [];
        if (result.faceScore != null) proofs.push({ key: 'face', icon: ScanFace, text: 'Face confirmed' });
        if (result.venueOutcome === 'within') {
          proofs.push({
            key: 'venue',
            icon: MapPinCheck,
            text: result.locationAccuracyMeters != null
              ? `In ${lecture.session.venueName ?? 'the venue'} · ±${formatAccuracy(result.locationAccuracyMeters)}`
              : `In ${lecture.session.venueName ?? 'the venue'}`,
          });
        }
        const markClassmate = () => {
          switchMarking('sign-in');
          setPhase({ kind: 'form', lecture });
          window.scrollTo({ top: 0 });
        };
        return (
          <StateView
            art={<PresentMark />}
            tone="success"
            role="status"
            title={already ? 'Already marked present' : phase.signedInHere ? `Done, ${name}` : 'You’re marked present'}
            actions={phase.keptSignedIn ? (
              <>
                <Button variant="filled" size="lg" block href="/attendance">See my attendance</Button>
                <InstallAppButton className={buttonClassName({ variant: 'gray', size: 'lg', block: true })} label="Add LASUATOS to my phone" />
              </>
            ) : phase.signedInHere && phoneAccount === 'student' ? (
              <Button variant="filled" size="lg" block onClick={() => startOver(false)}>Done, hand the phone back</Button>
            ) : phase.signedInHere ? (
              <Button variant="gray" size="lg" block onClick={() => startOver(false)}>Back to the start</Button>
            ) : (
              <>
                <Button variant="filled" size="lg" block href="/attendance">See my attendance</Button>
                {phoneAccount === 'student' ? (
                  <Button variant="gray" size="lg" block onClick={markClassmate} icon={<UserRoundPlus size={18} aria-hidden="true" />}>Mark a classmate</Button>
                ) : null}
                <InstallAppButton className={buttonClassName({ variant: 'plain', block: true })} label="Add LASUATOS to my phone" />
              </>
            )}
          >
            <Ticket session={lecture.session} now={now} who={who} titleAs="h2" stamp={{ at: result.checkedInAt }} />
            {proofs.length ? (
              <ul className="sc-proofs" aria-label="Checked">
                {proofs.map(({ key, icon: Icon, text }) => (
                  <li key={key}><Icon size={16} aria-hidden="true" /> {text}</li>
                ))}
              </ul>
            ) : null}
            {phase.keptSignedIn ? (
              <p className="sc-footnote">You’re now signed in on this phone. Next time you only scan.</p>
            ) : phase.signedInHere && phoneAccount === 'student' ? (
              <p className="sc-footnote">You were signed in only for this check-in. Nothing of yours stays on this phone.</p>
            ) : phase.signedInHere ? (
              <p className="sc-footnote">You were signed in only for this check-in. Sign in on your own phone and next time you only scan.</p>
            ) : null}
          </StateView>
        );
      })() : null}

      {phase.kind === 'help' ? (
        <HelpWait
          lecture={phase.lecture}
          initial={phase.status}
          now={now}
          onTryAgain={() => {
            setFormError('');
            setPhase({ kind: 'form', lecture: phase.lecture });
          }}
        />
      ) : null}

      {phase.kind === 'failed' ? (
        <StateView
          art={<AlertTriangle size={30} />}
          tone="warning"
          title="Not marked yet"
          role="alert"
          actions={(
            <>
              <Button variant="filled" size="lg" block onClick={() => startOver(true)} icon={<ScanLine size={19} aria-hidden="true" />}>Scan again</Button>
              <Button variant="gray" size="lg" block onClick={typeInstead} icon={<Keyboard size={18} aria-hidden="true" />}>Type the code</Button>
            </>
          )}
        >
          <p className="sc-state-text">{phase.message}</p>
        </StateView>
      ) : null}

      {faceRequest ? <FaceCapture poses={faceRequest.poses} title="Confirm it’s you" review={false} onDone={finishFace} onCancel={cancelFace} /> : null}
    </section>
  );
}
