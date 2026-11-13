'use client';

import type { CheckInLocationSample } from '@lasuatos/contracts';
import { combineFixes, surveyPoint, type CombinedFix, type RawFix, type SurveyedPoint } from '@lasuatos/verification/venue-area';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CheckInLocationInput } from './attendance-api';

/**
 * Reading the phone's position for venue checks.
 *
 * What goes wrong with a single getCurrentPosition() call, and what this does
 * instead:
 * - Browsers hand back a cached position (maximumAge), so a student who just
 *   walked into the hall can be judged on where they were outside. Here every
 *   request uses maximumAge 0, and readings stamped before tracking started
 *   are thrown away.
 * - The first fix is usually a coarse cell/Wi-Fi guess; GPS sharpens over the
 *   next seconds. Here the position is watched continuously from the moment
 *   the check-in form opens (while the student types), and readings are
 *   combined (combineFixes: the sharpest recent reading, steadied by the ones
 *   that agree with it).
 * - Phones pause location in the background; tracking restarts when the page
 *   is visible again.
 */

/** Positions stay usable this long without a new reading (a phone at rest may stop reporting). */
const HOLD_LAST_READING_MILLISECONDS = 45_000;

export type LocationStatus =
  /** Not started. */
  | 'idle'
  /** Waiting for the first reading (and possibly the permission prompt). */
  | 'waiting'
  /** Readings are arriving. */
  | 'tracking'
  /** The student (or the phone's settings) refused location to this site. */
  | 'denied'
  /** Location is switched off or no position could be found. */
  | 'unavailable'
  /** This browser has no location support (or the page is not https). */
  | 'unsupported';

export interface LiveLocation {
  readonly status: LocationStatus;
  readonly fix: CombinedFix | null;
  /** When tracking started (Date.now()), for "taking a while" hints. */
  readonly startedAt: number | null;
  /** Readings received since tracking started. */
  readonly readings: number;
  /** When this state was published (Date.now()): "now" for anything rendered from it. */
  readonly updatedAt: number;
}

const IDLE: LiveLocation = { status: 'idle', fix: null, startedAt: null, readings: 0, updatedAt: 0 };

function supported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext !== false && typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/** The combined fix now, or the last one for a while if the phone went quiet. */
function currentFix(fixes: readonly RawFix[], now: number): CombinedFix | null {
  const combined = combineFixes(fixes, now);
  if (combined) return combined;
  const newest = fixes.at(-1);
  if (!newest || now - newest.receivedAt > HOLD_LAST_READING_MILLISECONDS) return null;
  return { ...newest, sampleCount: 1, spreadMeters: 0 };
}

/**
 * Watches the phone's position while `enabled`. `fixRef` always holds the
 * latest combined fix, for code that must read it outside React's render.
 */
export function useLiveLocation(enabled: boolean): LiveLocation & {
  readonly fixRef: RefObject<CombinedFix | null>;
  readonly restart: () => void;
} {
  const [state, setState] = useState<LiveLocation>(IDLE);
  const [generation, setGeneration] = useState(0);
  const fixRef = useRef<CombinedFix | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let watchId: number | null = null;
    let fixes: RawFix[] = [];
    let readings = 0;
    let startedAt = Date.now();
    let status: LocationStatus = 'waiting';

    const publish = () => {
      if (cancelled) return;
      const now = Date.now();
      const fix = currentFix(fixes, now);
      fixRef.current = fix;
      setState({ status, fix, startedAt, readings, updatedAt: now });
    };

    const stop = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };

    const start = () => {
      stop();
      startedAt = Date.now();
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          // A reading stamped well before we asked is a cached one: skip it.
          if (position.timestamp && position.timestamp < startedAt - 1_000) return;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || accuracy <= 0) return;
          const now = Date.now();
          fixes = [...fixes.filter((fix) => now - fix.receivedAt <= HOLD_LAST_READING_MILLISECONDS), { latitude, longitude, accuracyMeters: accuracy, receivedAt: now }].slice(-60);
          readings += 1;
          status = 'tracking';
          publish();
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            status = 'denied';
            stop();
          } else if (status !== 'tracking' || !currentFix(fixes, Date.now())) {
            status = 'unavailable';
          }
          publish();
        },
        { enableHighAccuracy: true, maximumAge: 0 },
      );
    };

    // Deferred: state changes belong in callbacks, not in the effect body.
    const kickoff = window.setTimeout(() => {
      if (!supported()) {
        status = 'unsupported';
        publish();
        return;
      }
      status = 'waiting';
      publish();
      start();
    }, 0);
    // Expire old readings even when no new ones arrive.
    const ticker = window.setInterval(publish, 2_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && supported() && status !== 'denied') start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(kickoff);
      window.clearInterval(ticker);
      document.removeEventListener('visibilitychange', onVisibility);
      if (supported()) stop();
      fixRef.current = null;
    };
  }, [enabled, generation]);

  const restart = useCallback(() => setGeneration((value) => value + 1), []);
  const visible = enabled ? state : IDLE;
  return { ...visible, fixRef, restart };
}

export interface LocationSurvey {
  readonly status: LocationStatus;
  /** The averaged point so far (null until a reading arrives). */
  readonly point: SurveyedPoint | null;
  /** Readings received (including ones too vague to use). */
  readonly readings: number;
  /** The newest single reading's accuracy, metres. */
  readonly latestAccuracyMeters: number | null;
  readonly startedAt: number | null;
  readonly updatedAt: number;
}

const IDLE_SURVEY: LocationSurvey = { status: 'idle', point: null, readings: 0, latestAccuracyMeters: null, startedAt: null, updatedAt: 0 };

/** A capture stops itself after this long; GPS has long settled by then. */
const SURVEY_LIMIT_MILLISECONDS = 90_000;

/**
 * Stand-still capture for registering a venue point or corner: watches the
 * position while `active` (and `key` is unchanged) and averages every fresh
 * reading with surveyPoint. Change `key` to start a new capture.
 */
export function useLocationSurvey(active: boolean, key: number): LocationSurvey {
  const [state, setState] = useState<LocationSurvey>(IDLE_SURVEY);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let watchId: number | null = null;
    const fixes: RawFix[] = [];
    let readings = 0;
    let latest: number | null = null;
    const startedAt = Date.now();
    let status: LocationStatus = 'waiting';

    const publish = () => {
      if (cancelled) return;
      setState({ status, point: surveyPoint(fixes), readings, latestAccuracyMeters: latest, startedAt, updatedAt: Date.now() });
    };
    const stop = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };

    const kickoff = window.setTimeout(() => {
      if (!supported()) {
        status = 'unsupported';
        publish();
        return;
      }
      publish();
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (position.timestamp && position.timestamp < startedAt - 1_000) return;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || accuracy <= 0) return;
          fixes.push({ latitude, longitude, accuracyMeters: accuracy, receivedAt: Date.now() });
          if (fixes.length > 300) fixes.shift();
          readings += 1;
          latest = accuracy;
          status = 'tracking';
          publish();
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            status = 'denied';
            stop();
          } else if (!fixes.length) {
            status = 'unavailable';
          }
          publish();
        },
        { enableHighAccuracy: true, maximumAge: 0 },
      );
    }, 0);
    const limit = window.setTimeout(stop, SURVEY_LIMIT_MILLISECONDS);

    return () => {
      cancelled = true;
      window.clearTimeout(kickoff);
      window.clearTimeout(limit);
      if (supported()) stop();
    };
  }, [active, key]);

  return active ? state : IDLE_SURVEY;
}

/** The position as check-in evidence, aged on the phone's own clock. */
export function toCheckInLocation(fix: CombinedFix, now = Date.now()): CheckInLocationSample {
  return {
    latitude: Number(fix.latitude.toFixed(7)),
    longitude: Number(fix.longitude.toFixed(7)),
    accuracyMeters: Math.round(fix.accuracyMeters * 10) / 10,
    capturedAt: new Date(fix.receivedAt).toISOString(),
    ageMilliseconds: Math.max(0, Math.round(now - fix.receivedAt)),
    sampleCount: Math.min(500, fix.sampleCount),
  };
}

export type PhonePlatform = 'ios' | 'android' | 'other';

export function phonePlatform(): PhonePlatform {
  if (typeof navigator === 'undefined') return 'other';
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(agent) || (/Macintosh/i.test(agent) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(agent)) return 'android';
  return 'other';
}

/** Step-by-step help for turning location (and Precise Location) on. */
export function locationSettingsHelp(platform: PhonePlatform, problem: 'denied' | 'approximate' | 'off'): string {
  if (problem === 'approximate') {
    return platform === 'ios'
      ? 'On iPhone: Settings › Privacy & Security › Location Services › Safari Websites (or your browser) › turn on Precise Location.'
      : platform === 'android'
        ? 'On Android: Settings › Location › App location permissions › Chrome (or your browser) › Allow only while using the app, and turn on "Use precise location".'
        : 'Allow precise location for this browser in your device settings.';
  }
  if (problem === 'off') {
    return platform === 'ios'
      ? 'On iPhone: Settings › Privacy & Security › Location Services must be on.'
      : platform === 'android'
        ? 'On Android: swipe down from the top and turn on Location.'
        : 'Turn on location services for this device.';
  }
  return platform === 'ios'
    ? 'On iPhone: tap "aA" in the address bar › Website Settings › Location › Allow. Also check Settings › Privacy & Security › Location Services › Safari Websites › While Using the App.'
    : platform === 'android'
      ? 'On Android: tap the icon left of the web address › Permissions (or Site settings) › Location › Allow. Location must also be on in quick settings.'
      : 'Allow location for this site in your browser’s site settings, then reload the page.';
}

/**
 * One position, for places that need a single reading: watches for up to
 * `maxWaitMilliseconds` and returns early once a reading is sharp enough.
 * Resolves null when location is refused or unavailable.
 */
export function requestLocationSample(options: { readonly maxWaitMilliseconds?: number; readonly goodEnoughMeters?: number } = {}): Promise<CheckInLocationInput | null> {
  const maxWait = options.maxWaitMilliseconds ?? 10_000;
  const goodEnough = options.goodEnoughMeters ?? 20;
  return new Promise((resolve) => {
    if (!supported()) {
      resolve(null);
      return;
    }
    const startedAt = Date.now();
    let fixes: RawFix[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(deadline);
      const fix = currentFix(fixes, Date.now());
      resolve(fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: fix.accuracyMeters, capturedAt: new Date(fix.receivedAt).toISOString() } : null);
    };
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (position.timestamp && position.timestamp < startedAt - 1_000) return;
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(accuracy) || accuracy <= 0) return;
        fixes = [...fixes, { latitude, longitude, accuracyMeters: accuracy, receivedAt: Date.now() }];
        const fix = currentFix(fixes, Date.now());
        // Two readings at least: the first is often a stale or coarse guess.
        if (fix && fix.accuracyMeters <= goodEnough && fixes.length >= 2) finish();
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED || !fixes.length) finish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWait },
    );
    const deadline = window.setTimeout(finish, maxWait);
  });
}
