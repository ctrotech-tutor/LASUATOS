'use client';

import { useEffect } from 'react';

/**
 * Adds `is-in` to every `[data-reveal]` element the first time it scrolls into
 * view; with motion allowed, `hp-motion` makes those elements rise into place.
 * Without JavaScript, or with reduced motion, everything simply shows.
 */
export function RevealOnScroll() {
  useEffect(() => {
    const root = document.documentElement;
    const nodes = document.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('is-in'));
      return undefined;
    }
    // Reduced motion: nothing hides or moves, but `is-in` still marks what has been seen.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) root.classList.add('hp-motion');
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    nodes.forEach((node) => observer.observe(node));
    return () => { observer.disconnect(); root.classList.remove('hp-motion'); };
  }, []);
  return null;
}
