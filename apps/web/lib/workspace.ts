/**
 * Where each kind of account works, and the safe `?next=` rule. Plain module (no 'use client'),
 * so the proxy, server pages and client components all share one answer.
 */

export type AccountKind = 'student' | 'lecturer' | 'administrator';

/** The home of each account: students see their attendance, staff take it, administrators run it. */
export function workspacePath(accountType: AccountKind): string {
  if (accountType === 'lecturer') return '/sessions';
  if (accountType === 'administrator') return '/admin';
  return '/attendance';
}

/** The words on a link to that home, written from the person's side. */
export function workspaceLabel(accountType: AccountKind): string {
  if (accountType === 'lecturer') return 'Take attendance';
  if (accountType === 'administrator') return 'Administration';
  return 'My attendance';
}

/** A button that takes the person home: "Go to my attendance". */
export function workspaceAction(accountType: AccountKind): string {
  if (accountType === 'lecturer') return 'Go to my sessions';
  if (accountType === 'administrator') return 'Go to administration';
  return 'Go to my attendance';
}

export function roleLabel(accountType: AccountKind): string {
  if (accountType === 'lecturer') return 'Lecturer';
  if (accountType === 'administrator') return 'Administrator';
  return 'Student';
}

/** "Dr. Funke Adebayo" → "FA". Titles and initials are skipped by taking letters only. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?';
}

/** Pages for people who are not signed in yet. A signed-in visitor is never sent back to one. */
const SIGNED_OUT_PAGES = ['/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/verify-email', '/accept-invitation'];

/**
 * A same-site path from `?next=`, or null. Never an absolute or protocol-relative URL, never a
 * backslash trick, never control characters, and never another signed-out page (that would loop).
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 300) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const path = raw.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (SIGNED_OUT_PAGES.includes(path.toLowerCase())) return null;
  return raw;
}
