import type { Metadata } from 'next';
import { NotFoundBody } from '../components/not-found-body';
import { StateArt } from '../components/state-art';
import { Tight } from '../components/tight';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/** A missing page: on the public site in the marketing frame, inside a workspace in its shell. */
export default function NotFound() {
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
