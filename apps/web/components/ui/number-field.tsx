'use client';

import { Minus, Plus } from 'lucide-react';
import { useRef, type InputHTMLAttributes } from 'react';
import { setNativeValue, useWrappingLabel } from './primitives';

/* ------------------------------------------------------------------ */
/* NumberField: a number input with large − / + buttons instead of the */
/* browser's tiny spinners. Still a real <input type="number">, so the */
/* phone shows the number keyboard and min/max validation keeps        */
/* working (shown by FormValidation).                                  */
/* ------------------------------------------------------------------ */

type NumberFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'min' | 'max' | 'step'> & {
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  /** How much − / + change the value (defaults to step). */
  readonly nudge?: number | undefined;
  readonly unit?: string | undefined;
};

export function NumberField({ min, max, step = 1, nudge: nudgeBy, unit, className, disabled, ...input }: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useWrappingLabel(inputRef, !input['aria-label']);

  const nudge = (direction: 1 | -1) => {
    const element = inputRef.current;
    if (!element) return;
    const amount = nudgeBy ?? step;
    if (element.value === '' || !Number.isFinite(Number(element.value))) {
      setNativeValue(element, String(min ?? 0));
      element.focus({ preventScroll: true });
      return;
    }
    let next = Number(element.value) + direction * amount;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setNativeValue(element, String(next));
    element.focus({ preventScroll: true });
  };

  return (
    <span className={`ui-number${className ? ` ${className}` : ''}${disabled ? ' is-disabled' : ''}`}>
      {/* The input comes first so a wrapping <label> targets it, not a button. */}
      <input ref={inputRef} className="ui-number-input" type="number" inputMode="numeric" min={min} max={max} step={step} disabled={disabled} {...input} />
      {unit ? <span className="ui-number-unit" aria-hidden="true">{unit}</span> : null}
      <button type="button" className="ui-number-step is-down" tabIndex={-1} aria-label="Decrease" disabled={disabled}
        onPointerDown={(event) => event.preventDefault()} onClick={() => nudge(-1)}>
        <Minus size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <button type="button" className="ui-number-step is-up" tabIndex={-1} aria-label="Increase" disabled={disabled}
        onPointerDown={(event) => event.preventDefault()} onClick={() => nudge(1)}>
        <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </span>
  );
}
