import { LASU_MAIL_SCOPE, LasuMailConfigSchema, type LasuMailConfig } from '@lasuatos/contracts';
import { apiRequest } from '../lecture-api';
import { randomToken, safeReturnPath } from '../google-proof';

/**
 * LASU mail (ADR 030): connecting the student's LASU inbox, read-only.
 *
 * Google hands the browser a one-hour access token for `gmail.readonly` only, and
 * the browser talks to Gmail itself. Neither the token nor any mail ever reaches
 * the LASUATOS servers, which is what keeps the mailbox private (and keeps the app
 * out of Google's paid security assessment for apps that move mail through their
 * own servers).
 *
 * Like "Continue with Google" it is a full-page redirect to Google and back to
 * /auth/google, never a popup (this site's opener policy blocks popups). After the
 * first time, reconnecting is silent (`prompt=none`): Google answers straight away
 * while the student is still signed in to their LASU account and has not taken the
 * permission back.
 */

const PENDING_KEY = 'lasuatos.mail.pending';
const TOKEN_KEY = 'lasuatos.mail.token';
const RESULT_KEY = 'lasuatos.mail.result';
/** Remembers that this browser connected the mailbox, so the next visit reconnects silently. */
const CONNECTED_KEY = 'lasuatos.mail.connected';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ROUND_TRIP_MS = 10 * 60 * 1000;
/** Tokens are treated as expired a minute early, so a request never starts on a dying one. */
const EARLY_MS = 60 * 1000;

export type ReadyMailConfig = LasuMailConfig & { readonly status: 'ready'; readonly clientId: string; readonly redirectUri: string; readonly hostedDomain: string };

export interface MailToken {
  readonly accessToken: string;
  readonly expiresAt: number;
  /** The LASUATOS account (email) that connected it: nobody else signed in here may use it. */
  readonly owner: string;
}

/** Who connected which LASU mailbox on this device, for quiet reconnects. */
interface Connected {
  readonly owner: string;
  readonly mailbox: string;
}

interface Pending {
  readonly state: string;
  readonly owner: string;
  readonly silent: boolean;
  readonly returnTo: string;
  readonly startedAt: number;
}

export type MailProblem = 'cancelled' | 'not_allowed_by_lasu' | 'needs_sign_in' | 'scope_unticked' | 'expired' | 'failed' | 'not_lasu_mailbox';

export interface MailResult {
  readonly problem: MailProblem;
  readonly silent: boolean;
  readonly at: number;
}

/* ---------------- configuration ---------------- */

export const loadLasuMailConfig = (signal?: AbortSignal) =>
  apiRequest('/api/v1/mail/config', LasuMailConfigSchema, signal ? { signal } : undefined);

let onPromise: Promise<boolean> | null = null;

/** Whether LASU mail is switched on for the signed-in student; asked once per page load. */
export function lasuMailOn(): Promise<boolean> {
  onPromise ??= loadLasuMailConfig()
    .then((config) => config.status === 'ready')
    .catch(() => {
      onPromise = null;
      return false;
    });
  return onPromise;
}

export function readyConfig(config: LasuMailConfig | null | undefined, origin: string): ReadyMailConfig | null {
  if (!config || config.status !== 'ready' || !config.clientId || !config.redirectUri || !config.hostedDomain) return null;
  try {
    // Google returns only to the address registered for the client (production).
    if (new URL(config.redirectUri).origin !== origin) return null;
  } catch {
    return null;
  }
  return config as ReadyMailConfig;
}

/* ---------------- storage ---------------- */

/**
 * The token lives in this tab's session storage: gone when the tab closes, never
 * shared with other tabs or sent anywhere but Gmail. Everything else (the
 * round-trip state and the "connected before" flag) is in local storage.
 */
const store = (key: string): Storage => (key === TOKEN_KEY ? window.sessionStorage : window.localStorage);

function read<T>(key: string): T | null {
  try {
    const raw = store(key).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    store(key).setItem(key, JSON.stringify(value));
  } catch {
    // Storage off (private mode): the round trip cannot finish, which the page explains.
  }
}

function remove(key: string): void {
  try {
    store(key).removeItem(key);
  } catch {
    // Nothing to remove.
  }
}

const MAIL_CHANGED = 'lasuatos:mail-changed';

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MAIL_CHANGED));
}

/** Calls back when this tab connects or drops the token, or another tab disconnects. */
export function onMailChanged(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONNECTED_KEY || event.key === null) callback();
  };
  window.addEventListener(MAIL_CHANGED, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(MAIL_CHANGED, callback);
    window.removeEventListener('storage', onStorage);
  };
}

/** The live token this account connected, or null (none, expired, or another account's). */
export function currentToken(owner: string, now = Date.now()): MailToken | null {
  const token = read<MailToken>(TOKEN_KEY);
  if (!token || typeof token.accessToken !== 'string' || typeof token.expiresAt !== 'number') return null;
  if (token.owner !== owner.toLowerCase()) return null;
  if (token.expiresAt - EARLY_MS <= now) {
    remove(TOKEN_KEY);
    return null;
  }
  return token;
}

/** The LASU mailbox this account connected on this device before (so reconnecting can be quiet). */
export function connectedMailbox(owner: string): string | null {
  const connected = read<Connected>(CONNECTED_KEY);
  return connected && connected.owner === owner.toLowerCase() && typeof connected.mailbox === 'string' ? connected.mailbox : null;
}

/** Remembers the mailbox once Gmail confirmed which one it is. */
export function rememberMailbox(owner: string, mailbox: string): void {
  write(CONNECTED_KEY, { owner: owner.toLowerCase(), mailbox: mailbox.toLowerCase() } satisfies Connected);
}

/** Whether an address belongs to one of the LASU domains this site may open. */
export function inDomains(email: string, domains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  return at > 0 && domains.includes(email.slice(at + 1).toLowerCase());
}

/** The token was refused by Gmail (expired early or permission taken back): forget it. */
export function dropToken(): void {
  remove(TOKEN_KEY);
  announce();
}

/**
 * Disconnect: forget everything here and ask Google to take the permission back, so
 * nothing on this device or at Google lets LASUATOS read the mailbox until the
 * student connects again.
 */
export async function disconnect(): Promise<void> {
  const token = read<MailToken>(TOKEN_KEY);
  remove(TOKEN_KEY);
  remove(CONNECTED_KEY);
  // A problem just reported (a mailbox that isn't LASU's) stays, so the page can explain it.
  announce();
  if (!token?.accessToken) return;
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: token.accessToken }).toString(),
  }).catch(() => undefined);
}

/** On sign-out: this device keeps nothing of the mailbox (the permission at Google stays). */
export function forgetMail(): void {
  onPromise = null;
  remove(TOKEN_KEY);
  remove(CONNECTED_KEY);
  remove(PENDING_KEY);
  remove(RESULT_KEY);
  announce();
}

/* ---------------- going to Google ---------------- */

export function mailAuthUrl(config: ReadyMailConfig, state: string, silent: boolean, hint: string | null): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', LASU_MAIL_SCOPE);
  url.searchParams.set('state', state);
  // The LASU mailbox if known, and only accounts of LASU's Google Workspace on the chooser.
  if (hint) url.searchParams.set('login_hint', hint);
  url.searchParams.set('hd', config.hostedDomain);
  // Never mix in the sign-in permissions: this token can read mail and nothing else.
  url.searchParams.set('include_granted_scopes', 'false');
  if (silent) url.searchParams.set('prompt', 'none');
  else if (!hint) url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/**
 * Off to Google for `owner` (the signed-in account's email). `silent` asks without
 * showing anything; it is only offered once a mailbox was connected here before.
 */
export function connect(config: ReadyMailConfig, options: { readonly owner: string; readonly returnTo: string; readonly silent?: boolean }): void {
  const state = randomToken();
  const remembered = connectedMailbox(options.owner);
  const pending: Pending = {
    state,
    owner: options.owner.toLowerCase(),
    silent: Boolean(options.silent && remembered),
    returnTo: safeReturnPath(options.returnTo),
    startedAt: Date.now(),
  };
  write(PENDING_KEY, pending);
  remove(RESULT_KEY);
  if (pending.silent) markSilentAttempt();
  window.location.assign(mailAuthUrl(config, state, pending.silent, remembered ?? config.mailbox));
}

/* ---------------- coming back ---------------- */

export function problemFor(error: string, silent: boolean): MailProblem {
  if (error === 'access_denied') return 'cancelled';
  if (error === 'admin_policy_enforced' || error === 'org_internal' || error === 'unauthorized_client' || error === 'restricted_client') return 'not_allowed_by_lasu';
  if (silent || error === 'interaction_required' || error === 'login_required' || error === 'consent_required' || error === 'account_selection_required') return 'needs_sign_in';
  return 'failed';
}

/** Granted scopes come back space-separated; the student may have unticked mail on Google's page. */
export function grantsMail(scope: string | null): boolean {
  return (scope ?? '').split(/\s+/).includes(LASU_MAIL_SCOPE);
}

/**
 * Called by /auth/google. When Google's answer belongs to a mail connection
 * started here, keeps the token (or what went wrong) and says where to go back;
 * otherwise returns null and the page treats it as "Continue with Google".
 */
export function finishMail(hash: string, now = Date.now()): { readonly returnTo: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const pending = read<Pending>(PENDING_KEY);
  if (!pending || typeof pending.state !== 'string' || params.get('state') !== pending.state) return null;
  remove(PENDING_KEY);
  const fail = (problem: MailProblem) => write(RESULT_KEY, { problem, silent: pending.silent, at: now } satisfies MailResult);
  const accessToken = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') ?? '0');
  if (now - pending.startedAt > ROUND_TRIP_MS) fail('expired');
  else if (!accessToken) fail(problemFor(params.get('error') ?? '', pending.silent));
  else if (!grantsMail(params.get('scope'))) fail('scope_unticked');
  else {
    write(TOKEN_KEY, { accessToken, expiresAt: now + Math.max(60, Math.min(expiresIn || 3600, 3600)) * 1000, owner: pending.owner } satisfies MailToken);
    remove(RESULT_KEY);
  }
  return { returnTo: safeReturnPath(pending.returnTo) };
}

/** Records a problem found after the round trip (the page checks which mailbox it got). */
export function reportMailProblem(problem: MailProblem, now = Date.now()): void {
  write(RESULT_KEY, { problem, silent: false, at: now } satisfies MailResult);
}

/** What went wrong on the last trip to Google, once. */
export function takeMailResult(now = Date.now()): MailResult | null {
  const result = read<MailResult>(RESULT_KEY);
  remove(RESULT_KEY);
  if (!result || now - result.at > ROUND_TRIP_MS) return null;
  return result;
}

/** A silent reconnect that failed recently is not tried again straight away (no redirect loops). */
const SILENT_KEY = 'lasuatos.mail.silent-at';
export function maySilentlyReconnect(now = Date.now()): boolean {
  const at = read<number>(SILENT_KEY);
  return typeof at !== 'number' || now - at > 2 * 60 * 1000;
}
export function markSilentAttempt(now = Date.now()): void {
  write(SILENT_KEY, now);
}

export const PROBLEM_TEXT: Readonly<Record<MailProblem, { title: string; body: string }>> = {
  cancelled: { title: 'Not connected', body: 'You closed Google’s page or chose Cancel, so LASUATOS cannot show your mail. Connect again whenever you like.' },
  not_allowed_by_lasu: {
    title: 'LASU hasn’t switched this on yet',
    body: 'LASU’s Google settings don’t let apps read student mail until the university approves them. You can still read your mail in the Gmail app or at mail.google.com.',
  },
  needs_sign_in: { title: 'Connect again', body: 'Google needs you to pick your LASU account again (you may have signed out of it, or an hour has passed).' },
  scope_unticked: {
    title: 'Mail wasn’t ticked',
    body: 'On Google’s page, leave “View your email messages and settings” ticked. LASUATOS can only read, never send, change or delete.',
  },
  expired: { title: 'That took too long', body: 'Google’s answer came back too late. Connect again.' },
  not_lasu_mailbox: {
    title: 'That isn’t a LASU mailbox',
    body: 'You picked a personal Google account. Connect again and choose your LASU student account (it ends in @st.lasu.edu.ng).',
  },
  failed: { title: 'Google didn’t finish', body: 'Something went wrong on Google’s page. Try again in a moment.' },
};
