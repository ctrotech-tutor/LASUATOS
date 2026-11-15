'use client';

import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { numberFormat } from './format';
import type { AttentionItem } from './model';
import { RowBones } from './sessions';

/** What needs the administrator now, or one calm line saying nothing does. */
export function Attention({ items }: Readonly<{ items: readonly AttentionItem[] | null }>) {
  return (
    <section className="ds-section ov-attention" aria-labelledby="ov-attention-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ov-attention-title">Needs attention</h2>
      </div>
      {!items ? (
        <RowBones rows={2} label="Checking what needs attention" />
      ) : items.length ? (
        <ul className="ds-list has-leading">
          {items.map(({ key, icon: Icon, tone, title, subtitle, count, href }) => (
            <li key={key}>
              <Link className="ds-row" href={href}>
                <span className={`ds-row-leading ov-tone-${tone}`} aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                <span className="ds-row-body">
                  <span className="ds-row-title">{title}</span>
                  <span className="ds-row-subtitle">{subtitle}</span>
                </span>
                {count ? <span className={`ov-pill ov-tone-${tone}`}>{numberFormat.format(count)}</span> : null}
                <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ds-list has-leading">
          <div className="ds-row ov-clear">
            <span className="ds-row-leading ov-tone-success" aria-hidden="true"><Check size={18} strokeWidth={2.4} /></span>
            <span className="ds-row-body">
              <span className="ds-row-title">All caught up</span>
              <span className="ds-row-subtitle">Nothing needs you right now</span>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
