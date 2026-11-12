'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

export function OfflineRetry() {
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener('online', reload);
    return () => window.removeEventListener('online', reload);
  }, []);
  return (
    <button className="button button-primary" type="button" onClick={() => window.location.reload()}>
      <RefreshCw size={17} aria-hidden="true" /> Try again
    </button>
  );
}
