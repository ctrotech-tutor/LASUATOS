'use client';

import { ArrowRight, ArrowUpRight, QrCode, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { endSession, firstName, useCurrentAccount } from '../../lib/current-account';
import { initialsOf, workspaceLabel, workspacePath } from '../../lib/workspace';
import { BrandLockup } from '../brand-lockup';

type NavItem = { href: string; label: string; section?: string };

const NAV: readonly NavItem[] = [
  { href: '/#how', label: 'How it works', section: 'how' },
  { href: '/#checks', label: 'Security', section: 'checks' },
  { href: '/#roles', label: 'Who it’s for', section: 'roles' },
  { href: '/#faq', label: 'FAQ', section: 'faq' },
  { href: '/help', label: 'Help' },
];

/** Below this width the links live in the full-screen menu and the bar tucks away while reading. */
const DESKTOP = 1060;

/**
 * The public header: a floating glass bar.
 * - Desktop: a sliding marker follows the pointer and rests on the section you are reading.
 * - Phones: the bar slides away while scrolling down and comes back on the way up; the menu is a
 *   full-screen sheet built on <dialog>, so focus, Escape and the page behind are handled natively.
 * - A thin gold line along the bottom shows reading progress (CSS scroll timeline, no script).
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tucked, setTucked] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  // Signed-in visitors get their own workspace here instead of "Sign in" (null while unknown, so
  // the signed-out links render first and match the server HTML).
  const account = useCurrentAccount();
  const [signingOut, setSigningOut] = useState(false);

  // Scrolled shadow, and tuck-away on phones (only after a deliberate 24px in one direction).
  useEffect(() => {
    let last = window.scrollY;
    let anchor = last;
    let direction = 0;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - last;
      setScrolled(y > 4);
      if (delta !== 0 && Math.sign(delta) !== direction) {
        direction = Math.sign(delta);
        anchor = last;
      }
      last = y;
      const focusInside = headerRef.current?.contains(document.activeElement) ?? false;
      if (window.innerWidth >= DESKTOP || y < 120 || focusInside) setTucked(false);
      else if (direction > 0 && y - anchor > 24) setTucked(true);
      else if (direction < 0 && anchor - y > 24) setTucked(false);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Sticky bits further down (the policy contents bar) follow the header up and down.
  useEffect(() => {
    const root = document.documentElement;
    if (tucked) root.dataset.header = 'tucked';
    else delete root.dataset.header;
    return () => { delete root.dataset.header; };
  }, [tucked]);

  // Which homepage section is being read: the one crossing a band just above the middle of the screen.
  useEffect(() => {
    if (pathname !== '/') return undefined;
    const ids = NAV.flatMap((item) => (item.section ? [item.section] : []));
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      setSection([...ids].reverse().find((id) => visible.has(id)) ?? null);
    }, { rootMargin: '-42% 0px -52% 0px' });
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [pathname]);

  const activeHref = pathname === '/help' ? '/help' : pathname === '/' && section ? `/#${section}` : null;

  // The marker: positioned with CSS variables so moving it never re-renders the header.
  const placeMarker = useCallback((link: HTMLElement | null) => {
    const nav = navRef.current;
    if (!nav) return;
    if (!link) { nav.dataset.marker = 'off'; return; }
    nav.style.setProperty('--marker-x', `${link.offsetLeft}px`);
    nav.style.setProperty('--marker-w', `${link.offsetWidth}px`);
    nav.dataset.marker = 'on';
  }, []);

  const restMarker = useCallback(() => {
    placeMarker(navRef.current?.querySelector<HTMLElement>('[aria-current]') ?? null);
  }, [placeMarker]);

  useEffect(() => {
    restMarker();
    const nav = navRef.current;
    if (!nav) return undefined;
    const observer = new ResizeObserver(restMarker);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeHref, restMarker]);

  // Open and close the sheet; a wide window closes it.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;
    if (open && !sheet.open) sheet.showModal();
    if (!open && sheet.open) sheet.close();
    if (!open) return undefined;
    const onResize = () => { if (window.innerWidth >= DESKTOP) sheet.close(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  // Close synchronously so the page can scroll to a #section straight away.
  const closeSheet = () => sheetRef.current?.close();
  const signOut = async () => {
    setSigningOut(true);
    await endSession();
    // Reload this public page signed out: every link and button goes back to the signed-out ones.
    window.location.reload();
  };

  const className = ['site-header', scrolled && 'is-scrolled', tucked && !open && 'is-tucked'].filter(Boolean).join(' ');

  return (
    <header className={className} ref={headerRef}>
      <div className="site-header-bar">
        <BrandLockup />
        <nav className="site-nav" aria-label="Explore LASUATOS" ref={navRef} data-marker="off" onMouseLeave={restMarker}>
          <span className="site-nav-marker" aria-hidden="true" />
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={href === activeHref ? (href === '/help' ? 'page' : 'true') : undefined}
              onMouseEnter={(event) => placeMarker(event.currentTarget)}
              onFocus={(event) => placeMarker(event.currentTarget)}
              onBlur={restMarker}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="site-actions">
          {account ? (
            <Link
              className="site-account"
              href={workspacePath(account.accountType)}
              title={`Signed in as ${account.displayName}`}
              aria-label={`${workspaceLabel(account.accountType)}, signed in as ${account.displayName}`}
            >
              <span className="site-account-avatar" aria-hidden="true">{initialsOf(account.displayName)}</span>
              <span className="site-account-label" aria-hidden="true">{workspaceLabel(account.accountType)}</span>
            </Link>
          ) : (
            <Link className="site-sign-in" href="/sign-in">Sign in</Link>
          )}
          <Link className="site-cta" href="/a">
            <span className="site-cta-icon" aria-hidden="true"><QrCode size={16} /></span>
            <span className="site-cta-long">Mark attendance</span>
            <span className="site-cta-short">Scan</span>
          </Link>
          <button
            className="site-menu-button"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <span aria-hidden="true" /><span aria-hidden="true" />
          </button>
        </div>
        <span className="site-progress" aria-hidden="true" />
      </div>

      <dialog className="site-sheet" ref={sheetRef} aria-label="Menu" onClose={() => setOpen(false)}>
        <div className="site-sheet-top">
          <BrandLockup />
          <button className="site-sheet-close" type="button" aria-label="Close menu" onClick={closeSheet}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <nav className="site-sheet-nav" aria-label="Menu">
          {NAV.map(({ href, label }, index) => (
            <Link
              key={href}
              href={href}
              style={{ '--i': index } as CSSProperties}
              aria-current={href === activeHref ? (href === '/help' ? 'page' : 'true') : undefined}
              onClick={closeSheet}
            >
              <span className="site-sheet-num">{String(index + 1).padStart(2, '0')}</span>
              <span className="site-sheet-label">{label}</span>
              <ArrowUpRight size={20} aria-hidden="true" />
            </Link>
          ))}
        </nav>
        <div className="site-sheet-actions">
          <Link className="site-sheet-scan" href="/a" onClick={closeSheet}>
            <span className="site-sheet-scan-icon" aria-hidden="true"><QrCode size={22} /></span>
            <span className="site-sheet-scan-copy">
              <strong>Mark attendance</strong>
              <small>Scan the code on the screen in class</small>
            </span>
            <ArrowRight size={19} aria-hidden="true" />
          </Link>
          {account ? (
            <>
              <Link className="site-sheet-primary site-sheet-me" href={workspacePath(account.accountType)} onClick={closeSheet}>
                <span className="site-sheet-me-avatar" aria-hidden="true">{initialsOf(account.displayName)}</span>
                <span className="site-sheet-me-copy">
                  <strong>{workspaceLabel(account.accountType)}</strong>
                  <small>Signed in as {firstName(account.displayName)}</small>
                </span>
                <ArrowRight size={19} aria-hidden="true" />
              </Link>
              <div className="site-sheet-row">
                <Link href="/account/security" onClick={closeSheet}>Password &amp; sign-in</Link>
                <button type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
              </div>
            </>
          ) : (
            <>
              <Link className="site-sheet-primary" href="/sign-up" onClick={closeSheet}>Open my student account</Link>
              <div className="site-sheet-row">
                <Link href="/sign-in" onClick={closeSheet}>Sign in</Link>
                <Link href="/sessions" onClick={closeSheet}>Take attendance</Link>
              </div>
            </>
          )}
        </div>
      </dialog>
    </header>
  );
}
