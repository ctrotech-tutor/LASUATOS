'use client';

import { firstName, greetingForNow, useCurrentAccount } from '../lib/current-account';

/**
 * The student page heading: a short personal greeting above the page title.
 * The longer description is shown on wide screens only, so on a phone the
 * first thing below the header is the action the student came for.
 */
export function StudentPageHeader({ title, lede }: Readonly<{ title: string; lede: string }>) {
  const account = useCurrentAccount();
  const name = account ? firstName(account.displayName) : '';
  return (
    <section className="page-heading student-page-heading">
      <div>
        <p className="student-greeting" aria-live="polite">
          {account === undefined ? <span className="skeleton-line student-greeting-skeleton" /> : name ? `${greetingForNow()}, ${name}` : greetingForNow()}
        </p>
        <h1>{title}</h1>
        <p className="page-lede">{lede}</p>
      </div>
    </section>
  );
}
