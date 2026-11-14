import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { OfflineRetry } from '../../components/offline-retry';
import { Tight } from '../../components/tight';

export const metadata: Metadata = {
  title: 'You are offline',
  robots: { index: false, follow: false },
};

/** Served by the service worker when a page cannot load without a connection. */
export default function OfflinePage() {
  return (
    <div className="st-page">
      <section className="st">
        <div className="st-art" aria-hidden="true">
          <span className="st-orb is-offline"><WifiOff size={34} /></span>
        </div>
        <p className="st-kicker">No connection</p>
        <h1 className="st-title"><Tight>You’re offline.</Tight></h1>
        <p className="st-lede">LASUATOS needs a connection to mark or take attendance. Check your mobile data or Wi-Fi. This page reloads by itself when you’re back.</p>
        <div className="st-actions">
          <OfflineRetry className="st-btn st-btn-primary" />
        </div>
        <ul className="st-tips">
          <li>Turn airplane mode off, then on mobile data.</li>
          <li>On campus Wi-Fi, open any website once to finish signing in.</li>
          <li>Attendance still open? The person taking it can add you.</li>
        </ul>
      </section>
    </div>
  );
}
