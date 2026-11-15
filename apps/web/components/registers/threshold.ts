'use client';

import { DEFAULT_ATTENDANCE_THRESHOLD } from '@lasuatos/contracts';
import { useSyncExternalStore } from 'react';
import { THRESHOLDS } from './format';

/**
 * The required attendance, remembered on this device: a department that asks for 70% sets it
 * once. Read through an external store so the server render (75%) and the first client render
 * agree, and every open register follows a change.
 */
const KEY = 'lasuatos:register-threshold';
const EVENT = 'lasuatos:register-threshold';
/** Used when storage is blocked, so the choice still applies until the page is left. */
let unsaved: number | null = null;

function read(): number {
  if (unsaved !== null) return unsaved;
  try {
    const saved = Number(window.localStorage.getItem(KEY));
    return (THRESHOLDS as readonly number[]).includes(saved) ? saved : DEFAULT_ATTENDANCE_THRESHOLD;
  } catch {
    return DEFAULT_ATTENDANCE_THRESHOLD;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

const serverValue = () => DEFAULT_ATTENDANCE_THRESHOLD;

export function useThreshold(): number {
  return useSyncExternalStore(subscribe, read, serverValue);
}

export function setThreshold(value: number) {
  try {
    if (value === DEFAULT_ATTENDANCE_THRESHOLD) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(value));
  } catch {
    unsaved = value;
  }
  window.dispatchEvent(new Event(EVENT));
}
