import { ClipboardList, QrCode } from 'lucide-react';
import Link from 'next/link';

/** Segmented switch between taking attendance and the course registers. */
export function SessionsTabs({ active }: Readonly<{ active: 'sessions' | 'registers' }>) {
  return (
    <nav className="rg-tabs" aria-label="Attendance views">
      <Link href="/sessions" className={active === 'sessions' ? 'is-active' : ''} aria-current={active === 'sessions' ? 'page' : undefined}>
        <QrCode size={16} aria-hidden="true" /> Sessions
      </Link>
      <Link href="/registers" className={active === 'registers' ? 'is-active' : ''} aria-current={active === 'registers' ? 'page' : undefined}>
        <ClipboardList size={16} aria-hidden="true" /> Registers
      </Link>
    </nav>
  );
}
