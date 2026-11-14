import { ArrowLeft, CircleHelp } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup } from '../brand-lockup';
import { Tight } from '../tight';
import { AuthStory, STORIES, type StoryName } from './auth-story';
import './auth.css';

/**
 * The frame for every account page (sign in, open an account, password help,
 * email confirmation, staff invitation): no site navigation, just the task.
 *
 * Wide screens: a navy panel on the left plays a short, looping story of the
 * step the person is on; the form sits on paper on the right.
 * Phones and tablets: a compact navy band on top (brand, Help, Back to site,
 * and a one-line version of the story), then the form on a paper sheet.
 *
 * Everything here renders on the server; the animations are CSS only, run
 * only where they are visible, and stop for people who prefer less motion.
 */
export function AuthLayout({
  story,
  eyebrow,
  title,
  lede,
  back,
  footer,
  children,
}: Readonly<{
  story: StoryName;
  eyebrow: string;
  /** The page heading; full stops are tightened at display size. */
  title: string;
  lede?: ReactNode;
  /** A step back inside the flow, e.g. from password help to sign in. */
  back?: { href: string; label: string } | undefined;
  /** Shown under the form: usually the switch between signing in and opening an account. */
  footer?: ReactNode;
  children: ReactNode;
}>) {
  const { beats, headline } = STORIES[story];
  return (
    <div className="au" data-story={story}>
      <div className="au-top">
        <header className="au-bar">
          <span className="au-bar-brand"><BrandLockup tone="light" /></span>
          <nav className="au-bar-links" aria-label="Leave this page">
            <Link className="au-bar-link" href="/help">
              <CircleHelp size={17} aria-hidden="true" /><span>Help</span>
            </Link>
            <Link className="au-bar-link au-bar-back" href="/">
              <ArrowLeft size={16} aria-hidden="true" /><span>Back to site</span>
            </Link>
          </nav>
        </header>

        <aside className="au-stage" aria-label="How it works">
          <div className="au-stage-brand"><BrandLockup tone="light" /></div>

          {/* Phones and tablets: the story as a one-line ticker. */}
          <div className="au-ticker" aria-hidden="true">
            <span className="au-ticker-bars">{beats.map((beat) => <i key={beat} />)}</span>
            <span className="au-ticker-lines">
              {beats.map((beat, index) => (
                <span className="au-ticker-line" key={beat}><b>{index + 1}</b>{beat}</span>
              ))}
              <span className="au-ticker-still">{headline}</span>
            </span>
          </div>

          {/* Wide screens: the full story. */}
          <div className="au-stage-body">
            <div className="au-progress" aria-hidden="true">{beats.map((beat) => <i key={beat} />)}</div>
            <AuthStory story={story} />
            <div className="au-stage-copy">
              <p className="au-stage-headline">{headline}</p>
              <ol className="au-beats">
                {beats.map((beat, index) => (
                  <li key={beat}><span className="au-beat-num" data-n={index + 1} aria-hidden="true">{index + 1}</span><span className="au-beat-text">{beat}</span></li>
                ))}
              </ol>
            </div>
          </div>
          <p className="au-stage-foot" aria-hidden="true">Lagos State University <i /> For Truth and Service</p>
        </aside>
      </div>

      <main className="au-main" id="main-content" tabIndex={-1}>
        <div className="au-column">
          {back ? (
            <Link className="au-back" href={back.href}>
              <ArrowLeft size={16} aria-hidden="true" /> {back.label}
            </Link>
          ) : null}
          <header className="au-head">
            <p className="au-eyebrow">{eyebrow}</p>
            <h1><Tight>{title}</Tight></h1>
            {lede ? <p className="au-lede">{lede}</p> : null}
          </header>
          <div className="au-body">{children}</div>
          {footer ? <div className="au-after">{footer}</div> : null}
        </div>
        <footer className="au-foot">
          <span>LASUATOS · Lagos State University</span>
          <nav aria-label="Legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/help">Help</Link>
          </nav>
        </footer>
      </main>
    </div>
  );
}

/** The card under a form that sends people to the other door (sign in ↔ open an account). */
export function AuthSwitch({ href, prompt, action, icon }: Readonly<{ href: string; prompt: string; action: string; icon: ReactNode }>) {
  return (
    <Link className="au-switch" href={href}>
      <span className="au-switch-icon" aria-hidden="true">{icon}</span>
      <span className="au-switch-copy"><small>{prompt}</small><strong>{action}</strong></span>
      <svg className="au-switch-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
      </svg>
    </Link>
  );
}
