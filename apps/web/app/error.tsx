'use client';

import { Check, Copy, RefreshCw, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StateArt, type StateTone } from '../components/state-art';
import { Tight } from '../components/tight';
import { useCurrentAccount } from '../lib/current-account';
import { useNameThisPage } from '../lib/page-label';
import { reportPageError } from '../lib/report-error';
import { workspaceAction, workspacePath } from '../lib/workspace';

/** After a new release, a page that was already open can ask for code that no longer exists. */
const STALE_CODE = /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;

/** What most likely happened, so the screen can say something true and offer the right fix. */
function causeOf(error: Error): StateTone {
  if (STALE_CODE.test(`${error.name} ${error.message}`)) return 'update';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'error';
}

const COPY: Record<StateTone, { kicker: string; title: string; lede: string }> = {
  update: {
    kicker: 'Update ready',
    title: 'LASUATOS has been updated.',
    lede: 'This page was opened before the update. Reload to get the new version; nothing you have already saved is lost.',
  },
  offline: {
    kicker: 'No connection',
    title: 'You’re offline.',
    lede: 'This screen needs a connection to load. Check your mobile data or Wi-Fi; it tries again by itself when you’re back.',
  },
  error: {
    kicker: 'Something went wrong',
    title: 'This screen hit a problem.',
    lede: 'Your attendance records are safe. Try again, and if it keeps happening, reload the app.',
  },
  missing: { kicker: '', title: '', lede: '' },
};

/** Shown when a page crashes; the menus around it keep working. */
export default function RouteError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  const account = useCurrentAccount();
  const [cause] = useState(() => causeOf(error));
  const [copied, setCopied] = useState(false);
  useNameThisPage(cause === 'update' ? 'Update ready' : cause === 'offline' ? 'Offline' : 'Something went wrong');

  useEffect(() => {
    console.error(error);
    reportPageError(error);
  }, [error]);

  // Offline: try again by itself the moment the connection comes back.
  useEffect(() => {
    if (cause !== 'offline') return undefined;
    window.addEventListener('online', reset);
    return () => window.removeEventListener('online', reset);
  }, [cause, reset]);

  const copyReference = async () => {
    if (!error.digest) return;
    try {
      await navigator.clipboard.writeText(error.digest);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The reference stays on screen to read out.
    }
  };

  const text = COPY[cause];
  const home = account ? workspacePath(account.accountType) : '/launch';

  return (
    <div className="st-page">
      <section className="st" role="alert">
        <StateArt tone={cause} />
        <p className="st-kicker">{text.kicker}</p>
        <h1 className="st-title"><Tight>{text.title}</Tight></h1>
        <p className="st-lede">{text.lede}</p>
        <div className="st-actions">
          {cause === 'update' ? (
            <button className="st-btn st-btn-primary" type="button" onClick={() => window.location.reload()}><RefreshCw size={17} aria-hidden="true" /> Reload</button>
          ) : (
            <button className="st-btn st-btn-primary" type="button" onClick={reset}><RotateCcw size={17} aria-hidden="true" /> Try again</button>
          )}
          <Link className="st-btn st-btn-ghost" href={home}>{account ? workspaceAction(account.accountType) : 'Back to my home'}</Link>
        </div>
        {error.digest && cause === 'error' ? (
          <p className="st-ref">
            <span>If you contact support, quote</span>
            <button className="st-ref-copy" type="button" onClick={() => void copyReference()} aria-label={copied ? 'Reference copied' : `Copy reference ${error.digest}`}>
              <code>{error.digest}</code>
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </button>
            <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
