'use client';

import { useEffect } from 'react';
import { reportPageError } from '../lib/report-error';

/**
 * Last-resort screen if the root layout itself fails. Nothing else is guaranteed to have loaded (no
 * stylesheet, no fonts, no icons), so it carries its own small stylesheet and the brand mark inline,
 * in the app's colours: the page background, the navy mark, gold accents.
 */
const STYLES = `
  .ge { box-sizing: border-box; display: grid; min-height: 100vh; min-height: 100dvh; place-items: center; margin: 0; padding: 32px 22px;
    background: radial-gradient(ellipse 70% 50% at 50% 0%, rgb(21 59 91 / 7%), transparent 70%), #f2f3ee; color: #10202e;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  .ge * { box-sizing: border-box; }
  .ge-card { display: grid; justify-items: center; width: min(460px, 100%); text-align: center; }
  .ge-mark { width: 72px; height: 72px; margin-bottom: 28px; border-radius: 22px; box-shadow: 0 22px 40px -20px rgb(11 36 57 / 65%); }
  .ge-kicker { margin: 0 0 10px; color: #87661f; font-size: 12.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
  .ge h1 { margin: 0; font-size: clamp(28px, 7vw, 38px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; text-wrap: balance; }
  .ge-lede { margin: 14px 0 0; color: #4b5965; font-size: 16px; line-height: 1.6; text-wrap: pretty; }
  .ge-actions { display: grid; width: 100%; gap: 10px; margin-top: 26px; }
  .ge-btn { display: inline-flex; min-height: 50px; align-items: center; justify-content: center; padding: 0 22px; border: 1px solid transparent;
    border-radius: 14px; font: inherit; font-size: 16px; font-weight: 650; cursor: pointer; text-decoration: none; }
  .ge-btn:focus-visible { outline: 3px solid #c59a42; outline-offset: 2px; }
  .ge-primary { background: #153b5b; color: #fff; box-shadow: 0 10px 24px -10px rgb(21 59 91 / 60%); }
  .ge-primary:hover { background: #0b2439; }
  .ge-ghost { border-color: #d5ddd9; background: #fff; color: #153b5b; }
  .ge-ghost:hover { border-color: #153b5b; }
  .ge-ref { margin: 20px 0 0; color: #5c6872; font-size: 13px; }
  .ge-ref code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  @media (min-width: 520px) { .ge-actions { display: flex; width: auto; justify-content: center; } }
`;

export default function GlobalError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    reportPageError(error);
  }, [error]);
  return (
    <html lang="en-NG">
      <head>
        <title>LASUATOS couldn’t load</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style>{STYLES}</style>
      </head>
      <body style={{ margin: 0 }}>
        <main className="ge">
          <section className="ge-card" role="alert">
            <svg className="ge-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
              <rect x="1" y="1" width="46" height="46" rx="14" fill="#153B5B" />
              <path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke="#F7F8F4" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M18.5 35V25h12v10" stroke="#F7F8F4" strokeWidth="2.2" strokeLinejoin="round" />
              <path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#D8B15C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="34.5" cy="12.5" r="2.3" fill="#D8B15C" />
            </svg>
            <p className="ge-kicker">Something went wrong</p>
            <h1>LASUATOS couldn’t load.</h1>
            <p className="ge-lede">Your attendance records are safe. Check your connection, then try again. If it keeps happening, reload the app.</p>
            <div className="ge-actions">
              <button className="ge-btn ge-primary" type="button" onClick={reset}>Try again</button>
              <button className="ge-btn ge-ghost" type="button" onClick={() => window.location.reload()}>Reload the app</button>
            </div>
            {error.digest ? <p className="ge-ref">Reference: <code>{error.digest}</code></p> : null}
          </section>
        </main>
      </body>
    </html>
  );
}
