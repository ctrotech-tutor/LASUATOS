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
