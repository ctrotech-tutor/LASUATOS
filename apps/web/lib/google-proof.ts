import { GoogleSignInConfigSchema, type GoogleProof, type GoogleProofPurpose, type GoogleSignInConfig } from '@lasuatos/contracts';
import { apiRequest } from './lecture-api';

/**
 * "Continue with Google" in place of the emailed code (ADR 027).
 *
 * LASU student emails are Google accounts, so the student picks theirs on
 * Google's own page and Google sends back a signed statement (an ID token)
 * that they own it. Only `openid email` is asked for: Google shares the
 * address, never the mailbox.
 *
 * It is a full-page redirect, not a popup: popups are blocked by this site's
 * Cross-Origin-Opener-Policy and break in installed apps. What the step needs
 * after the round trip (the matric number, the step itself) waits in
 * localStorage, which an installed app on Android shares with the Chrome tab
 * Google may open in; it never holds a password. A random nonce, of which
 * Google only sees a digest tied to the step, makes the answer useless to
 * anyone but this browser, for anything but that step.
 */

const PENDING_KEY = 'lasuatos.google.pending';
const RESULT_KEY = 'lasuatos.google.result';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** A little under the server's 15 minutes, so a proof handed over still has time to be used. */
const MAX_AGE_MS = 14 * 60 * 1000;

export type GoogleContext = Readonly<Record<string, string>>;

interface Pending {
  readonly state: string;
  readonly nonce: string;
  readonly purpose: GoogleProofPurpose;
  readonly returnTo: string;
  readonly context: GoogleContext;
  readonly startedAt: number;
}

export type GoogleResult =
  | { readonly kind: 'proof'; readonly purpose: GoogleProofPurpose; readonly proof: GoogleProof; readonly email: string; readonly context: GoogleContext; readonly at: number }
  | { readonly kind: 'error'; readonly purpose: GoogleProofPurpose; readonly message: string; readonly context: GoogleContext; readonly at: number };

export type ReadyGoogleConfig = GoogleSignInConfig & { readonly clientId: string; readonly redirectUri: string };

/* ---------------- configuration ---------------- */

let configRequest: Promise<GoogleSignInConfig | null> | null = null;

/** Whether the button can show here: set up on the server, and this is the address Google returns to. */
export function usableConfig(config: GoogleSignInConfig | null, origin: string): ReadyGoogleConfig | null {
  if (!config?.clientId || !config.redirectUri) return null;
  try {
    if (new URL(config.redirectUri).origin !== origin) return null;
  } catch {
    return null;
  }
  return config as ReadyGoogleConfig;
}

/** Asked once per page load; a failure just hides the button (the code still works). */
export function loadGoogleConfig(): Promise<GoogleSignInConfig | null> {
  configRequest ??= apiRequest('/api/v1/students/google', GoogleSignInConfigSchema).catch(() => {
    configRequest = null;
    return null;
  });
  return configRequest;
}

/* ---------------- the nonce ---------------- */

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** base64url(SHA-256(purpose + ":" + raw)): the same as the server's googleNonceFor. */
export async function googleNonce(raw: string, purpose: GoogleProofPurpose): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${purpose}:${raw}`));
  return base64url(new Uint8Array(digest));
}

/* ---------------- storage ---------------- */

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode with storage off: the round trip cannot be finished, which the return page says.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clean up.
  }
}

/** Only a same-site path, never another site (the value comes back through storage). */
export function safeReturnPath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

/* ---------------- going to Google ---------------- */

export interface GoogleStart {
  readonly purpose: GoogleProofPurpose;
  /** Where to come back to (a path on this site); the page there picks the result up. */
  readonly returnTo: string;
  readonly context?: GoogleContext;
  /** The address expected (pre-selects that account on Google's page). */
  readonly loginHint?: string | null | undefined;
  /** A personal address (a student on a JAMB number): any Google account, not only LASU's. */
  readonly personal?: boolean;
}

/** Google's page, with everything it needs. */
export function googleAuthUrl(config: ReadyGoogleConfig, start: GoogleStart, state: string, hashedNonce: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('nonce', hashedNonce);
  url.searchParams.set('state', state);
  // Shows only LASU accounts on Google's chooser (Google still checks; so does the server).
  if (!start.personal) url.searchParams.set('hd', config.hostedDomain);
  if (start.loginHint) url.searchParams.set('login_hint', start.loginHint);
  // Without a hint, always show the chooser: many students are signed in to a personal Gmail too.
  else url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function startGoogle(config: ReadyGoogleConfig, start: GoogleStart): Promise<void> {
  const state = randomToken();
  const nonce = randomToken();
  const pending: Pending = {
    state,
    nonce,
    purpose: start.purpose,
    returnTo: safeReturnPath(start.returnTo),
    context: start.context ?? {},
    startedAt: Date.now(),
  };
  write(PENDING_KEY, pending);
  remove(RESULT_KEY);
  window.location.assign(googleAuthUrl(config, start, state, await googleNonce(nonce, start.purpose)));
}

/* ---------------- coming back ---------------- */

/** Google's answer for people: what went wrong and what to do now. */
export function googleErrorText(error: string): string {
  if (error === 'access_denied') return 'Google sign-in was cancelled. Try again, or get a code by email instead.';
  if (error === 'admin_policy_enforced' || error === 'org_internal' || error === 'unauthorized_client') {
    return 'LASU’s Google settings don’t allow this yet. Get a code by email instead.';
  }
  if (error === 'interaction_required' || error === 'login_required' || error === 'account_selection_required' || error === 'consent_required') {
    return 'Google needs you to sign in first. Try again and pick your LASU account.';
  }
  return 'Google sign-in didn’t finish. Try again, or get a code by email instead.';
}

/** The address in Google's answer, to show the student (the server checks everything). */
export function emailInCredential(credential: string): string {
  try {
    const part = credential.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === 'string' ? email.toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * Called by /auth/google with the fragment Google returned. Checks it was
 * started here (state), keeps the result for the page to pick up, and says
 * where to go back to.
 */
export function finishGoogle(hash: string, now = Date.now()): { readonly returnTo: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const pending = read<Pending>(PENDING_KEY);
  remove(PENDING_KEY);
  // Started in another browser or app (or storage is off): nothing here to go back to.
  if (!pending || typeof pending.state !== 'string' || typeof pending.nonce !== 'string') return null;
  const base = { purpose: pending.purpose, context: pending.context ?? {}, at: now };
  const credential = params.get('id_token');
  let result: GoogleResult;
  if (params.get('state') !== pending.state || now - pending.startedAt > MAX_AGE_MS) {
    result = { kind: 'error', ...base, message: 'That Google sign-in took too long, or was started in another tab. Try again.' };
  } else if (credential) {
    result = { kind: 'proof', ...base, proof: { credential, nonce: pending.nonce }, email: emailInCredential(credential) };
  } else {
    result = { kind: 'error', ...base, message: googleErrorText(params.get('error') ?? '') };
  }
  write(RESULT_KEY, result);
  return { returnTo: safeReturnPath(pending.returnTo) };
}

/** The result for this step, once (it is removed); null when there is none or it is too old. */
export function takeGoogleResult(purposes: readonly GoogleProofPurpose[], now = Date.now()): GoogleResult | null {
  const result = read<GoogleResult>(RESULT_KEY);
  if (!result || !purposes.includes(result.purpose)) return null;
  remove(RESULT_KEY);
  return now - result.at > MAX_AGE_MS ? null : result;
}

/**
 * In-app browsers (WhatsApp, Instagram, Facebook…) are blocked by Google's
 * sign-in. Used only to show a hint; nothing is stored or sent.
 */
export function inAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|WhatsApp|; wv\)/i.test(userAgent);
}
