'use client';

import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { SetupStep } from './model';

/** First-run checklist: a progress ring, then each step; done steps are ticked and quiet. */
export function SetupChecklist({ steps, onHide }: Readonly<{ steps: readonly SetupStep[]; onHide: () => void }>) {
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  return (
    <section className="ds-section ov-setup-section" aria-labelledby="ov-setup-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ov-setup-title">Get set up</h2>
        <button className="ov-section-link" type="button" onClick={onHide}>Hide</button>
      </div>
      <div className="ds-list ov-setup">
        <div className="ov-setup-head">
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
        </div>
        <ol className="ov-steps">
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
