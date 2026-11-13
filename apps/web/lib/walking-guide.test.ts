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
  outline: null,
  allowanceMeters: 0,
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

  it('classifies a reading as inside, near or away by the same rule as check-in', () => {
    expect(readPosition({ latitude: 6.5944, longitude: 3.99595 }, theatre)).toMatchObject({ kind: 'inside' });
    // ~89 m away: 9 m outside an 80 m boundary. A big accuracy circle no longer lets it in…
    const near = readPosition({ latitude: 6.5935, longitude: 3.99595, accuracyMeters: 20 }, theatre);
    expect(near).toMatchObject({ kind: 'near', direction: 'north' });
    expect(near.meters).toBeGreaterThan(8);
    expect(near.meters).toBeLessThan(11);
    // …but the venue's allowance does.
    expect(readPosition({ latitude: 6.5935, longitude: 3.99595 }, { ...theatre, allowanceMeters: 15 }).kind).toBe('inside');
    // Distances count from the edge of the venue, not its centre.
    const away = readPosition({ latitude: 6.5843, longitude: 3.99595 }, theatre);
    expect(away).toMatchObject({ kind: 'away', direction: 'north' });
    expect(away.kind === 'away' ? away.minutes : 0).toBe(13);
  });

  it('uses the outline when the venue has one', () => {
    // A 40 m × 24 m hall drawn corner by corner around the theatre point.
    const dLat = 12 / 111_195;
    const dLng = 20 / (111_195 * Math.cos((6.5943 * Math.PI) / 180));
    const hall = {
      ...theatre,
      radiusMeters: 24,
      outline: [
        { latitude: 6.5943 - dLat, longitude: 3.99595 - dLng },
        { latitude: 6.5943 - dLat, longitude: 3.99595 + dLng },
        { latitude: 6.5943 + dLat, longitude: 3.99595 + dLng },
        { latitude: 6.5943 + dLat, longitude: 3.99595 - dLng },
      ],
      allowanceMeters: 10,
    };
    // 18 m east of centre: inside the long side of the hall.
    expect(readPosition({ latitude: 6.5943, longitude: 3.99595 + dLng * 0.9 }, hall).kind).toBe('inside');
    // 18 m north of centre: 6 m past the short wall, within the 10 m allowance.
    expect(readPosition({ latitude: 6.5943 + dLat * 1.5, longitude: 3.99595 }, hall).kind).toBe('inside');
    // 30 m north: 18 m past the wall, 8 m beyond the allowance.
    const outside = readPosition({ latitude: 6.5943 + dLat * 2.5, longitude: 3.99595 }, hall);
    expect(outside.kind).toBe('near');
    expect(Math.round(outside.meters)).toBe(8);
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
