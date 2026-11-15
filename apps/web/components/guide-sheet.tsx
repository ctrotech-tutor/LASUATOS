'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Sheet } from './ds';
import { PAGE_GUIDE } from './shell/guide';
import { groupsOf, navigationFor, type ShellRole } from './shell/nav-model';
import './guide-sheet.css';

/**
 * The guide: every page of the workspace with one line on what it is for, grouped like the
 * sidebar. Screens stay lean because the explanations live here.
 */
export function GuideSheet({ open, onClose, role, institutionAdmin }: Readonly<{
  open: boolean;
  onClose: () => void;
  role: ShellRole;
  institutionAdmin: boolean;
}>) {
  const groups = groupsOf(navigationFor({ role, pathname: '', capabilities: null, openDisputes: 0, institutionAdmin }));
  return (
    <Sheet open={open} onClose={onClose} title="Guide">
      <div className="gd-body">
        {groups.map((group) => (
          <section className="gd-group" key={group.label ?? 'main'} aria-label={group.label ?? 'Start'}>
            {group.label ? <h3 className="gd-group-title">{group.label}</h3> : null}
            <ul className="ds-list has-leading">
              {group.items.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link className="ds-row gd-row" href={href} onClick={onClose}>
                    <span className="ds-row-leading" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                    <span className="ds-row-body">
                      <span className="ds-row-title">{label}</span>
                      {PAGE_GUIDE[href] ? <span className="ds-row-subtitle">{PAGE_GUIDE[href]}</span> : null}
                    </span>
                    <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
