import type { ReactNode } from 'react';

/** A labelled number. Put several inside `Stats` for a responsive grid. */
export function Stat({ label, value, hint, tone }: Readonly<{
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'warning' | 'success' | undefined;
}>) {
  return (
    <div className={`ds-stat${tone ? ` ds-stat-${tone}` : ''}`}>
      <span className="ds-stat-label">{label}</span>
      <strong className="ds-stat-value">{value}</strong>
      {hint ? <span className="ds-stat-hint">{hint}</span> : null}
    </div>
  );
}

export function Stats({ label, children }: Readonly<{ label?: string | undefined; children: ReactNode }>) {
  return <div className="ds-stats" role="group" aria-label={label}>{children}</div>;
}
