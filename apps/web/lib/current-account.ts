'use client';

import { SessionStatusSchema, type AuthenticatedSession } from '@lasuatos/contracts';
import { useEffect, useState } from 'react';

export type CurrentAccount = AuthenticatedSession['account'];

export type SessionLookup =
  | { readonly kind: 'signed_in'; readonly account: CurrentAccount }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'unavailable' };

const REUSE_MS = 30_000;
let cached: { readonly at: number; readonly promise: Promise<SessionLookup> } | null = null;

async function fetchSessionOnce(): Promise<SessionLookup> {
  try {
    // The status route answers 200 when signed out, so public pages do not log a failed request.
    const response = await fetch('/api/v1/auth/session/status', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) return { kind: 'signed_out' };
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = SessionStatusSchema.safeParse(await response.json());
    if (!parsed.success) return { kind: 'unavailable' };
    return parsed.data.status === 'authenticated' ? { kind: 'signed_in', account: parsed.data.account } : { kind: 'signed_out' };
  } catch {
    return { kind: 'unavailable' };
  }
}

const RETRY_DELAYS_MS = [700, 1_500, 3_000];

/**
 * A refresh after the site has been idle can reach a server (and database)
 * that is still waking up. That is a connection problem, not a signed-out
 * account, so it is retried for a few seconds before giving up. Only a 401
 * means the person must sign in again.
 */
async function fetchSession(): Promise<SessionLookup> {
  let result = await fetchSessionOnce();
  for (const delay of RETRY_DELAYS_MS) {
    if (result.kind !== 'unavailable') return result;
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await fetchSessionOnce();
  }
  return result;
}

/**
 * One session lookup shared by the account menu, the page gate and greetings,
 * so a page load asks the server once instead of three times. Reused for 30
 * seconds; sign-in and sign-out reload the page, which clears it.
 */
export function lookupSession(): Promise<SessionLookup> {
  const now = Date.now();
  if (!cached || now - cached.at > REUSE_MS) {
    const promise = fetchSession();
    cached = { at: now, promise };
    // Do not keep a failed lookup around; the next caller should retry.
    void promise.then((result) => {
      if (result.kind === 'unavailable' && cached?.promise === promise) cached = null;
    });
  }
  return cached.promise;
}

export function forgetSession(): void {
  cached = null;
}

/**
 * Signs this browser out. Network trouble is ignored: the caller reloads or moves on, and the
 * next lookup asks the server again. Returns whether the server confirmed it.
 */
export async function endSession(): Promise<boolean> {
  const ok = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' })
    .then((response) => response.ok)
    .catch(() => false);
  forgetSession();
  return ok;
}

/**
 * The signed-in account if the answer comes within `waitMs`, otherwise null. For pages that
 * adjust to a signed-in visitor but must never be held up by a slow lookup.
 */
export function quickAccount(waitMs = 1_500): Promise<CurrentAccount | null> {
  return Promise.race([
    lookupSession().then((result) => (result.kind === 'signed_in' ? result.account : null)),
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), waitMs);
    }),
  ]);
}

const ACCOUNT_CHANGED = 'lasuatos:account-changed';

/** Tells the header, greetings and gates that the signed-in person's details changed. */
export function announceAccountChanged(): void {
  forgetSession();
  window.dispatchEvent(new Event(ACCOUNT_CHANGED));
}

/** Runs `listener` whenever announceAccountChanged() is called; returns the unsubscribe. */
export function onAccountChanged(listener: () => void): () => void {
  window.addEventListener(ACCOUNT_CHANGED, listener);
  return () => window.removeEventListener(ACCOUNT_CHANGED, listener);
}

/** `undefined` while loading, `null` when signed out or unavailable. */
export function useCurrentAccount(): CurrentAccount | null | undefined {
  const [account, setAccount] = useState<CurrentAccount | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const load = () => {
      void lookupSession().then((result) => {
        if (active) setAccount(result.kind === 'signed_in' ? result.account : null);
      });
    };
    load();
    const unsubscribe = onAccountChanged(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return account;
}

const TITLE = /^(dr|prof|professor|mr|mrs|ms|miss|engr|arc|barr)\.?$/i;
const INITIALS = /^([A-Za-z]\.)+[A-Za-z]?\.?$/;
/** A class-list SURNAME in capitals ("OKAFOR"), as opposed to a short all-capital initial like "A". */
const SURNAME_IN_CAPITALS = /^[A-Z][A-Z'-]+$/;

export function firstName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  // Skip titles such as "Dr." or "Prof." and initials such as "O.A".
  const named = parts.filter((part) => !TITLE.test(part) && !INITIALS.test(part));
  // Class lists put the SURNAME first in capitals ("OKAFOR Chidinma"): the first name follows it.
  if (named.length > 1 && SURNAME_IN_CAPITALS.test(named[0]!) && !SURNAME_IN_CAPITALS.test(named[1]!)) return named[1]!;
  return named[0] ?? parts[0] ?? displayName;
}

/**
 * How to address someone on the site: "Dr. Adeyemi" for staff with a title (not "Folasade"),
 * otherwise their first name.
 */
export function addressName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  const title = parts[0] && TITLE.test(parts[0]) ? parts[0] : null;
  const named = parts.filter((part) => !TITLE.test(part) && !INITIALS.test(part));
  if (title && named.length > 0) {
    const short = title.replace(/\.$/, '').toLowerCase() === 'professor' ? 'Prof' : title.replace(/\.$/, '');
    const surname = named[named.length - 1]!;
    const tidy = SURNAME_IN_CAPITALS.test(surname) ? surname[0] + surname.slice(1).toLowerCase() : surname;
    return `${short[0]!.toUpperCase()}${short.slice(1).toLowerCase()}. ${tidy}`;
  }
  return firstName(displayName);
}

export function greetingForNow(date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Lagos' }).format(date));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export type AdministratorAccount = Extract<CurrentAccount, { accountType: 'administrator' }>;

/**
 * The signed-in administrator, or a message for the page to show. Signed-out
 * visitors are sent to sign in; a connection problem is reported as one, never
 * as "sign in again".
 */
export async function lookupAdministrator(purpose: string): Promise<
  { readonly kind: 'ok'; readonly account: AdministratorAccount } | { readonly kind: 'error'; readonly message: string }
> {
  const result = await lookupSession();
  if (result.kind === 'signed_out') {
    window.location.replace('/sign-in');
    return { kind: 'error', message: `Sign in to ${purpose}.` };
  }
  if (result.kind === 'unavailable') return { kind: 'error', message: 'We could not reach LASUATOS. Check your connection and try again.' };
  if (result.account.accountType !== 'administrator') return { kind: 'error', message: `An administrator account is required to ${purpose}.` };
  return { kind: 'ok', account: result.account };
}
