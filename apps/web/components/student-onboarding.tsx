'use client';

import {
  LASU_STUDENT_EMAIL_DOMAIN,
  PASSWORD_MIN_LENGTH,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_LENGTH,
  isJambRegNumber,
  isLasuMatricNumber,
  isLasuStudentEmail,
  isPersonalEmail,
  normalizeMatricNumber,
  normalizeSetupCode,
  type ClassListLookupResult,
  type FaceFrame,
  type StudentSetup,
} from '@lasuatos/contracts';
import { ArrowRight, BadgeCheck, Camera, GraduationCap, KeyRound, Lock, Mail, RotateCw, ScanFace, ShieldCheck, Ticket, Timer, Trash2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { hasPendingCheckIn } from '../lib/check-in-device';
import { announceAccountChanged } from '../lib/current-account';
import { failureText } from '../lib/lecture-api';
import {
  confirmMatricNumber,
  loadStudentSetup,
  lookupMatric,
  openAccount,
  openWithSetupCode,
  registerFace,
  requestAccountEmailCode,
  requestMatricCode,
  requestOpeningCode,
  requestPasswordCode,
  resetPasswordWithCode,
  verifyAccountEmail,
} from '../lib/student-api';
import { nextPathFromLocation } from './account-forms';
import { PasswordField } from './password-field';
import { FaceCapture } from './face-capture';
import { preloadFaceTracker } from '../lib/face-tracker';
import { useFeedback } from './feedback';
import { FlowActions, FlowResult, FlowStep, MailChip, PasswordKey, SlotInput, StudentIdCard } from './onboarding/flow';
import { AccountPanelSkeleton } from './ui/skeleton';

/**
 * Opening a student account from the class list.
 *
 * The HOC has already put every student's name (and usually their LASU email)
 * on the class list, so a student types only their matric number:
 *   1. matric number → "ODEJOBI Abraham Oluwaseun, Mechanical Engineering, 200 Level: is this you?"
 *   2. a 6-digit code to their LASU email (…@st.lasu.edu.ng) proves it is them
 *      (or a one-time setup code from their HOC, when they cannot get the email);
 *   3. the account opens, signed in, with the LASU-style starting password
 *      (LASU + matric + SURNAME), shown once;
 *   4. they register their face (three photos), used to confirm it is them at check-in.
 *
 * A Direct Entry student without a matric number yet uses their JAMB
 * registration number (12 digits and 2 letters) and a personal email. When
 * the matric number and LASU email arrive, they add them in Account setup
 * (a code to the LASU email): the account, attendance, courses and face stay.
 *
 * An older account with the matric number whose LASU email was never
 * confirmed is taken over by step 2 (its attendance kept). An account with a
 * confirmed LASU email is "already open": sign in, or reset the password with
 * a code sent to that email.
 */

const FACE_POSES = ['front', 'left', 'right'] as const;

function continuePath(): string {
  return nextPathFromLocation() ?? (hasPendingCheckIn() ? '/check-in' : '/attendance');
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

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

const digitsOnly = (raw: string) => raw.replace(/\D/g, '');
/** A JAMB registration number as typed: 12 digits, then 2 letters, in capitals. */
function jambCharacters(raw: string): string {
  let out = '';
  for (const character of raw.toUpperCase()) {
    if (out.length < 12 ? /\d/.test(character) : /[A-Z]/.test(character)) out += character;
    if (out.length === 14) break;
  }
  return out;
}
/** A whole JAMB number pasted or typed into the matric boxes. */
const looksLikeJamb = (raw: string) => /^\d{12}[A-Z]{1,2}$/.test(raw.toUpperCase().replace(/[\s-]/g, ''));
const JAMB_LENGTH = 14;
/** Only the setup-code alphabet, upper case: "abcd-efg" → "ABCDEFG". */
const setupCharacters = (raw: string) => [...normalizeSetupCode(raw)].filter((character) => SETUP_CODE_ALPHABET.includes(character)).join('');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** "Didn't get it?" with the resend countdown. */
function Resend({ left, busy, onResend, onChangeEmail }: Readonly<{ left: number; busy: boolean; onResend: () => void; onChangeEmail?: (() => void) | undefined }>) {
  return (
    <div className="obf-resend">
      <p>Nothing yet? Check Spam, or wait a minute.</p>
      <div className="obf-resend-actions">
        <button className="obf-link" type="button" onClick={onResend} disabled={busy || left > 0}>
          <RotateCw size={15} aria-hidden="true" />
          {left > 0 ? <>Send a new code in <span className="obf-tabular">{clock(left)}</span></> : 'Send a new code'}
        </button>
        {onChangeEmail ? <button className="obf-link" type="button" onClick={onChangeEmail} disabled={busy}>Use a different email</button> : null}
      </div>
    </div>
  );
}

/** The six-digit code field and its resend link, shared by opening an account, confirming an older one and replacing a face. */
export function CodeForm({
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

  function change(value: string) {
    setCode(value);
    // The sixth digit sends it: no extra tap.
    if (value.length === 6 && code.length < 6 && !busy) onSubmit(value);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length === 6) onSubmit(code);
  }

  return (
    <form className="obf-form" onSubmit={submit} noValidate>
      <MailChip address={sentTo} />
      <SlotInput
        name="code"
        label="6-digit code"
        hint="From the email. It works for 15 minutes."
        value={code}
        groups={[3, 3]}
        onValueChange={change}
        clean={digitsOnly}
        inputMode="numeric"
        autoComplete="one-time-code"
        invalid={Boolean(error)}
        autoFocus
      />
      {error ? <p className="obf-error" role="alert">{error}</p> : null}
      <Resend left={left} busy={busy} onResend={onResend} onChangeEmail={onChangeEmail} />
      <FlowActions>
        <button className="obf-primary" type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : submitLabel}
        </button>
      </FlowActions>
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
  const id = useId();
  const showSuffix = !value.includes('@');
  return (
    <div className="obf-field">
      <label className="obf-label" htmlFor={id}>Your LASU student email</label>
      <span className={`obf-email${showSuffix ? ' has-suffix' : ''}`}>
        <input
          id={id}
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
          aria-describedby={`${id}-hint`}
          required
        />
        {showSuffix ? <span className="obf-email-suffix" aria-hidden="true">@{LASU_STUDENT_EMAIL_DOMAIN}</span> : null}
      </span>
      <p className="obf-hint" id={`${id}-hint`}>The Google account LASU gave you. The part before the @ is enough.</p>
    </div>
  );
}

/** Any email the student can open: for a student on a JAMB number (no LASU email yet). */
function PersonalEmailField({ value, onChange, label = 'Your email' }: Readonly<{ value: string; onChange: (value: string) => void; label?: string }>) {
  const id = useId();
  return (
    <div className="obf-field">
      <label className="obf-label" htmlFor={id}>{label}</label>
      <span className="obf-email">
        <input
          id={id}
          name="email"
          type="email"
          inputMode="email"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={320}
          placeholder="name@gmail.com"
          aria-describedby={`${id}-hint`}
          required
        />
      </span>
      <p className="obf-hint" id={`${id}-hint`}>No LASU email yet? Use one you can open now (Gmail, Yahoo, Outlook…). Your LASU email replaces it when you add your matric number.</p>
    </div>
  );
}

/** The typed address for a JAMB-number student: a LASU one (the part before the @ is not enough here) or a personal one. */
function personalEmailProblem(address: string): string {
  if (!address) return 'Enter an email you can open, e.g. name@gmail.com.';
  if (isLasuStudentEmail(address) || isPersonalEmail(address)) return '';
  return 'Check the email address: it needs a name, an @ and the provider, e.g. name@gmail.com.';
}

/** Who this is for, small, on the steps after "Is this you?". */
function Who({ name, matricNumber }: Readonly<{ name: string; matricNumber: string }>) {
  return (
    <p className="obf-who">
      <UserRound size={16} aria-hidden="true" />
      <span><strong>{name}</strong> <span className="obf-tabular">{matricNumber}</span></span>
    </p>
  );
}

/** How the starting password is made, for people who forgot it. */
function PasswordPattern({ children, jamb = false }: Readonly<{ children?: ReactNode; jamb?: boolean }>) {
  return (
    <div className="obf-tip">
      <KeyRound size={18} aria-hidden="true" />
      <p>
        {jamb
          ? <>Unless you changed it, your password is <strong>LASU</strong> + the number you opened the account with + <strong>SURNAME</strong>, e.g. <span className="obf-mono">LASU202530074987JAODEJOBI</span>.</>
          : <>Unless you changed it, your password is <strong>LASU</strong> + matric number + <strong>SURNAME</strong>, e.g. <span className="obf-mono">LASU250211184ODEJOBI</span>.</>}
        {children ? <> {children}</> : null}
      </p>
    </div>
  );
}

/**
 * Forgot password, for a student whose account has a confirmed LASU email:
 * the 6-digit code from that email and the new password, on one screen.
 */
function ResetPasswordForm({
  sentTo,
  resendAt,
  busy,
  error,
  onSubmit,
  onResend,
  onError,
}: Readonly<{
  sentTo: string;
  resendAt: number;
  busy: boolean;
  error: string;
  onSubmit: (code: string, password: string) => void;
  onResend: () => void;
  onError: (message: string) => void;
}>) {
  const [code, setCode] = useState('');
  const left = useSecondsLeft(resendAt);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const repeat = String(form.get('repeatPassword') ?? '');
    if (code.length !== 6) return onError('Enter the 6-digit code from the email.');
    if (password.length < PASSWORD_MIN_LENGTH) return onError(`Use at least ${PASSWORD_MIN_LENGTH} characters for the new password.`);
    if (password !== repeat) return onError('The two passwords are not the same. Type the new password again.');
    onSubmit(code, password);
  }

  return (
    <form className="obf-form" onSubmit={submit} noValidate>
      <MailChip address={sentTo} />
      <SlotInput
        name="code"
        label="6-digit code"
        hint="From the email. It works for 15 minutes."
        value={code}
        groups={[3, 3]}
        onValueChange={setCode}
        clean={digitsOnly}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
      />
      <Resend left={left} busy={busy} onResend={onResend} />
      <div className="obf-fields">
        <PasswordField label="New password" name="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} hint={`At least ${PASSWORD_MIN_LENGTH} characters. Not your starting password.`} />
        <PasswordField label="New password again" name="repeatPassword" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
      </div>
      {error ? <p className="obf-error" role="alert">{error}</p> : null}
      <FlowActions note="Saving signs you out on every other phone or computer.">
        <button className="obf-primary" type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Saving…' : 'Save my new password'}
        </button>
      </FlowActions>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Face registration (shared)                                           */
/* ------------------------------------------------------------------ */

export function FaceRegistration({ onRegistered, onSkip }: Readonly<{ onRegistered: () => void; onSkip?: () => void }>) {
  const [consent, setConsent] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const consentBox = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cancel = useCallback(() => setCamera(false), []);
  // The camera's live guide downloads while the student reads the notice.
  useEffect(() => { preloadFaceTracker(); }, []);
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
    <div className="obf-form">
      <div className="obf-face-art" aria-hidden="true">
        <span className="obf-face-ring"><ScanFace size={46} strokeWidth={1.6} /></span>
        <span className="obf-face-poses"><span>Front</span><span>Left</span><span>Right</span></span>
      </div>
      <ul className="obf-facts">
        <li><span className="obf-fact-icon" aria-hidden="true"><Timer size={18} /></span><span><strong>About 15 seconds.</strong> Look at the camera, blink, then turn your head left and right. The photos take themselves.</span></li>
        <li><span className="obf-fact-icon" aria-hidden="true"><ShieldCheck size={18} /></span><span><strong>Why.</strong> At each class you look at the camera for a second, so no one else can mark your attendance.</span></li>
        <li><span className="obf-fact-icon" aria-hidden="true"><Lock size={18} /></span><span><strong>What is kept.</strong> Face measurements (numbers, not pictures) and one small front photo, which your HOC and administrators can see on the class list.</span></li>
        <li><span className="obf-fact-icon" aria-hidden="true"><Trash2 size={18} /></span><span><strong>Your choice.</strong> An administrator deletes it on request, and it goes with your account.</span></li>
      </ul>
      <label className={`obf-consent${consent ? ' is-checked' : askConsent ? ' is-asking' : ''}`}>
        <input
          ref={consentBox}
          type="checkbox"
          checked={consent}
          onChange={(event) => { setConsent(event.target.checked); setAskConsent(false); }}
          aria-describedby={askConsent ? 'obf-consent-ask' : undefined}
        />
        <span>I agree to LASUATOS keeping my face measurements and photo to confirm it is me at check-in. <Link href="/privacy">Privacy notice</Link></span>
      </label>
      {askConsent ? <p className="obf-consent-ask" id="obf-consent-ask" role="alert">Tick the box to agree, then open the camera.</p> : null}
      {error ? <p className="obf-error" role="alert">{error}</p> : null}
      <FlowActions>
        <button
          className="obf-primary"
          type="button"
          disabled={busy}
          onClick={() => {
            // The pinned button stays live: without the tick, it points to the box instead.
            if (!consent) {
              setAskConsent(true);
              consentBox.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              consentBox.current?.focus({ preventScroll: true });
              return;
            }
            setError('');
            setCamera(true);
          }}
        >
          <Camera size={18} aria-hidden="true" /> {busy ? 'Checking your photos…' : error ? 'Try again' : 'Open the camera'}
        </button>
        {onSkip ? <button className="obf-link obf-skip" type="button" onClick={onSkip} disabled={busy}>Do it later (needed before your next check-in)</button> : null}
      </FlowActions>
      {camera ? <FaceCapture poses={FACE_POSES} title="Register your face" review onDone={(frames) => void captured(frames)} onCancel={cancel} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Opening an account                                                   */
/* ------------------------------------------------------------------ */

type Found = Extract<ClassListLookupResult, { status: 'found' }>;

type Phase =
  | { readonly kind: 'matric' }
  | { readonly kind: 'found'; readonly found: Found }
  | { readonly kind: 'not_found'; readonly matricNumber: string }
  | { readonly kind: 'replaced'; readonly jambNumber: string; readonly matricNumber: string }
  | { readonly kind: 'code'; readonly found: Found; readonly sentTo: string; readonly resendInSeconds: number; readonly typedEmail: string | null; readonly sentAt: number }
  | { readonly kind: 'setup_code'; readonly found: Found }
  | { readonly kind: 'reset'; readonly found: Found; readonly sentTo: string; readonly resendInSeconds: number; readonly sentAt: number }
  | { readonly kind: 'reset_done'; readonly firstName: string; readonly signedOut: number }
  | { readonly kind: 'password'; readonly password: string; readonly firstName: string; readonly takenOver: boolean; readonly jamb: boolean }
  | { readonly kind: 'face' }
  | { readonly kind: 'done'; readonly firstName: string };

/** "OKONKWO Chidinma Adaeze" → "Chidinma OKONKWO", for the small "for" line. */
function shortName(fullName: string): string {
  const [surname = '', first = ''] = fullName.trim().split(/\s+/);
  return first ? `${first} ${surname}` : surname;
}

function ContinueButton() {
  return (
    <button className="obf-primary" type="button" onClick={() => window.location.replace(continuePath())}>
      {hasPendingCheckIn() ? 'Finish your check-in' : 'Go to my attendance'} <ArrowRight size={18} aria-hidden="true" />
    </button>
  );
}

export function StudentOnboarding() {
  const feedback = useFeedback();
  const [phase, setPhase] = useState<Phase>({ kind: 'matric' });
  /** 'jamb': a Direct Entry student without a matric number yet types their JAMB number. */
  const [numberMode, setNumberMode] = useState<'matric' | 'jamb'>('matric');
  const [matric, setMatric] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [setupCode, setSetupCode] = useState('');

  const go = (next: Phase) => {
    setError('');
    setPhase(next);
  };

  function switchMode(next: 'matric' | 'jamb', value = '') {
    setNumberMode(next);
    setMatric(next === 'jamb' ? jambCharacters(value) : digitsOnly(value));
    setError('');
    if (next === 'jamb' && jambCharacters(value).length === JAMB_LENGTH && !busy) void lookup(jambCharacters(value));
  }

  async function lookup(value: string) {
    setError('');
    const typed = normalizeMatricNumber(value);
    if (!isLasuMatricNumber(typed) && !isJambRegNumber(typed)) {
      setError(numberMode === 'jamb'
        ? 'Enter your JAMB registration number: 12 digits and 2 letters, e.g. 202530074987JA.'
        : 'Enter your 9-digit matric number, e.g. 250211184.');
      return;
    }
    setBusy(true);
    try {
      const result = await lookupMatric(typed);
      setPhase(result.status === 'found' ? { kind: 'found', found: result }
        : result.status === 'replaced' ? { kind: 'replaced', jambNumber: result.matricNumber, matricNumber: result.replacedBy }
          : { kind: 'not_found', matricNumber: result.matricNumber });
    } catch (caught) {
      setError(failureText(caught, 'That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  /** The address the student typed (null when the list has one), or an error shown and null returned as false. */
  function typedEmailFor(found: Found): string | null | false {
    if (found.emailOnList) return null;
    if (found.numberKind === 'jamb') {
      const address = email.trim().toLowerCase();
      const problem = personalEmailProblem(address);
      if (problem) {
        setError(problem);
        return false;
      }
      return address;
    }
    const address = lasuEmailFrom(email);
    if (!isLasuStudentEmail(address)) {
      setError(`Use your LASU student email, ending in @${LASU_STUDENT_EMAIL_DOMAIN}.`);
      return false;
    }
    return address;
  }

  async function sendCode(found: Found) {
    setError('');
    const typedEmail = typedEmailFor(found);
    if (typedEmail === false) return;
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

  function opened(result: Awaited<ReturnType<typeof openAccount>>) {
    announceAccountChanged();
    const first = result.student.displayName.split(' ')[0] ?? '';
    setFirstName(first);
    setPhase({ kind: 'password', password: result.startingPassword, firstName: first, takenOver: result.takenOver, jamb: isJambRegNumber(result.student.matricNumber) });
  }

  async function open(found: Found, code: string) {
    setError('');
    setBusy(true);
    try {
      opened(await openAccount(found.matricNumber, code));
    } catch (caught) {
      setError(failureText(caught, 'Your account could not be opened. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function openWithCode(event: FormEvent<HTMLFormElement>, found: Found) {
    event.preventDefault();
    setError('');
    const code = normalizeSetupCode(setupCode);
    if (code.length !== SETUP_CODE_LENGTH) {
      setError('Enter the 8-character setup code from your HOC, e.g. ABCD-EFGH.');
      return;
    }
    const typedEmail = typedEmailFor(found);
    if (typedEmail === false) return;
    setBusy(true);
    try {
      opened(await openWithSetupCode(found.matricNumber, code, typedEmail ?? undefined));
    } catch (caught) {
      setError(failureText(caught, 'Your account could not be opened. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function sendResetCode(found: Found) {
    setError('');
    setBusy(true);
    try {
      const sent = await requestPasswordCode(found.matricNumber);
      setPhase({ kind: 'reset', found, sentTo: sent.email, resendInSeconds: sent.resendInSeconds, sentAt: Date.now() });
    } catch (caught) {
      setError(failureText(caught, 'The code could not be sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveNewPassword(found: Found, code: string, password: string) {
    setError('');
    setBusy(true);
    try {
      const reset = await resetPasswordWithCode(found.matricNumber, code, password);
      announceAccountChanged();
      setPhase({ kind: 'reset_done', firstName: reset.student.displayName.split(' ')[0] ?? '', signedOut: reset.signedOutSessions });
    } catch (caught) {
      setError(failureText(caught, 'Your password could not be changed. Try again.'));
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
    const jamb = numberMode === 'jamb';
    const length = jamb ? JAMB_LENGTH : 9;
    return (
      <FlowStep
        key="matric"
        step={0}
        jamb={jamb}
        title="Open your account"
        lede={jamb
          ? 'Direct Entry and no matric number yet? Your JAMB number and an email you can open. You add your matric number later and keep your attendance.'
          : 'Your matric number, a code to your LASU email and three quick photos. About two minutes.'}
      >
        <form className="obf-form" onSubmit={(event) => { event.preventDefault(); void lookup(matric); }} noValidate>
          <SlotInput
            key={numberMode}
            name={jamb ? 'jambNumber' : 'matricNumber'}
            label={jamb ? 'JAMB registration number' : 'Matric number'}
            hint={jamb ? '12 digits and 2 letters, from your JAMB admission letter or CAPS, e.g. 202530074987JA.' : 'The 9 digits on your LASU ID card.'}
            value={matric}
            groups={jamb ? [4, 4, 4, 2] : [2, 4, 3]}
            onValueChange={(value) => {
              setMatric(value);
              setError('');
              // The last character finds you: no extra tap.
              if (value.length === length && matric.length < length && !busy) void lookup(value);
            }}
            clean={jamb ? jambCharacters : (raw) => {
              // A whole JAMB number pasted here: switch to the JAMB boxes with it.
              if (looksLikeJamb(raw)) window.setTimeout(() => switchMode('jamb', raw), 0);
              return digitsOnly(raw);
            }}
            inputMode={jamb ? 'text' : 'numeric'}
            autoCapitalize={jamb ? 'characters' : 'none'}
            autoComplete="off"
            invalid={Boolean(error)}
            disabled={busy}
            autoFocus
          />
          {error ? <p className="obf-error" role="alert">{error}</p> : null}
          <button className="obf-link obf-mode-switch" type="button" onClick={() => switchMode(jamb ? 'matric' : 'jamb')} disabled={busy}>
            <GraduationCap size={15} aria-hidden="true" />
            {jamb ? 'I have my matric number' : 'Direct Entry, no matric number yet? Use your JAMB number'}
          </button>
          <FlowActions note={<>No access to {jamb ? 'any email' : 'your LASU email'}? Your HOC can give you a setup code.</>}>
            <button className="obf-primary" type="submit" disabled={busy || matric.length !== length}>
              {busy ? 'Finding you…' : <>Find me <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
          </FlowActions>
        </form>
      </FlowStep>
    );
  }

  if (phase.kind === 'replaced') {
    return (
      <FlowStep key="replaced" step={0} jamb eyebrow="Your matric number is in" title="Use your matric number now" onBack={() => go({ kind: 'matric' })} backLabel="Change the number">
        <div className="obf-form">
          <div className="obf-missing">
            <span className="obf-missing-number obf-tabular">{phase.matricNumber}</span>
            <span>is your matric number on the class list now, in place of the JAMB number {phase.jambNumber}. Your attendance went with it.</span>
          </div>
          <p className="obf-small">Already opened your account? Sign in with either number; your password is unchanged.</p>
          <FlowActions>
            <button className="obf-primary" type="button" disabled={busy} onClick={() => { setNumberMode('matric'); setMatric(phase.matricNumber); void lookup(phase.matricNumber); }}>
              {busy ? 'Finding you…' : <>Continue with {phase.matricNumber} <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
          </FlowActions>
        </div>
      </FlowStep>
    );
  }

  if (phase.kind === 'not_found') {
    return (
      <FlowStep key="not_found" step={0} eyebrow="Not on a class list yet" title="We couldn’t find you" onBack={() => go({ kind: 'matric' })} backLabel="Change the matric number">
        <div className="obf-form">
          <div className="obf-missing">
            <span className="obf-missing-number obf-tabular">{phase.matricNumber}</span>
            <span>is not on any class list on LASUATOS yet.</span>
          </div>
          <ol className="obf-numbered">
            {isJambRegNumber(phase.matricNumber) ? (
              <>
                <li><span><strong>Check the number.</strong> It is the 12 digits and 2 letters on your JAMB admission letter or CAPS.</span></li>
                <li><span><strong>Tell your HOC.</strong> They add you to the class list with your JAMB number (and your email, if you like). Then come back here.</span></li>
                <li><span><strong>Have your matric number now?</strong> Use it instead.</span></li>
              </>
            ) : (
              <>
                <li><span><strong>Check the number.</strong> It is the 9 digits on your LASU ID card and the portal.</span></li>
                <li><span><strong>Tell your HOC.</strong> If it is right, your class rep adds you to the class list in a minute. Then come back here.</span></li>
              </>
            )}
          </ol>
          <FlowActions>
            <button className="obf-primary" type="button" onClick={() => go({ kind: 'matric' })}>Try another number</button>
          </FlowActions>
        </div>
      </FlowStep>
    );
  }

  if (phase.kind === 'found') {
    const { found } = phase;
    if (found.hasAccount || found.accountStatus === 'open') {
      return (
        <FlowStep key="open" eyebrow="Already open" title="You already have an account" onBack={() => go({ kind: 'matric' })} backLabel="Change the matric number">
          <div className="obf-form">
            <StudentIdCard fullName={found.fullName} matricNumber={found.matricNumber} department={found.departmentName} level={found.levelLabel} status="Account open" />
            <PasswordPattern jamb={found.numberKind === 'jamb'}>Forgot it? We send a code to the email you confirmed.</PasswordPattern>
            {error ? <p className="obf-error" role="alert">{error}</p> : null}
            <FlowActions note="Not your account? Show your HOC your ID card: an administrator can release it to you.">
              <Link className="obf-primary" href="/sign-in">Sign in <ArrowRight size={18} aria-hidden="true" /></Link>
              <button className="obf-secondary" type="button" onClick={() => void sendResetCode(found)} disabled={busy}>
                <KeyRound size={17} aria-hidden="true" /> {busy ? 'Sending the code…' : 'Reset my password'}
              </button>
            </FlowActions>
          </div>
        </FlowStep>
      );
    }
    const unconfirmed = found.accountStatus === 'unconfirmed';
    return (
      <FlowStep key="found" step={1} jamb={found.numberKind === 'jamb'} title={unconfirmed ? 'Is this account yours?' : 'Is this you?'} onBack={() => go({ kind: 'matric' })} backLabel="Change the matric number">
        <form className="obf-form" onSubmit={(event) => { event.preventDefault(); void sendCode(found); }} noValidate>
          <StudentIdCard fullName={found.fullName} matricNumber={found.matricNumber} department={found.departmentName} level={found.levelLabel} />
          <p className="obf-small">Name wrong? Your HOC can correct the class list; it updates straight away.</p>
          {unconfirmed ? (
            <p className="obf-notice">
              An older account uses this matric number but never confirmed a LASU email. Confirm yours and it becomes yours: its attendance is kept, and anyone else using it is signed out.
            </p>
          ) : null}
          {found.numberKind === 'jamb' ? (
            <p className="obf-notice is-calm">You are on the class list by your JAMB number. When your matric number and LASU email arrive, add them in Account: your attendance stays.</p>
          ) : null}
          {found.emailOnList ? (
            <div className="obf-tip is-plain">
              <Mail size={18} aria-hidden="true" />
              <p>We’ll email a 6-digit code to the {found.numberKind === 'jamb' ? 'email' : 'LASU email'} your HOC listed for you.</p>
            </div>
          ) : found.numberKind === 'jamb' ? (
            <PersonalEmailField value={email} onChange={setEmail} />
          ) : (
            <EmailField value={email} onChange={setEmail} />
          )}
          {error ? <p className="obf-error" role="alert">{error}</p> : null}
          <FlowActions>
            <button className="obf-primary" type="submit" disabled={busy}>
              {busy ? 'Sending the code…' : <>Yes, send my code <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
            <div className="obf-action-row">
              <button className="obf-link" type="button" onClick={() => go({ kind: 'matric' })} disabled={busy}>Not me</button>
              <button className="obf-link" type="button" onClick={() => { setSetupCode(''); go({ kind: 'setup_code', found }); }} disabled={busy}>
                <Ticket size={15} aria-hidden="true" /> Use a setup code
              </button>
            </div>
          </FlowActions>
        </form>
      </FlowStep>
    );
  }

  if (phase.kind === 'setup_code') {
    const { found } = phase;
    return (
      <FlowStep key="setup_code" step={1} jamb={found.numberKind === 'jamb'} title="Enter your setup code" lede="Can’t get the email code? Your HOC gives you a one-time code from the class list. It works once, for 30 minutes." onBack={() => go({ kind: 'found', found })}>
        <form className="obf-form" onSubmit={(event) => void openWithCode(event, found)} noValidate>
          <Who name={shortName(found.fullName)} matricNumber={found.matricNumber} />
          <SlotInput
            name="setupCode"
            label="Setup code"
            hint="Eight letters and numbers, e.g. ABCD-EFGH."
            value={setupCode}
            groups={[4, 4]}
            onValueChange={setSetupCode}
            clean={setupCharacters}
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            invalid={Boolean(error)}
            autoFocus
          />
          {found.emailOnList ? null : found.numberKind === 'jamb' ? <PersonalEmailField value={email} onChange={setEmail} /> : <EmailField value={email} onChange={setEmail} />}
          {error ? <p className="obf-error" role="alert">{error}</p> : null}
          <FlowActions note={found.numberKind === 'jamb' ? 'You confirm your email later, from your account.' : 'You confirm your LASU email later, from your account.'}>
            <button className="obf-primary" type="submit" disabled={busy || setupCode.length !== SETUP_CODE_LENGTH}>
              {busy ? 'Opening your account…' : 'Open my account'}
            </button>
          </FlowActions>
        </form>
      </FlowStep>
    );
  }

  if (phase.kind === 'reset') {
    const { found } = phase;
    return (
      <FlowStep key={`reset-${phase.sentAt}`} eyebrow="Forgot password" title="Choose a new password" onBack={() => go({ kind: 'found', found })}>
        <Who name={shortName(found.fullName)} matricNumber={found.matricNumber} />
        <ResetPasswordForm
          key={phase.sentAt}
          sentTo={phase.sentTo}
          resendAt={phase.sentAt + phase.resendInSeconds * 1000}
          busy={busy}
          error={error}
          onError={setError}
          onSubmit={(code, password) => void saveNewPassword(found, code, password)}
          onResend={() => void sendResetCode(found)}
        />
      </FlowStep>
    );
  }

  if (phase.kind === 'reset_done') {
    return (
      <FlowResult title={`Password changed${phase.firstName ? `, ${phase.firstName}` : ''}`}>
        <p>You are signed in with your new password.{phase.signedOut > 0 ? ` ${phase.signedOut} other ${phase.signedOut === 1 ? 'device was' : 'devices were'} signed out.` : ''}</p>
        <FlowActions><ContinueButton /></FlowActions>
      </FlowResult>
    );
  }

  if (phase.kind === 'code') {
    const { found } = phase;
    return (
      <FlowStep key={`code-${phase.sentAt}`} step={1} jamb={found.numberKind === 'jamb'} title="Check your email" lede={found.numberKind === 'jamb' || !isLasuStudentEmail(phase.sentTo) ? 'Enter the 6-digit code we just sent to your inbox.' : 'Enter the 6-digit code we just sent. Open Gmail with your LASU account.'} onBack={() => go({ kind: 'found', found })}>
        <CodeForm
          key={phase.sentAt}
          sentTo={phase.sentTo}
          resendAt={phase.sentAt + phase.resendInSeconds * 1000}
          busy={busy}
          error={error}
          submitLabel="Open my account"
          onSubmit={(code) => void open(found, code)}
          onResend={() => void sendCode(found)}
          onChangeEmail={phase.typedEmail !== null ? () => go({ kind: 'found', found }) : undefined}
        />
      </FlowStep>
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
      <FlowStep key="password" step={2} jamb={phase.jamb} title={`Welcome, ${phase.firstName}`} lede="Your account is open and you are signed in. Keep this password: it is in the same style as the LASU portal.">
        <div className="obf-form">
          {phase.takenOver ? (
            <p className="obf-notice" role="status">An older account used your matric number. It is yours now: its attendance is kept, and anyone else using it was signed out.</p>
          ) : null}
          <PasswordKey password={phase.password} onCopy={() => void copy()} />
          <p className="obf-small">Sign in with your {phase.jamb ? 'JAMB number (later, your matric number)' : 'matric number'} and this password. Change it any time in <Link href="/account/security">Account</Link>.</p>
          <FlowActions>
            <button className="obf-primary" type="button" onClick={() => void afterPassword()} disabled={busy}>
              {busy ? 'One moment…' : <>I’ve saved it, continue <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
          </FlowActions>
        </div>
      </FlowStep>
    );
  }

  if (phase.kind === 'face') {
    return (
      <FlowStep key="face" step={3} title="Register your face" lede="The last step. So only you can mark your attendance.">
        <FaceRegistration onRegistered={() => setPhase({ kind: 'done', firstName })} onSkip={() => window.location.replace(continuePath())} />
      </FlowStep>
    );
  }

  return (
    <FlowResult title={`You’re all set${phase.firstName ? `, ${phase.firstName}` : ''}`}>
      <p>At each class, scan the QR code and look at the camera. That’s all.</p>
      <FlowActions><ContinueButton /></FlowActions>
    </FlowResult>
  );
}

/* ------------------------------------------------------------------ */
/* Finishing setup (older accounts, or a face left for later)            */
/* ------------------------------------------------------------------ */

type SetupPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly setup: StudentSetup }
  | { readonly kind: 'code'; readonly setup: StudentSetup; readonly sentTo: string; readonly resendInSeconds: number; readonly sentAt: number; readonly typed: boolean }
  /** A student on a JAMB number adds their matric number and LASU email. */
  | { readonly kind: 'matric'; readonly setup: StudentSetup }
  | { readonly kind: 'matric_code'; readonly setup: StudentSetup; readonly matricNumber: string; readonly email: string; readonly sentTo: string; readonly resendInSeconds: number; readonly sentAt: number }
  | { readonly kind: 'matric_done'; readonly matricNumber: string; readonly previousNumber: string; readonly email: string; readonly attendanceMoved: number };

const SETUP_EYEBROW = 'Finish setting up';
const MATRIC_EYEBROW = 'Your matric number';

/** /account/setup?add=matric opens straight on adding the matric number. */
function wantsMatricStep(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('add') === 'matric';
}

/**
 * Adding the matric number: the 9 digits and the LASU email, then a code to
 * that email. Everything the student has stays; registers show the matric
 * number from then on, and the JAMB number still signs them in.
 */
function AddMatricForm({ busy, error, onSubmit, onCancel }: Readonly<{
  busy: boolean;
  error: string;
  onSubmit: (matricNumber: string, email: string) => void;
  onCancel: () => void;
}>) {
  const [matric, setMatric] = useState('');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = lasuEmailFrom(email);
    if (!isLasuMatricNumber(matric)) return setProblem('Enter your 9-digit matric number, e.g. 250211184.');
    if (!isLasuStudentEmail(address)) return setProblem(`Use your LASU student email, ending in @${LASU_STUDENT_EMAIL_DOMAIN}.`);
    setProblem('');
    onSubmit(matric, address);
  }

  const shown = problem || error;
  return (
    <form className="obf-form" onSubmit={submit} noValidate>
      <SlotInput
        name="matricNumber"
        label="Matric number"
        hint="The 9 digits on your LASU ID card or the portal."
        value={matric}
        groups={[2, 4, 3]}
        onValueChange={(value) => { setMatric(value); setProblem(''); }}
        clean={digitsOnly}
        inputMode="numeric"
        autoComplete="off"
        invalid={Boolean(shown)}
        autoFocus
      />
      <EmailField value={email} onChange={(value) => { setEmail(value); setProblem(''); }} />
      <ul className="obf-facts is-compact">
        <li><span className="obf-fact-icon" aria-hidden="true"><BadgeCheck size={18} /></span><span><strong>Everything stays.</strong> Your attendance, courses, face and password move to the matric number.</span></li>
        <li><span className="obf-fact-icon" aria-hidden="true"><Mail size={18} /></span><span><strong>Your LASU email becomes your account email.</strong> Your personal email gets a note that it changed.</span></li>
      </ul>
      {shown ? <p className="obf-error" role="alert">{shown}</p> : null}
      <FlowActions>
        <button className="obf-primary" type="submit" disabled={busy || matric.length !== 9}>
          {busy ? 'Sending the code…' : <>Send the code <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
        <button className="obf-link" type="button" onClick={onCancel} disabled={busy}>Not now</button>
      </FlowActions>
    </form>
  );
}

export function StudentSetupFlow() {
  const [phase, setPhase] = useState<SetupPhase>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadStudentSetup(controller.signal)
      .then((setup) => setPhase(setup.numberKind === 'jamb' && wantsMatricStep() ? { kind: 'matric', setup } : { kind: 'ready', setup }))
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
    const jamb = setup.numberKind === 'jamb';
    const address = jamb ? email.trim().toLowerCase() : lasuEmailFrom(email);
    if (typed && jamb && personalEmailProblem(address)) {
      setError(personalEmailProblem(address));
      return;
    }
    if (typed && !jamb && !isLasuStudentEmail(address)) {
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

  async function sendMatricCode(setup: StudentSetup, matricNumber: string, address: string) {
    setError('');
    setBusy(true);
    try {
      const sent = await requestMatricCode(matricNumber, address);
      setPhase({ kind: 'matric_code', setup, matricNumber, email: address, sentTo: sent.email, resendInSeconds: sent.resendInSeconds, sentAt: Date.now() });
    } catch (caught) {
      setError(failureText(caught, 'The code could not be sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMatric(matricNumber: string, address: string, code: string) {
    setError('');
    setBusy(true);
    try {
      const switched = await confirmMatricNumber(matricNumber, address, code);
      announceAccountChanged();
      setPhase({ kind: 'matric_done', ...switched });
    } catch (caught) {
      setError(failureText(caught, 'That code did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (phase.kind === 'loading') return <AccountPanelSkeleton label="Loading your account…" />;
  if (phase.kind === 'matric_done') {
    return (
      <FlowResult title="Your matric number is in">
        <p>
          You are <span className="obf-tabular">{phase.matricNumber}</span> on every register now, and your account email is <strong className="obf-wrap">{phase.email}</strong>.
          {phase.attendanceMoved > 0 ? ` ${phase.attendanceMoved} attendance ${phase.attendanceMoved === 1 ? 'record' : 'records'} moved with you.` : ' Your attendance moved with you.'}
        </p>
        <p className="obf-small">Sign in with the matric number from now on (the JAMB number {phase.previousNumber} still works). Your password has not changed.</p>
        <FlowActions><button className="obf-primary" type="button" onClick={reload}>Done</button></FlowActions>
      </FlowResult>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <FlowStep key="failed" eyebrow={SETUP_EYEBROW} title="We couldn’t load your account" lede={phase.message}>
        <FlowActions><button className="obf-primary" type="button" onClick={reload}>Try again</button></FlowActions>
      </FlowStep>
    );
  }

  const { setup } = phase;
  if (!setup.classList) {
    return (
      <FlowStep key="no-list" eyebrow="Not on a class list yet" title="Ask your HOC to add you" lede="Your matric number is not on a class list on LASUATOS yet. Once your HOC adds you, come back here to confirm your LASU email and register your face.">
        <FlowActions><Link className="obf-primary" href="/attendance">Back to my attendance</Link></FlowActions>
      </FlowStep>
    );
  }
  const list = setup.classList;
  const fullName = [list.surname, list.firstName, list.middleName].filter(Boolean).join(' ');
  const onJamb = setup.numberKind === 'jamb';
  const toMatric = () => { setError(''); setPhase({ kind: 'matric', setup }); };

  if (phase.kind === 'matric') {
    return (
      <FlowStep key="matric" eyebrow={MATRIC_EYEBROW} title="Add your matric number" lede="Got your LASU matric number and student email? Add them here. A code goes to the LASU email to confirm it is yours." onBack={() => { setError(''); setPhase({ kind: 'ready', setup }); }}>
        <StudentIdCard fullName={fullName} matricNumber={setup.studentNumber ?? undefined} department={list.departmentName} level={list.levelLabel} status="Direct Entry" />
        <AddMatricForm busy={busy} error={error} onSubmit={(matricNumber, address) => void sendMatricCode(setup, matricNumber, address)} onCancel={() => { setError(''); setPhase({ kind: 'ready', setup }); }} />
      </FlowStep>
    );
  }

  if (phase.kind === 'matric_code') {
    return (
      <FlowStep key={`matric-code-${phase.sentAt}`} eyebrow={MATRIC_EYEBROW} title="Check your LASU email" lede="Enter the 6-digit code we just sent. Open Gmail with your LASU account." onBack={() => { setError(''); setPhase({ kind: 'matric', setup: phase.setup }); }}>
        <CodeForm
          key={phase.sentAt}
          sentTo={phase.sentTo}
          resendAt={phase.sentAt + phase.resendInSeconds * 1000}
          busy={busy}
          error={error}
          submitLabel={`Switch to ${phase.matricNumber}`}
          onSubmit={(code) => void confirmMatric(phase.matricNumber, phase.email, code)}
          onResend={() => void sendMatricCode(phase.setup, phase.matricNumber, phase.email)}
          onChangeEmail={() => { setError(''); setPhase({ kind: 'matric', setup: phase.setup }); }}
        />
      </FlowStep>
    );
  }

  if (phase.kind === 'code') {
    return (
      <FlowStep key={`code-${phase.sentAt}`} step={1} eyebrow={SETUP_EYEBROW} title="Check your email" lede={isLasuStudentEmail(phase.sentTo) ? 'Enter the 6-digit code we just sent. Open Gmail with your LASU account.' : 'Enter the 6-digit code we just sent to your inbox.'} onBack={() => { setError(''); setPhase({ kind: 'ready', setup: phase.setup }); }}>
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
      </FlowStep>
    );
  }

  // Opened with the HOC's setup code: the face first (needed to check in), the email when they can.
  if (!setup.emailVerified && setup.vouched && setup.faceRequired && !setup.faceRegistered) {
    return (
      <FlowStep key="face-first" step={3} eyebrow={SETUP_EYEBROW} title="Register your face" lede="Your HOC’s setup code opened your account. Register your face now so you can mark attendance; confirm your LASU email when you can open it.">
        <FaceRegistration onRegistered={reload} />
      </FlowStep>
    );
  }

  if (!setup.emailVerified) {
    const listed = list.listedEmail;
    return (
      <FlowStep
        key="email"
        step={1}
        eyebrow={SETUP_EYEBROW}
        title={onJamb ? 'Confirm your email' : 'Confirm your LASU email'}
        lede={onJamb
          ? 'Until you have a LASU email, a personal one stands in. Confirm it once and it becomes your account email.'
          : 'Student accounts use LASU student emails. Confirm yours once and it becomes your account email.'}
      >
        <form className="obf-form" onSubmit={(event) => { event.preventDefault(); void sendCode(setup); }} noValidate>
          <StudentIdCard fullName={fullName} department={list.departmentName} level={list.levelLabel} />
          {listed ? (
            <MailChip address={listed} label="We’ll send a code to" />
          ) : onJamb ? (
            <PersonalEmailField value={email} onChange={setEmail} />
          ) : (
            <EmailField value={email} onChange={setEmail} />
          )}
          {setup.vouched ? (
            <p className="obf-notice">Your HOC’s setup code lets you use your account meanwhile. Until you confirm your LASU email, whoever confirms it can take the account over, so do it soon.</p>
          ) : null}
          {error ? <p className="obf-error" role="alert">{error}</p> : null}
          <FlowActions>
            <button className="obf-primary" type="submit" disabled={busy}>{busy ? 'Sending the code…' : <>Send the code <ArrowRight size={18} aria-hidden="true" /></>}</button>
            {onJamb ? <button className="obf-link" type="button" onClick={toMatric} disabled={busy}><GraduationCap size={15} aria-hidden="true" /> Got your matric number? Add it instead</button> : null}
            {setup.vouched ? <Link className="obf-link" href="/attendance">Not now</Link> : null}
          </FlowActions>
        </form>
      </FlowStep>
    );
  }

  if (setup.faceRequired && !setup.faceRegistered) {
    return (
      <FlowStep key="face" step={3} eyebrow={SETUP_EYEBROW} title="Register your face" lede="Needed to mark attendance: it confirms it is really you.">
        <FaceRegistration onRegistered={reload} />
      </FlowStep>
    );
  }

  return (
    <FlowResult title="Your account is ready">
      <p>{setup.emailKind === 'personal' ? 'Email' : 'LASU email'} confirmed{setup.faceRequired ? ' and face registered' : ''}. Scan the QR code at each class to mark your attendance.</p>
      {onJamb ? (
        <div className="obf-tip">
          <GraduationCap size={18} aria-hidden="true" />
          <p>
            You are on registers by your JAMB number, <span className="obf-mono">{setup.studentNumber}</span>. When your matric number and LASU email arrive, add them: your attendance moves with you.{' '}
            <button className="obf-inline-link" type="button" onClick={toMatric}>Add my matric number</button>
          </p>
        </div>
      ) : null}
      {setup.defaultPassword ? (
        <div className="obf-tip">
          <KeyRound size={18} aria-hidden="true" />
          <p>You still use the starting password (LASU + {setup.jambNumber ? 'your number' : 'matric'} + SURNAME). <Link href="/account/security#change-password">Change it</Link> to something only you know.</p>
        </div>
      ) : null}
      <FlowActions><ContinueButton /></FlowActions>
    </FlowResult>
  );
}
