'use client';

import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';

/**
 * A modal form for correcting an existing record: a centred card on desktop and
 * a bottom sheet on phones (same look as the confirm dialogs). Built on
 * <dialog>.showModal(), so focus is trapped and Escape closes it; custom
 * selects and date pickers open inside it because they portal into the open
 * dialog. The parent owns saving: `onSubmit` receives the form element and
 * returns when the save finished (throw to keep the dialog open).
 */
export function EditDialog({
  title,
  description,
  submitLabel = 'Save changes',
  busy = false,
  error = '',
  onClose,
  onSubmit,
  children,
  wide = false,
}: Readonly<{
  title: string;
  description?: ReactNode;
  submitLabel?: string;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (form: HTMLFormElement) => void | Promise<void>;
  children: ReactNode;
  wide?: boolean;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // Start in the first field on computers; on touch screens keep the keyboard closed
      // until the person taps a field (the sheet itself takes focus instead).
      const first = dialog.querySelector<HTMLElement>('.ui-edit-fields input:not([type=hidden]):not([readonly]), .ui-edit-fields button');
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && first) first.focus();
      else dialog.querySelector<HTMLElement>('.ui-edit-card')?.focus();
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // Bring a save error into view (the sheet can be scrolled on phones).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    void onSubmit(event.currentTarget);
  }

  function close() {
    if (!busy) onClose();
  }

  return (
    <dialog
      ref={ref}
      className={`ui-dialog ui-edit-dialog${wide ? ' is-wide' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === ref.current) close(); }}
    >
      <form className="ui-dialog-card ui-edit-card" onSubmit={submit} tabIndex={-1}>
        <span className="ui-dialog-grip" aria-hidden="true" />
        <div className="ui-edit-head">
          <h2 id={titleId}>{title}</h2>
          <button className="ui-edit-close" type="button" onClick={close} aria-label="Close" disabled={busy}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {description ? <div className="ui-dialog-body" id={descriptionId}>{description}</div> : null}
        <div className="ui-edit-fields">{children}</div>
        {error ? <p className="ui-edit-error" role="alert" ref={errorRef}>{error}</p> : null}
        <div className="ui-dialog-actions">
          <button className="button button-secondary" type="button" onClick={close} disabled={busy}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <LoaderCircle className="course-spin" size={16} aria-hidden="true" /> : null}
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Reads a trimmed text field from a submitted form. */
export function formText(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** A small "Edit" trigger used next to records. */
export function EditButton({ label, onClick, compact = false }: Readonly<{ label: string; onClick: () => void; compact?: boolean }>) {
  return (
    <button className={`ui-edit-trigger${compact ? ' is-compact' : ''}`} type="button" onClick={onClick} aria-label={label} data-tip={compact ? label : undefined}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      {compact ? null : <span>Edit</span>}
    </button>
  );
}
