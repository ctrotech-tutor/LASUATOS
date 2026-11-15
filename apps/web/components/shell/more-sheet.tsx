'use client';

import { ChevronRight, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Sheet } from '../ds/sheet';
import { groupsOf, isActive, type NavItem } from './nav-model';

/** A stable key for the tile colour of a group in "More". */
function tone(group: string | null): string {
  return (group ?? 'home').toLowerCase().replace(/[^a-z]+/g, '-');
}

/**
 * The phone tab bar's last slot when the pages do not all fit: an iOS sheet with the rest,
 * grouped like the sidebar, each with a coloured icon tile as in iOS Settings.
 */
export function MoreTab({ items, pathname, badge }: Readonly<{
  items: readonly NavItem[];
  pathname: string;
  badge: (href: string) => ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const activeInside = items.some((item) => isActive(item.href, pathname));
  const waiting = items.some((item) => badge(item.href) !== null);
  return (
    <>
      <button
        className={`ap-tab${activeInside ? ' is-active' : ''}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-current={activeInside ? 'page' : undefined}
        onClick={() => setOpen(true)}
      >
        <span className="ap-tab-icon">
          <MoreHorizontal size={24} strokeWidth={activeInside ? 2.2 : 1.8} aria-hidden="true" />
          {waiting ? <span className="ap-tab-dot" aria-hidden="true" /> : null}
        </span>
        <span className="ap-tab-label">More</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="More">
        <div className="ap-more">
          {groupsOf(items).map((group) => (
            <section className="ap-more-group" key={group.label ?? 'pages'} aria-label={group.label ?? 'Pages'}>
              {group.label ? <h3 className="ap-more-heading">{group.label}</h3> : null}
              <ul className="ap-more-list">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href, pathname);
                  return (
                    <li key={href}>
                      <Link className={`ap-more-link${active ? ' is-active' : ''}`} href={href} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}>
                        <span className="ap-more-tile" data-tone={tone(group.label)} aria-hidden="true"><Icon size={17} strokeWidth={2} /></span>
                        <span className="ap-more-label">{label}</span>
                        {badge(href)}
                        <ChevronRight className="ap-more-chevron" size={18} strokeWidth={2} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </Sheet>
    </>
  );
}
