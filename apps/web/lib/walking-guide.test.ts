import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  compassDirection,
  describeVenuePlace,
  distanceMeters,
  formatDistance,
  readPosition,
  walkingDirectionsUrl,
} from './walking-guide';

const theatre = {
  campusName: 'Epe Campus',
  buildingName: 'Engineering Complex',
  floorLabel: 'Ground floor',
  sectionLabel: null,
  latitude: 6.5943,
  longitude: 3.99595,
  radiusMeters: 80,
};

describe('walking guide', () => {
  it('measures distance and direction', () => {
    // 0.001° of latitude is about 111 m.
    const south = { latitude: 6.5933, longitude: 3.99595 };
    expect(distanceMeters(south, theatre)).toBeGreaterThan(105);
    expect(distanceMeters(south, theatre)).toBeLessThan(117);
    expect(compassDirection(bearingDegrees(south, theatre))).toBe('north');
    expect(compassDirection(bearingDegrees({ latitude: 6.5953, longitude: 3.99695 }, theatre))).toBe('south-west');
    expect(compassDirection(359)).toBe('north');
  });

  it('classifies a reading as inside, near or away, allowing for GPS accuracy', () => {
    expect(readPosition({ latitude: 6.5944, longitude: 3.99595 }, theatre)).toMatchObject({ kind: 'inside' });
    // ~89 m away: just outside an 80 m boundary, but within it given 20 m accuracy.
    expect(readPosition({ latitude: 6.5935, longitude: 3.99595, accuracyMeters: 20 }, theatre).kind).toBe('inside');
    expect(readPosition({ latitude: 6.5935, longitude: 3.99595, accuracyMeters: 2 }, theatre)).toMatchObject({ kind: 'near', direction: 'north' });
    const away = readPosition({ latitude: 6.5843, longitude: 3.99595 }, theatre);
    expect(away).toMatchObject({ kind: 'away', direction: 'north' });
    expect(away.kind === 'away' ? away.minutes : 0).toBe(13);
  });

  it('formats places, distances and directions links', () => {
    expect(describeVenuePlace(theatre)).toBe('Engineering Complex · Ground floor · Epe Campus');
    expect(describeVenuePlace(null)).toBe('');
    expect(formatDistance(4)).toBe('10 m');
    expect(formatDistance(234)).toBe('230 m');
    expect(formatDistance(1530)).toBe('1.5 km');
    expect(walkingDirectionsUrl(theatre)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=6.594300%2C3.995950&travelmode=walking',
    );
  });
});
