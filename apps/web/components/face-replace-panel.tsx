'use client';

import type { FaceFrame, StudentSetup } from '@lasuatos/contracts';
import { Camera, KeyRound, ScanFace } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { failureText } from '../lib/lecture-api';
import { confirmFaceReplace, loadStudentSetup, OWN_FACE_PHOTO_URL, replaceFace, requestFaceReplaceCode } from '../lib/student-api';
import { FaceCapture } from './face-capture';
import { useFeedback } from './feedback';
import { PasswordField } from './password-field';
import { CodeForm } from './student-onboarding';

const FACE_POSES = ['front', 'left', 'right'] as const;

type Step =
  | { readonly kind: 'idle' }
  | { readonly kind: 'password' }
  | { readonly kind: 'code'; readonly sentTo: string; readonly resendAt: number }
  | { readonly kind: 'photos'; readonly until: string };

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(value));
}

function stillOpen(until: string | null): until is string {
  return Boolean(until && new Date(until).getTime() > Date.now() + 15_000);
}

/**
 * A student's registered face, and taking new photos when check-ins keep
 * failing (new glasses, a new hairstyle, a poor first photo). Confirmed with
 * the password and a code sent to the LASU email, so someone holding an
 * unlocked phone cannot put their own face on the account; the new photos
 * must also look like the face already registered.
 */
export function FaceReplacePanel() {
  const [setup, setSetup] = useState<StudentSetup | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [camera, setCamera] = useState(false);
  const [photoVersion, setPhotoVersion] = useState('');
  const dialogs = useFeedback();

  useEffect(() => {
    const controller = new AbortController();
    loadStudentSetup(controller.signal)
      .then((loaded) => {
        setSetup(loaded);
        setPhotoVersion(loaded.faceEnrolledAt ?? '');
        // Came back within the 20 minutes after confirming: go straight to the photos.
        if (stillOpen(loaded.faceReplaceAllowedUntil)) setStep({ kind: 'photos', until: loaded.faceReplaceAllowedUntil });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const cancelCamera = useCallback(() => setCamera(false), []);
  const captured = useCallback(async (frames: FaceFrame[]) => {
    setCamera(false);
    setBusy(true);
    setError('');
    try {
      const result = await replaceFace(frames);
      setPhotoVersion(result.enrolledAt);
      setSetup((current) => current && { ...current, faceEnrolledAt: result.enrolledAt, faceReplaceAllowedUntil: null });
      setStep({ kind: 'idle' });
      dialogs.toast('Your new face photos are saved. Use them at your next check-in.');
    } catch (caught) {
      const message = failureText(caught, 'Your new photos were not saved. Try again.');
      setError(message);
      if (/confirm/i.test(message) && /expired|first/i.test(message)) setStep({ kind: 'idle' });
    } finally {
      setBusy(false);
    }
  }, [dialogs]);

  if (!setup || !setup.faceRequired || !setup.faceRegistered) return null;

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const password = event ? String(new FormData(event.currentTarget).get('password') ?? '') : '';
    if (event && !password) {
      setError('Enter your password.');
      return;
    }
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
      setStep({ kind: 'photos', until: confirmed.allowedUntil });
    } catch (caught) {
      setError(failureText(caught, 'That code did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel fx-replace" aria-labelledby="face-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">FACE CHECK</p>
        <h2 id="face-heading">Your registered face</h2>
        <p>Each check-in compares your face with these photos. If check-ins keep failing, take new photos in good light.</p>
      </div>
      <div className="fx-replace-current">
        <img src={`${OWN_FACE_PHOTO_URL}?v=${encodeURIComponent(photoVersion)}`} alt="Your registered face" width={88} height={88} />
        <div>
          <strong><ScanFace size={16} aria-hidden="true" /> Registered</strong>
          {setup.faceEnrolledAt ? <span>Photos taken {formatDate(setup.faceEnrolledAt)}</span> : null}
        </div>
      </div>

      {step.kind === 'idle' ? (
        <>
          {error ? <p className="account-error" role="alert">{error}</p> : null}
          <button className="button button-secondary fx-replace-start" type="button" onClick={() => { setError(''); setStep({ kind: 'password' }); }}>
            <Camera size={17} aria-hidden="true" /> Take new photos
          </button>
        </>
      ) : null}

      {step.kind === 'password' ? (
        <form className="account-form" onSubmit={(event) => void sendCode(event)} noValidate>
          <p className="fx-replace-step"><KeyRound size={16} aria-hidden="true" /> Step 1 of 3: confirm it is you. We then email a code to your LASU address.</p>
          <PasswordField label="Your password" name="password" autoComplete="current-password" />
          {error ? <p className="account-error" role="alert">{error}</p> : null}
          <div className="fx-replace-actions">
            <button className="button button-secondary" type="button" onClick={() => { setError(''); setStep({ kind: 'idle' }); }} disabled={busy}>Cancel</button>
            <button className="account-primary-button" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Send the code'}</button>
          </div>
        </form>
      ) : null}

      {step.kind === 'code' ? (
        <div className="account-form">
          <p className="fx-replace-step">Step 2 of 3: the code from your email.</p>
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

      {step.kind === 'photos' ? (
        <div className="account-form">
          <p className="fx-replace-step"><Camera size={16} aria-hidden="true" /> Step 3 of 3: three photos, like when you registered. Face a window or a light. Open until {new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(new Date(step.until))}.</p>
          {error ? <p className="account-error" role="alert">{error}</p> : null}
          <button className="account-primary-button" type="button" disabled={busy} onClick={() => { setError(''); setCamera(true); }}>
            {busy ? 'Checking your photos…' : error ? 'Try again' : 'Open the camera'}
          </button>
          <p className="account-fine-print">The new photos must look like you in the old ones. If your registered photos are of someone else, ask your HOC or an administrator to reset them.</p>
        </div>
      ) : null}

      {camera ? <FaceCapture poses={FACE_POSES} title="Take new photos" review onDone={(frames) => void captured(frames)} onCancel={cancelCamera} /> : null}
    </section>
  );
}
