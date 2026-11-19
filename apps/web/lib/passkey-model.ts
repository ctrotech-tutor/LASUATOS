import type { Passkey } from '@lasuatos/contracts';

/*
 * Pure helpers for staff passkeys (ADR 037), kept apart from the browser calls so they are tested.
 */

export type CeremonyFailure =
  /** The person closed the passkey prompt or it timed out: nothing to show beyond a quiet note. */
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

function nameOf(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : '';
}

function codeOf(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
}

/**
 * What to say when the browser's passkey prompt fails. Browsers report "the person said no", "it
 * timed out" and "there is no passkey here" all as NotAllowedError on purpose (so a site cannot
 * probe which passkeys exist), so those read as cancelled rather than as an error.
 */
export function ceremonyFailure(error: unknown, purpose: 'add' | 'sign_in'): CeremonyFailure {
  const name = nameOf(error);
  const code = codeOf(error);
  if (name === 'NotAllowedError' || name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED') return { kind: 'cancelled' };
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') {
    return { kind: 'failed', message: 'This device or password manager already has a passkey for your account. Use that one, or add a passkey on another device.' };
  }
  if (code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT' || code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT' || name === 'ConstraintError') {
    return { kind: 'failed', message: 'This security key can’t check that it’s you (no PIN or fingerprint), so it can’t be a LASUATOS passkey. Use your phone or computer’s screen lock instead.' };
  }
  if (code === 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG' || name === 'NotSupportedError') {
    return { kind: 'failed', message: 'This device can’t make a passkey LASUATOS accepts. Try your phone, or another browser.' };
  }
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID' || name === 'SecurityError') {
    return { kind: 'failed', message: 'Passkeys only work on the LASUATOS address itself. Open LASUATOS directly (not inside another app) and try again.' };
  }
  return {
    kind: 'failed',
    message: purpose === 'add'
      ? 'Your device couldn’t make the passkey. Try again; if it keeps failing, try another browser.'
      : 'Your device couldn’t use the passkey. Try again, or sign in with your password.',
  };
}

/** The line under a passkey, e.g. "Synced · last used 2 days ago" or "This device only · not used yet". */
export function passkeyLine(passkey: Pick<Passkey, 'synced' | 'lastUsedAt' | 'createdAt'>, ago: (iso: string) => string, added: (iso: string) => string): string {
  const where = passkey.synced ? 'Synced' : 'This device only';
  const used = passkey.lastUsedAt ? `last used ${ago(passkey.lastUsedAt)}` : `added ${added(passkey.createdAt)}, not used yet`;
  return `${where} · ${used}`;
}

/**
 * Remembered on a device that has signed in with, or added, a passkey: only there does the sign-in
 * page offer passkeys in the email field's autofill. Everyone else (every student) never asks the
 * server for a passkey challenge just by opening the page.
 */
export const PASSKEY_DEVICE_KEY = 'lasuatos:passkey-device';
