'use client';

import type { StudentSetup } from '@lasuatos/contracts';
import { Camera, ChevronRight, KeyRound, MailCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { preloadFaceTracker } from '../../lib/face-tracker';
import { failureText } from '../../lib/lecture-api';
import { confirmFaceReplace, OWN_FACE_PHOTO_URL, requestFaceReplaceCode } from '../../lib/student-api';
import { Button, Section } from '../ds';
import { PasswordField } from '../password-field';
import { CodeForm } from '../student-onboarding';
import { dateLabel } from './model';

const time = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });

/** The new-photos window is open (confirmed with password and email code) for at least 15 more seconds. */
export function replaceOpen(setup: StudentSetup | null | undefined, now: number): setup is StudentSetup & { faceReplaceAllowedUntil: string } {
  return Boolean(setup?.faceReplaceAllowedUntil && new Date(setup.faceReplaceAllowedUntil).getTime() > now + 15_000);
}

/**
 * The registered face: the photo and when it was taken, and taking new photos when check-ins
 * keep failing. Shown only to students with a registered face.
 */
export function FaceSection({ setup, now, onStart, onCamera }: Readonly<{
  setup: StudentSetup;
  now: number;
  onStart: () => void;
  onCamera: () => void;
}>) {
  const open = replaceOpen(setup, now);
  return (
    <Section
      title="Face check"
      id="acs-face"
      footer="Every check-in compares your face with these photos. If check-ins keep failing (new glasses, a new hairstyle, a dark first photo), take new ones in good light."
    >
      <ul className="ds-list acs-face">
        <li>
          <div className="ds-row acs-face-current">
            <img src={`${OWN_FACE_PHOTO_URL}?v=${encodeURIComponent(setup.faceEnrolledAt ?? '')}`} alt="Your registered face" width={56} height={56} />
            <span className="ds-row-body">
              <span className="ds-row-title">Registered</span>
              <span className="ds-row-subtitle">{setup.faceEnrolledAt ? `Photos taken ${dateLabel(setup.faceEnrolledAt, now)}` : 'Photos on file'}</span>
            </span>
          </div>
        </li>
        <li>
          {open ? (
            <button className="ds-row acs-action" type="button" onClick={onCamera}>
              <span className="acs-action-icon" aria-hidden="true"><Camera size={18} strokeWidth={2} /></span>
              <span className="ds-row-body">
                <span className="ds-row-title is-tint">Open the camera</span>
                <span className="ds-row-subtitle">Confirmed. Take your new photos by {time.format(new Date(setup.faceReplaceAllowedUntil))}.</span>
              </span>
              <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : (
            <button className="ds-row acs-action" type="button" onClick={onStart}>
              <span className="acs-action-icon" aria-hidden="true"><Camera size={18} strokeWidth={2} /></span>
              <span className="ds-row-body"><span className="ds-row-title is-tint">Take new photos</span></span>
              <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
        </li>
      </ul>
    </Section>
  );
}

type Step =
  | { readonly kind: 'password' }
  | { readonly kind: 'code'; readonly sentTo: string; readonly resendAt: number }
  | { readonly kind: 'ready'; readonly until: string };

/**
 * Confirming it is them before new photos, in a sheet: the password, then a code sent to the LASU
 * email, so someone holding an unlocked phone cannot put their own face on the account. Then
 * "Open the camera" closes the sheet and starts the camera (in the same tap, as phones require).
 */
export function FaceConfirmForm({ onConfirmed, onCamera }: Readonly<{
  onConfirmed: (until: string) => void;
  onCamera: () => void;
}>) {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // New photos are coming: fetch the camera's face guide meanwhile.
  useEffect(() => {
    preloadFaceTracker();
  }, []);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    if (!password) return setError('Type your password.');
    setBusy(true);
    setError('');
    try {
      const sent = await requestFaceReplaceCode(password);
      setStep({ kind: 'code', sentTo: sent.email, resendAt: Date.now() + sent.resendInSeconds * 1000 });
    } catch (caught) {
      setError(failureText(caught, 'The code was not sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(code: string) {
    setBusy(true);
    setError('');
    try {
      const confirmed = await confirmFaceReplace(code);
      onConfirmed(confirmed.allowedUntil);
      setStep({ kind: 'ready', until: confirmed.allowedUntil });
    } catch (caught) {
      setError(failureText(caught, 'That code did not work. Check it and try again.'));
    } finally {
      setBusy(false);
    }
  }

  const number = step.kind === 'password' ? 1 : step.kind === 'code' ? 2 : 3;
  return (
    <div className="acs-form acs-face-flow">
      <ol className="acs-steps" aria-label={`Step ${number} of 3`}>
        {[1, 2, 3].map((index) => <li key={index} className={index < number ? 'is-done' : index === number ? 'is-now' : undefined} aria-hidden="true" />)}
      </ol>
      {step.kind === 'password' ? (
        <form className="acs-form" onSubmit={(event) => void sendCode(event)} onInput={() => setError('')} noValidate>
          <p className="acs-step-text"><KeyRound size={17} strokeWidth={2.2} aria-hidden="true" /> First, your password. We then email a code to your LASU address.</p>
          <PasswordField label="Your password" name="password" autoComplete="current-password" autoFocus />
          {error ? <p className="acs-error" role="alert">{error}</p> : null}
          <Button type="submit" size="lg" block busy={busy} disabled={busy}>{busy ? 'Checking…' : 'Send the code'}</Button>
        </form>
      ) : null}
      {step.kind === 'code' ? (
        <div className="acs-form acs-code">
          <p className="acs-step-text"><MailCheck size={17} strokeWidth={2.2} aria-hidden="true" /> Now the 6-digit code from your email.</p>
          <CodeForm
            sentTo={step.sentTo}
            resendAt={step.resendAt}
            busy={busy}
            error={error}
            onSubmit={(code) => void confirm(code)}
            onResend={() => { setError(''); setStep({ kind: 'password' }); }}
            submitLabel="Confirm"
          />
        </div>
      ) : null}
      {step.kind === 'ready' ? (
        <div className="acs-form">
          <p className="acs-step-text"><Camera size={17} strokeWidth={2.2} aria-hidden="true" /> Confirmed. Three photos, like when you registered: straight on, then turned left and right. Face a window or a light.</p>
          <Button size="lg" block icon={<Camera size={18} aria-hidden="true" />} onClick={onCamera}>Open the camera</Button>
          <p className="acs-fine">Open until {time.format(new Date(step.until))}. The new photos must look like you in the old ones; if your registered photos are of someone else, ask your HOC to reset them.</p>
        </div>
      ) : null}
    </div>
  );
}
