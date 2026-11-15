'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export type Segment<T extends string> = { readonly value: T; readonly label: ReactNode; readonly icon?: ReactNode };

/**
 * An iOS segmented control for switching a view in place (not for navigation:
 * use links for that). Arrow keys move between segments, as in a radio group.
 */
export function SegmentedControl<T extends string>({ segments, value, onChange, label, block = false }: Readonly<{
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  block?: boolean;
}>) {
  const group = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = segments.findIndex((segment) => segment.value === value);
    const next = segments[(index + step + segments.length) % segments.length];
    if (!next) return;
    onChange(next.value);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[segments.indexOf(next)]?.focus();
  };
  return (
    <div ref={group} className={`ds-segmented${block ? ' ds-segmented-block' : ''}`} role="radiogroup" aria-label={label} onKeyDown={move}>
      {segments.map((segment) => {
        const checked = segment.value === value;
        return (
          <button
            key={segment.value}
            className="ds-segment"
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(segment.value)}
          >
            {segment.icon}
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
