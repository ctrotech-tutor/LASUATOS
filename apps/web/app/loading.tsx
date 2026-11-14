/**
 * Shown while the next page's code and data arrive (slow mobile data). Kept to a
 * thin progress bar so fast navigations do not flash a skeleton over the page.
 * The spacer holds a screen's height for the page, so the footer never jumps up
 * into view and back down while it streams in (that jump read as a layout shift).
 */
export default function Loading() {
  return (
    <>
      <div className="route-loading" role="status" aria-live="polite">
        <span className="route-loading-bar" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
      <div className="route-loading-space" aria-hidden="true" />
    </>
  );
}
