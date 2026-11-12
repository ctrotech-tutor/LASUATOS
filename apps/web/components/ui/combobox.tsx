'use client';

import { useCallback, useId, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { portalTarget, useAnchoredPanel, useOutsidePress } from './primitives';

/* ------------------------------------------------------------------ */
/* Combobox: a text field with suggestions (replaces <datalist>).      */
/* Typing is free; suggestions narrow as you type. Arrow keys move,    */
/* Enter picks, Escape closes. Tapping a suggestion keeps the keyboard */
/* open on phones.                                                     */
/* ------------------------------------------------------------------ */

export interface ComboboxSuggestion {
  readonly value: string;
  readonly label?: string | undefined;
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list' | 'role'>;

export interface ComboboxProps extends InputProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly suggestions: readonly ComboboxSuggestion[];
  /** How many suggestions to show at most. */
  readonly limit?: number | undefined;
}

const squash = (text: string) => text.toLocaleLowerCase('en-NG').replace(/\s+/g, '');

export function Combobox({ value, onValueChange, suggestions, limit = 8, onKeyDown, onFocus, onBlur, className, ...input }: ComboboxProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const matches = useMemo(() => {
    const needle = squash(value);
    const scored = suggestions
      .map((item) => {
        const code = squash(item.value);
        const label = squash(item.label ?? '');
        const score = !needle ? 1 : code.startsWith(needle) ? 3 : code.includes(needle) ? 2 : label.includes(needle) ? 1 : 0;
        return { item, score };
      })
      .filter(({ item, score }) => score > 0 && squash(item.value) !== needle);
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ item }) => item);
  }, [suggestions, value, limit]);

  const showing = open && matches.length > 0;
  const openList = () => { setContainer(portalTarget(inputRef.current)); setOpen(true); };
  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);
  const pick = (item: ComboboxSuggestion) => { onValueChange(item.value); close(); };

  useAnchoredPanel(showing, inputRef, panelRef, { maxHeight: 300 });
  const refs = useMemo(() => [inputRef, panelRef], []);
  useOutsidePress(showing, refs, close);

  return (
    <>
      <input
        {...input}
        ref={inputRef}
        className={className}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(event) => { onValueChange(event.target.value); openList(); setActive(-1); }}
        onFocus={(event) => { openList(); onFocus?.(event); }}
        onBlur={(event) => { if (!panelRef.current?.contains(event.relatedTarget as Node)) close(); onBlur?.(event); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) openList(); setActive((current) => Math.min(current + 1, matches.length - 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => Math.max(current - 1, -1)); }
          else if (event.key === 'Enter' && showing && active >= 0) { event.preventDefault(); pick(matches[active]!); }
          else if (event.key === 'Escape' && showing) { event.preventDefault(); event.stopPropagation(); close(); }
          onKeyDown?.(event);
        }}
      />
      {showing && container
        ? createPortal(
          <div ref={panelRef} className="ui-popover ui-combobox-popover">
            <div className="ui-select-list" id={listId} role="listbox" aria-label="Suggestions">
              {matches.map((item, index) => (
                <div
                  key={item.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`ui-select-option${index === active ? ' is-active' : ''}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(item)}
                >
                  <span className="ui-select-option-text">
                    <span className="ui-combobox-value">{item.value}</span>
                    {item.label ? <small>{item.label}</small> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>,
          container,
        )
        : null}
    </>
  );
}
