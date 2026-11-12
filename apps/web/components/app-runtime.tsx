'use client';

import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { startInstallTracking } from '../lib/app-install';

/**
 * Native-app plumbing that every page shares: the service worker (offline
 * page and instant asset loads), install-prompt tracking, and a banner when
 * the device loses its connection.
 */
export function AppRuntime() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    startInstallTracking();
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      const register = () => void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="ui-offline-banner" role="status">
      <WifiOff size={16} aria-hidden="true" />
      <span>You’re offline. Attendance will work again when you reconnect.</span>
    </div>
  );
}
