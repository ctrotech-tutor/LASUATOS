/**
 * Shown while the next page's code and data arrive (slow mobile data).
 * - Public pages: a thin gold bar along the top, so fast navigations never flash a skeleton.
 * - Workspaces: the shape of a page (eyebrow, large title, a line of text, cards) in the shell's
 *   own content area, faded in only after a moment, so a quick tap shows nothing at all and a slow
 *   one shows where things will land instead of a blank page.
 * The spacer holds a screen's height, so the footer never jumps up into view and back down while
 * the page streams in (that jump read as a layout shift).
 */
export default function Loading() {
  return (
    <div className="route-loading-wrap" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="route-loading" aria-hidden="true">
        <span className="route-loading-bar" />
      </div>
      <div className="route-skeleton" aria-hidden="true">
        <span className="ds-skeleton route-skeleton-eyebrow" />
        <span className="ds-skeleton route-skeleton-title" />
        <span className="ds-skeleton route-skeleton-line" />
        <span className="ds-skeleton route-skeleton-line is-short" />
        <div className="route-skeleton-cards">
          <span className="route-skeleton-card"><span className="ds-skeleton" /><span className="ds-skeleton is-wide" /></span>
          <span className="route-skeleton-card"><span className="ds-skeleton" /><span className="ds-skeleton is-wide" /></span>
          <span className="route-skeleton-card"><span className="ds-skeleton" /><span className="ds-skeleton is-wide" /></span>
        </div>
        <span className="route-skeleton-panel"><span className="ds-skeleton" /><span className="ds-skeleton is-wide" /><span className="ds-skeleton is-wide" /></span>
      </div>
      <div className="route-loading-space" aria-hidden="true" />
    </div>
  );
}
