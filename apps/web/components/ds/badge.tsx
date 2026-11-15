import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'tint' | 'accent' | 'success' | 'warning' | 'danger';

/** A short status or label. `dot` adds a leading dot (live or open states). */
export function Badge({ tone = 'neutral', dot = false, className, children }: Readonly<{
  tone?: BadgeTone | undefined;
  dot?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}>) {
  const classes = ['ds-badge', tone === 'neutral' ? '' : `ds-badge-${tone}`, dot ? 'ds-badge-dot' : '', className ?? ''].filter(Boolean).join(' ');
  return <span className={classes}>{children}</span>;
}
