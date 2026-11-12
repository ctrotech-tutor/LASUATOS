import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section className="ui-state-page">
      <span className="ui-state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8.5 11h5" /></svg>
      </span>
      <span className="ui-state-code">404</span>
      <h1>We couldn’t find that page</h1>
      <p>The link may be old or mistyped. If you came here from a QR code, scan it again or type the code.</p>
      <div className="ui-state-actions">
        <Link className="button button-primary" href="/a">Mark attendance</Link>
        <Link className="button button-secondary" href="/">Go to the home page</Link>
      </div>
    </section>
  );
}
