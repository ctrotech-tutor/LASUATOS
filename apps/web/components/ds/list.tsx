import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** An iOS-style inset grouped list. Pass `ListRow`s as children. */
export function List({ leading = false, label, className, children }: Readonly<{
  /** Set when rows have a leading icon, so the hairlines start at the text. */
  leading?: boolean | undefined;
  label?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}>) {
  return <ul className={`ds-list${leading ? ' has-leading' : ''}${className ? ` ${className}` : ''}`} aria-label={label}>{children}</ul>;
}

/** One row: a link (with a chevron), a button, or plain content. */
export function ListRow({ title, subtitle, leading, detail, trailing, href, onClick, chevron }: Readonly<{
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  /** Short value on the right (a count, a time). */
  detail?: ReactNode;
  /** Anything else on the right (a badge, a switch). */
  trailing?: ReactNode;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  /** Defaults to true for links. */
  chevron?: boolean | undefined;
}>) {
  const content = (
    <>
      {leading ? <span className="ds-row-leading" aria-hidden="true">{leading}</span> : null}
      <span className="ds-row-body">
        <span className="ds-row-title">{title}</span>
        {subtitle ? <span className="ds-row-subtitle">{subtitle}</span> : null}
      </span>
      {detail !== undefined && detail !== null ? <span className="ds-row-detail">{detail}</span> : null}
      {trailing}
      {(chevron ?? Boolean(href)) ? <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" /> : null}
    </>
  );
  if (href) return <li><Link className="ds-row" href={href}>{content}</Link></li>;
  if (onClick) return <li><button className="ds-row" type="button" onClick={onClick}>{content}</button></li>;
  return <li><div className="ds-row">{content}</div></li>;
}
