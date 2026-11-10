# Venue system

## Status

Venue registration and location verification are not implemented. The current schema contains campuses but no buildings, floors, venues, geofences, coordinates, markers or beacon records. The current interface contains no map and no venue data. No coordinates in this repository represent a LASU classroom.

## Intended hierarchy

```text
Institution
  └── Campus
       └── Building
            └── Floor or section (optional)
                 └── Venue
```

A venue may be shared across departments. Ownership and availability should be modeled separately from the department that happens to use a room for one lecture. Not every room needs a floor value.

## Venue registration requirements

An authorized administrator should register a venue on site, capture a coordinate, inspect and confirm it, choose an appropriate circular geofence, record capacity and venue type, and submit the change for the required approval. Store the registering actor, approver, timestamps and previous location values. An unreviewed coordinate must not silently become an active attendance boundary.

A future venue record should include stable identifier, code and name, institution, campus, building, optional floor or section, venue type, capacity, active status and verification configuration. A geofence is initially circular; the model should leave room for a later polygon representation without pretending it is supported now.

## Proximity evaluation

The server should use a well-tested geodesic distance function such as Haversine and consider the reported horizontal accuracy and reading age. A per-venue policy should define the acceptable radius. There should be three location outcomes:

- Within boundary: enough proximity evidence for the configured policy.
- Outside boundary: the reading appears inconsistent with the venue.
- Inconclusive: uncertainty or freshness prevents a reliable conclusion.

A large uncertainty circle must not be treated as a precise indoor location. GPS alone cannot prove classroom presence. A student with a weak or unavailable signal needs a retry or documented human-reviewed alternative.

## Privacy and optional evidence

Location is requested only for an attendance event or an explicitly approved checkpoint. No continuous tracking or background PWA location is planned. Raw coordinates, calculated distance, outcome and final attendance decision should be separate data with scoped access and approved retention.

A permanent venue marker and a dynamic session QR are different credentials. A static marker can be shared and is supplementary evidence only. Browser BLE APIs do not provide unrestricted or dependable background scanning across devices. A native client may later submit a signed beacon observation through a `VenueProximityProvider` interface. Any university Wi-Fi integration requires LASU IT approval; a PWA cannot inspect arbitrary access points.

## Dependencies

Physical survey, building ownership, map provider selection, geofence thresholds, accessibility alternatives, approval workflow, data retention and the authorized roles for location review are open institutional decisions. No real venue can be configured until those decisions and access are available.
