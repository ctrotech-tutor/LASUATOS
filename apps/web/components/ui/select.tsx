'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { clearFieldError } from './form-validation';
import { labelTextFor, portalTarget, revealInList, useAnchoredPanel, useIsPhone, useOutsidePress, useWrappingLabel } from './primitives';

/* ------------------------------------------------------------------ */
/* Select: the app's replacement for <select>.                         */
/*                                                                     */
/* Desktop: a popover list under the field. Phones: a bottom sheet     */
/* with large rows. Long lists get a search box. Follows the WAI-ARIA  */
/* "select-only combobox" pattern: arrow keys, Home/End, Page keys,    */
/* type-to-jump, Enter/Space, Escape. Works in plain <form>s: with     */
/* `name` it submits through a hidden input, and `required` shows the  */
/* app's own validation message. Options can carry a group (shown as   */
/* sticky headings), a short tag such as a course code, and the list   */
/* can end with a footer (e.g. "Not on the list? Add it").             */
/* ------------------------------------------------------------------ */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** Second line, shown in the list only. */
  readonly description?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Heading the option is listed under. Consecutive options with the same group share one heading. */
  readonly group?: string | undefined;
  /** A short code shown as a chip before the label, in the list and on the field (e.g. "GET 201"). */
  readonly tag?: string | undefined;
  /** Extra words the search matches but the list does not show. */
  readonly keywords?: string | undefined;
}

export interface SelectProps {
  readonly options: readonly SelectOption[];
  /** Controlled value. Use with onValueChange. */
  readonly value?: string | undefined;
  /** Uncontrolled starting value (forms that read FormData). */
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: (value: string) => void;
  /** Submits the value under this name. */
  readonly name?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Shown when nothing is chosen. */
  readonly placeholder?: string | undefined;
  /** Show a search box. Defaults to on for more than 8 options. */
  readonly searchable?: boolean | undefined;
  /** Needed when the Select is not inside a <label>. */
  readonly 'aria-label'?: string | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly size?: 'md' | 'sm';
  /** The popover is at least this wide (it can be wider than a narrow field). */
  readonly panelMinWidth?: number | undefined;
  /** The popover's tallest height on desktop. */
  readonly panelMaxHeight?: number | undefined;
  readonly searchPlaceholder?: string | undefined;
  /** Shown under the list, in the popover and the phone sheet. */
  readonly footer?: ((api: { readonly close: () => void; readonly query: string }) => ReactNode) | undefined;
}

const SEARCH_THRESHOLD = 8;

function SelectFooter({ render, onClose, query }: Readonly<{
  render: NonNullable<SelectProps['footer']>;
  onClose: () => void;
  query: string;
}>) {
  return <div className="ui-select-footer">{render({ close: onClose, query })}</div>;
}

/** Splits text so the searched words can be marked. */
function highlight(text: string, words: readonly string[]): ReactNode {
  if (!words.length || !text) return text;
  const lower = normalise(text);
  const marks: Array<[number, number]> = [];
  for (const word of words) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(word, from);
      if (at === -1) break;
      marks.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  if (!marks.length) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const mark of marks) {
    const last = merged.at(-1);
    if (last && mark[0] <= last[1]) last[1] = Math.max(last[1], mark[1]);
    else merged.push([...mark]);
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={index}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function normalise(text: string) {
  return text.toLocaleLowerCase('en-NG').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function Select({
  options,
  value: controlled,
  defaultValue = '',
  onValueChange,
  name,
  required = false,
  disabled = false,
  placeholder = 'Choose…',
  searchable,
  'aria-label': ariaLabel,
  id,
  className,
  size = 'md',
  panelMinWidth = 220,
  panelMaxHeight = 340,
  searchPlaceholder = 'Search…',
  footer,
}: SelectProps) {
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listId = `${autoId}-list`;
  const optionId = (index: number) => `${autoId}-opt-${index}`;

  const isPhone = useIsPhone();
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const value = controlled ?? uncontrolled;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [title, setTitle] = useState('');

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: '', timer: 0 });
  /** Set by keyboard moves and opening; pointer hover never scrolls the list. */
  const reveal = useRef<'nearest' | 'center' | null>(null);

  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;
  const words = useMemo(() => normalise(query).split(/\s+/).filter(Boolean), [query]);
  const visible = useMemo(() => {
    // "get201" finds "GET 201": codes are also matched with their spaces taken out.
    const squashed = words.join('');
    return options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => {
        if (!words.length) return true;
        const haystack = normalise(`${option.tag ?? ''} ${option.label} ${option.description ?? ''} ${option.keywords ?? ''}`);
        if (words.every((word) => haystack.includes(word))) return true;
        return Boolean(option.tag) && normalise(option.tag!).replace(/\s+/g, '').includes(squashed);
      });
  }, [options, words]);

  useWrappingLabel(triggerRef, !ariaLabel);

  const firstEnabled = useCallback((from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < visible.length; i += step) {
      if (!visible[i]!.option.disabled) return i;
    }
    return -1;
  }, [visible]);

  const show = useCallback(() => {
    if (disabled) return;
    setQuery('');
    setContainer(portalTarget(triggerRef.current));
    setTitle(labelTextFor(triggerRef.current) || ariaLabel || placeholder);
    setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
    reveal.current = 'center';
    setOpen(true);
  }, [disabled, selectedIndex, options, ariaLabel, placeholder]);

  const hide = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  const choose = useCallback((next: SelectOption) => {
    if (next.disabled) return;
    if (controlled === undefined) setUncontrolled(next.value);
    if (next.value !== value) onValueChange?.(next.value);
    clearFieldError(proxyRef.current);
    hide();
  }, [controlled, value, onValueChange, hide]);

  // Phones: open as a modal sheet (top layer, focus kept inside, Escape closes).
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !isPhone || !sheet || sheet.open) return;
    sheet.showModal();
  }, [open, isPhone, container]);

  useAnchoredPanel(open && !isPhone, triggerRef, panelRef, { minWidth: panelMinWidth, maxHeight: panelMaxHeight });
  const outsideRefs = useMemo(() => [triggerRef, panelRef], []);
  useOutsidePress(open && !isPhone, outsideRefs, useCallback(() => hide(false), [hide]));

  // Runs after the panel is placed (and its height capped), so centring measures the real list.
  // Keep the highlighted option in view after keyboard moves (and show the chosen one on
  // opening). Only the list scrolls: never the page, and never because the pointer moved.
  useLayoutEffect(() => {
    const mode = reveal.current;
    if (!open || !mode) return;
    const list = listRef.current;
    const item = active >= 0 ? document.getElementById(optionId(visible[active]?.index ?? -1)) : null;
    if (!list) return;
    reveal.current = null;
    if (!item) return;
    const sticky = list.querySelector<HTMLElement>('.ui-select-group-label')?.offsetHeight ?? 0;
    if (mode === 'center') {
      const listRect = list.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      list.scrollTop += itemRect.top - listRect.top - (list.clientHeight - itemRect.height) / 2;
    } else {
      revealInList(list, item, sticky);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, visible, container]);


  const jumpTo = (key: string) => {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += key.toLocaleLowerCase('en-NG');
    state.timer = window.setTimeout(() => { state.text = ''; }, 700);
    const start = state.text.length === 1 ? active + 1 : Math.max(active, 0);
    const order = [...visible.slice(start), ...visible.slice(0, start)];
    const match = order.find(({ option }) => !option.disabled && normalise(`${option.tag ?? ''}${option.tag ? ' ' : ''}${option.label}`).startsWith(normalise(state.text)));
    if (match) {
      reveal.current = 'nearest';
      setActive(visible.indexOf(match));
    }
  };

  /** Keys while the list is open (focus on the trigger, the search box or the sheet's list). */
  const onListKey = (event: KeyboardEvent, fromSearch = false) => {
    const page = 8;
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) reveal.current = 'nearest';
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActive((current) => { const next = firstEnabled(current + 1, 1); return next >= 0 ? next : current; }); break;
      case 'ArrowUp': event.preventDefault(); setActive((current) => { const next = firstEnabled(current - 1, -1); return next >= 0 ? next : current; }); break;
      case 'PageDown': event.preventDefault(); setActive((current) => { const next = firstEnabled(Math.min(current + page, visible.length - 1), -1); return next >= 0 ? next : current; }); break;
      case 'PageUp': event.preventDefault(); setActive((current) => { const next = firstEnabled(Math.max(current - page, 0), 1); return next >= 0 ? next : current; }); break;
      case 'Home': if (fromSearch) return; event.preventDefault(); setActive(firstEnabled(0, 1)); break;
      case 'End': if (fromSearch) return; event.preventDefault(); setActive(firstEnabled(visible.length - 1, -1)); break;
      case 'Enter':
      case ' ':
        if (event.key === ' ' && fromSearch) return;
        event.preventDefault();
        if (visible[active]) choose(visible[active]!.option);
        break;
      case 'Escape': event.preventDefault(); event.stopPropagation(); hide(); break;
      case 'Tab': hide(false); break;
      default:
        if (!fromSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) jumpTo(event.key);
    }
  };

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open && !isPhone) {
      if (withSearch && event.key.length === 1) return; // the search box has focus
      onListKey(event);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      show();
      if (event.key === 'End') setActive(options.length - 1);
      if (event.key === 'Home') setActive(0);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !isPhone) {
      show();
      jumpTo(event.key);
    }
  };

  const activeId = open && visible[active] ? optionId(visible[active]!.index) : undefined;

  // Consecutive options with the same group are listed under one sticky heading.
  const sections: Array<{ group: string | undefined; items: Array<{ option: SelectOption; index: number; position: number }> }> = [];
  visible.forEach((entry, position) => {
    const last = sections.at(-1);
    if (last && last.group === entry.option.group) last.items.push({ ...entry, position });
    else sections.push({ group: entry.option.group, items: [{ ...entry, position }] });
  });

  const renderOption = ({ option, index, position }: { option: SelectOption; index: number; position: number }) => {
    const isSelected = index === selectedIndex;
    return (
      <div
        key={`${option.value}-${index}`}
        id={optionId(index)}
        role="option"
        aria-selected={isSelected}
        aria-disabled={option.disabled || undefined}
        className={`ui-select-option${position === active ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${option.tag ? ' has-tag' : ''}`}
        onPointerMove={() => { if (!option.disabled && position !== active) setActive(position); }}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      >
        {option.tag ? <span className="ui-tag">{highlight(option.tag, words)}</span> : null}
        <span className="ui-select-option-text">
          <span>{highlight(option.label, words)}</span>
          {option.description ? <small>{option.description}</small> : null}
        </span>
        {isSelected ? <Check className="ui-select-check" size={18} strokeWidth={2.4} aria-hidden="true" /> : null}
      </div>
    );
  };

  const list = (
    <div
      ref={listRef}
      className="ui-select-list"
      id={listId}
      role="listbox"
      aria-label={title}
      tabIndex={isPhone && !withSearch ? 0 : -1}
      aria-activedescendant={isPhone ? activeId : undefined}
      onKeyDown={isPhone ? (event) => onListKey(event) : undefined}
    >
      {visible.length === 0 ? <p className="ui-select-empty">No matches for “{query}”.</p> : null}
      {sections.map((section, sectionIndex) => (
        section.group ? (
          <div key={`${section.group}-${sectionIndex}`} role="group" aria-labelledby={`${autoId}-group-${sectionIndex}`} className="ui-select-group">
            <div id={`${autoId}-group-${sectionIndex}`} role="presentation" className="ui-select-group-label">
              <span>{section.group}</span>
              <small>{section.items.length}</small>
            </div>
            {section.items.map(renderOption)}
          </div>
        ) : (
          <Fragment key={`none-${sectionIndex}`}>{section.items.map(renderOption)}</Fragment>
        )
      ))}
    </div>
  );

  const footerBlock = footer ? <SelectFooter render={footer} onClose={hide} query={query} /> : null;
  const resultsNote = query ? (
    <span className="sr-only" aria-live="polite">{visible.length === 1 ? '1 result' : `${visible.length} results`}</span>
  ) : null;

  const search = withSearch ? (
    <div className="ui-select-search">
      <Search size={17} aria-hidden="true" />
      <input
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={`Search ${title || 'options'}`}
        placeholder={searchPlaceholder}
        value={query}
        autoFocus={!isPhone}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="done"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          reveal.current = 'nearest';
          if (listRef.current) listRef.current.scrollTop = 0;
        }}
        onKeyDown={(event) => onListKey(event, true)}
      />
      {query ? (
        <button type="button" className="ui-select-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); setActive(0); }}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !isPhone && !withSearch ? activeId : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        disabled={disabled}
        className={`ui-select is-${size}${selected ? '' : ' is-placeholder'}${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onTriggerKey}
      >
        <span className="ui-select-value">
          {selected?.tag ? <span className="ui-tag">{selected.tag}</span> : null}
          <span className="ui-select-value-text">{selected ? selected.label : placeholder}</span>
        </span>
        <ChevronDown className="ui-select-chevron" size={18} aria-hidden="true" />
      </button>
      {name !== undefined || required ? (
        <input
          ref={proxyRef}
          className="ui-control-proxy"
          tabIndex={-1}
          aria-hidden="true"
          data-ui-proxy={triggerId}
          data-ui-kind="select"
          name={name}
          value={value}
          required={required}
          disabled={disabled}
          onChange={() => undefined}
        />
      ) : null}
      {open && container && !isPhone
        ? createPortal(
          <div ref={panelRef} className="ui-popover ui-select-popover">
            {search}
            {list}
            {footerBlock}
            {resultsNote}
          </div>,
          container,
        )
        : null}
      {open && container && isPhone
        ? createPortal(
          <dialog
            ref={sheetRef}
            className="ui-dialog ui-sheet ui-select-sheet"
            aria-label={title}
            onClose={() => setOpen(false)}
            onCancel={(event) => { event.preventDefault(); hide(); }}
            onClick={(event) => { if (event.target === event.currentTarget) hide(); }}
          >
            <div className="ui-dialog-card">
              <span className="ui-dialog-grip" aria-hidden="true" />
              <div className="ui-sheet-head">
                <h2>{title}</h2>
                <button type="button" className="lx-icon-button" aria-label="Close" onClick={() => hide()}>
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              {search}
              {list}
              {footerBlock}
              {resultsNote}
            </div>
          </dialog>,
          container,
        )
        : null}
    </>
  );
}
