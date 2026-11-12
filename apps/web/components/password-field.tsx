'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

type PasswordFieldProps = {
  readonly label: ReactNode;
  readonly name: string;
  readonly autoComplete: 'current-password' | 'new-password';
  readonly hint?: ReactNode;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly required?: boolean;
  readonly autoFocus?: boolean;
};

/**
 * A password input with a show/hide button. Uncontrolled, so forms keep reading
 * the value from FormData. The label is tied to the input with htmlFor (not by
 * wrapping), so screen readers announce "Password" rather than also reading the
 * button's name. Tapping the button keeps the keyboard open on phones.
 */
export function PasswordField({ label, name, autoComplete, hint, minLength, maxLength = 128, required = true, autoFocus = false }: PasswordFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <span className={`password-input${visible ? ' is-visible' : ''}`}>
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          minLength={minLength}
          maxLength={maxLength}
          required={required}
          autoFocus={autoFocus}
          aria-describedby={hint ? hintId : undefined}
        />
        <button
          className="password-toggle"
          type="button"
          aria-controls={id}
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
          // Keep focus (and the phone keyboard) in the input.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setVisible((value) => !value)}
        >
          <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </span>
      {hint ? <small id={hintId}>{hint}</small> : null}
    </div>
  );
}
