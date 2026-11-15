import { RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { MockQr } from './home/mock-qr';

export type StateTone = 'missing' | 'error' | 'offline' | 'update';

const SEED: Record<StateTone, number> = { missing: 404, error: 500, offline: 503, update: 426 };

/**
 * The picture on the state pages (not found, crashed, offline, updated): the class screen with its
 * QR code, the object the whole product is about, on the same navy paper as the sidebar. The tag
 * on its corner says what happened. Server-safe and asset-free, so the offline page draws it with
 * no connection.
 */
export function StateArt({ tone }: Readonly<{ tone: StateTone }>) {
  return (
    <div className="st-art" aria-hidden="true">
      <div className={`st-screen is-${tone}`}>
        <MockQr seed={SEED[tone]} className="st-qr" />
        <span className="st-badge">
          {tone === 'missing' ? '404' : null}
          {tone === 'error' ? <TriangleAlert size={22} strokeWidth={2.4} /> : null}
          {tone === 'offline' ? <WifiOff size={22} strokeWidth={2.4} /> : null}
          {tone === 'update' ? <RefreshCw size={22} strokeWidth={2.4} /> : null}
        </span>
      </div>
    </div>
  );
}
