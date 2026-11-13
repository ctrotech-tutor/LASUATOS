/**
 * Tells the operator that a page crashed in this browser (the error screen was
 * shown). Best effort: it never throws, sends each distinct error once per page
 * load, and skips chunk-load failures after a new deploy (a reload fixes those).
 */
const reported = new Set<string>();

export function reportPageError(error: Error & { digest?: string }): void {
  if (typeof window === 'undefined') return;
  const message = String(error?.message ?? '').slice(0, 1_000);
  const name = String(error?.name ?? 'Error').slice(0, 100);
  if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(`${name} ${message}`)) return;
  const key = `${name}:${message}:${window.location.pathname}`;
  if (reported.has(key)) return;
  reported.add(key);
  try {
    void fetch('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message,
        name,
        ...(error?.digest ? { digest: String(error.digest).slice(0, 100) } : {}),
        path: window.location.pathname,
        userAgent: navigator.userAgent.slice(0, 300),
      }),
    }).catch(() => undefined);
  } catch {
    // Reporting must never make a broken page worse.
  }
}
