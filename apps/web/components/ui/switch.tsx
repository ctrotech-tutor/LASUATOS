'use client';

import { useId, type ReactNode } from 'react';

/**
 * An on/off setting with a label and an optional explanation underneath: a
 * `role="switch"` button, so it looks the same on every phone and reads as a
 * switch to screen readers. The whole row is the tap target.
 */
export function SwitchField({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled = false,
  name,
}: Readonly<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  /** Submits "on" in a plain form when set. */
  name?: string;
}>) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className={`ui-switch-field${disabled ? ' is-disabled' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        className="ui-switch"
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="ui-switch-thumb" aria-hidden="true" />
      </button>
      <span className="ui-switch-text" onClick={() => { if (!disabled) onCheckedChange(!checked); }}>
        <span id={labelId}>{label}</span>
        {hint ? <small id={hintId}>{hint}</small> : null}
      </span>
      {name && checked ? <input type="hidden" name={name} value="on" /> : null}
    </div>
  );
}
