import type { Metadata } from 'next';
import { connection } from 'next/server';
import { NotFoundBody } from '../components/not-found-body';
import { StateArt } from '../components/state-art';
import { Tight } from '../components/tight';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/**
 * A missing page: on the public site in the marketing frame, inside a workspace in its shell.
 *
 * Rendered for each request, not once at build time: the frame depends on the address
 * (components/app-shell.tsx), and a single prebuilt page carries the public frame, which the
 * browser then had to swap for the workspace one at /admin/… (React error #418).
 */
export default async function NotFound() {
  await connection();
  return (
    <div className="st-page">
      <section className="st">
        <StateArt tone="missing" />
        <p className="st-kicker">Page not found</p>
        <h1 className="st-title"><Tight>This link has gone stale.</Tight></h1>
        <NotFoundBody />
      </section>
    </div>
  );
}
