'use client';

import { useSyncExternalStore } from 'react';

/** The browser's deferred "Install app" prompt (Chrome, Edge, Android). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  | { readonly kind: 'installed' }
  | { readonly kind: 'promptable' }
  /** iPhone/iPad Safari: no prompt API, but "Share → Add to Home Screen" works. */
  | { readonly kind: 'ios' }
  | { readonly kind: 'unavailable' };

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

let started = false;
/** Call once on startup, before the browser fires beforeinstallprompt. */
export function startInstallTracking(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  installed = isStandalone();
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

let cached: InstallState = { kind: 'unavailable' };
function snapshot(): InstallState {
  const next: InstallState = installed
    ? { kind: 'installed' }
    : deferred
      ? { kind: 'promptable' }
      : isIos()
        ? { kind: 'ios' }
        : { kind: 'unavailable' };
  if (next.kind !== cached.kind) cached = next;
  return cached;
}
const serverSnapshot: InstallState = { kind: 'unavailable' };

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot,
    () => serverSnapshot,
  );
}

/** Shows the browser's install prompt. Resolves true when the user accepts. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === 'accepted';
}
