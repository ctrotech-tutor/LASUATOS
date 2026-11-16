'use client';

import type { AuditCategory, AuditLogEntry } from '@lasuatos/contracts';
import {
  ArrowRight, ChevronDown, ChevronUp, ClipboardCheck, Copy, FileText, GraduationCap, Landmark, Link2, MapPinned, Quote, ScanFace, Search,
  Trash2, TriangleAlert, UserCog, UserRound, X,
} from 'lucide-react';
import Link from 'next/link';
import { Badge, buttonClassName, Menu } from '../ds';
import { useFeedback } from '../feedback';
import { actorLabel, agoLabel, CATEGORY_SHORT, copyText, entryText, fullWhen, initials, PATH, prettyRecord } from './format';

export const CATEGORY_ICONS: Readonly<Record<AuditCategory, typeof ScanFace>> = {
  students: GraduationCap,
  faces: ScanFace,
  attendance: ClipboardCheck,
  staff: UserCog,
  structure: Landmark,
  venues: MapPinned,
  retention: Trash2,
};

export function CategoryGlyph({ category, notable = false, size = 18 }: Readonly<{ category: AuditCategory; notable?: boolean; size?: number }>) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <span className={`au-glyph is-${category}${notable ? ' is-notable' : ''}`} aria-hidden="true">
      <Icon size={size} strokeWidth={2.1} />
    </span>
  );
}

export type Nav = {
  readonly previous: (() => void) | null;
  readonly next: (() => void) | null;
  /** "3 of 50+" */
  readonly position: string | null;
};

/**
 * One entry: what happened, who did it and when, what changed (before → after), the reason
 * they gave, links to the pages it touched, and the record exactly as stored. In the pane on
 * wide screens and in a sheet on phones (`inSheet`, where the sheet's title is the summary).
 */
export function EntryDetail({ entry, now, inSheet, nav, onClose, onActor, onSubject }: Readonly<{
  entry: AuditLogEntry;
  now: number;
  inSheet: boolean;
  nav: Nav;
  onClose?: (() => void) | undefined;
  /** Show everything this person did; null when they are already the filter. */
  onActor: ((entry: AuditLogEntry) => void) | null;
  /** Search the log for the subject (a matric number, a venue…). */
  onSubject: ((entry: AuditLogEntry) => void) | null;
}>) {
  const feedback = useFeedback();
  const record = prettyRecord(entry.details);
  const actor = actorLabel(entry);
  const titleId = `au-title-${entry.id.replace(/[^a-z0-9]/gi, '')}`;
  const canActor = Boolean(onActor && entry.actorId);
  const canSubject = Boolean(onSubject && entry.subjectSearch);

  function copy(text: string, what: string) {
    void copyText(text).then((done) => done
      ? feedback.toast(`${what} copied`)
      : feedback.toast(`The ${what.toLowerCase()} could not be copied.`, 'error'));
  }
  const link = () => `${window.location.origin}${PATH}?entry=${entry.id}`;

  return (
    <article className="au-detail" tabIndex={-1} aria-labelledby={inSheet ? undefined : titleId} aria-label={inSheet ? entry.summary : undefined}>
      <div className="au-detail-bar">
        <div className="au-detail-nav">
          <button className="ds-icon-btn" type="button" aria-label="Newer entry" data-tip="Newer (K)" disabled={!nav.previous} onClick={nav.previous ?? undefined}>
            <ChevronUp size={18} strokeWidth={2.3} aria-hidden="true" />
          </button>
          <button className="ds-icon-btn" type="button" aria-label="Older entry" data-tip="Older (J)" disabled={!nav.next} onClick={nav.next ?? undefined}>
            <ChevronDown size={18} strokeWidth={2.3} aria-hidden="true" />
          </button>
          {nav.position ? <span className="au-detail-position">{nav.position}</span> : null}
        </div>
        <div className="au-detail-tools">
          <Menu
            label="Entry actions"
            title={entry.summary}
            items={[
              { label: 'Copy link to this entry', icon: <Link2 size={17} />, onSelect: () => copy(link(), 'Link') },
              { label: 'Copy as text', icon: <Copy size={17} />, onSelect: () => copy(entryText(entry, window.location.origin), 'Entry') },
              record ? { label: 'Copy the stored record', icon: <FileText size={17} />, onSelect: () => copy(record, 'Stored record') } : null,
              canActor ? { label: `Everything by ${actor}`, icon: <UserRound size={17} />, onSelect: () => onActor?.(entry) } : null,
              canSubject ? { label: `Everything about ${entry.subjectSearch}`, icon: <Search size={17} />, onSelect: () => onSubject?.(entry) } : null,
            ]}
          />
          {onClose ? (
            <button className="ds-icon-btn" type="button" aria-label="Close entry" data-tip="Close" onClick={onClose}>
              <X size={17} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <header className="au-detail-head">
        <div className="au-detail-badges">
          <Badge tone="tint">{CATEGORY_SHORT[entry.category]}</Badge>
          {entry.notable ? <Badge tone="warning">Worth a look</Badge> : null}
        </div>
        {inSheet ? null : <h2 className="au-detail-title" id={titleId}>{entry.summary}</h2>}
        {entry.subject ? <p className="au-detail-subject">{entry.subject}</p> : null}
        <p className="au-detail-when">
          <time dateTime={entry.at}>{fullWhen(entry.at)}</time>
          {now ? <span> · {agoLabel(entry.at, now)}</span> : null}
        </p>
      </header>

      {entry.notable ? (
        <p className="au-callout">
          <TriangleAlert size={17} strokeWidth={2.3} aria-hidden="true" />
          <span>This took something away from someone, or handed an account to someone else. Nothing is wrong with it; it is just worth knowing about.</span>
        </p>
      ) : null}

      <section className="au-block" aria-labelledby={`${titleId}-who`}>
        <h3 className="au-block-title" id={`${titleId}-who`}>Done by</h3>
        <div className="au-who">
          <span className="au-avatar" aria-hidden="true">{initials(actor)}</span>
          <span className="au-who-name">{actor}</span>
          {canActor ? (
            <button className={buttonClassName({ variant: 'gray', size: 'sm', className: 'au-who-more' })} type="button" onClick={() => onActor?.(entry)}>
              <UserRound size={15} strokeWidth={2.2} aria-hidden="true" />
              Everything by them
            </button>
          ) : null}
        </div>
      </section>

      {entry.note ? (
        <section className="au-block" aria-labelledby={`${titleId}-note`}>
          <h3 className="au-block-title" id={`${titleId}-note`}>Reason given</h3>
          <blockquote className="au-note">
            <Quote size={16} strokeWidth={2.3} aria-hidden="true" />
            <span>{entry.note}</span>
          </blockquote>
        </section>
      ) : null}

      {entry.facts.length ? (
        <section className="au-block" aria-labelledby={`${titleId}-facts`}>
          <h3 className="au-block-title" id={`${titleId}-facts`}>Details</h3>
          <dl className="au-facts">
            {entry.facts.map((fact, index) => (
              <div key={`${fact.label}-${index}`} className={fact.previous !== null ? 'is-change' : undefined}>
                <dt>{fact.label}</dt>
                <dd>
                  {fact.previous !== null ? (
                    <span className="au-change">
                      <span className="au-before"><span className="sr-only">Changed from </span>{fact.previous}</span>
                      <ArrowRight className="au-change-arrow" size={15} strokeWidth={2.4} aria-hidden="true" />
                      <span className="au-after"><span className="sr-only">to </span>{fact.value}</span>
                    </span>
                  ) : fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {entry.links.length || canSubject ? (
        <section className="au-block" aria-labelledby={`${titleId}-open`}>
          <h3 className="au-block-title" id={`${titleId}-open`}>Go to</h3>
          <div className="au-links">
            {entry.links.map((item) => (
              <Link key={item.href} className={buttonClassName({ variant: 'tinted', size: 'sm' })} href={item.href}>
                {item.label}
                <ArrowRight size={15} strokeWidth={2.3} aria-hidden="true" />
              </Link>
            ))}
            {canSubject ? (
              <button className={buttonClassName({ variant: 'gray', size: 'sm' })} type="button" onClick={() => onSubject?.(entry)}>
                <Search size={15} strokeWidth={2.2} aria-hidden="true" />
                Everything about {entry.subjectSearch}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {record ? (
        <details className="au-record">
          <summary>
            <FileText size={16} strokeWidth={2.2} aria-hidden="true" />
            Stored record
            <span className="au-record-hint">exactly as kept, ids and all</span>
          </summary>
          <pre className="au-record-body" tabIndex={0} aria-label="Stored record">{record}</pre>
          <div className="au-record-foot">
            <button className={buttonClassName({ variant: 'gray', size: 'sm' })} type="button" onClick={() => copy(record, 'Stored record')}>
              <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
              Copy record
            </button>
            <button className="au-id" type="button" onClick={() => copy(entry.id, 'Entry id')} aria-label={`${entry.id}, copy entry id`} data-tip="Copy entry id">
              {entry.id}
            </button>
          </div>
        </details>
      ) : null}
    </article>
  );
}
