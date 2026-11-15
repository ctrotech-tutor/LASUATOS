'use client';

import type { LectureSessionSummary } from '@lasuatos/contracts';
import { ChevronRight, QrCode } from 'lucide-react';
import Link from 'next/link';
import { formatClock } from '../../lib/lecture-api';

function timeLeft(endsAt: string, now: number): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(endsAt) - now) / 60_000));
  if (minutes > 90) return `until ${formatClock(endsAt)}`;
  return `${minutes} min left`;
}

/**
 * Back to the session that is taking attendance, from anywhere in the app. In the sidebar it
 * sits above the account; on phones it floats over the tab bar like a mini player; in the
 * narrow sidebar it is an icon with a live dot.
 */
export function LiveSessionLink({ session, count, now, variant }: Readonly<{
  session: LectureSessionSummary;
  count: number;
  now: number;
  variant: 'side' | 'accessory';
}>) {
  const present = `${session.presentCount} present`;
  const left = timeLeft(session.endsAt, now);
  const more = count > 1 ? ` · ${count} open` : '';
  return (
    <Link
      className={`ap-live ap-live-${variant}`}
      href={`/sessions/${session.id}`}
      data-tip={variant === 'side' ? `Live: ${session.courseCode} · ${present}` : undefined}
      data-tip-when-hidden={variant === 'side' ? '.ap-live-text' : undefined}
    >
      <span className="ap-live-icon" aria-hidden="true">
        <QrCode size={18} strokeWidth={2} />
        <span className="ap-live-dot" />
      </span>
      <span className="ap-live-text">
        <span className="ap-live-kicker">Live now<span className="sr-only">:</span></span>
        <strong>{session.courseCode}</strong>
        <span className="ap-live-meta">{present} · {left}{more}</span>
      </span>
      <ChevronRight className="ap-live-chevron" size={18} strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}
