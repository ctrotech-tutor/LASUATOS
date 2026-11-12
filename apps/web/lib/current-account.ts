'use client';

import { AuthenticatedSessionSchema, type AuthenticatedSession } from '@lasuatos/contracts';
import { useEffect, useState } from 'react';

export type CurrentAccount = AuthenticatedSession['account'];

export type SessionLookup =
  | { readonly kind: 'signed_in'; readonly account: CurrentAccount }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'unavailable' };

const REUSE_MS = 30_000;
let cached: { readonly at: number; readonly promise: Promise<SessionLookup> } | null = null;

async function fetchSession(): Promise<SessionLookup> {
  try {
    const response = await fetch('/api/v1/auth/session', { cache: 'no-store' });
    if (response.status === 401) return { kind: 'signed_out' };
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = AuthenticatedSessionSchema.safeParse(await response.json());
    return parsed.success ? { kind: 'signed_in', account: parsed.data.account } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
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

/** `undefined` while loading, `null` when signed out or unavailable. */
export function useCurrentAccount(): CurrentAccount | null | undefined {
  const [account, setAccount] = useState<CurrentAccount | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void lookupSession().then((result) => {
      if (active) setAccount(result.kind === 'signed_in' ? result.account : null);
    });
    return () => {
      active = false;
    };
  }, []);
  return account;
}

export function firstName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  // Skip titles such as "Dr." or "Prof." and initials such as "O.A".
  const usable = parts.find((part) => !/^(dr|prof|mr|mrs|ms|engr|arc|barr)\.?$/i.test(part) && !/^([A-Za-z]\.)+[A-Za-z]?\.?$/.test(part));
  return usable ?? parts[0] ?? displayName;
}

export function greetingForNow(date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Lagos' }).format(date));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
