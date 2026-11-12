/**
 * Shown while the next page's code and data arrive (slow mobile data). Kept to a
 * thin progress bar so fast navigations do not flash a skeleton over the page.
 */
export default function Loading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading-bar" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
