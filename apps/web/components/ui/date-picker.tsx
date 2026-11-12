'use client';

import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { clearFieldError } from './form-validation';
import { labelTextFor, portalTarget, useAnchoredPanel, useIsPhone, useOutsidePress, useWrappingLabel } from './primitives';

/* ------------------------------------------------------------------ */
/* DatePicker: the app's replacement for <input type="date">.          */
/* Value is an ISO day ("2026-09-01"), like the native input, so call  */
/* sites keep their string handling. Calendar popover on desktop,      */
/* bottom sheet on phones. Keyboard: arrows move by day/week, Page     */
/* keys by month (Shift: year), Home/End to week start/end.            */
/* ------------------------------------------------------------------ */

export interface DatePickerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly name?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Earliest and latest allowed days, ISO. */
  readonly min?: string | undefined;
  readonly max?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly 'aria-label'?: string | undefined;
  readonly id?: string | undefined;
}

interface Day { readonly y: number; readonly m: number; readonly d: number }

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = ({ y, m, d }: Day) => `${y}-${pad(m + 1)}-${pad(d)}`;
function parseIso(value: string | undefined): Day | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}
const utc = ({ y, m, d }: Day) => new Date(Date.UTC(y, m, d));
const fromUtc = (date: Date): Day => ({ y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() });
const addDays = (day: Day, n: number) => fromUtc(new Date(Date.UTC(day.y, day.m, day.d + n)));
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
function addMonths(day: Day, n: number): Day {
  const target = new Date(Date.UTC(day.y, day.m + n, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();
  return { y, m, d: Math.min(day.d, daysIn(y, m)) };
}
const sameDay = (a: Day | null, b: Day | null) => Boolean(a && b && a.y === b.y && a.m === b.m && a.d === b.d);
/** Monday = 0. */
const weekday = (day: Day) => (utc(day).getUTCDay() + 6) % 7;
function today(): Day {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

const fullFormat = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const longFormat = new Intl.DateTimeFormat('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function DatePicker({ value, onChange, name, required = false, disabled = false, min, max, placeholder = 'Choose a date', 'aria-label': ariaLabel, id }: DatePickerProps) {
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const isPhone = useIsPhone();
  const selected = parseIso(value);
  const minDay = parseIso(min);
  const maxDay = parseIso(max);

  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<Day>(() => selected ?? today());
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [title, setTitle] = useState('');

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);

  useWrappingLabel(triggerRef, !ariaLabel, `${triggerId}-value`);

  const outOfRange = useCallback((day: Day) => {
    const time = utc(day).getTime();
    return Boolean((minDay && time < utc(minDay).getTime()) || (maxDay && time > utc(maxDay).getTime()));
  }, [minDay, maxDay]);

  const clamp = useCallback((day: Day) => {
    if (minDay && utc(day) < utc(minDay)) return minDay;
    if (maxDay && utc(day) > utc(maxDay)) return maxDay;
    return day;
  }, [minDay, maxDay]);

  const show = () => {
    if (disabled) return;
    moved.current = false;
    setFocused(clamp(selected ?? today()));
    setContainer(portalTarget(triggerRef.current));
    setTitle(labelTextFor(triggerRef.current) || ariaLabel || placeholder);
    setOpen(true);
  };
  const hide = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);
  const pick = (day: Day | null) => {
    if (day && outOfRange(day)) return;
    onChange(day ? toIso(day) : '');
    clearFieldError(proxyRef.current);
    hide();
  };

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !isPhone || !sheet || sheet.open) return;
    sheet.showModal();
  }, [open, isPhone, container]);

  // Move real focus to the focused day once the calendar is shown and after keyboard moves.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: !moved.current });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focused, container]);

  useAnchoredPanel(open && !isPhone, triggerRef, panelRef, { matchWidth: false, minWidth: 312, maxHeight: 460 });
  const outsideRefs = useMemo(() => [triggerRef, panelRef], []);
  useOutsidePress(open && !isPhone, outsideRefs, useCallback(() => hide(false), [hide]));

  const weeks = useMemo(() => {
    const first: Day = { y: focused.y, m: focused.m, d: 1 };
    const start = addDays(first, -weekday(first));
    return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)))
      // Drop a trailing week that is entirely next month.
      .filter((week, index) => index < 5 || week[0]!.m === focused.m);
  }, [focused.y, focused.m]);

  const move = (next: Day) => { moved.current = true; setFocused(clamp(next)); };
  const onGridKey = (event: KeyboardEvent) => {
    const keys: Record<string, () => Day> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -weekday(focused)),
      End: () => addDays(focused, 6 - weekday(focused)),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    };
    if (keys[event.key]) { event.preventDefault(); move(keys[event.key]!()); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); }
  };

  const now = today();
  /** A month can be shown if any of its days is allowed. */
  const canPrev = (months: number) => {
    if (!minDay) return true;
    const target = addMonths({ ...focused, d: 1 }, -months);
    return utc({ ...target, d: daysIn(target.y, target.m) }) >= utc(minDay);
  };
  const canNext = (months: number) => !maxDay || utc(addMonths({ ...focused, d: 1 }, months)) <= utc(maxDay);

  const calendar = (
    <div className="ui-calendar" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); } }}>
      <div className="ui-calendar-head">
        <button type="button" className="ui-calendar-nav" aria-label="Previous year" disabled={!canPrev(12)} onClick={() => move(addMonths(focused, -12))}><ChevronsLeft size={18} aria-hidden="true" /></button>
        <button type="button" className="ui-calendar-nav" aria-label="Previous month" disabled={!canPrev(1)} onClick={() => move(addMonths(focused, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
        <h3 className="ui-calendar-title" aria-live="polite">{monthFormat.format(utc({ ...focused, d: 1 }))}</h3>
        <button type="button" className="ui-calendar-nav" aria-label="Next month" disabled={!canNext(1)} onClick={() => move(addMonths(focused, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
        <button type="button" className="ui-calendar-nav" aria-label="Next year" disabled={!canNext(12)} onClick={() => move(addMonths(focused, 12))}><ChevronsRight size={18} aria-hidden="true" /></button>
      </div>
      <table ref={gridRef} className="ui-calendar-grid" role="grid" aria-label={monthFormat.format(utc({ ...focused, d: 1 }))} onKeyDown={onGridKey}>
        <thead>
          <tr>{WEEKDAYS.map((day, index) => <th key={day} scope="col" abbr={WEEKDAYS_LONG[index]}>{day.slice(0, 2)}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={toIso(week[0]!)}>
              {week.map((day) => {
                const isFocused = sameDay(day, focused);
                const isSelected = sameDay(day, selected);
                const disabledDay = outOfRange(day);
                return (
                  <td key={toIso(day)} role="gridcell" aria-selected={isSelected || undefined}>
                    <button
                      type="button"
                      tabIndex={isFocused ? 0 : -1}
                      aria-label={longFormat.format(utc(day))}
                      aria-pressed={isSelected}
                      aria-current={sameDay(day, now) ? 'date' : undefined}
                      disabled={disabledDay}
                      className={`ui-day${day.m !== focused.m ? ' is-outside' : ''}${isSelected ? ' is-selected' : ''}${sameDay(day, now) ? ' is-today' : ''}`}
                      onClick={() => pick(day)}
                    >
                      {day.d}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ui-calendar-foot">
        <button type="button" className="text-button" disabled={outOfRange(now)} onClick={() => pick(now)}>Today</button>
        {!required && value ? <button type="button" className="text-button" onClick={() => pick(null)}>Clear</button> : null}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        className={`ui-select ui-date is-md${selected ? '' : ' is-placeholder'}${open ? ' is-open' : ''}`}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); show(); } }}
      >
        <CalendarDays className="ui-date-icon" size={17} aria-hidden="true" />
        <span className="ui-select-value" id={`${triggerId}-value`}>{selected ? fullFormat.format(utc(selected)) : placeholder}</span>
      </button>
      <input
        ref={proxyRef}
        className="ui-control-proxy"
        tabIndex={-1}
        aria-hidden="true"
        data-ui-proxy={triggerId}
        data-ui-kind="date"
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        onChange={() => undefined}
      />
      {open && container && !isPhone
        ? createPortal(
          <div ref={panelRef} className="ui-popover ui-date-popover" role="dialog" aria-label={title}>
            {calendar}
          </div>,
          container,
        )
        : null}
      {open && container && isPhone
        ? createPortal(
          <dialog
            ref={sheetRef}
            className="ui-dialog ui-sheet ui-date-sheet"
            aria-label={title}
            onClose={() => setOpen(false)}
            onCancel={(event) => { event.preventDefault(); hide(); }}
            onClick={(event) => { if (event.target === event.currentTarget) hide(); }}
          >
            <div className="ui-dialog-card">
              <span className="ui-dialog-grip" aria-hidden="true" />
              <div className="ui-sheet-head">
                <h2>{title}</h2>
                <button type="button" className="lx-icon-button" aria-label="Close" onClick={() => hide()}><X size={18} aria-hidden="true" /></button>
              </div>
              {calendar}
            </div>
          </dialog>,
          container,
        )
        : null}
    </>
  );
}
