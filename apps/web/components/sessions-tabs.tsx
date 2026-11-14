import { ClipboardList, QrCode, ScanFace } from 'lucide-react';
import Link from 'next/link';

/**
 * Segmented switch between taking attendance, the course registers and (for
 * lecturers and administrators) the face checks to review.
 */
export function SessionsTabs({ active, faceChecks = false }: Readonly<{ active: 'sessions' | 'registers' | 'face-checks'; faceChecks?: boolean }>) {
  return (
    <nav className="rg-tabs" aria-label="Attendance views">
      <Link href="/sessions" className={active === 'sessions' ? 'is-active' : ''} aria-current={active === 'sessions' ? 'page' : undefined}>
        <QrCode size={16} aria-hidden="true" /> Sessions
      </Link>
      <Link href="/registers" className={active === 'registers' ? 'is-active' : ''} aria-current={active === 'registers' ? 'page' : undefined}>
        <ClipboardList size={16} aria-hidden="true" /> Registers
      </Link>
      {faceChecks || active === 'face-checks' ? (
        <Link href="/face-checks" className={active === 'face-checks' ? 'is-active' : ''} aria-current={active === 'face-checks' ? 'page' : undefined}>
          <ScanFace size={16} aria-hidden="true" /> Face checks
        </Link>
      ) : null}
    </nav>
  );
}
