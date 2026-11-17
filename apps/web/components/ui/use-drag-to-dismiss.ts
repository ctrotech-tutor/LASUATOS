'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** Bottom sheets only exist at phone widths; wider screens show a centred dialog that does not drag. */
export const SHEET_MEDIA = '(max-width: 760px)';

/** Grabbers and sheet headers: a drag always starts here, even on a sheet that scrolls or holds a map. */
export const DRAG_HANDLE = '[data-drag-handle]';

/**
 * Never start a drag on these: they use vertical gestures themselves (a slider, a map that pans,
 * a text area being selected), or ask not to (`data-no-drag`).
 */
const NO_DRAG = '[data-no-drag], input[type="range"], textarea, select, [contenteditable="true"], .leaflet-container, canvas, video';

/** How far, as a share of the sheet's height, a slow drag must go to close it. */
const CLOSE_SHARE = 0.25;
/** A flick at this speed (px per ms) closes the sheet even when it moved only a little. */
const FLICK_SPEED = 0.45;
/** Movement before a touch counts as a drag rather than a tap. */
const SLOP = 6;
/** Same curve as iOS sheets (and vaul). */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SETTLE_MS = 300;
const LEAVE_MS = 240;

export type DragToDismissOptions = {
  /** Listen only while the sheet is shown. */
  readonly enabled: boolean;
  /** Called when a drag closes the sheet, once it has slid out of view. */
  readonly onDismiss: () => void;
  /** Only the grabber and header start a drag: for sheets whose body pans (a map) or holds unsaved work. */
  readonly handleOnly?: boolean;
  /** A separate backdrop to fade with the drag (for sheets that are not a <dialog> with ::backdrop). */
  readonly scrim?: RefObject<HTMLElement | null>;
  /** When sheets apply; defaults to phone widths. */
  readonly media?: string;
};

type Gesture = {
  startY: number;
  startX: number;
  fromHandle: boolean;
  scrollers: HTMLElement[];
  phase: 'pending' | 'dragging';
  offset: number;
  samples: { y: number; t: number }[];
};

/** Every element between `target` and `sheet` (inclusive) that scrolls vertically. */
function verticalScrollers(target: Element, sheet: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
      found.push(node);
    }
    if (node === sheet) break;
  }
  return found;
}

/**
 * Drag a bottom sheet down to close it, like the iOS sheets and the shadcn (vaul) drawer.
 *
 * - The sheet follows the finger and the backdrop fades with it; past a quarter of its height,
 *   or on a quick flick, it slides away and `onDismiss` runs. Otherwise it springs back.
 * - Dragging up gives a little rubber-band resistance and never closes.
 * - The grabber and header always drag. The body drags only when everything under the finger
 *   is scrolled to the top, so a long list still scrolls; a mostly sideways move (a wide table)
 *   is left to the browser; sliders, maps and text areas never drag.
 * - A drag that moved never also counts as a tap on whatever the finger started on.
 *
 * Keyboard and screen reader users close sheets with Escape or the Close button, as before.
 */
export function useDragToDismiss(ref: RefObject<HTMLElement | null>, options: DragToDismissOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const { enabled, handleOnly = false, media = SHEET_MEDIA } = options;

  useEffect(() => {
    const sheet = ref.current;
    if (!sheet || !enabled) return;
    let gesture: Gesture | null = null;
    let timer = 0;

    const scrim = () => latest.current.scrim?.current ?? null;
    const setFade = (share: number) => {
      const value = String(Math.min(1, Math.max(0, share)));
      sheet.style.setProperty('--drag-progress', value);
      const extra = scrim();
      if (extra) extra.style.opacity = String(1 - Number(value));
    };
    const reset = () => {
      window.clearTimeout(timer);
      sheet.style.removeProperty('transform');
      sheet.style.removeProperty('transition');
      sheet.style.removeProperty('--drag-progress');
      delete sheet.dataset.dragging;
      const extra = scrim();
      if (extra) {
        extra.style.removeProperty('opacity');
        extra.style.removeProperty('transition');
      }
    };
    reset();

    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function begin(x: number, y: number, target: EventTarget | null): boolean {
      if (!window.matchMedia(media).matches || !(target instanceof Element) || !sheet) return false;
      const fromHandle = Boolean(target.closest(DRAG_HANDLE));
      if (!fromHandle && (latest.current.handleOnly ?? false)) return false;
      if (!fromHandle && target.closest(NO_DRAG)) return false;
      window.clearTimeout(timer);
      gesture = {
        startX: x,
        startY: y,
        fromHandle,
        scrollers: fromHandle ? [] : verticalScrollers(target, sheet),
        phase: 'pending',
        offset: 0,
        samples: [{ y, t: performance.now() }],
      };
      return true;
    }

    /** Returns true while this gesture is moving the sheet (so the page must not also scroll). */
    function move(x: number, y: number): boolean {
      if (!gesture || !sheet) return false;
      if (gesture.phase === 'pending') {
        const dx = x - gesture.startX;
        const dy = y - gesture.startY;
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return false;
        const sideways = Math.abs(dx) > Math.abs(dy);
        const upFromBody = dy < 0 && !gesture.fromHandle;
        const scrolled = gesture.scrollers.some((element) => element.scrollTop > 0);
        const selecting = Boolean(window.getSelection()?.toString());
        if (sideways || upFromBody || scrolled || selecting) {
          gesture = null;
          return false;
        }
        // Start from here so the sheet does not jump by the slop.
        gesture.phase = 'dragging';
        gesture.startY = y;
        sheet.dataset.dragging = '';
        sheet.style.transition = 'none';
        const extra = scrim();
        if (extra) extra.style.transition = 'none';
      }
      const offset = y - gesture.startY;
      gesture.offset = offset;
      const shown = offset >= 0 ? offset : -Math.min(24, Math.sqrt(-offset) * 2.2);
      sheet.style.transform = `translate3d(0, ${shown.toFixed(1)}px, 0)`;
      setFade(Math.max(0, offset) / Math.max(1, sheet.offsetHeight));
      const now = performance.now();
      gesture.samples.push({ y, t: now });
      while (gesture.samples.length > 2 && now - gesture.samples[0]!.t > 100) gesture.samples.shift();
      return true;
    }

    /** Returns true when the gesture had moved the sheet (so the following click is swallowed). */
    function end(): boolean {
      const done = gesture;
      gesture = null;
      if (!done || done.phase !== 'dragging' || !sheet) return false;
      delete sheet.dataset.dragging;
      const height = sheet.getBoundingClientRect().height;
      const first = done.samples[0]!;
      const last = done.samples[done.samples.length - 1]!;
      const speed = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      const close = done.offset > height * CLOSE_SHARE || (speed > FLICK_SPEED && done.offset > SLOP * 3);
      const still = reducedMotion();
      const extra = scrim();
      if (close) {
        const leave = still ? 0 : LEAVE_MS;
        sheet.style.transition = still ? 'none' : `transform ${leave}ms ${EASE}`;
        sheet.style.transform = `translate3d(0, ${Math.ceil(height + 24)}px, 0)`;
        if (extra) extra.style.transition = still ? 'none' : `opacity ${leave}ms ${EASE}`;
        setFade(1);
        timer = window.setTimeout(() => latest.current.onDismiss(), leave);
      } else {
        sheet.style.transition = still ? 'none' : `transform ${SETTLE_MS}ms ${EASE}`;
        sheet.style.transform = 'translate3d(0, 0, 0)';
        if (extra) extra.style.transition = still ? 'none' : `opacity ${SETTLE_MS}ms ${EASE}`;
        setFade(0);
        timer = window.setTimeout(() => {
          sheet.style.removeProperty('transform');
          sheet.style.removeProperty('transition');
          sheet.style.removeProperty('--drag-progress');
          if (extra) extra.style.removeProperty('transition');
        }, still ? 0 : SETTLE_MS);
      }
      return true;
    }

    function swallowNextClick() {
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
    }

    // Touch: touchmove must be non-passive so a drag can stop the page (or the list) scrolling.
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        gesture = null;
        return;
      }
      const touch = event.touches[0]!;
      begin(touch.clientX, touch.clientY, event.target);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || !gesture) return;
      if (move(touch.clientX, touch.clientY) && event.cancelable) event.preventDefault();
    };
    const onTouchEnd = () => {
      if (end()) swallowNextClick();
    };

    // A mouse drags from the grabber or header only (a narrow desktop window, or testing).
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (!(event.target instanceof Element) || !event.target.closest(DRAG_HANDLE)) return;
      if (!begin(event.clientX, event.clientY, event.target)) return;
      const onMove = (moveEvent: PointerEvent) => {
        if (move(moveEvent.clientX, moveEvent.clientY)) moveEvent.preventDefault();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (end()) swallowNextClick();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

    // A <dialog> that closed (by a drag or any other way) starts clean next time it opens.
    const onClose = () => reset();

    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: false });
    sheet.addEventListener('touchend', onTouchEnd);
    sheet.addEventListener('touchcancel', onTouchEnd);
    sheet.addEventListener('pointerdown', onPointerDown);
    sheet.addEventListener('close', onClose);
    return () => {
      window.clearTimeout(timer);
      sheet.removeEventListener('touchstart', onTouchStart);
      sheet.removeEventListener('touchmove', onTouchMove);
      sheet.removeEventListener('touchend', onTouchEnd);
      sheet.removeEventListener('touchcancel', onTouchEnd);
      sheet.removeEventListener('pointerdown', onPointerDown);
      sheet.removeEventListener('close', onClose);
    };
  }, [ref, enabled, handleOnly, media]);
}
