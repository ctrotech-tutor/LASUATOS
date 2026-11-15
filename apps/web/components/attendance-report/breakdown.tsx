'use client';

import type { LectureReport } from '@lasuatos/contracts';
import { ChevronRight, MapPinOff, PenLine, Smartphone, UserMinus } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { List, ListRow, Section } from '../ds';
import { numberFormat, plural } from './format';
import { RateMeter } from './parts';

/** Departments in the period; tapping one narrows the whole report to it. */
export function DepartmentsSection({ report, onPick }: Readonly<{ report: LectureReport; onPick: (id: string) => void }>) {
  // One department (a department administrator, or already narrowed) has nothing to compare.
  if (report.department || report.departments.length < 2) return null;
  return (
    <section className="ds-section ar-departments" aria-labelledby="ar-departments-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ar-departments-title">Departments</h2>
      </div>
      <ul className="ds-list">
        {report.departments.map((group) => {
          const body = (
            <>
              <span className="ds-row-body">
                <span className="ds-row-title">{group.name}</span>
                <span className="ds-row-subtitle">{plural(group.sessions, 'session')} · {plural(group.checkIns, 'check-in')}</span>
              </span>
              <RateMeter rate={group.rate} threshold={report.below.threshold} />
            </>
          );
          return (
            <li key={group.id ?? group.name}>
              {group.id ? (
                <button className="ds-row" type="button" onClick={() => onPick(group.id!)} aria-label={`Show only ${group.name}`}>
                  {body}
                  <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
                </button>
              ) : <div className="ds-row">{body}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** How the check-ins were made: the things worth a second look, as a share of all of them. */
export function ChecksSection({ report }: Readonly<{ report: LectureReport }>) {
  const { checks, totals } = report;
  if (totals.checkIns === 0 && checks.removed === 0) return null;
  const share = (count: number) => (totals.checkIns && count ? `${Math.max(1, Math.round((count / totals.checkIns) * 100))}% of check-ins` : undefined);
  const rows: readonly { key: string; icon: ReactNode; title: string; count: number; warn?: boolean; subtitle?: string | undefined }[] = [
    { key: 'manual', icon: <PenLine size={18} strokeWidth={2.1} />, title: 'Added by hand', count: checks.manual, subtitle: share(checks.manual) },
    { key: 'outside', icon: <MapPinOff size={18} strokeWidth={2.1} />, title: 'Outside the venue', count: checks.outside, warn: checks.outside > 0, subtitle: share(checks.outside) },
    { key: 'phone', icon: <Smartphone size={18} strokeWidth={2.1} />, title: 'Same phone', count: checks.sharedPhone, warn: checks.sharedPhone > 0, subtitle: share(checks.sharedPhone) },
    { key: 'removed', icon: <UserMinus size={18} strokeWidth={2.1} />, title: 'Removed', count: checks.removed },
  ];
  return (
    <Section id="ar-checks" title="Checks">
      <List leading>
        {rows.map((row) => (
          <ListRow
            key={row.key}
            leading={<span className={`ar-check-icon${row.warn ? ' is-warning' : ''}`}>{row.icon}</span>}
            title={row.title}
            subtitle={row.subtitle}
            detail={<span className={row.warn ? 'ar-count is-warning' : 'ar-count'}>{numberFormat.format(row.count)}</span>}
          />
        ))}
      </List>
    </Section>
  );
}

/** Who opened the period's sessions, as one bar. */
export function TakersSection({ report }: Readonly<{ report: LectureReport }>) {
  const { takers, totals } = report;
  if (totals.sessions === 0) return null;
  const parts = [
    { key: 'lecturer', label: 'Lecturers', count: takers.lecturer },
    { key: 'rep', label: 'Class reps', count: takers.classRep },
    { key: 'admin', label: 'Administrators', count: takers.administrator },
  ].filter((part) => part.count > 0);
  const spoken = parts.map((part) => `${part.label}: ${plural(part.count, 'session')}`).join(', ');
  return (
    <Section id="ar-takers" title="Taken by">
      <div className="ds-card ar-takers">
        <div className="ar-takers-bar" role="img" aria-label={spoken}>
          {parts.map((part) => <span key={part.key} className={`is-${part.key}`} style={{ '--share': part.count / totals.sessions } as CSSProperties} />)}
        </div>
        <ul className="ar-takers-legend" aria-hidden="true">
          {parts.map((part) => (
            <li key={part.key}>
              <span className={`ar-dot is-${part.key}`} />
              <span>{part.label}</span>
              <strong>{numberFormat.format(part.count)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
