import type { CSSProperties } from 'react';

/** How a rate reads against a required line: met, close (within 25 points), far, or none yet. */
export function rateTone(rate: number | null, threshold: number): 'good' | 'warning' | 'danger' | 'none' {
  if (rate === null) return 'none';
  if (rate >= threshold) return 'good';
  return rate >= threshold - 25 ? 'warning' : 'danger';
}

/**
 * A rate as a short bar with a tick at the required line, and the whole-number figure beside it,
 * in green, amber or red. The figure is the accessible text; the bar is decoration.
 */
export function RateMeter({ rate, threshold }: Readonly<{ rate: number | null; threshold: number }>) {
  return (
    <span className={`ds-meter is-${rateTone(rate, threshold)}`}>
      <span className="ds-meter-track" aria-hidden="true" style={{ '--v': ((rate ?? 0) / 100).toFixed(4), '--line': threshold / 100 } as CSSProperties}>
        <span />
      </span>
      <span className="ds-meter-value">{rate === null ? '–' : `${Math.round(rate)}%`}</span>
    </span>
  );
}
