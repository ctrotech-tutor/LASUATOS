'use client';

import { useEffect } from 'react';

/* ------------------------------------------------------------------ */
/* Replaces the browser's "Please fill out this field" bubbles with    */
/* messages written in the app's voice, shown under the field. Forms   */
/* keep using required/minLength/type="email"; this only changes how   */
/* the problem is shown. Mounted once in the app shell.                */
/* ------------------------------------------------------------------ */

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const ERROR_CLASS = 'ui-field-error';
let errorSequence = 0;

function isField(node: EventTarget | null): node is Field {
  return node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement;
}

/** Custom controls (Select, DatePicker) validate through a hidden proxy input; focus their visible part. */
function visibleControl(field: Field): HTMLElement {
  const id = field.dataset.uiProxy;
  return (id ? document.getElementById(id) : null) ?? field;
}

function container(field: Field): HTMLElement | null {
  return field.closest<HTMLElement>('[data-field], .account-field, label, .ui-field') ?? field.parentElement;
}

const dateLabel = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
};

export function messageFor(field: Field): string {
  const v = field.validity;
  const kind = field.dataset.uiKind ?? (field instanceof HTMLSelectElement ? 'select' : field.type);
  if (v.valueMissing) {
    if (kind === 'checkbox') return 'Tick this box to continue.';
    if (kind === 'radio') return 'Choose one of the options.';
    if (kind === 'select') return 'Choose an option.';
    if (kind === 'date') return 'Choose a date.';
    if (kind === 'file') return 'Choose a file.';
    return 'Fill in this field.';
  }
  if (v.typeMismatch) {
    if (field.type === 'email') return 'Enter an email address, like name@example.com.';
    if (field.type === 'url') return 'Enter a web address, like https://example.com.';
    return 'Check the format.';
  }
  if (v.badInput) return field.type === 'number' ? 'Enter a number.' : 'Check what you typed.';
  if (v.tooShort && 'minLength' in field) return `Use at least ${field.minLength} characters (you have ${field.value.length}).`;
  if (v.tooLong && 'maxLength' in field) return `Use at most ${field.maxLength} characters.`;
  if (v.rangeUnderflow && field instanceof HTMLInputElement) {
    return kind === 'date' ? `Choose ${dateLabel(field.min)} or later.` : `Use ${field.min} or more.`;
  }
  if (v.rangeOverflow && field instanceof HTMLInputElement) {
    return kind === 'date' ? `Choose ${dateLabel(field.max)} or earlier.` : `Use ${field.max} or less.`;
  }
  if (v.stepMismatch) return 'Use a whole number.';
  if (v.patternMismatch) return field.dataset.patternMessage || field.title || 'Check the format.';
  return field.validationMessage || 'Check this field.';
}

export function showFieldError(field: Field, message: string) {
  const control = visibleControl(field);
  const box = container(field);
  let error = box?.querySelector<HTMLElement>(`:scope > .${ERROR_CLASS}`) ?? null;
  if (!error && box) {
    error = document.createElement('span');
    error.className = ERROR_CLASS;
    error.id = `ui-error-${++errorSequence}`;
    box.append(error);
  }
  if (error) {
    error.textContent = message;
    const described = new Set((control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
    described.add(error.id);
    control.setAttribute('aria-describedby', [...described].join(' '));
  }
  control.setAttribute('aria-invalid', 'true');
  box?.classList.add('has-error');
}

/** Removes the message once the field is fixed. Custom controls call this when their value changes. */
export function clearFieldError(field: Field | null) {
  if (!field) return;
  const control = visibleControl(field);
  const box = container(field);
  const error = box?.querySelector<HTMLElement>(`:scope > .${ERROR_CLASS}`);
  if (error) {
    const rest = (control.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== error.id);
    if (rest.length) control.setAttribute('aria-describedby', rest.join(' '));
    else control.removeAttribute('aria-describedby');
    error.remove();
  }
  control.removeAttribute('aria-invalid');
  box?.classList.remove('has-error');
}

export function FormValidation() {
  useEffect(() => {
    let focusedThisRound = false;

    const onInvalid = (event: Event) => {
      const field = event.target;
      if (!isField(field)) return;
      event.preventDefault(); // no browser bubble
      showFieldError(field, messageFor(field));
      // A submit fires `invalid` for every bad field in page order: focus only the first.
      if (!focusedThisRound) {
        focusedThisRound = true;
        // Microtasks run between the browser's `invalid` events, so wait for the next task.
        window.setTimeout(() => { focusedThisRound = false; }, 0);
        const control = visibleControl(field);
        control.focus({ preventScroll: true });
        control.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    };

    const onEdit = (event: Event) => {
      const field = event.target;
      if (!isField(field) || field.getAttribute('aria-invalid') !== 'true') return;
      if (field.checkValidity()) clearFieldError(field);
      else showFieldError(field, messageFor(field));
    };

    // Radio groups: fixing one radio fixes the group.
    const onChange = (event: Event) => {
      const field = event.target;
      if (field instanceof HTMLInputElement && field.type === 'radio' && field.name && field.form) {
        field.form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(field.name)}"]`).forEach((radio) => clearFieldError(radio));
      }
      onEdit(event);
    };

    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('input', onEdit, true);
    document.addEventListener('change', onChange, true);
    return () => {
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('input', onEdit, true);
      document.removeEventListener('change', onChange, true);
    };
  }, []);
  return null;
}
