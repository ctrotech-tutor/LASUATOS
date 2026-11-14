import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath, workspacePath, type AccountKind } from './lib/workspace';

const SESSION_COOKIE = 'lasuatos_session';
const ACCOUNT_KINDS: readonly string[] = ['student', 'lecturer', 'administrator'];
/** Past this the page is served as usual and the in-page check takes over; the form never waits long. */
const LOOKUP_TIMEOUT_MS = 2_500;

type Lookup = { kind: 'signed_in'; accountType: AccountKind } | { kind: 'signed_out' } | { kind: 'unknown' };

/** Asks the account service who owns this browser's session cookie. */
export async function lookupAccount(request: NextRequest, token: string): Promise<Lookup> {
  try {
    const response = await fetch(new URL('/api/v1/auth/session', request.nextUrl.origin), {
      headers: { cookie: `${SESSION_COOKIE}=${token}`, accept: 'application/json' },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (response.status === 401) return { kind: 'signed_out' };
    if (!response.ok) return { kind: 'unknown' };
    const body: unknown = await response.json();
    const accountType = (body as { status?: unknown; account?: { accountType?: unknown } } | null)?.account?.accountType;
    if ((body as { status?: unknown } | null)?.status === 'authenticated' && typeof accountType === 'string' && ACCOUNT_KINDS.includes(accountType)) {
      return { kind: 'signed_in', accountType: accountType as AccountKind };
    }
    return { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * Signed-in visitors skip the pages meant for signing in.
 * - /sign-in and /sign-up redirect to a safe `?next=` or the account's workspace, before any HTML
 *   is sent, so the form never flashes.
 * - /forgot-password shows "you're signed in" choices instead of the form (same address).
 * Only runs when the session cookie is present (see `config`), so visitors who are signed out pay
 * nothing. A slow or failing check never blocks the page: it is served as usual, and the
 * in-page check (components/auth/signed-in.tsx) catches up.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.next();

  const lookup = await lookupAccount(request, token);
  if (lookup.kind === 'signed_out') {
    // The cookie is stale (expired or signed out elsewhere): drop it so later visits skip the check.
    const response = NextResponse.next();
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  if (lookup.kind !== 'signed_in') return NextResponse.next();

  const { pathname, searchParams } = request.nextUrl;
  if (pathname === '/forgot-password') {
    return NextResponse.rewrite(new URL('/forgot-password/signed-in', request.url));
  }
  const target = safeNextPath(searchParams.get('next')) ?? workspacePath(lookup.accountType);
  const response = NextResponse.redirect(new URL(target, request.url), 307);
  response.headers.set('cache-control', 'private, no-store');
  return response;
}

// Literal values only: Next.js reads this at build time.
export const config = {
  matcher: [
    { source: '/sign-in', has: [{ type: 'cookie', key: 'lasuatos_session' }] },
    { source: '/sign-up', has: [{ type: 'cookie', key: 'lasuatos_session' }] },
    { source: '/forgot-password', has: [{ type: 'cookie', key: 'lasuatos_session' }] },
  ],
};
