import type { Metadata } from 'next';
import { OfflineRetry } from '../../components/offline-retry';

export const metadata: Metadata = {
  title: 'You are offline',
  robots: { index: false, follow: false },
};

/** Served by the service worker when a page cannot load without a connection. */
export default function OfflinePage() {
  return (
    <section className="ui-state-page">
      <span className="ui-state-icon is-offline" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5M5 12.6a10 10 0 0 1 3.4-2.1M19 12.6a10 10 0 0 0-2.6-1.8M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" /></svg>
      </span>
      <h1>You’re offline</h1>
      <p>LASUATOS needs a connection to mark or take attendance. Check your mobile data or Wi-Fi.</p>
      <OfflineRetry />
    </section>
  );
}
