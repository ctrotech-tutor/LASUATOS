'use client';

import { useEffect, useId, useRef } from 'react';

/* ------------------------------------------------------------------ */
/* Tooltips for any element with data-tip="…" (replaces title="…",     */
/* whose browser tooltip is slow, unstyled and never shows on phones). */
/* Desktop: on hover after a short delay, and on keyboard focus.       */
/* Phones: tapping an element that is not a button or link shows it    */
/* for a few seconds (e.g. a table header or a badge).                 */
/* One shared element, mounted once in the app shell.                  */
/* ------------------------------------------------------------------ */

const SHOW_DELAY = 400;
const TOUCH_TIME = 2800;

export function TooltipLayer() {
  const id = useId();
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    let current: HTMLElement | null = null;
    let timer = 0;

    const place = (target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const viewport = document.documentElement.clientWidth;
      const above = rect.top - height - 8 >= 8;
      tip.style.left = `${Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), viewport - width - 8)}px`;
      tip.style.top = `${above ? rect.top - height - 8 : rect.bottom + 8}px`;
      tip.dataset.side = above ? 'top' : 'bottom';
    };

    const hide = () => {
      window.clearTimeout(timer);
      if (current) {
        const described = (current.getAttribute('aria-describedby') ?? '').split(' ').filter((value) => value && value !== tip.id);
        if (described.length) current.setAttribute('aria-describedby', described.join(' '));
        else current.removeAttribute('aria-describedby');
      }
      current = null;
      tip.hidden = true;
    };

    const show = (target: HTMLElement) => {
      const text = target.dataset.tip?.trim();
      if (!text) return;
      current = target;
      tip.textContent = text;
      tip.hidden = false;
      place(target);
      // Screen readers hear the tip as a description, unless it only repeats the name.
      if (text !== target.getAttribute('aria-label')) {
        const described = new Set((target.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
        described.add(tip.id);
        target.setAttribute('aria-describedby', [...described].join(' '));
      }
    };

    const tipTarget = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null);

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = tipTarget(event.target);
      if (target === current) return;
      hide();
      if (target) timer = window.setTimeout(() => show(target), SHOW_DELAY);
    };
    const onOut = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = tipTarget(event.target);
      if (target && !target.contains(event.relatedTarget as Node)) hide();
    };
    const onFocus = (event: FocusEvent) => {
      const target = tipTarget(event.target);
      if (target && target.matches(':focus-visible')) { hide(); show(target); }
    };
    const onBlur = (event: FocusEvent) => { if (tipTarget(event.target) === current) hide(); };
    const onTap = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      const target = tipTarget(event.target);
      if (!target || target.closest('button, a, input, select, textarea, [role="button"]')) { hide(); return; }
      hide();
      show(target);
      timer = window.setTimeout(hide, TOUCH_TIME);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerup', onTap);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      hide();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerup', onTap);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  return <div ref={tipRef} id={`tip-${id.replace(/:/g, '')}`} className="ui-tooltip" role="tooltip" aria-hidden="true" hidden />;
}
