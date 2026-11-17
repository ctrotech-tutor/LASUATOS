'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useDragToDismiss } from '../ui/use-drag-to-dismiss';

/**
 * A modal sheet: slides up from the bottom on phones (with a grabber, like iOS),
 * a centred dialog on wider screens. Escape, the close button and a tap on the
 * backdrop all close it; focus returns to whatever opened it. On phones it can
 * also be dragged down to close (see useDragToDismiss); a `full` sheet drags from
 * its grabber and header only, so its map still pans.
 */
export function Sheet({ open, onClose, title, size = 'md', children }: Readonly<{
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /**
   * `wide` (720px on desktop) for content that needs a table or two columns; `full` fills the
   * window less a margin, for work with a large map. Phones are full width either way. A `full`
   * sheet holds work in progress, so a stray tap outside it does not close it.
   */
  size?: 'md' | 'wide' | 'full';
  children: ReactNode;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useDragToDismiss(ref, { enabled: open, onDismiss: onClose, handleOnly: size === 'full' });
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // A field marked data-autofocus gets the cursor (React's autoFocus fires before the sheet
      // opens, so it is lost). Otherwise the browser focuses the first control, the close button,
      // which then wears a focus ring when the sheet opens from a link: start on the sheet itself.
      const wanted = dialog.querySelector<HTMLElement>('[data-autofocus]');
      if (wanted) wanted.focus({ preventScroll: true });
      else if (document.activeElement === dialog.querySelector('.ds-sheet-close')) dialog.focus({ preventScroll: true });
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`ds-sheet${size === 'md' ? '' : ` is-${size}`}`}
      aria-labelledby={titleId}
      tabIndex={-1}
      // React passes a nested dialog's close (a Menu, a phone Select) up the tree; only our own counts.
      onClose={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onClick={(event) => { if (size !== 'full' && event.target === ref.current) onClose(); }}
    >
      <div className="ds-sheet-grabber" aria-hidden="true" data-drag-handle />
      <div className="ds-sheet-head" data-drag-handle>
        <h2 className="ds-sheet-title" id={titleId}>{title}</h2>
        <button className="ds-sheet-close" type="button" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
      <div className="ds-sheet-body">{children}</div>
    </dialog>
  );
}
