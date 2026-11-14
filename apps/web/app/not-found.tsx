import type { Metadata } from 'next';
import { ArrowRight, QrCode } from 'lucide-react';
import Link from 'next/link';
import { MockQr } from '../components/home/mock-qr';
import { Tight } from '../components/tight';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="st-page">
      <section className="st">
        <div className="st-art" aria-hidden="true">
          <div className="st-screen">
            <MockQr seed={404} className="st-qr" />
            <span className="st-badge">404</span>
          </div>
        </div>
        <p className="st-kicker">Page not found</p>
        <h1 className="st-title"><Tight>This link has gone stale.</Tight></h1>
        <p className="st-lede">The address may be old or mistyped. If you came here from a QR code, scan the screen again or type the code shown under it.</p>
        <div className="st-actions">
          <Link className="st-btn st-btn-primary" href="/a"><QrCode size={18} aria-hidden="true" /> Mark attendance</Link>
          <Link className="st-btn st-btn-ghost" href="/">Go to the home page <ArrowRight size={17} aria-hidden="true" /></Link>
        </div>
        <p className="st-links">Or try the <Link href="/help">Help centre</Link> or <Link href="/sign-in">Sign in</Link>.</p>
      </section>
    </div>
  );
}
