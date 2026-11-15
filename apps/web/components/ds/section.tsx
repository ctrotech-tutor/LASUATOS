import type { ReactNode } from 'react';

/** A titled group of content, with an optional note on the right and a footnote below. */
export function Section({ title, aside, footer, id, children }: Readonly<{
  title?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  id?: string | undefined;
  children: ReactNode;
}>) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className="ds-section" id={id} aria-labelledby={title && headingId ? headingId : undefined}>
      {title || aside ? (
        <div className="ds-section-head">
          {title ? <h2 className="ds-section-title" id={headingId}>{title}</h2> : <span />}
          {aside ? <span className="ds-section-aside">{aside}</span> : null}
        </div>
      ) : null}
      {children}
      {footer ? <p className="ds-section-foot">{footer}</p> : null}
    </section>
  );
}
