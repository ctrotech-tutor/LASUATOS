import type { ReactNode } from 'react';

/**
 * What a screen shows when there is nothing yet, or when loading failed (`error`).
 * Always say what happened and what to do next; give the action when there is one.
 */
export function EmptyState({ icon, title, message, action, error = false }: Readonly<{
  icon?: ReactNode;
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  error?: boolean | undefined;
}>) {
  return (
    <div className={`ds-empty${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>
      {icon ? <span className="ds-empty-icon" aria-hidden="true">{icon}</span> : null}
      <p className="ds-empty-title">{title}</p>
      {message ? <p className="ds-empty-message">{message}</p> : null}
      {action ? <div className="ds-empty-action">{action}</div> : null}
    </div>
  );
}

/** Placeholder lines while content loads. Announces once to screen readers. */
export function SkeletonLines({ lines = 3, label = 'Loading' }: Readonly<{ lines?: number; label?: string }>) {
  return (
    <div role="status" aria-label={label} style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: lines }, (_, index) => (
        <span className="ds-skeleton" key={index} style={{ width: `${index === lines - 1 ? 58 : 100 - index * 8}%` }} />
      ))}
    </div>
  );
}
