'use client';

import { Ellipsis } from 'lucide-react';
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useDragToDismiss } from '../ui/use-drag-to-dismiss';

export type MenuItem = {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
};

/**
 * A "more actions" menu: a popover under its button on wider screens, an iOS action sheet on
 * phones. It is a modal dialog, so focus stays inside and Escape or a tap outside closes it;
 * on phones the action sheet also drags down to close.
 * An item's action runs after the menu has closed, so it can open a dialog of its own.
 */
export function Menu({ label, items, title, icon }: Readonly<{
  /** Names the button and the menu, e.g. "Session actions". */
  label: string;
  items: readonly (MenuItem | null | false)[];
  /** Shown above the items in the phone action sheet. */
  title?: ReactNode;
  icon?: ReactNode;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const id = useId();
  const shown = items.filter((item): item is MenuItem => Boolean(item));
  useDragToDismiss(ref, { enabled: true, onDismiss: () => ref.current?.close() });

  function open() {
    const dialog = ref.current;
    const button = trigger.current;
    if (!dialog || !button) return;
    const rect = button.getBoundingClientRect();
    setPlace({
      '--ds-menu-top': `${Math.round(rect.bottom + 6)}px`,
      '--ds-menu-right': `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`,
    } as CSSProperties);
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }

  function choose(item: MenuItem) {
    ref.current?.close();
    // After the close has returned focus to the button.
    window.setTimeout(item.onSelect, 0);
  }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        className="ds-icon-btn"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-controls={id}
        data-tip={label}
        onClick={open}
      >
        {icon ?? <Ellipsis size={20} strokeWidth={2.2} aria-hidden="true" />}
      </button>
      <dialog
        ref={ref}
        id={id}
        className="ds-menu"
        style={place}
        aria-label={label}
        onClick={(event) => { if (event.target === ref.current) ref.current.close(); }}
      >
        <div className="ds-menu-group">
          {title ? <p className="ds-menu-title">{title}</p> : null}
          <div role="menu" aria-label={label} onKeyDown={move}>
            {shown.map((item) => (
              <button
                key={item.label}
                className={`ds-menu-item${item.destructive ? ' is-destructive' : ''}`}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => choose(item)}
              >
                <span>{item.label}</span>
                {item.icon ? <span className="ds-menu-icon" aria-hidden="true">{item.icon}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <button className="ds-menu-cancel" type="button" onClick={() => ref.current?.close()}>Cancel</button>
      </dialog>
    </>
  );
}
