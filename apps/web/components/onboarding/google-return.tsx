'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { finishGoogle } from '../../lib/google-proof';
import { StateArt } from '../state-art';
import { Tight } from '../tight';

/**
 * Google's answer arrives in the fragment (#id_token=… or #error=…). It is
 * handed to the step that asked for it and the fragment is wiped from the
 * address and history straight away, so the token never lingers in the
 * address bar, a screenshot or Back.
 */
export function GoogleReturn() {
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    window.history.replaceState(null, '', window.location.pathname);
    const done = finishGoogle(hash);
    if (done) window.location.replace(done.returnTo);
    else window.setTimeout(() => setLost(true), 0);
  }, []);

  if (!lost) {
    return (
      <div className="route-loading-wrap" role="status" aria-live="polite">
        <span className="sr-only">Back from Google. Taking you back…</span>
        <div className="route-loading" aria-hidden="true"><span className="route-loading-bar" /></div>
      </div>
    );
  }

  return (
    <div className="st-page">
      <section className="st">
        <StateArt tone="error" />
        <p className="st-kicker">Google sign-in</p>
        <h1 className="st-title"><Tight>Start again from the same app.</Tight></h1>
        <p className="st-lede">
          Google answered, but this browser didn’t start that sign-in. That happens when Google opens in a different browser or app. Go back, then tap Continue with Google again.
        </p>
        <div className="st-actions">
          <Link className="st-btn st-btn-primary" href="/sign-up">Open my account</Link>
          <Link className="st-btn st-btn-ghost" href="/sign-in">Sign in</Link>
        </div>
        <ul className="st-tips">
          <li>Installed the app? Open LASUATOS from your home screen and try again there.</li>
          <li>Opened from WhatsApp? Choose “Open in browser” first.</li>
          <li>You can always use the 6-digit code from your email instead.</li>
        </ul>
      </section>
    </div>
  );
}
