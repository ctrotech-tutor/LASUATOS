'use client';

import { Check, ChevronLeft, Copy, Mail } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import './onboarding.css';

/**
 * The pieces of the student account flow (opening an account, finishing
 * setup): one screen per step, like a phone app's onboarding.
 *
 *   progress (four segments)   ← the only progress on the page
 *   ‹ back       big title
 *   the one thing to do on this step
 *   [ primary action ]         ← pinned to the bottom of the screen on phones
 *
 * The segments keep the `ob-steps` / `is-current` names: the story panel on
 * wide screens follows them (components/auth/auth.css).
 */

const STEP_LABELS = ['Matric number', 'LASU email', 'Password', 'Face'] as const;
/** A Direct Entry student without a matric number yet: their JAMB number and any email they can open. */
const JAMB_STEP_LABELS = ['JAMB number', 'Email', 'Password', 'Face'] as const;

/** Steps after the first scroll the new screen to the top and move focus to its title. */
let stepsShown = 0;

export function FlowStep({
  step,
  eyebrow,
  title,
  lede,
  onBack,
  backLabel = 'Back',
  jamb = false,
  children,
}: Readonly<{
  /** 0–3: which of the four steps this screen belongs to; omit for screens outside the steps. */
  step?: 0 | 1 | 2 | 3 | undefined;
  eyebrow?: string | undefined;
  title: string;
  lede?: ReactNode;
  onBack?: (() => void) | undefined;
  backLabel?: string;
  /** Name the steps for a student on a JAMB number. */
  jamb?: boolean;
  children: ReactNode;
}>) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    stepsShown += 1;
    if (stepsShown === 1) return;
    // A new screen: start at its top, and tell screen readers where they are.
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="obf" aria-labelledby="obf-title">
      {/* Like an app's top bar: back on the left, the progress beside it. */}
      {onBack || step !== undefined ? (
        <div className="obf-top">
          {onBack ? (
            <button className="obf-back" type="button" onClick={onBack} aria-label={backLabel}>
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
          ) : null}
          {step !== undefined ? <FlowProgress step={step} labels={jamb ? JAMB_STEP_LABELS : STEP_LABELS} /> : null}
        </div>
      ) : null}
      <header className="obf-head">
        {eyebrow ? <p className="obf-eyebrow">{eyebrow}</p> : null}
        <h1 id="obf-title" ref={heading} tabIndex={-1}>{title}</h1>
        {lede ? <p className="obf-lede">{lede}</p> : null}
      </header>
      {children}
    </section>
  );
}

function FlowProgress({ step, labels }: Readonly<{ step: 0 | 1 | 2 | 3; labels: readonly string[] }>) {
  return (
    <div className="obf-progress">
      <p className="obf-progress-label">
        <span>Step {step + 1} of 4</span>
        <span aria-hidden="true">·</span>
        <span>{labels[step]}</span>
      </p>
      <ol className="ob-steps obf-segments" aria-label="Steps">
        {labels.map((label, index) => (
          <li key={label} className={index < step ? 'is-done' : index === step ? 'is-current' : ''} aria-current={index === step ? 'step' : undefined}>
            <span className="sr-only">{label}{index < step ? ' (done)' : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The step's buttons: pinned to the bottom of the screen on phones, inline on wide screens.
 * The note sits under them but is not pinned, so the pinned bar stays small.
 */
export function FlowActions({ children, note }: Readonly<{ children: ReactNode; note?: ReactNode }>) {
  return (
    <>
      <div className="obf-actions">{children}</div>
      {note ? <p className="obf-actions-note">{note}</p> : null}
    </>
  );
}

/**
 * One box per character, grouped like the number is written (matric 25·0211·184,
 * setup code ABCD·EFGH). It is a single real input underneath, so typing,
 * pasting, autofill of one-time codes and screen readers all work as usual.
 */
export function SlotInput({
  name,
  label,
  hint,
  value,
  groups,
  onValueChange,
  clean,
  inputMode,
  autoComplete,
  autoCapitalize,
  invalid,
  disabled,
  autoFocus,
}: Readonly<{
  name: string;
  label: string;
  hint?: ReactNode;
  /** The characters typed so far, without separators. */
  value: string;
  /** Characters per group, e.g. [2, 4, 3]. */
  groups: readonly number[];
  onValueChange: (value: string) => void;
  /** Keeps only the characters this field accepts. */
  clean: (raw: string) => string;
  inputMode: 'numeric' | 'text';
  autoComplete: string;
  autoCapitalize?: 'characters' | 'none';
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}>) {
  const id = useId();
  const length = groups.reduce((sum, size) => sum + size, 0);
  const active = Math.min(value.length, length - 1);
  // Where each group starts: [2, 4, 3] → [0, 2, 6].
  const starts = groups.map((_, index) => groups.slice(0, index).reduce((sum, size) => sum + size, 0));

  return (
    <div className={`obf-slot-field${invalid ? ' is-invalid' : ''}`}>
      <label className="obf-label" htmlFor={id}>{label}</label>
      {/* The current box lights up with CSS :focus-within, so it is right even when the
          browser focused the input before the page became interactive. */}
      <div className={`obf-slots${value.length === length ? ' is-full' : ''}`}>
        <input
          id={id}
          className="obf-slots-input"
          name={name}
          value={value}
          onChange={(event) => onValueChange(clean(event.target.value).slice(0, length))}
          onFocus={(event) => {
            // Typing always adds at the end, whichever box was tapped.
            const input = event.currentTarget;
            requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
          }}
          inputMode={inputMode}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          autoCorrect="off"
          spellCheck={false}
          maxLength={length * 2}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          disabled={disabled}
          // The first field of the flow: the keyboard opens straight away, like an app.
          autoFocus={autoFocus}
        />
        <span className="obf-slot-row" aria-hidden="true">
          {groups.map((size, groupIndex) => {
            const start = starts[groupIndex] ?? 0;
            return (
              <span className="obf-slot-group" key={groupIndex} style={{ flexGrow: size }}>
                {Array.from({ length: size }, (_, index) => {
                  const position = start + index;
                  const character = value[position];
                  const state = character ? ' is-filled' : '';
                  const current = position === active && value.length < length ? ' is-current' : '';
                  return <span className={`obf-slot${state}${current}`} key={position}>{character ?? <i />}</span>;
                })}
              </span>
            );
          })}
        </span>
      </div>
      {hint ? <p className="obf-hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

/** "OKONKWO Chidinma Adaeze" → surname on top, given names under it, initials for the photo spot. */
function splitName(fullName: string): { surname: string; given: string; initials: string } {
  const words = fullName.trim().split(/\s+/);
  const surnameFirst = words.length > 1 && words[0] === words[0]!.toUpperCase();
  const surname = surnameFirst ? words[0]! : words.at(-1) ?? '';
  const given = (surnameFirst ? words.slice(1) : words.slice(0, -1)).join(' ');
  const initials = `${given.charAt(0)}${surname.charAt(0)}`.toUpperCase() || '?';
  return { surname, given, initials };
}

/** The class list entry, shown as a LASU student ID card: "Is this you?" */
export function StudentIdCard({
  fullName,
  matricNumber,
  department,
  level,
  status,
}: Readonly<{
  fullName: string;
  matricNumber?: string | undefined;
  department: string;
  level: string;
  /** A small label on the card, e.g. "Account open". */
  status?: string | undefined;
}>) {
  const { surname, given, initials } = splitName(fullName);
  return (
    <div className="obf-id" role="group" aria-label="Your class list entry">
      <div className="obf-id-band">
        <span className="obf-id-school">Lagos State University</span>
        <span className="obf-id-kind">{status ?? 'Student'}</span>
      </div>
      <div className="obf-id-body">
        <span className="obf-id-photo" aria-hidden="true">{initials}</span>
        <p className="obf-id-name">
          <strong>{surname}</strong>
          {given ? <span>{given}</span> : null}
        </p>
      </div>
      <dl className="obf-id-facts">
        {matricNumber ? (
          <div className={`obf-id-matric${/[A-Z]/i.test(matricNumber) ? ' is-jamb' : ''}`}>
            <dt>{/[A-Z]/i.test(matricNumber) ? 'JAMB number' : 'Matric number'}</dt>
            <dd>{matricNumber}</dd>
          </div>
        ) : null}
        <div>
          <dt>Level</dt>
          <dd>{level}</dd>
        </div>
        <div className="obf-id-wide">
          <dt>Department</dt>
          <dd>{department}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Where the code went. A long LASU address wraps inside the chip. */
export function MailChip({ address, label = 'Code sent to' }: Readonly<{ address: string; label?: string }>) {
  return (
    <p className="obf-mail">
      <span className="obf-mail-icon" aria-hidden="true"><Mail size={18} /></span>
      <span className="obf-mail-copy">
        <small>{label}</small>
        <strong>{address}</strong>
      </span>
    </p>
  );
}

/**
 * The starting password, coloured by where each part comes from, so the
 * pattern (LASU + matric number + SURNAME) is learnt at a glance.
 */
export function PasswordKey({ password, onCopy }: Readonly<{ password: string; onCopy: () => void }>) {
  const parts = /^(LASU)(\d+)(.+)$/i.exec(password);
  return (
    <div className="obf-key">
      <p className="obf-key-label">Your password</p>
      <p className="obf-key-code">
        {parts ? (
          <>
            <span className="is-school">{parts[1]}</span>
            <span className="is-matric">{parts[2]}</span>
            <span className="is-surname">{parts[3]}</span>
          </>
        ) : password}
      </p>
      {parts ? (
        <ul className="obf-key-legend" aria-label="How it is made">
          <li className="is-school">LASU</li>
          <li className="is-matric">Matric number</li>
          <li className="is-surname">SURNAME</li>
        </ul>
      ) : null}
      <button className="obf-key-copy" type="button" onClick={onCopy}>
        <Copy size={16} aria-hidden="true" /> Copy password
      </button>
    </div>
  );
}

/** The end of a path: a seal, a title, one line, and the way on. */
export function FlowResult({ title, children, tone = 'success', icon }: Readonly<{ title: string; children: ReactNode; tone?: 'success' | 'info'; icon?: ReactNode }>) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className={`obf obf-result ob-done is-${tone}`} aria-labelledby="obf-result-title">
      <span className="obf-seal" aria-hidden="true">{icon ?? <Check size={34} strokeWidth={2.6} />}</span>
      <h1 id="obf-result-title" ref={heading} tabIndex={-1}>{title}</h1>
      {children}
    </section>
  );
}
