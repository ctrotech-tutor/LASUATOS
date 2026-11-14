'use client';

import { useEffect, useRef, useState } from 'react';

type TocItem = { readonly id: string; readonly label: string };

/**
 * "On this page" for long documents. A sticky row of chips on phones and a
 * side rail on desktop; the section being read is highlighted.
 */
export function PageToc({ items, label = 'On this page' }: Readonly<{ items: readonly TocItem[]; label?: string }>) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const sections = items.map((item) => document.getElementById(item.id)).filter((node): node is HTMLElement => node !== null);
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // The first section (in reading order) that is in the reading band wins.
        const first = items.find((item) => visible.has(item.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  // On phones the chips scroll sideways: keep the active one in view.
  useEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const link = list.querySelector<HTMLElement>(`[data-toc="${active}"]`);
    if (!link) return;
    const target = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [active]);

  return (
    <nav className="pg-toc" aria-label={label}>
      <p className="pg-toc-label">{label}</p>
      <ol ref={listRef}>
        {items.map((item, index) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              data-toc={item.id}
              className={active === item.id ? 'is-active' : undefined}
              aria-current={active === item.id ? 'location' : undefined}
              onClick={() => setActive(item.id)}
            >
              <span className="pg-toc-n" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
