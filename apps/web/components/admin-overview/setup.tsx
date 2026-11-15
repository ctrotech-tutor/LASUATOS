'use client';

import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { SetupStep } from './model';

/**
 * First-run checklist: a progress ring, then each step; done steps are ticked and quiet.
 * It collapses to one row (the next step) and disappears by itself once every step is done.
 */
export function SetupChecklist({ steps, collapsed, onToggle }: Readonly<{
  steps: readonly SetupStep[];
  collapsed: boolean;
  onToggle: () => void;
}>) {
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  const summary = (
    <>
      <span
        className="ov-ring"
        role="img"
        aria-label={`${done} of ${steps.length} steps done`}
        style={{ '--progress': done / steps.length } as CSSProperties}
      >
        <span aria-hidden="true">{done}/{steps.length}</span>
      </span>
      <span className="ov-setup-copy">
        <strong>{done === 0 ? 'Start here' : `${steps.length - done} to go`}</strong>
        {next ? <span>Next: {next.title.toLowerCase()}</span> : null}
      </span>
    </>
  );
  return (
    <section className="ds-section ov-setup-section" aria-labelledby="ov-setup-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ov-setup-title">Get set up</h2>
        <button
          className={`ov-disclosure${collapsed ? ' is-collapsed' : ''}`}
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls="ov-setup-steps"
          aria-label={collapsed ? 'Show setup steps' : 'Collapse setup steps'}
          data-tip={collapsed ? 'Expand' : 'Collapse'}
        >
          <ChevronDown size={18} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
      <div className="ds-list ov-setup">
        {collapsed && next ? (
          <Link className="ov-setup-head is-link" href={next.href}>
            {summary}
            <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        ) : (
          <div className="ov-setup-head">{summary}</div>
        )}
        <ol className="ov-steps" id="ov-setup-steps" hidden={collapsed}>
          {steps.map((step) => (
            <li key={step.key}>
              <Link className={`ds-row ov-step${step.done ? ' is-done' : ''}`} href={step.href}>
                <span className="ov-step-mark" aria-hidden="true">{step.done ? <Check size={14} strokeWidth={3} /> : null}</span>
                <span className="ds-row-body">
                  <span className="ds-row-title">{step.title}</span>
                </span>
                <span className="sr-only">{step.done ? ', done' : ', to do'}</span>
                <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
