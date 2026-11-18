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

/* ------------------------------------------------------------------ */
/* Field names for screen readers. Most forms wrap the control in its  */
/* label: <label><span>Full name</span><input/><small>hint</small>     */
/* </label>. Browsers then name the field with ALL the label's text,   */
/* so "Full name" is read with its hint, and with any error appended   */
/* above, before the field even says what it is. For each wrapped      */
/* control this names it by the label's own <span> (aria-labelledby)   */
/* and turns the label's other text (hints, counts, errors) into its   */
/* description (aria-describedby), as components/password-field.tsx   */
/* does by hand. Controls that already carry aria-label or             */
/* aria-labelledby are left alone.                                     */
/* ------------------------------------------------------------------ */

const CONTROL = 'input:not([type="hidden"]), select, textarea';
let nameSequence = 0;
const ensureId = (element: Element, prefix: string) => {
  if (!element.id) element.id = `${prefix}-${++nameSequence}`;
  return element.id;
};

/** Names every label-wrapped control under `root` by its label's name, not its whole text. */
export function nameWrappedFields(root: ParentNode) {
  for (const label of root.querySelectorAll('label')) {
    const controls = label.querySelectorAll<HTMLElement>(CONTROL);
    if (controls.length !== 1) continue;
    const control = controls[0]!;
    // The page named it itself (and not through an earlier pass of this function).
    const ours = control.dataset.fieldNamed !== undefined;
    if (!ours && (control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby'))) continue;
    const said = (element: Element) => !element.contains(control) && element.getAttribute('aria-hidden') !== 'true' && Boolean(element.textContent?.trim());
    const children = [...label.children].filter(said);
    const name = children.find((child) => child.tagName === 'SPAN' || child.tagName === 'STRONG');
    // Text beside the control inside its own wrapper (a unit, a domain) is a note too.
    const wrapper = [...label.children].find((child) => child !== control && child.contains(control));
    const notes = [...children.filter((child) => child !== name), ...(wrapper ? [...wrapper.children].filter(said) : [])];
    // A label that is only its name is already the right name.
    if (!name || !notes.length) continue;
    control.dataset.fieldNamed = '';
    control.setAttribute('aria-labelledby', ensureId(name, 'field-name'));
    const described = new Set((control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
    for (const note of notes) described.add(ensureId(note, 'field-note'));
    control.setAttribute('aria-describedby', [...described].join(' '));
  }
}

export function FormValidation() {
  useEffect(() => {
    // Fields appear with sheets and steps: name them as they arrive (one pass per frame).
    let queued = 0;
    const nameSoon = () => {
      if (queued) return;
      queued = window.requestAnimationFrame(() => { queued = 0; nameWrappedFields(document); });
    };
    nameWrappedFields(document);
    const observer = new MutationObserver(nameSoon);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); window.cancelAnimationFrame(queued); };
  }, []);

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
