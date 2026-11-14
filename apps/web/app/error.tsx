'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
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
    <div className="st-page">
      <section className="st" role="alert">
        <div className="st-art" aria-hidden="true">
          <span className="st-orb is-error"><TriangleAlert size={34} /></span>
        </div>
        <p className="st-kicker">Something went wrong</p>
        <h1 className="st-title">This screen hit a problem</h1>
        <p className="st-lede">Your attendance records are safe. Try again, and if it keeps happening, reload the app.</p>
        <div className="st-actions">
          <button className="st-btn st-btn-primary" type="button" onClick={reset}><RotateCcw size={17} aria-hidden="true" /> Try again</button>
          <Link className="st-btn st-btn-ghost" href="/launch">Back to my home</Link>
        </div>
        {error.digest ? <p className="st-ref">Reference: <code>{error.digest}</code></p> : null}
      </section>
    </div>
  );
}
