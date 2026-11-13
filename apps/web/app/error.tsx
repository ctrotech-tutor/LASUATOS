'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { reportPageError } from '../lib/report-error';

/** Shown when a page crashes; the rest of the app keeps working. */
export default function RouteError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error(error);
    reportPageError(error);
  }, [error]);
  return (
    <section className="ui-state-page" role="alert">
      <span className="ui-state-icon is-error" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
      </span>
      <h1>Something went wrong</h1>
      <p>This screen hit a problem. Your attendance records are safe. Try again, and if it keeps happening, reload the app.</p>
      {error.digest ? <p className="lx-fine">Reference: {error.digest}</p> : null}
      <div className="ui-state-actions">
        <button className="button button-primary" type="button" onClick={reset}>Try again</button>
        <Link className="button button-secondary" href="/launch">Back to my home</Link>
      </div>
    </section>
  );
}
