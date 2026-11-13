import type { CSSProperties, ReactNode } from 'react';

/**
 * Loading placeholders shaped like the content that is about to appear, so the
 * page does not jump when data arrives. Every variant is one `role="status"`
 * region with a screen-reader label; the shimmering blocks themselves are
 * hidden from assistive technology.
 */

export function Bone({ className = '', width, height, style }: Readonly<{
  className?: string;
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}>) {
  return <span className={`skeleton-block sk-bone ${className}`.trim()} style={{ width, height, ...style }} aria-hidden="true" />;
}

export function SkeletonRegion({ label, className = '', children }: Readonly<{ label: string; className?: string; children: ReactNode }>) {
  return (
    <div className={`sk-region ${className}`.trim()} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A page title block: kicker, heading and one line of description. */
export function HeadingSkeleton({ withAction = false }: Readonly<{ withAction?: boolean }>) {
  return (
    <div className="sk-heading">
      <div className="sk-heading-copy">
        <Bone className="sk-kicker" />
        <Bone className="sk-title" />
        <Bone className="sk-text" />
      </div>
      {withAction ? <Bone className="sk-pill" /> : null}
    </div>
  );
}

/** The administrator overview: scope card, five metric cards and the overview panel. */
export function AdminDashboardSkeleton({ label = 'Opening your administration workspace…' }: Readonly<{ label?: string }>) {
  return (
    <SkeletonRegion label={label} className="admin-dashboard">
      <div className="admin-scope-card sk-scope-card">
        <Bone className="sk-scope-symbol" />
        <div className="sk-stack">
          <Bone className="sk-kicker" />
          <Bone className="sk-title" width="min(320px, 70%)" />
          <Bone className="sk-text" width="min(260px, 60%)" />
        </div>
        <Bone className="sk-pill" />
      </div>
      <div className="admin-metric-grid">
        {[0, 1, 2, 3, 4].map((key) => (
          <div className="admin-metric-card sk-metric-card" key={key}>
            <Bone className="sk-text" width="70%" />
            <Bone className="sk-number" />
            <Bone className="sk-text" width="85%" />
          </div>
        ))}
      </div>
      <PanelBody rows={4} />
    </SkeletonRegion>
  );
}

function PanelBody({ rows }: Readonly<{ rows: number }>) {
  return (
    <div className="sk-panel">
      <div className="sk-panel-head">
        <Bone className="sk-icon" />
        <div className="sk-stack">
          <Bone className="sk-subtitle" />
          <Bone className="sk-text" width="min(340px, 80%)" />
        </div>
      </div>
      <div className="sk-rows">
        {Array.from({ length: rows }, (_, index) => (
          <div className="sk-row" key={index}>
            <div className="sk-stack">
              <Bone className="sk-line-strong" width={`${62 - (index % 3) * 12}%`} />
              <Bone className="sk-text" width={`${44 - (index % 2) * 10}%`} />
            </div>
            <Bone className="sk-pill is-small" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A management page: heading, an optional summary card, then a list panel. */
export function ManagementSkeleton({ label, rows = 5, withScope = true }: Readonly<{ label: string; rows?: number; withScope?: boolean }>) {
  return (
    <SkeletonRegion label={label} className="sk-page">
      <HeadingSkeleton withAction />
      {withScope ? (
        <div className="admin-scope-card sk-scope-card">
          <Bone className="sk-scope-symbol" />
          <div className="sk-stack">
            <Bone className="sk-kicker" />
            <Bone className="sk-title" width="min(280px, 70%)" />
            <Bone className="sk-text" width="min(240px, 60%)" />
          </div>
        </div>
      ) : null}
      <PanelBody rows={rows} />
    </SkeletonRegion>
  );
}

/** A list of rows, for use inside an existing panel. */
export function ListSkeleton({ label, rows = 4, className = '' }: Readonly<{ label: string; rows?: number; className?: string }>) {
  return (
    <SkeletonRegion label={label} className={`sk-list ${className}`.trim()}>
      <div className="sk-rows">
        {Array.from({ length: rows }, (_, index) => (
          <div className="sk-row" key={index}>
            <div className="sk-stack">
              <Bone className="sk-line-strong" width={`${58 - (index % 3) * 10}%`} />
              <Bone className="sk-text" width={`${40 - (index % 2) * 8}%`} />
            </div>
            <Bone className="sk-pill is-small" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** A grid of cards (course pickers, offering lists). */
export function CardGridSkeleton({ label, count = 3, className = '' }: Readonly<{ label: string; count?: number; className?: string }>) {
  return (
    <SkeletonRegion label={label} className={`sk-card-grid ${className}`.trim()}>
      {Array.from({ length: count }, (_, index) => (
        <div className="sk-card" key={index}>
          <Bone className="sk-kicker" />
          <Bone className="sk-line-strong" width="72%" />
          <Bone className="sk-text" width="54%" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A report or register: summary tiles then a table. */
export function TableSkeleton({ label, rows = 6, columns = 4, withSummary = true }: Readonly<{
  label: string;
  rows?: number;
  columns?: number;
  withSummary?: boolean;
}>) {
  return (
    <SkeletonRegion label={label} className="sk-table-wrap">
      {withSummary ? (
        <div className="sk-tiles">
          {[0, 1, 2].map((key) => (
            <div className="sk-tile" key={key}>
              <Bone className="sk-text" width="60%" />
              <Bone className="sk-number" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="sk-table" style={{ '--sk-template': `1.6fr repeat(${Math.max(1, columns - 1)}, minmax(0, 1fr))` } as CSSProperties}>
        <div className="sk-table-row is-head">
          {Array.from({ length: columns }, (_, index) => <Bone key={index} className="sk-text" width="60%" />)}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div className="sk-table-row" key={row}>
            {Array.from({ length: columns }, (_, column) => (
              <Bone key={column} className="sk-text" width={`${column === 0 ? 78 : 50 + ((row + column) % 3) * 12}%`} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** A single account-style card (reset link, invitation, sessions list). */
export function AccountPanelSkeleton({ label, rows = 0 }: Readonly<{ label: string; rows?: number }>) {
  return (
    <section className="account-panel sk-account-panel" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="sk-stack">
        <Bone className="sk-kicker" />
        <Bone className="sk-title" width="68%" />
        <Bone className="sk-text" width="92%" />
        <Bone className="sk-text" width="74%" />
        {rows ? (
          <div className="sk-rows">
            {Array.from({ length: rows }, (_, index) => (
              <div className="sk-row" key={index}>
                <div className="sk-stack">
                  <Bone className="sk-line-strong" width="56%" />
                  <Bone className="sk-text" width="38%" />
                </div>
                <Bone className="sk-pill is-small" />
              </div>
            ))}
          </div>
        ) : <Bone className="sk-button" />}
      </div>
    </section>
  );
}
