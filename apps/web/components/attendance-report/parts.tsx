import type { CSSProperties } from 'react';
import { percent, toneOf } from './format';

/** The course register, optionally filtered to one student. */
export function registerHref(courseCode: string, matricNumber?: string): string {
  return `/registers?course=${encodeURIComponent(courseCode)}${matricNumber ? `&q=${encodeURIComponent(matricNumber)}` : ''}`;
}

/** A rate as a short bar with a tick at the threshold, and the figure beside it. */
export function RateMeter({ rate, threshold }: Readonly<{ rate: number | null; threshold: number }>) {
  const tone = toneOf(rate, threshold);
  return (
    <span className={`ar-meter is-${tone}`}>
      <span className="ar-meter-track" aria-hidden="true" style={{ '--v': ((rate ?? 0) / 100).toFixed(4), '--line': threshold / 100 } as CSSProperties}>
        <span />
      </span>
      <span className="ar-meter-value">{percent(rate)}</span>
    </span>
  );
}
