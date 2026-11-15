import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The top of every app screen: an optional back link, an optional uppercase eyebrow,
 * the large title (the page's only h1), one line of context, and the page actions.
 * On phones the shell's top bar shows the title in small type once this one scrolls away.
 */
export function PageHeader({ title, eyebrow, subtitle, back, actions }: Readonly<{
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string } | undefined;
  actions?: ReactNode;
}>) {
  return (
    <header className="ds-page-header">
      {back ? (
        <Link className="ds-page-header-back" href={back.href}>
          <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}
      <div className="ds-page-header-row">
        <div className="ds-page-header-text">
          {eyebrow ? <p className="ds-eyebrow">{eyebrow}</p> : null}
          <h1 className="ds-large-title">{title}</h1>
          {subtitle ? <p className="ds-page-header-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="ds-page-header-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
