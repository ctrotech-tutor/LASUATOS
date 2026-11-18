'use client';

import {
  extractCheckInChallenge,
  readAttendanceScan,
  type CheckedInAttendanceResponse,
  type FaceFrame,
  type FacePose,
  type StudentOpenAttendanceSession,
} from '@lasuatos/contracts';
import {
  AlertTriangle,
  BookOpenCheck,
  Clock3,
  Keyboard,
  KeyRound,
  LoaderCircle,
  LogIn,
  MapPin,
  MapPinCheck,
  MapPinOff,
  QrCode,
  ScanFace,
  ScanLine,
  ShieldAlert,
  Smartphone,
  WifiOff,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { checkInToCourse, loadStudentOpenAttendanceSessions, type CheckInLocationInput } from '../../lib/attendance-api';
import { preloadFaceTracker } from '../../lib/face-tracker';
import { savePendingCheckIn, takePendingCheckIn, typedCodeOf } from '../../lib/check-in-device';
import { lookupSession } from '../../lib/current-account';
import { locationSettingsHelp, phonePlatform, requestLocationSample } from '../../lib/location';
import { staleResources } from '../../lib/resource';
import { haptic } from '../../lib/use-live';
import { roleLabel, workspaceAction, workspacePath, type AccountKind } from '../../lib/workspace';
import { Button } from '../ds';
import { FaceCapture } from '../face-capture';
import { CheckRow, PresentMark, StateView, Ticket, TicketSkeleton, type TicketClass } from '../scan/parts';
import { Viewfinder } from '../scan/viewfinder';
import { useClock } from '../take-attendance/hooks';
import { classLine, findClass, needsLocation, readProblem, venueNote, type CheckInProblem, type ProblemKind } from './model';
import '../scan/scan.css';
import './check-in.css';

type Who = { readonly fullName: string; readonly matricNumber: string };
type OpenClass = StudentOpenAttendanceSession;

type Phase =
  | { readonly kind: 'arriving' }
  | { readonly kind: 'sign_in' }
  | { readonly kind: 'wrong_account'; readonly accountType: Exclude<AccountKind, 'student'> }
  | { readonly kind: 'working'; readonly step: 'locating' | 'saving' | 'face'; readonly cls: OpenClass | null; readonly who: Who; readonly located: boolean | null; readonly waiting?: boolean }
  | { readonly kind: 'done'; readonly result: CheckedInAttendanceResponse; readonly cls: OpenClass | null; readonly who: Who }
  | { readonly kind: 'face_setup'; readonly courseCode: string; readonly courseTitle: string }
  | { readonly kind: 'failed'; readonly problem: CheckInProblem; readonly cls: OpenClass | null }
  | { readonly kind: 'scanning'; readonly back: Phase | null };

/** Longest wait for a position. The code lives 20 to 40 seconds, so this stays well inside it. */
const LOCATE_WAIT_MILLISECONDS = 8_000;
/** One good reading is enough after this long, if the phone does not report again. */
const LOCATE_SETTLE_MILLISECONDS = 1_200;

function acceptScan(text: string): string | null {
  return readAttendanceScan(text) ? text : null;
}

/** Already allowed: the position can be read while the account and class load, without a prompt. */
async function locationAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

function ticketOf(cls: OpenClass): TicketClass {
  return { courseCode: cls.courseCode, courseTitle: cls.courseTitle, endsAt: cls.endsAt };
}

const PROBLEM_ART: Record<ProblemKind, ReactNode> = {
  expired: <Clock3 size={30} />,
  closed: <Clock3 size={30} />,
  not_enrolled: <BookOpenCheck size={30} />,
  location: <MapPinOff size={30} />,
  outside: <MapPinOff size={30} />,
  removed: <ShieldAlert size={30} />,
  busy: <Clock3 size={30} />,
  offline: <WifiOff size={30} />,
  signed_out: <LogIn size={30} />,
  phone_full: <Smartphone size={30} />,
  password: <KeyRound size={30} />,
  other: <AlertTriangle size={30} />,
};

/**
 * Course check-in (/check-in): where a course's rotating QR code lands, straight from the phone's
 * camera app or from the Scan screen. The code comes in the URL fragment (never sent to the
 * server) and leaves the address bar at once, so it cannot be shared from there; it survives a
 * detour through sign-in in sessionStorage.
 *
 * It is one motion: the class appears as a ticket while the phone checks in, then the ticket is
 * stamped. Each step is done in parallel where it can be, because the code expires in seconds.
 */
export function CourseCheckIn() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'arriving' });
  const started = useRef(false);
  const screen = useRef<HTMLElement>(null);
  const now = useClock('fifteen');

  // The face check's camera, open while a check-in waits for its photos (ADR 033).
  const [faceRequest, setFaceRequest] = useState<{ readonly poses: readonly FacePose[] } | null>(null);
  const faceWaiter = useRef<((frames: FaceFrame[] | null) => void) | null>(null);
  const captureFace = useCallback((turn: 'left' | 'right') => new Promise<FaceFrame[] | null>((resolve) => {
    faceWaiter.current?.(null);
    faceWaiter.current = resolve;
    setFaceRequest({ poses: ['front', turn] });
  }), []);
  const finishFace = useCallback((frames: FaceFrame[] | null) => {
    const resolve = faceWaiter.current;
    faceWaiter.current = null;
    setFaceRequest(null);
    resolve?.(frames);
  }, []);
  const cancelFace = useCallback(() => finishFace(null), [finishFace]);

  const run = useCallback(async (challenge: string) => {
    setPhase({ kind: 'arriving' });
    // Kept until the account is known: a sign-in detour comes back here with it.
    savePendingCheckIn(challenge);
    // Read only, and sent only if this class is at a venue.
    const early = (await locationAllowed()) ? requestLocationSample({ maxWaitMilliseconds: LOCATE_WAIT_MILLISECONDS, settleMilliseconds: LOCATE_SETTLE_MILLISECONDS }) : null;
    const [session, open] = await Promise.all([
      lookupSession(),
      loadStudentOpenAttendanceSessions().then((result) => result.sessions).catch(() => null),
    ]);
    if (session.kind === 'signed_out') {
      // The sign-in page says why they are there and comes back here after; no pause on the way.
      setPhase({ kind: 'sign_in' });
      window.location.replace('/sign-in');
      return;
    }
    takePendingCheckIn();
    if (session.kind === 'unavailable') {
      setPhase({ kind: 'failed', problem: readProblem(new TypeError('unavailable'), null), cls: null });
      return;
    }
    if (session.account.accountType !== 'student') {
      setPhase({ kind: 'wrong_account', accountType: session.account.accountType });
      return;
    }

    const who: Who = { fullName: session.account.displayName, matricNumber: session.account.matricNumber };
    // A code typed on My attendance comes as `code:<code>`; the class is known once the server answers.
    const typedCode = typedCodeOf(challenge);
    const cls = typedCode ? null : findClass(challenge, open);
    const wantLocation = needsLocation(cls, open);
    let location: CheckInLocationInput | undefined;
    if (wantLocation) {
      setPhase({ kind: 'working', step: 'locating', cls, who, located: null });
      const sample = await (early ?? requestLocationSample({ maxWaitMilliseconds: LOCATE_WAIT_MILLISECONDS, settleMilliseconds: LOCATE_SETTLE_MILLISECONDS }));
      if (sample) location = sample;
    }
    const located = wantLocation ? Boolean(location) : null;
    setPhase({ kind: 'working', step: 'saving', cls, who, located });
    // The camera's live guide downloads while the first step runs.
    preloadFaceTracker();
    try {
      const outcome = await checkInToCourse(typedCode ? { code: typedCode } : { challenge }, location, {
        captureFace: async (face) => {
          setPhase({ kind: 'working', step: 'face', cls, who, located });
          const frames = await captureFace(face.turn);
          setPhase({ kind: 'working', step: 'face', cls, who, located });
          return frames;
        },
        onWaiting: () => setPhase({ kind: 'working', step: 'face', cls, who, located, waiting: true }),
      });
      if (outcome.kind === 'face_setup') {
        setPhase({ kind: 'face_setup', courseCode: outcome.session.courseCode, courseTitle: outcome.session.courseTitle });
        return;
      }
      if (outcome.kind === 'cancelled') {
        setPhase({ kind: 'failed', problem: { kind: 'other', title: 'Not marked yet', text: 'The camera closed before the face check. Scan the code again to finish.' }, cls });
        return;
      }
      haptic([16, 60, 24]);
      // My attendance shows the new mark when the student goes back to it.
      staleResources('student:');
      setPhase({ kind: 'done', result: outcome.result, cls, who });
    } catch (caught) {
      haptic(30);
      setPhase({ kind: 'failed', problem: readProblem(caught, cls?.venueName ?? null), cls });
    }
  }, [captureFace]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fromLink = window.location.hash.length > 1 ? extractCheckInChallenge(window.location.href) : null;
    if (window.location.hash || window.location.search) window.history.replaceState(null, '', '/check-in');
    const challenge = fromLink ?? takePendingCheckIn();
    // Deferred so the first render matches the server; the fragment is client-only.
    window.setTimeout(() => {
      if (challenge) void run(challenge);
      // Opened without a code: scanning lives on the Scan screen.
      else router.replace('/a');
    }, 0);
  }, [router, run]);

  const handleScan = useCallback((text: string) => {
    const scan = readAttendanceScan(text);
    if (!scan) return;
    if (scan.kind === 'course') void run(scan.challenge);
    else if (scan.kind === 'lecture') window.location.assign(`/a#${encodeURIComponent(scan.challenge)}`);
    else window.location.assign(`/a/${encodeURIComponent(scan.code)}`);
  }, [run]);

  const scanAgain = useCallback(() => setPhase((current) => ({ kind: 'scanning', back: current })), []);

  // Each new step names itself: focus moves to its title, as a native screen push does.
  const lastPhase = useRef(phase.kind);
  useEffect(() => {
    if (lastPhase.current === phase.kind) return;
    lastPhase.current = phase.kind;
    if (phase.kind === 'arriving' || phase.kind === 'working') return;
    const title = screen.current?.querySelector<HTMLElement>('h1');
    if (!title) return;
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }, [phase.kind]);

  const scanButton = (
    <Button variant="filled" size="lg" block onClick={scanAgain} icon={<ScanLine size={19} aria-hidden="true" />}>Scan again</Button>
  );

  return (
    <section className="sc ci" data-phase={phase.kind} ref={screen}>
      {phase.kind === 'arriving' ? <TicketSkeleton /> : null}

      {phase.kind === 'working' ? (
        <div className="sc-confirm" aria-busy="true">
          {phase.cls ? (
            <Ticket session={ticketOf(phase.cls)} line={classLine(phase.cls)} now={now} who={phase.who} />
          ) : (
            <h1 className="sc-large-title ci-working-title">One moment</h1>
          )}
          <section className="sc-checks" aria-labelledby="ci-steps-title">
            <h2 className="sc-section-title" id="ci-steps-title">Checking you in</h2>
            <ul className="sc-check-list">
              {phase.step === 'locating' || phase.located !== null ? (
                <CheckRow
                  icon={phase.step === 'locating' ? <MapPin size={18} /> : phase.located ? <MapPinCheck size={18} /> : <MapPinOff size={18} />}
                  tone={phase.step === 'locating' ? 'wait' : phase.located ? 'ok' : 'warn'}
                  title={phase.step === 'locating'
                    ? `Confirming you’re at ${phase.cls?.venueName ?? 'the venue'}`
                    : phase.located ? 'Location read' : 'No location reading'}
                  detail={phase.step === 'locating' ? 'If your phone asks to use your location, tap Allow.' : undefined}
                  live
                />
              ) : null}
              {phase.step === 'face' ? (
                <CheckRow
                  icon={<ScanFace size={18} />}
                  tone="wait"
                  title="Checking it’s you…"
                  detail={phase.waiting ? 'Lots of students are checking in. Keep this page open: it carries on by itself.' : 'Look at the camera, then turn your head when asked.'}
                  live
                />
              ) : (
                <CheckRow
                  icon={phase.step === 'saving' ? <LoaderCircle size={18} className="sc-spin" /> : <QrCode size={18} />}
                  tone={phase.step === 'saving' ? 'wait' : 'info'}
                  title={phase.step === 'saving' ? 'Marking you present…' : 'Then you’re marked present'}
                  detail={phase.step === 'saving' ? 'Keep this page open for a moment.' : undefined}
                  live={phase.step === 'saving'}
                />
              )}
            </ul>
          </section>
        </div>
      ) : null}

      {phase.kind === 'done' ? (() => {
        const { result, cls, who } = phase;
        const already = result.status === 'already_checked_in';
        const record = result.attendance;
        const note = venueNote(record.venueOutcome, record.venueName);
        return (
          <StateView
            art={<PresentMark />}
            tone="success"
            role="status"
            title={already ? 'Already marked present' : 'You’re marked present'}
            actions={(
              <>
                <Button variant="filled" size="lg" block href="/attendance">See my attendance</Button>
                <Button variant="plain" block href="/a" icon={<ScanLine size={16} aria-hidden="true" />}>Scan another class</Button>
              </>
            )}
          >
            <Ticket
              session={{ courseCode: record.courseCode, courseTitle: record.courseTitle, endsAt: cls?.endsAt ?? record.checkedInAt }}
              line={classLine(record)}
              now={now}
              who={who}
              titleAs="h2"
              stamp={{ at: record.checkedInAt }}
            />
            {note ? (
              <ul className="sc-proofs" aria-label="Checked">
                <li className={record.venueOutcome === 'within_boundary' ? undefined : 'is-quiet'}>
                  {record.venueOutcome === 'within_boundary' ? <MapPinCheck size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />} {note}
                </li>
              </ul>
            ) : null}
          </StateView>
        );
      })() : null}

      {phase.kind === 'failed' ? (() => {
        const { problem } = phase;
        // Phones get the exact settings path; elsewhere the text above already says it all.
        const platform = phonePlatform();
        const help = problem.kind === 'location' && platform !== 'other' ? locationSettingsHelp(platform, 'denied') : null;
        return (
          <StateView
            art={PROBLEM_ART[problem.kind]}
            tone={problem.kind === 'removed' ? 'danger' : 'warning'}
            title={problem.title}
            role="alert"
            actions={problem.kind === 'not_enrolled' ? (
              <>
                <Button variant="filled" size="lg" block href="/courses#join" icon={<BookOpenCheck size={19} aria-hidden="true" />}>Join the course</Button>
                <Button variant="gray" size="lg" block onClick={scanAgain} icon={<ScanLine size={18} aria-hidden="true" />}>Scan again</Button>
              </>
            ) : problem.kind === 'removed' ? (
              <Button variant="filled" size="lg" block href="/attendance">Open My attendance</Button>
            ) : problem.kind === 'closed' ? (
              <>
                <Button variant="filled" size="lg" block href="/attendance">Open My attendance</Button>
                <Button variant="gray" size="lg" block onClick={scanAgain} icon={<ScanLine size={18} aria-hidden="true" />}>Scan a different code</Button>
              </>
            ) : problem.kind === 'password' ? (
              <Button variant="filled" size="lg" block href="/account/setup" icon={<KeyRound size={19} aria-hidden="true" />}>Choose my password</Button>
            ) : problem.kind === 'phone_full' ? (
              <Button variant="filled" size="lg" block href="/attendance">Open My attendance</Button>
            ) : problem.kind === 'signed_out' ? (
              <Button variant="filled" size="lg" block href="/sign-in" icon={<LogIn size={19} aria-hidden="true" />}>Sign in</Button>
            ) : (
              <>
                {scanButton}
                <Button variant="gray" size="lg" block href="/a" icon={<Keyboard size={18} aria-hidden="true" />}>Type the code</Button>
              </>
            )}
          >
            {phase.cls ? <p className="ci-class">{phase.cls.courseCode} · {phase.cls.courseTitle}</p> : null}
            <p className="sc-state-text">{problem.text}</p>
            {help ? <p className="ci-help">{help}</p> : null}
          </StateView>
        );
      })() : null}

      {phase.kind === 'scanning' ? (
        <div className="ci-scan">
          <header className="sc-start-head">
            <h1 className="sc-large-title">Scan the code</h1>
            <p className="ci-scan-hint">It changes every 20 seconds, so point at the one showing now.</p>
          </header>
          <Viewfinder accept={acceptScan} onDetected={handleScan} autoStart />
          <div className="sc-links">
            <Button variant="plain" size="sm" href="/a" icon={<Keyboard size={16} aria-hidden="true" />}>Type the code instead</Button>
            {phase.back ? (
              <Button variant="plain" size="sm" onClick={() => setPhase(phase.back ?? { kind: 'arriving' })}>Cancel</Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase.kind === 'sign_in' ? (
        <StateView
          art={<LogIn size={30} />}
          tone="tint"
          title="Sign in to finish"
          role="status"
          actions={<Button variant="filled" size="lg" block href="/sign-in" icon={<LogIn size={19} aria-hidden="true" />}>Sign in</Button>}
        >
          <p className="sc-state-text">Taking you to sign-in. You come straight back here afterwards.</p>
        </StateView>
      ) : null}

      {phase.kind === 'face_setup' ? (
        <StateView
          art={<ScanFace size={30} />}
          tone="tint"
          title="Register your face first"
          role="status"
          actions={(
            <>
              <Button variant="filled" size="lg" block href={`/account/setup?next=${encodeURIComponent('/a')}`} icon={<ScanFace size={19} aria-hidden="true" />}>Register my face</Button>
              <Button variant="plain" block onClick={scanAgain} icon={<ScanLine size={16} aria-hidden="true" />}>Scan again</Button>
            </>
          )}
        >
          <p className="ci-class">{phase.courseCode} · {phase.courseTitle}</p>
          <p className="sc-state-text">Attendance checks it is really you with a quick look at the camera. Register your face once (about 30 seconds), then scan the code again.</p>
        </StateView>
      ) : null}

      {phase.kind === 'wrong_account' ? (
        // Not an error: staff often scan their own code to try it.
        <StateView
          art={<QrCode size={30} />}
          tone="tint"
          title="This is a student code"
          actions={(
            <>
              <Button variant="filled" size="lg" block href={workspacePath(phase.accountType)}>{workspaceAction(phase.accountType)}</Button>
              <Button variant="plain" block href="/">Back to LASUATOS</Button>
            </>
          )}
        >
          <p className="sc-state-text">
            You’re signed in as {phase.accountType === 'administrator' ? 'an' : 'a'} {roleLabel(phase.accountType).toLowerCase()}. Students scan this code with their own phones to mark themselves
            {phase.accountType === 'lecturer' ? ', and each one appears on your live list.' : '.'}
          </p>
        </StateView>
      ) : null}
      {faceRequest ? <FaceCapture poses={faceRequest.poses} title="Confirm it’s you" review={false} onDone={finishFace} onCancel={cancelFace} /> : null}
    </section>
  );
}
