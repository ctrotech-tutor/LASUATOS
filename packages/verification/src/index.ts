export {
  EARTH_MEAN_RADIUS_METERS,
  MAX_READING_AGE_MILLISECONDS,
  MAX_USABLE_ACCURACY_METERS,
  evaluateCircularGeofence,
  haversineMeters,
  isValidCoordinate,
} from './geofence.js';
export type {
  CircularGeofence,
  GeographicCoordinate,
  GeofenceEvaluation,
  GeofenceOutcome,
  LocationReading,
} from './geofence.js';
export {
  CHALLENGE_PREFIX,
  DEFAULT_CHALLENGE_WINDOW_SECONDS,
  createSessionQrChallenge,
  generateSessionSecret,
  parseSessionQrChallenge,
  verifySessionQrChallenge,
} from './session-challenge.js';
export type {
  SessionQrChallenge,
  SessionQrChallengeVerification,
} from './session-challenge.js';
