'use client';

import { useEffect, useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

/* Shared plumbing for the custom form controls (Select, DatePicker, Combobox, NumberField). */

const PHONE_QUERY = '(max-width: 760px)';

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True on phone-width screens, where pickers open as bottom sheets instead of popovers. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

/** Popovers go into the open <dialog> they were opened from (top layer), otherwise <body>. */
export function portalTarget(anchor: HTMLElement | null): HTMLElement {
  const dialog = anchor?.closest('dialog[open]');
  return dialog instanceof HTMLElement ? dialog : document.body;
}

const GAP = 6;
const EDGE = 8;

/**
 * Keeps a fixed-position panel attached to its anchor: below it when there is room, above
 * otherwise, never past the screen edges, at least as wide as the anchor. Writes styles
 * straight to the element so scrolling never re-renders React.
 */
export function useAnchoredPanel(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  options: { readonly maxHeight?: number; readonly minWidth?: number; readonly matchWidth?: boolean } = {},
) {
  const { maxHeight = 340, minWidth = 0, matchWidth = true } = options;
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportWidth = document.documentElement.clientWidth;
      const width = Math.min(viewportWidth - EDGE * 2, Math.max(matchWidth ? rect.width : 0, minWidth));
      panel.style.width = `${width}px`;
      panel.style.maxHeight = '';
      const natural = Math.min(panel.scrollHeight, maxHeight);
      const below = viewportHeight - rect.bottom - GAP - EDGE;
      const above = rect.top - GAP - EDGE;
      const placeBelow = below >= natural || below >= above;
      const room = Math.max(120, Math.min(maxHeight, placeBelow ? below : above));
      const height = Math.min(natural, room);
      panel.style.maxHeight = `${room}px`;
      panel.style.left = `${Math.min(Math.max(EDGE, rect.left), viewportWidth - width - EDGE)}px`;
      panel.style.top = `${placeBelow ? rect.bottom + GAP : rect.top - GAP - height}px`;
      panel.dataset.side = placeBelow ? 'bottom' : 'top';
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open, anchorRef, panelRef, maxHeight, minWidth, matchWidth]);
}

/** Calls `onOutside` for presses outside every given element while `active`. */
export function useOutsidePress(active: boolean, refs: readonly RefObject<HTMLElement | null>[], onOutside: () => void) {
  useEffect(() => {
    if (!active) return;
    const handle = (event: PointerEvent) => {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onOutside();
    };
    document.addEventListener('pointerdown', handle, true);
    return () => document.removeEventListener('pointerdown', handle, true);
  }, [active, refs, onOutside]);
}

let labelSequence = 0;

/**
 * Most fields are written as <label><span>Name</span><Control/></label>. A wrapping label
 * would name a custom control after all of its text (including the control's own value and
 * button labels), so this points aria-labelledby at the label's caption instead, and makes a
 * press on the caption focus the control without opening it, like a native <select>.
 * Returns nothing; the effect only touches DOM attributes React does not manage.
 */
/**
 * Lets a wrapping <label> name and focus a custom control. `valueId` (for buttons) adds the
 * shown value to the name, so speech users can say what they see.
 */
export function useWrappingLabel(controlRef: RefObject<HTMLElement | null>, enabled: boolean, valueId?: string) {
  useEffect(() => {
    const control = controlRef.current;
    if (!enabled || !control) return;
    const label = control.closest('label');
    if (!label) return;
    // Only text before the control names it; hints after it (e.g. "Caps the level…") do not.
    const before = (node: Node) => !node.contains(control) && Boolean(node.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
    const leading = [...label.childNodes].filter((node) => before(node) && node.nodeType !== Node.COMMENT_NODE);
    const hasBareText = leading.some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    let hidden: HTMLSpanElement | null = null;
    const caption = hasBareText ? undefined : leading.find(
      (node): node is Element => node instanceof Element && (node.tagName === 'SPAN' || node.tagName === 'STRONG') && Boolean(node.textContent?.trim()),
    );
    if (caption) {
      if (!caption.id) caption.id = `ui-label-${++labelSequence}`;
      control.setAttribute('aria-labelledby', valueId ? `${caption.id} ${valueId}` : caption.id);
    } else if (!control.hasAttribute('aria-label')) {
      // e.g. "Capacity <span>(optional)</span>": name from all the text before the control.
      const text = leading.map((node) => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
      if (text && valueId) {
        // Bare text has no id to point at, so give it a hidden twin that has one.
        hidden = document.createElement('span');
        hidden.className = 'sr-only';
        hidden.id = `ui-label-${++labelSequence}`;
        hidden.textContent = text;
        label.append(hidden);
        control.setAttribute('aria-labelledby', `${hidden.id} ${valueId}`);
      } else if (text) {
        control.setAttribute('aria-label', text);
      }
    }
    const onLabelClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (control.contains(target)) return;
      // Presses on other controls inside the label (buttons, inputs) keep working.
      if (target instanceof Element && target.closest('button, input, select, textarea, a, [role="option"]')) return;
      event.preventDefault();
      control.focus();
    };
    label.addEventListener('click', onLabelClick);
    return () => {
      label.removeEventListener('click', onLabelClick);
      hidden?.remove();
    };
  }, [controlRef, enabled, valueId]);
}

/** The text a wrapping label shows for a control (used as the phone sheet's title). */
export function labelTextFor(control: HTMLElement | null): string {
  if (!control) return '';
  // The first id is the caption; any later one is the control's own value.
  const id = control.getAttribute('aria-labelledby')?.split(' ')[0];
  const byId = id ? document.getElementById(id)?.textContent : null;
  return (byId ?? control.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
}

/** Sets an input's value the way typing would, so React's onChange and form listeners fire. */
export function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
