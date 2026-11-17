'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * What arrived since the screen last looked: the ids that are new in a live list (a student who
 * just checked in, a dispute that just came in), so their rows can light up briefly and a screen
 * reader hears about them. The first list a screen gets is the starting point and never counts
 * as arrivals, and neither does a different list (another course or tab: pass a new `scope`).
 */
export function useArrivals<T>(
  items: readonly T[] | null | undefined,
  idOf: (item: T) => string,
  options: { readonly scope?: string; readonly holdMs?: number } = {},
): { readonly fresh: ReadonlySet<string>; readonly arrived: readonly T[]; readonly round: number } {
  const { scope = '', holdMs = 6_000 } = options;
  const seen = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const [state, setState] = useState<{ fresh: ReadonlySet<string>; arrived: readonly T[]; round: number }>(
    { fresh: new Set(), arrived: [], round: 0 },
  );
  const idRef = useRef(idOf);
  useEffect(() => {
    idRef.current = idOf;
  });

  useEffect(() => {
    if (!items) return;
    const ids = new Set(items.map((item) => idRef.current(item)));
    const before = seen.current;
    seen.current = { scope, ids };
    if (!before || before.scope !== scope) return;
    const arrived = items.filter((item) => !before.ids.has(idRef.current(item)));
    if (!arrived.length) return;
    // Arrivals pile up while the last ones are still lit; each new batch is a new round.
    setState((current) => ({
      fresh: new Set([...current.fresh, ...arrived.map((item) => idRef.current(item))]),
      arrived,
      round: current.round + 1,
    }));
  }, [items, scope]);

  useEffect(() => {
    if (!state.fresh.size) return undefined;
    const timer = window.setTimeout(() => setState((current) => ({ ...current, fresh: new Set() })), holdMs);
    return () => window.clearTimeout(timer);
  }, [state.round, state.fresh.size, holdMs]);

  return state;
}

/** "Ada Bello checked in" / "Ada Bello and Chidi Obi checked in" / "5 students checked in". */
export function arrivalsSentence(names: readonly string[], verb: string, people = 'students'): string {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} ${verb}`;
  if (names.length === 2) return `${names[0]} and ${names[1]} ${verb}`;
  return `${names.length} ${people} ${verb}`;
}
