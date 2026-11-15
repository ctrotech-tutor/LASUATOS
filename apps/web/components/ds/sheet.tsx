'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A modal sheet: slides up from the bottom on phones (with a grabber, like iOS),
 * a centred dialog on wider screens. Escape, the close button and a tap on the
 * backdrop all close it; focus returns to whatever opened it.
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
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`ds-sheet${size === 'md' ? '' : ` is-${size}`}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (size !== 'full' && event.target === ref.current) onClose(); }}
    >
      <div className="ds-sheet-grabber" aria-hidden="true" />
      <div className="ds-sheet-head">
        <h2 className="ds-sheet-title" id={titleId}>{title}</h2>
        <button className="ds-sheet-close" type="button" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
      <div className="ds-sheet-body">{children}</div>
    </dialog>
  );
}
