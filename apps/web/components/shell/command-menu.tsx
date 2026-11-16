'use client';

import { CornerDownLeft, KeyRound, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { isActive, type NavItem } from './nav-model';

type Entry = { readonly href: string; readonly label: string; readonly group: string; readonly icon: NavItem['icon'] };

const noop = () => () => undefined;
const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function matches(entry: Entry, query: string): boolean {
  const haystack = `${entry.label} ${entry.group}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

/**
 * "Go to a page" for keyboards: ⌘K (Ctrl K elsewhere) or the search button in the top bar.
 * Type part of a name, move with the arrow keys, Enter to open. Wider screens only; phones
 * have the tab bar and "More".
 */
export function CommandMenu({ items, pathname }: Readonly<{ items: readonly NavItem[]; pathname: string }>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const apple = useSyncExternalStore(noop, isApple, () => true);

  const entries = useMemo<Entry[]>(() => [
    ...items.map((item) => ({ href: item.href, label: item.label, group: item.group ?? 'Pages', icon: item.icon })),
    { href: '/account/security', label: 'Account, password and sign-ins', group: 'Account', icon: KeyRound },
  ], [items]);
  const results = query.trim() ? entries.filter((entry) => matches(entry, query)) : entries;
  const selected = Math.min(index, Math.max(0, results.length - 1));

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        // Phones and tablets in portrait have no use for it (and no button for it).
        if (!window.matchMedia('(min-width: 761px)').matches) return;
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
    setIndex(0);
  }

  function go(entry: Entry | undefined) {
    if (!entry) return;
    close();
    if (entry.href !== pathname) router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setIndex((selected + step + results.length) % Math.max(1, results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[selected]);
    }
  }

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, selected, listId]);

  return (
    <>
      <button className="ap-search" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Search size={16} strokeWidth={2} aria-hidden="true" />
        <span className="ap-search-text">Go to a page</span>
        <kbd className="ap-kbd" aria-hidden="true">{apple ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <dialog
        ref={dialogRef}
        className="ap-command"
        aria-label="Go to a page"
        onClose={close}
        onClick={(event) => { if (event.target === dialogRef.current) close(); }}
      >
        <div className="ap-command-field">
          <Search size={18} strokeWidth={2} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? `${listId}-${selected}` : undefined}
            aria-autocomplete="list"
            aria-label="Page name"
            placeholder="Go to a page…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setIndex(0); }}
            onKeyDown={onKeyDown}
          />
          <kbd className="ap-kbd" aria-hidden="true">Esc</kbd>
        </div>
        <ul className="ap-command-list" id={listId} role="listbox" aria-label="Pages">
          {results.map((entry, position) => {
            const Icon = entry.icon;
            const current = isActive(entry.href, pathname);
            return (
              <li
                key={entry.href}
                id={`${listId}-${position}`}
                role="option"
                aria-selected={position === selected}
                className="ap-command-item"
                onPointerMove={() => { if (position !== selected) setIndex(position); }}
                onClick={() => go(entry)}
              >
                <span className="ap-command-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.9} /></span>
                <span className="ap-command-label">{entry.label}</span>
                <span className="ap-command-group">{current ? 'This page' : entry.group}</span>
                <CornerDownLeft className="ap-command-enter" size={15} aria-hidden="true" />
              </li>
            );
          })}
        </ul>
        {results.length ? null : <p className="ap-command-empty" role="status">No page called “{query.trim()}”.</p>}
      </dialog>
    </>
  );
}
