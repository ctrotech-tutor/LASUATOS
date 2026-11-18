'use client';

import { useEffect, useRef } from 'react';

/**
 * The LASUATOS cursor: a viewfinder, like the scanner in the hero. It runs on every page
 * (public site, account pages and the signed-in workspaces), and the status page has a
 * plain-script copy (status/src/cursor.ts) that a test keeps in step with this file.
 *
 * - A small dot sits exactly on the pointer (never eased, so aiming stays precise).
 * - Four corner brackets trail it softly. Over a link or button they lock on and
 *   frame it, turning gold, and close in a little when it is pressed: the page
 *   "scans" what you are about to choose.
 *
 * Built to cost nothing:
 * - Only for a real mouse or trackpad (`hover: hover` and `pointer: fine`). Touch
 *   screens, reduced motion, forced colours, Data Saver and weak hardware keep
 *   the system cursor, and so does anyone whose device stalls (see below).
 * - Five fixed elements moved with `transform` only, so the GPU composites them:
 *   no layout, no paint. No React state: one requestAnimationFrame loop runs while
 *   something is moving and stops as soon as everything has settled.
 * - Text fields, dialogs and the scrollbar hand back the system cursor (an I-beam
 *   for typing; dialogs sit above the page, where the brackets cannot follow). So do
 *   maps (their crosshair and grab hand mean something) and the full-screen QR code
 *   (the projector shows only that element, so the brackets could not be drawn there,
 *   and nothing may sit on a code students are scanning).
 * - If the main thread stalls again and again (a very slow machine), a frozen custom
 *   cursor would feel like a hang, so the system cursor comes back for the session.
 *   One heavy moment (a big list rendering) does not count: it takes three stalls
 *   within ten seconds.
 */

export const INTERACTIVE = 'a[href], button, [role="button"], [role="tab"], [role="link"], [role="switch"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"], summary, label[for], select, [data-cursor="lock"]';
const TEXT_FIELD = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"], [type="file"], [type="color"], [type="image"]), textarea, [contenteditable]:not([contenteditable="false"])';
/** Keep in step with the `cursor: none` exceptions in globals.css. */
export const NATIVE_ZONE = 'dialog, [popover], .leaflet-container, .tk-projector, [data-cursor="native"]';
/** Navy surfaces, where the cursor turns white: the public site's dark bands and the workspace sidebar. */
export const DARK = '.site-footer, .hp-checks, .hp-projector, .hp-final-card, .pg-start, .au-stage, .ap-side, .ds-paper, .ap-live-accessory, .ui-toast, .ui-status-notice[data-tone="maintenance"], [data-cursor="dark"]';
/**
 * Light surfaces that sit inside a navy one: the sidebar's current-page tab (cut from the page
 * itself) and the account menu that opens from it. Whichever surface is nearer wins.
 */
export const LIGHT = '.ap-nav-link.is-active, .account-menu-panel, [data-cursor="light"]';
const DARK_NARROW = '.au-top';

export const CORNER = 8; // bracket size, px
export const FREE = 12; // half-size of the resting viewfinder, px
export const LOCK_MAX_W = 520; // bigger targets (whole cards) are not framed, just hinted
export const LOCK_MAX_H = 220;
const STALL_MS = 200;
const STALLS_TO_STOP = 3;
const STALL_WINDOW_MS = 10_000;
const OFF_KEY = 'lasuatos:cursor-off';

type Box = { l: number; t: number; r: number; b: number };

/**
 * The cursor costs a few composited transforms while the mouse moves, so it stays on for most
 * "lite" machines (lite also catches every 4-core laptop). Only truly weak hardware or Data
 * Saver skip it; anything else that struggles is caught by the stall guard.
 */
function weakDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (nav.deviceMemory !== undefined && nav.deviceMemory <= 2)
    || (nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2)
    || nav.connection?.saveData === true;
}

function rectFor(element: Element, x: number, y: number): DOMRect | null {
  const rects = element.getClientRects();
  if (rects.length === 0) return null;
  if (rects.length === 1) return rects[0] ?? null;
  // A link that wraps onto two lines: frame the line under the pointer.
  let best: DOMRect | null = null;
  let bestDistance = Infinity;
  for (const rect of Array.from(rects)) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const distance = dx + dy;
    if (distance < bestDistance) { best = rect; bestDistance = distance; }
  }
  return best;
}

export function SiteCursor({ enabled }: Readonly<{ enabled: boolean }>) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return undefined;
    const html = document.documentElement;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const calm = window.matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)');
    const narrow = window.matchMedia('(max-width: 1023.98px)');
    const parts = Array.from(root.children) as HTMLElement[];
    const [dot, tl, tr, bl, br] = parts;
    if (!dot || !tl || !tr || !bl || !br) return undefined;
    const corners = [tl, tr, bl, br];

    let running = false;
    let raf = 0;
    let last = 0;
    let x = -100;
    let y = -100;
    let seen = false;
    let visible = false;
    let native = false;
    let pressed = false;
    let lock: Element | null = null;
    let hint = false;
    const at = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    let stalls: number[] = [];
    let observer: PerformanceObserver | null = null;

    const allowed = () => fine.matches && !calm.matches && !weakDevice() && sessionStorage.getItem(OFF_KEY) !== '1';

    const setClass = (name: string, on: boolean) => { root.classList.toggle(name, on); };
    const show = (on: boolean) => {
      if (visible === on) return;
      visible = on;
      setClass('is-hidden', !on);
    };

    const targetBox = (): Box => {
      if (lock) {
        const rect = rectFor(lock, x, y);
        // Scrolled away from under the pointer (wheel scroll without a mouse move): let go.
        if (!rect || x < rect.left - 2 || x > rect.right + 2 || y < rect.top - 2 || y > rect.bottom + 2) {
          lock = null;
          setClass('is-lock', false);
        } else {
          const small = rect.height < 30;
          const padX = small ? 6 : 7;
          const padY = small ? 4 : 7;
          // A gentle pull towards the pointer keeps the frame alive without wobbling.
          const cx = (rect.left + rect.right) / 2;
          const cy = (rect.top + rect.bottom) / 2;
          const pullX = Math.max(-4, Math.min(4, (x - cx) * 0.06));
          const pullY = Math.max(-3, Math.min(3, (y - cy) * 0.12));
          const inset = pressed ? 2.5 : 0;
          return {
            l: rect.left - padX + pullX + inset,
            t: rect.top - padY + pullY + inset,
            r: rect.right + padX + pullX - inset,
            b: rect.bottom + padY + pullY - inset,
          };
        }
      }
      const size = pressed ? FREE - 3 : hint ? FREE + 3 : FREE;
      return { l: x - size, t: y - size, r: x + size, b: y + size };
    };

    const write = () => {
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      for (let i = 0; i < 4; i += 1) {
        const point = at[i]!;
        corners[i]!.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
      }
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const box = targetBox();
      const goals = [
        { x: box.l, y: box.t },
        { x: box.r - CORNER, y: box.t },
        { x: box.l, y: box.b - CORNER },
        { x: box.r - CORNER, y: box.b - CORNER },
      ];
      // Frame-rate independent easing: the same feel at 60 Hz and 120 Hz.
      const k = 1 - Math.exp(-dt / (lock ? 62 : 38));
      let moving = false;
      for (let i = 0; i < 4; i += 1) {
        const point = at[i]!;
        const goal = goals[i]!;
        const dx = goal.x - point.x;
        const dy = goal.y - point.y;
        if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
          point.x += dx * k;
          point.y += dy * k;
          moving = true;
        } else {
          point.x = goal.x;
          point.y = goal.y;
        }
      }
      write();
      if (moving) raf = window.requestAnimationFrame(frame);
      else last = 0;
    };

    const schedule = () => {
      if (!raf && running) raf = window.requestAnimationFrame(frame);
    };

    const classify = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      const goNative = !element || document.fullscreenElement !== null || Boolean(element.closest(NATIVE_ZONE)) || element.matches(TEXT_FIELD) || Boolean(element.closest(TEXT_FIELD));
      native = goNative;
      if (goNative) {
        show(false);
        return;
      }
      if (seen) show(true);
      const candidate = element.closest(INTERACTIVE);
      const disabled = candidate ? candidate.matches(':disabled, [aria-disabled="true"]') : false;
      let nextLock: Element | null = null;
      let nextHint = false;
      if (candidate && !disabled) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width <= LOCK_MAX_W && rect.height <= LOCK_MAX_H) nextLock = candidate;
        else nextHint = true;
      }
      lock = nextLock;
      hint = nextHint;
      setClass('is-lock', Boolean(nextLock));
      setClass('is-hint', nextHint);
      setClass('is-blocked', disabled);
      const dark = element.closest(DARK) ?? (narrow.matches ? element.closest(DARK_NARROW) : null);
      const light = dark ? element.closest(LIGHT) : null;
      setClass('is-dark', Boolean(dark && !(light && dark.contains(light))));
      schedule();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || document.fullscreenElement) { show(false); return; }
      x = event.clientX;
      y = event.clientY;
      if (!seen) {
        seen = true;
        // Start the brackets on the pointer rather than flying in from the corner.
        for (const point of at) { point.x = x - CORNER / 2; point.y = y - CORNER / 2; }
        html.classList.add('cursor-on');
        classify(event.target);
      }
      // Over the scrollbar the system draws its own arrow.
      const onScrollbar = x >= html.clientWidth || y >= html.clientHeight;
      if (onScrollbar) show(false);
      else if (!native) show(true);
      schedule();
    };
    const onOver = (event: PointerEvent) => { if (event.pointerType === 'mouse') classify(event.target); };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      pressed = true;
      setClass('is-press', true);
      schedule();
    };
    const onUp = () => {
      if (!pressed) return;
      pressed = false;
      setClass('is-press', false);
      schedule();
    };
    const onLeave = (event: MouseEvent) => { if (!event.relatedTarget) show(false); };
    const onBlur = () => { show(false); onUp(); };
    const onScroll = () => { if (lock) schedule(); };
    // Full screen shows only one element, so the brackets cannot be drawn: hand back the arrow.
    const onFullscreen = () => {
      if (document.fullscreenElement) {
        native = true;
        show(false);
        html.classList.remove('cursor-on');
      } else if (seen) {
        html.classList.add('cursor-on');
      }
    };

    const start = () => {
      if (running || !allowed()) return;
      running = true;
      setClass('is-live', true);
      setClass('is-hidden', true);
      visible = false;
      window.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerover', onOver, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onUp, { passive: true });
      document.addEventListener('mouseout', onLeave, { passive: true });
      window.addEventListener('blur', onBlur);
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      document.addEventListener('fullscreenchange', onFullscreen);
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        observer = new PerformanceObserver((list) => {
          if (!visible) return;
          for (const entry of list.getEntries()) if (entry.duration >= STALL_MS) stalls.push(entry.startTime);
          const recent = performance.now() - STALL_WINDOW_MS;
          stalls = stalls.filter((at) => at >= recent);
          if (stalls.length >= STALLS_TO_STOP) {
            sessionStorage.setItem(OFF_KEY, '1');
            stop();
          }
        });
        observer.observe({ type: 'longtask' });
      }
    };

    function stop() {
      if (!running) return;
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      seen = false;
      lock = null;
      observer?.disconnect();
      observer = null;
      html.classList.remove('cursor-on');
      root!.className = 'site-cursor';
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.removeEventListener('mouseout', onLeave);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('fullscreenchange', onFullscreen);
    }

    // A mouse plugged in, or reduced motion switched on, while the page is open.
    const onMedia = () => { if (allowed()) start(); else stop(); };
    fine.addEventListener('change', onMedia);
    calm.addEventListener('change', onMedia);
    start();
    return () => {
      fine.removeEventListener('change', onMedia);
      calm.removeEventListener('change', onMedia);
      stop();
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div className="site-cursor" ref={rootRef} aria-hidden="true">
      <i className="site-cursor-dot"><b /></i>
      <i className="site-cursor-c is-tl" />
      <i className="site-cursor-c is-tr" />
      <i className="site-cursor-c is-bl" />
      <i className="site-cursor-c is-br" />
    </div>
  );
}
