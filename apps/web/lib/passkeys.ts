'use client';

import {
  ApiProblemSchema,
  AuthenticatedSessionSchema,
  PASSKEY_UNKNOWN_PROBLEM,
  PasskeyOptionsSchema,
  PasskeySchema,
  type AuthenticatedSession,
  type Passkey,
  type PasskeyList,
} from '@lasuatos/contracts';
import { z } from 'zod';
import { ceremonyFailure, PASSKEY_DEVICE_KEY } from './passkey-model';

/*
 * Passkeys in the browser (ADR 037): signing in with one, and keeping the person's password
 * manager in step with LASUATOS through the WebAuthn Signal API. @simplewebauthn/browser is loaded
 * only when a passkey is actually used, so the sign-in page stays light for everyone else.
 */

const PasskeyAddedSchema = z.object({ passkey: PasskeySchema });

const UNREACHABLE = 'LASUATOS did not respond. Check your connection and try again.';

/** This browser can make and use passkeys (a secure page with the WebAuthn API). */
export function passkeysAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof window.PublicKeyCredential === 'function';
}

/** A device that has used a passkey here before: the sign-in page offers passkeys in autofill. */
export function deviceHasPasskey(): boolean {
  try {
    return window.localStorage.getItem(PASSKEY_DEVICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberPasskeyDevice(): void {
  try {
    window.localStorage.setItem(PASSKEY_DEVICE_KEY, '1');
  } catch {
    // Private browsing: autofill is simply not offered next time.
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** The server's own words when it wrote them for people, else `fallback`. */
export function problemText(status: number, body: unknown, fallback: string): string {
  if (status >= 500) return 'LASUATOS is busy or waking up. Wait a few seconds and try again.';
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  const problem = ApiProblemSchema.safeParse(body);
  const detail = problem.success ? problem.data.detail : undefined;
  return detail && !/^(The request is invalid\.|Authentication is required\.|Invalid request\.)$/.test(detail) ? detail : fallback;
}

export type PasskeySignIn =
  | { readonly kind: 'signed_in'; readonly account: AuthenticatedSession['account'] }
  | { readonly kind: 'cancelled' }
  /** The answer came after the five-minute challenge ran out (an autofill prompt left open). */
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Signs in with a passkey. `autofill` waits quietly for the person to pick a passkey from the email
 * field's suggestions (conditional mediation) instead of opening a prompt; another passkey request
 * (the button) cancels it, which reads as `cancelled`.
 */
export async function signInWithPasskey(mode: 'button' | 'autofill', onPicked?: () => void): Promise<PasskeySignIn> {
  let options;
  try {
    const response = await fetch('/api/v1/auth/passkeys/sign-in/options', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body = await readBody(response);
    const parsed = PasskeyOptionsSchema.safeParse(body);
    if (!response.ok || !parsed.success) return { kind: 'failed', message: problemText(response.status, body, 'Passkey sign-in did not start. Try again, or sign in with your password.') };
    options = parsed.data;
  } catch {
    return { kind: 'failed', message: UNREACHABLE };
  }

  const webauthn = await import('@simplewebauthn/browser');
  const requestOptions = options.options as unknown as Parameters<typeof webauthn.startAuthentication>[0]['optionsJSON'];
  let credential;
  try {
    credential = await webauthn.startAuthentication({ optionsJSON: requestOptions, useBrowserAutofill: mode === 'autofill' });
  } catch (error) {
    const failure = ceremonyFailure(error, 'sign_in');
    return failure.kind === 'cancelled' ? failure : { kind: 'failed', message: failure.message };
  }
  onPicked?.();

  try {
    const response = await fetch('/api/v1/auth/passkeys/sign-in', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: options.challengeId, credential }),
    });
    const body = await readBody(response);
    const session = AuthenticatedSessionSchema.safeParse(body);
    if (response.ok && session.success) {
      rememberPasskeyDevice();
      return { kind: 'signed_in', account: session.data.account };
    }
    if (response.status === 410) return { kind: 'expired' };
    const problem = ApiProblemSchema.safeParse(body);
    if (problem.success && problem.data.type === PASSKEY_UNKNOWN_PROBLEM && requestOptions.rpId) {
      // Removed in LASUATOS but still in the password manager: ask it to stop offering this one.
      void webauthn.sendSignal({ signalName: 'unknownCredential', rpID: requestOptions.rpId, credentialID: credential.id }).catch(() => undefined);
    }
    return { kind: 'failed', message: problemText(response.status, body, 'Your passkey didn’t work. Try again, or sign in with your password.') };
  } catch {
    return { kind: 'failed', message: UNREACHABLE };
  }
}

/**
 * Tells the password manager which LASUATOS passkeys this account still has (so removed ones stop
 * being offered) and the account's current email and name. Best effort: browsers without the
 * Signal API, or that refuse, are fine.
 */
export async function syncPasskeysWithDevice(list: PasskeyList, account: { readonly email: string; readonly displayName: string }): Promise<void> {
  if (!passkeysAvailable()) return;
  const credential = window.PublicKeyCredential as unknown as Record<string, unknown>;
  const accepted = typeof credential.signalAllAcceptedCredentials === 'function';
  const details = typeof credential.signalCurrentUserDetails === 'function';
  if (!accepted && !details) return;
  const webauthn = await import('@simplewebauthn/browser');
  const base = { rpID: list.relyingPartyId, userID: list.userHandle };
  await Promise.allSettled([
    accepted ? webauthn.sendSignal({ signalName: 'allAcceptedCredentials', ...base, allAcceptedCredentialIDs: list.passkeys.map((passkey) => passkey.credentialId) }) : null,
    details ? webauthn.sendSignal({ signalName: 'currentUserDetails', ...base, userName: account.email, userDisplayName: account.displayName }) : null,
  ]);
}

export type PasskeyAdded =
  | { readonly kind: 'added'; readonly passkey: Passkey }
  | { readonly kind: 'cancelled' }
  /** `field` is set when the password was the problem, so the form puts the cursor back there. */
  | { readonly kind: 'failed'; readonly message: string; readonly field?: 'currentPassword' };

/**
 * Adds a passkey to the signed-in staff account: the password again, then the device's own prompt
 * (fingerprint, face or screen lock), then LASUATOS checks the device's answer.
 */
export async function addPasskey(currentPassword: string): Promise<PasskeyAdded> {
  const post = (url: string, body: unknown) => fetch(url, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let options;
  try {
    const response = await post('/api/v1/auth/passkeys/registration/options', { currentPassword });
    const body = await readBody(response);
    const parsed = PasskeyOptionsSchema.safeParse(body);
    if (!response.ok || !parsed.success) {
      const message = problemText(response.status, body, 'Adding a passkey did not start. Try again.');
      return response.status === 400 ? { kind: 'failed', message, field: 'currentPassword' } : { kind: 'failed', message };
    }
    options = parsed.data;
  } catch {
    return { kind: 'failed', message: UNREACHABLE };
  }

  const webauthn = await import('@simplewebauthn/browser');
  let credential;
  try {
    credential = await webauthn.startRegistration({ optionsJSON: options.options as unknown as Parameters<typeof webauthn.startRegistration>[0]['optionsJSON'] });
  } catch (error) {
    const failure = ceremonyFailure(error, 'add');
    return failure.kind === 'cancelled' ? failure : { kind: 'failed', message: failure.message };
  }

  try {
    const response = await post('/api/v1/auth/passkeys/registration', { challengeId: options.challengeId, credential });
    const body = await readBody(response);
    const parsed = PasskeyAddedSchema.safeParse(body);
    if (response.ok && parsed.success) {
      rememberPasskeyDevice();
      return { kind: 'added', passkey: parsed.data.passkey };
    }
    if (response.status === 410) return { kind: 'failed', message: 'That took too long, so nothing was added. Try again.' };
    return { kind: 'failed', message: problemText(response.status, body, 'The passkey was not added. Try again.') };
  } catch {
    return { kind: 'failed', message: UNREACHABLE };
  }
}
