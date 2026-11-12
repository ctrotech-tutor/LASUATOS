import type { CheckInLocationInput } from './attendance-api';

/**
 * Attempts to read the device's current position so venue-linked check-ins can
 * attach honest location evidence. Resolved as null when the browser cannot
 * or will not provide a reading — the server decides what the venue requires.
 */
export function requestLocationSample(): Promise<CheckInLocationInput | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  });
}
