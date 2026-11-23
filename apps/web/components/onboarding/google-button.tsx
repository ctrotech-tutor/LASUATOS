'use client';

import { useEffect, useRef, useState } from 'react';
import {
  inAppBrowser,
  loadGoogleConfig,
  startGoogle,
  usableConfig,
  type GoogleStart,
  type ReadyGoogleConfig,
} from '../../lib/google-proof';
import './google-button.css';

/**
 * "Continue with Google" (ADR 027): the student picks their LASU account on
 * Google's own page instead of waiting for an emailed code. Shown only when
 * the deployment has a Google client and this is the address Google returns
 * to; otherwise nothing renders and the code is the way, as before.
 */

/** The deployment's Google setup, or null while loading, when off, or on another address (a preview). */
export function useGoogleSignIn(): ReadyGoogleConfig | null {
  const [config, setConfig] = useState<ReadyGoogleConfig | null>(null);
  useEffect(() => {
    let live = true;
    void loadGoogleConfig().then((loaded) => {
      if (live) setConfig(usableConfig(loaded, window.location.origin));
    });
    return () => { live = false; };
  }, []);
  return config;
}

/** Google's "G", in its own colours (Google's sign-in branding guidelines). */
export function GoogleMark({ size = 20 }: Readonly<{ size?: number }>) {
  return (
    <svg className="gsi-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GoogleButton({
  config,
  prepare,
  label = 'Continue with Google',
  compact = false,
  disabled = false,
}: Readonly<{
  config: ReadyGoogleConfig;
  /** What the round trip is for; null cancels (the caller shows why, e.g. a missing matric number). */
  prepare: () => GoogleStart | null;
  label?: string;
  /** A smaller button, for "code not coming?" under a code field. */
  compact?: boolean;
  disabled?: boolean;
}>) {
  const [going, setGoing] = useState(false);
  /** Came back to this page without Google's answer (it opened in another app or browser). */
  const [returned, setReturned] = useState(false);
  const [inApp, setInApp] = useState(false);
  /* A ref for the listeners below: they are attached once, but must see the current state. */
  const goingRef = useRef(false);
  const visibleTimer = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setInApp(inAppBrowser(navigator.userAgent)), 0);
    const stop = () => {
      goingRef.current = false;
      setGoing(false);
    };
    // Back from Google's page (the browser restores this one as it was): the button works again.
    const restored = (event: PageTransitionEvent) => { if (event.persisted) stop(); };
    /*
     * Google can open outside this page's world — an installed app hands the
     * accounts.google.com link to the browser, which also gets the answer.
     * This page then never navigates and never hears back, so "Opening
     * Google…" would spin forever. When the page shows again while a start is
     * still open, the round trip did not happen here: re-arm the button and
     * say where the answer may have gone. (A completed flow lands on
     * /auth/google and replaces this page, so this never fires on success.)
     */
    const visible = () => {
      if (document.visibilityState !== 'visible' || !goingRef.current) return;
      window.clearTimeout(visibleTimer.current);
      visibleTimer.current = window.setTimeout(() => {
        if (!goingRef.current) return;
        stop();
        setReturned(true);
      }, 1200);
    };
    window.addEventListener('pageshow', restored);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(visibleTimer.current);
      window.removeEventListener('pageshow', restored);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  function go() {
    const start = prepare();
    if (!start) return;
    goingRef.current = true;
    setGoing(true);
    setReturned(false);
    startGoogle(config, start).catch(() => {
      goingRef.current = false;
      setGoing(false);
    });
  }

  return (
    <div className={`gsi${compact ? ' is-compact' : ''}`}>
      <button className="gsi-button" type="button" onClick={go} disabled={disabled || going} aria-busy={going || undefined}>
        <GoogleMark size={compact ? 18 : 20} />
        <span>{going ? 'Opening Google…' : label}</span>
      </button>
      {inApp ? (
        <p className="gsi-hint">
          Opened from WhatsApp or Instagram? Google may refuse inside their browser. Open this page in Chrome or Safari first (menu, then <strong>Open in browser</strong>).
        </p>
      ) : null}
      {returned && !going ? (
        <p className="gsi-hint" role="status">
          Google may have opened in your browser app instead of here. If you finished there, continue in that browser. Otherwise tap the button again — and pick the account this page expects.
        </p>
      ) : null}
    </div>
  );
}
