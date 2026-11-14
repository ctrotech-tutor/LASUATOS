'use client';

import {
  LASU_STUDENT_EMAIL_DOMAIN,
  isLasuMatricNumber,
  isLasuStudentEmail,
  normalizeMatricNumber,
  type ClassListLookupResult,
  type FaceFrame,
  type StudentSetup,
} from '@lasuatos/contracts';
import { ArrowRight, BadgeCheck, Check, Copy, KeyRound, Mail, ScanFace, ShieldCheck, UserRoundSearch } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { hasPendingCheckIn } from '../lib/check-in-device';
import { announceAccountChanged } from '../lib/current-account';
import { failureText } from '../lib/lecture-api';
import {
  loadStudentSetup,
  lookupMatric,
  openAccount,
  registerFace,
  requestAccountEmailCode,
  requestOpeningCode,
  verifyAccountEmail,
} from '../lib/student-api';
import { nextPathFromLocation } from './account-forms';
import { FaceCapture } from './face-capture';
import { useFeedback } from './feedback';
import { AccountPanelSkeleton } from './ui/skeleton';

/**
 * Opening a student account from the class list.
 *
 * The HOC has already put every student's name (and usually their LASU email)
 * on the class list, so a student types only their matric number:
 *   1. matric number → "ODEJOBI A. O., Mechanical Engineering, 200 Level: is this you?"
 *   2. a 6-digit code to their LASU email (…@st.lasu.edu.ng) proves it is them;
 *   3. the account opens, signed in, with the LASU-style starting password
 *      (LASU + matric + SURNAME), shown once;
 *   4. they register their face (three photos), used to confirm it is them at check-in.
 */

const FACE_POSES = ['front', 'left', 'right'] as const;

function continuePath(): string {
  return nextPathFromLocation() ?? (hasPendingCheckIn() ? '/check-in' : '/attendance');
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

function Steps({ current }: Readonly<{ current: 0 | 1 | 2 | 3 }>) {
  const labels = ['Matric', 'Email', 'Password', 'Face'];
  return (
    <ol className="ob-steps" aria-label="Steps">
      {labels.map((label, index) => (
        <li key={label} className={index < current ? 'is-done' : index === current ? 'is-current' : ''} aria-current={index === current ? 'step' : undefined}>
          <span aria-hidden="true">{index < current ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
          <em>{label}</em>
        </li>
      ))}
    </ol>
  );
}

function Panel({ kicker, title, intro, children, step }: Readonly<{ kicker: string; title: string; intro?: ReactNode; children: ReactNode; step?: 0 | 1 | 2 | 3 }>) {
  return (
    <section className="account-panel ob-panel" aria-labelledby="ob-heading">
      {step !== undefined ? <Steps current={step} /> : null}
      <div className="account-panel-heading">
        <p className="section-kicker">{kicker}</p>
        <h2 id="ob-heading">{title}</h2>
        {intro ? <p>{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Ticks once a second while `until` is in the future; returns the seconds left. */
function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [until]);
  return now === 0 ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/** The six-digit code field and its resend link, shared by opening an account and confirming an older one. */
function CodeForm({
  sentTo,
  resendAt,
  busy,
  error,
  onSubmit,
  onResend,
  onChangeEmail,
  submitLabel,
}: Readonly<{
  sentTo: string;
  /** When a new code may be asked for (epoch milliseconds). */
  resendAt: number;
  busy: boolean;
  error: string;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onChangeEmail?: (() => void) | undefined;
  submitLabel: string;
}>) {
  const [code, setCode] = useState('');
  const left = useSecondsLeft(resendAt);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = code.replace(/\D/g, '');
    if (digits.length === 6) onSubmit(digits);
  }

  return (
    <form className="account-form" onSubmit={submit} noValidate>
      <p className="ob-sent"><Mail size={18} aria-hidden="true" /><span>We sent a 6-digit code to <strong>{sentTo}</strong>. Open your LASU email (Gmail) to find it. Check Spam too.</span></p>
      <label className="account-field">
        <span>6-digit code</span>
        <input
          className="ob-code-input"
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          aria-describedby="ob-code-help"
          required
        />
        <small id="ob-code-help">The code works for 15 minutes.</small>
      </label>
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      <button className="account-primary-button" type="submit" disabled={busy || code.length !== 6}>
        {busy ? 'Checking…' : submitLabel}
      </button>
      <p className="account-inline-link ob-resend">
        {left > 0 ? <span>Send a new code in {left}s</span> : <button className="lx-link-button" type="button" onClick={onResend} disabled={busy}>Send a new code</button>}
        {onChangeEmail ? <button className="lx-link-button" type="button" onClick={onChangeEmail} disabled={busy}>Use a different email</button> : null}
      </p>
    </form>
  );
}

/**
 * The address a student meant: most type only the part before the @, so the
 * LASU student domain is added when there is no @ (or nothing after it).
 */
function lasuEmailFrom(value: string): string {
  const typed = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!typed) return '';
  if (!typed.includes('@')) return `${typed}@${LASU_STUDENT_EMAIL_DOMAIN}`;
  if (typed.endsWith('@')) return `${typed}${LASU_STUDENT_EMAIL_DOMAIN}`;
  return typed;
}

function EmailField({ value, onChange }: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const showSuffix = !value.includes('@');
  return (
    <label className="account-field">
      <span>Your LASU student email</span>
      <span className={`ob-email-input${showSuffix ? ' has-suffix' : ''}`}>
        <input
          name="email"
          type="email"
          inputMode="email"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={320}
          placeholder="yourname"
          required
        />
        {showSuffix ? <span className="ob-email-suffix" aria-hidden="true">@{LASU_STUDENT_EMAIL_DOMAIN}</span> : null}
      </span>
      <small>The Google account LASU gave you. Type the part before the @ or the full address.</small>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Face registration (shared)                                           */
/* ------------------------------------------------------------------ */

export function FaceRegistration({ onRegistered, onSkip }: Readonly<{ onRegistered: () => void; onSkip?: () => void }>) {
  const [consent, setConsent] = useState(false);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cancel = useCallback(() => setCamera(false), []);
  const captured = useCallback(async (frames: FaceFrame[]) => {
    setCamera(false);
    setBusy(true);
    setError('');
    try {
      await registerFace(frames);
      onRegistered();
    } catch (caught) {
      setError(failureText(caught, 'Your face could not be registered. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [onRegistered]);

  return (
    <div className="account-form">
      <div className="ob-face-card">
        <span className="ob-face-mark" aria-hidden="true"><ScanFace size={30} /></span>
        <ul className="ob-face-points">
          <li><strong>Three quick photos:</strong> looking straight, then your head turned left and right. About 20 seconds.</li>
          <li><strong>Why:</strong> at each class you look at the camera for a second, and LASUATOS checks it is really you marking your attendance, so no one can mark it for you.</li>
          <li><strong>What is kept:</strong> face measurements (numbers, not pictures) and one small photo of you facing the camera. Your HOC and administrators can see the photo on the class list.</li>
          <li><strong>Your choice:</strong> an administrator can delete your face on request; it is also deleted with your account.</li>
        </ul>
      </div>
      <label className="lx-check ob-consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>I agree to LASUATOS keeping my face measurements and photo to confirm it is me at check-in.<small>See the <Link href="/privacy">privacy notice</Link>.</small></span>
      </label>
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      <button className="account-primary-button" type="button" disabled={!consent || busy} onClick={() => { setError(''); setCamera(true); }}>
        {busy ? 'Checking your photos…' : error ? 'Try again' : 'Open the camera'}
      </button>
      {onSkip ? <button className="lx-link-button" type="button" onClick={onSkip} disabled={busy}>Do it later (you need it before your next check-in)</button> : null}
      {camera ? <FaceCapture poses={FACE_POSES} title="Register your face" review onDone={(frames) => void captured(frames)} onCancel={cancel} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Opening an account                                                   */
/* ------------------------------------------------------------------ */

type Phase =
  | { readonly kind: 'matric' }
  | { readonly kind: 'found'; readonly found: Extract<ClassListLookupResult, { status: 'found' }> }
  | { readonly kind: 'not_found'; readonly matricNumber: string }
  | { readonly kind: 'code'; readonly found: Extract<ClassListLookupResult, { status: 'found' }>; readonly sentTo: string; readonly resendInSeconds: number; readonly typedEmail: string | null; readonly sentAt: number }
  | { readonly kind: 'password'; readonly password: string; readonly firstName: string }
  | { readonly kind: 'face' }
  | { readonly kind: 'done'; readonly firstName: string };

export function StudentOnboarding() {
  const feedback = useFeedback();
  const [phase, setPhase] = useState<Phase>({ kind: 'matric' });
  const [matric, setMatric] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const typed = normalizeMatricNumber(matric);
    if (!isLasuMatricNumber(typed)) {
      setError('Enter your 9-digit matric number, e.g. 250211184.');
      return;
    }
    setBusy(true);
    try {
      const result = await lookupMatric(typed);
      setPhase(result.status === 'found' ? { kind: 'found', found: result } : { kind: 'not_found', matricNumber: result.matricNumber });
    } catch (caught) {
      setError(failureText(caught, 'That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(found: Extract<ClassListLookupResult, { status: 'found' }>) {
    setError('');
    const typedEmail = found.emailOnList ? null : lasuEmailFrom(email);
    if (typedEmail !== null && !isLasuStudentEmail(typedEmail)) {
      setError(`Use your LASU student email, ending in @${LASU_STUDENT_EMAIL_DOMAIN}.`);
      return;
    }
    setBusy(true);
    try {
      const sent = await requestOpeningCode(found.matricNumber, typedEmail ?? undefined);
      setPhase({ kind: 'code', found, sentTo: sent.email, resendInSeconds: sent.resendInSeconds, typedEmail, sentAt: Date.now() });
    } catch (caught) {
      setError(failureText(caught, 'The code could not be sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function open(found: Extract<ClassListLookupResult, { status: 'found' }>, code: string) {
    setError('');
    setBusy(true);
    try {
      const opened = await openAccount(found.matricNumber, code);
      announceAccountChanged();
      setFirstName(opened.student.displayName.split(' ')[0] ?? '');
      setPhase({ kind: 'password', password: opened.startingPassword, firstName: opened.student.displayName.split(' ')[0] ?? '' });
    } catch (caught) {
      setError(failureText(caught, 'Your account could not be opened. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function afterPassword() {
    setBusy(true);
    try {
      const setup = await loadStudentSetup();
      setPhase(setup.faceRequired && !setup.faceRegistered ? { kind: 'face' } : { kind: 'done', firstName });
    } catch {
      setPhase({ kind: 'face' });
    } finally {
      setBusy(false);
    }
  }

  if (phase.kind === 'matric') {
    return (
      <Panel step={0} kicker="STUDENT ACCOUNT" title="Open your account" intro="Your HOC has put your class on LASUATOS. Type your matric number and we fill in the rest.">
        <form className="account-form" onSubmit={(event) => void lookup(event)} noValidate>
          <label className="account-field">
            <span>Matric number</span>
            <input
              className="ob-matric-input"
              name="matricNumber"
              value={matric}
              onChange={(event) => setMatric(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              placeholder="e.g. 250211184"
              required
            />
          </label>
          {error ? <p className="account-error" role="alert">{error}</p> : null}
          <button className="account-primary-button" type="submit" disabled={busy}>
            {busy ? 'Finding you…' : <>Continue <ArrowRight size={17} aria-hidden="true" /></>}
          </button>
          <p className="account-fine-print">You need your LASU student email (yourname@{LASU_STUDENT_EMAIL_DOMAIN}) to receive the code.</p>
        </form>
      </Panel>
    );
  }

  if (phase.kind === 'not_found') {
    return (
      <Panel kicker="NOT ON A CLASS LIST YET" title="We could not find your matric number" intro={<><strong>{phase.matricNumber}</strong> is not on any class list on LASUATOS yet.</>}>
        <div className="account-form">
          <ul className="ob-help-list">
            <li>Check the number: it is the 9 digits on your school ID card and portal.</li>
            <li>If it is right, tell your HOC (class representative). They add you to the class list in LASUATOS in a minute, then you can open your account.</li>
          </ul>
          <button className="account-primary-button" type="button" onClick={() => { setError(''); setPhase({ kind: 'matric' }); }}>Try another number</button>
        </div>
      </Panel>
    );
  }

  if (phase.kind === 'found') {
    const { found } = phase;
    if (found.hasAccount) {
      return (
        <Panel kicker="ALREADY OPEN" title="You already have an account" intro={<>An account is open for <strong>{found.matricNumber}</strong> ({found.maskedName}). Sign in with your matric number.</>}>
          <div className="account-form">
            <Link className="account-primary-button" href="/sign-in">Sign in <ArrowRight size={17} aria-hidden="true" /></Link>
            <p className="account-inline-link"><Link href="/forgot-password">Forgot your password?</Link></p>
            <p className="account-fine-print">Not you? Someone may have opened an account with your matric number. Tell your HOC straight away.</p>
          </div>
        </Panel>
      );
    }
    return (
      <Panel step={1} kicker="IS THIS YOU?" title="Confirm it is you">
        <form className="account-form" onSubmit={(event) => { event.preventDefault(); void sendCode(found); }} noValidate>
          <div className="ob-identity">
            <UserRoundSearch size={22} aria-hidden="true" />
            <div>
              <strong>{found.maskedName}</strong>
              <span>{found.matricNumber}</span>
              <span>{found.departmentName} · {found.levelLabel}</span>
            </div>
          </div>
          {found.emailOnList ? (
            <p className="account-fine-print ob-lede">We will email a 6-digit code to the LASU email your HOC listed for you.</p>
          ) : (
            <EmailField value={email} onChange={setEmail} />
          )}
          {error ? <p className="account-error" role="alert">{error}</p> : null}
          <button className="account-primary-button" type="submit" disabled={busy}>
            {busy ? 'Sending the code…' : 'Yes, this is me: send the code'}
          </button>
          <button className="lx-link-button" type="button" onClick={() => { setError(''); setPhase({ kind: 'matric' }); }} disabled={busy}>
            Not me: change the matric number
          </button>
          <p className="account-fine-print">Name wrong? Ask your HOC to correct the class list. It updates straight away.</p>
        </form>
      </Panel>
    );
  }

  if (phase.kind === 'code') {
    const { found } = phase;
    return (
      <Panel step={1} kicker="LASU EMAIL" title="Enter the code">
        <CodeForm
          key={phase.sentAt}
          sentTo={phase.sentTo}
          resendAt={phase.sentAt + phase.resendInSeconds * 1000}
          busy={busy}
          error={error}
          submitLabel="Open my account"
          onSubmit={(code) => void open(found, code)}
          onResend={() => void sendCode(found)}
          onChangeEmail={phase.typedEmail !== null ? () => { setError(''); setPhase({ kind: 'found', found }); } : undefined}
        />
      </Panel>
    );
  }

  if (phase.kind === 'password') {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(phase.password);
        feedback.toast('Password copied.', 'success');
      } catch {
        feedback.toast('Copy did not work. Write the password down.', 'info');
      }
    };
    return (
      <Panel step={2} kicker="ACCOUNT OPEN" title={`Welcome, ${phase.firstName}`} intro="Your account is open and you are signed in. This is your password, in the same style as the LASU portal:">
        <div className="account-form">
          <div className="ob-password">
            <code aria-label="Your starting password">{phase.password}</code>
            <button className="button button-secondary" type="button" onClick={() => void copy()}><Copy size={16} aria-hidden="true" /> Copy</button>
          </div>
          <p className="ob-password-hint"><KeyRound size={18} aria-hidden="true" /><span><strong>LASU</strong> + your matric number + your <strong>SURNAME</strong>. Sign in with your matric number and this password. You can change it any time under <Link href="/account/security">Account security</Link>.</span></p>
          <button className="account-primary-button" type="button" onClick={() => void afterPassword()} disabled={busy}>
            {busy ? 'One moment…' : <>Continue <ArrowRight size={17} aria-hidden="true" /></>}
          </button>
        </div>
      </Panel>
    );
  }

  if (phase.kind === 'face') {
    return (
      <Panel step={3} kicker="LAST STEP" title="Register your face" intro="So only you can mark your attendance.">
        <FaceRegistration onRegistered={() => setPhase({ kind: 'done', firstName })} onSkip={() => window.location.assign(continuePath())} />
      </Panel>
    );
  }

  return (
    <section className="account-panel account-verification ob-done" aria-live="polite">
      <span className="account-result-mark" aria-hidden="true"><BadgeCheck size={30} /></span>
      <h2>You are all set{phase.firstName ? `, ${phase.firstName}` : ''}</h2>
      <p>At each class, scan the QR code and look at the camera. That is all.</p>
      <button className="account-primary-button" type="button" onClick={() => window.location.assign(continuePath())}>
        {hasPendingCheckIn() ? 'Finish your check-in' : 'Go to my attendance'} <ArrowRight size={17} aria-hidden="true" />
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Finishing setup (older accounts, or a face left for later)            */
/* ------------------------------------------------------------------ */

type SetupPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly setup: StudentSetup }
  | { readonly kind: 'code'; readonly setup: StudentSetup; readonly sentTo: string; readonly resendInSeconds: number; readonly sentAt: number; readonly typed: boolean };

export function StudentSetupFlow() {
  const [phase, setPhase] = useState<SetupPhase>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadStudentSetup(controller.signal)
      .then((setup) => setPhase({ kind: 'ready', setup }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught && typeof caught === 'object' && 'status' in caught && caught.status === 401) {
          window.location.replace(`/sign-in?next=${encodeURIComponent('/account/setup')}`);
          return;
        }
        setPhase({ kind: 'failed', message: failureText(caught, 'Your account could not be loaded.') });
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = () => {
    setError('');
    setPhase({ kind: 'loading' });
    setAttempt((value) => value + 1);
  };

  async function sendCode(setup: StudentSetup) {
    setError('');
    const typed = !setup.classList?.listedEmail;
    const address = lasuEmailFrom(email);
    if (typed && !isLasuStudentEmail(address)) {
      setError(`Use your LASU student email, ending in @${LASU_STUDENT_EMAIL_DOMAIN}.`);
      return;
    }
    setBusy(true);
    try {
      const sent = await requestAccountEmailCode(typed ? address : undefined);
      setPhase({ kind: 'code', setup, sentTo: sent.email, resendInSeconds: sent.resendInSeconds, sentAt: Date.now(), typed });
    } catch (caught) {
      setError(failureText(caught, 'The code could not be sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    setError('');
    setBusy(true);
    try {
      await verifyAccountEmail(code);
      announceAccountChanged();
      reload();
    } catch (caught) {
      setError(failureText(caught, 'That code did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (phase.kind === 'loading') return <AccountPanelSkeleton label="Loading your account…" />;
  if (phase.kind === 'failed') {
    return (
      <Panel kicker="ACCOUNT SETUP" title="We could not load your account" intro={phase.message}>
        <button className="account-primary-button" type="button" onClick={reload}>Try again</button>
      </Panel>
    );
  }

  const { setup } = phase;
  if (!setup.classList) {
    return (
      <Panel kicker="NOT ON A CLASS LIST YET" title="Ask your HOC to add you" intro="Your matric number is not on a class list on LASUATOS yet. Once your HOC adds you, come back here to confirm your LASU email and register your face.">
        <Link className="account-primary-button" href="/attendance">Back to my attendance</Link>
      </Panel>
    );
  }

  if (phase.kind === 'code') {
    return (
      <Panel step={1} kicker="LASU EMAIL" title="Enter the code">
        <CodeForm
          key={phase.sentAt}
          sentTo={phase.sentTo}
          resendAt={phase.sentAt + phase.resendInSeconds * 1000}
          busy={busy}
          error={error}
          submitLabel="Confirm my email"
          onSubmit={(code) => void verify(code)}
          onResend={() => void sendCode(phase.setup)}
          onChangeEmail={phase.typed ? () => { setError(''); setPhase({ kind: 'ready', setup: phase.setup }); } : undefined}
        />
      </Panel>
    );
  }

  if (!setup.emailVerified) {
    const listed = setup.classList.listedEmail;
    return (
      <Panel step={1} kicker="ACCOUNT SETUP" title="Confirm your LASU email" intro="Student accounts now use LASU student emails. Confirm yours once and it becomes your account email.">
        <form className="account-form" onSubmit={(event) => { event.preventDefault(); void sendCode(setup); }} noValidate>
          <div className="ob-identity">
            <ShieldCheck size={22} aria-hidden="true" />
            <div>
              <strong>{[setup.classList.firstName, setup.classList.middleName, setup.classList.surname].filter(Boolean).join(' ')}</strong>
              <span>{setup.classList.departmentName} · {setup.classList.levelLabel}</span>
            </div>
          </div>
          {listed ? (
            <p className="account-fine-print ob-lede">We will email a 6-digit code to <strong>{listed}</strong>, the address on your class list.</p>
          ) : (
            <EmailField value={email} onChange={setEmail} />
          )}
          {error ? <p className="account-error" role="alert">{error}</p> : null}
          <button className="account-primary-button" type="submit" disabled={busy}>{busy ? 'Sending the code…' : 'Send the code'}</button>
        </form>
      </Panel>
    );
  }

  if (setup.faceRequired && !setup.faceRegistered) {
    return (
      <Panel step={3} kicker="ACCOUNT SETUP" title="Register your face" intro="Needed to mark attendance: it confirms it is really you.">
        <FaceRegistration onRegistered={reload} />
      </Panel>
    );
  }

  return (
    <section className="account-panel account-verification ob-done" aria-live="polite">
      <span className="account-result-mark" aria-hidden="true"><BadgeCheck size={30} /></span>
      <h2>Your account is ready</h2>
      <p>LASU email confirmed{setup.faceRequired ? ' and face registered' : ''}. Scan the QR code at each class to mark your attendance.</p>
      {setup.defaultPassword ? (
        <p className="ob-password-hint"><KeyRound size={18} aria-hidden="true" /><span>You still use the starting password (LASU + matric + SURNAME). <Link href="/account/security">Change it</Link> to something only you know.</span></p>
      ) : null}
      <button className="account-primary-button" type="button" onClick={() => window.location.assign(continuePath())}>
        {hasPendingCheckIn() ? 'Finish your check-in' : 'Go to my attendance'} <ArrowRight size={17} aria-hidden="true" />
      </button>
    </section>
  );
}
