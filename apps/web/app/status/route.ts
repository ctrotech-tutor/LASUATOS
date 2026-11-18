import { NextResponse } from 'next/server';

/**
 * lasuatos…/status: a short address for the independent status page (ADR 034), so
 * posters and messages never go stale if the status page moves. It needs LASUATOS
 * itself to answer, so Help also gives the status page's own address to bookmark.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const target = statusPageUrl();
  const response = NextResponse.redirect(target ?? new URL('/help#q-down', request.url), 307);
  response.headers.set('cache-control', 'public, max-age=300');
  return response;
}

function statusPageUrl(): string | null {
  const value = process.env.STATUS_PAGE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.href : null;
  } catch {
    return null;
  }
}
