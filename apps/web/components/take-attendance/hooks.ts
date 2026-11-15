'use client';

import { useSyncExternalStore } from 'react';
import { lagosDay } from './format';

/* A shared clock: components subscribe at the rate they need, and all re-render together. */

function tickEvery(ms: number) {
  return (listener: () => void) => {
    const timer = window.setInterval(listener, ms);
    return () => window.clearInterval(timer);
  };
}
const everySecond = tickEvery(1_000);
const everyFifteen = tickEvery(15_000);
const everyMinute = tickEvery(60_000);

// Snapshots must be stable between ticks, so they are rounded to the tick.
const secondSnapshot = () => Math.floor(Date.now() / 1_000) * 1_000;
const fifteenSnapshot = () => Math.floor(Date.now() / 15_000) * 15_000;
const todaySnapshot = () => lagosDay(new Date());
const serverZero = () => 0;
const serverBlank = () => '';

/** The time now, as epoch milliseconds, updated every second or every 15 s. 0 on the server. */
export function useClock(rate: 'second' | 'fifteen'): number {
  return useSyncExternalStore(
    rate === 'second' ? everySecond : everyFifteen,
    rate === 'second' ? secondSnapshot : fifteenSnapshot,
    serverZero,
  );
}

/** Today in Lagos (YYYY-MM-DD); '' on the server. */
export function useToday(): string {
  return useSyncExternalStore(everyMinute, todaySnapshot, serverBlank);
}
