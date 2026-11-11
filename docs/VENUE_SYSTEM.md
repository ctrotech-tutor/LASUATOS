# Venue system

## Status

The venue model, administration API and administrator interface are implemented. The schema contains campuses (now with optional map anchors), buildings, venues and a venue location audit trail; the administrator workspace at `/admin/venues` lists venues, creates buildings and venues, registers venue coordinates and circular boundaries with a live map preview, and activates or deactivates venues. The circular geofence evaluator ships in `packages/verification` with a tested three-outcome decision model.

Attendance sessions do not yet reference venues, so venue boundaries currently gate nothing at check-in; wiring venue-aware sessions into the attendance flow is the next phase. Polygon geofences, venue beacons/markers, BLE and university Wi-Fi evidence remain unimplemented. No coordinates in this repository represent a real LASU classroom: the demo seed's campus anchor comes from a public map reference for the LASU Epe Campus area (user-provided Google Maps link, approximately `6.594255, 3.995948`), is labelled synthetic, and the seeded demo venue stays `pending_review` with no boundary until an administrator registers one in person.

## Implemented hierarchy

```text
Institution
  └── Campus (code/name, optional address and map anchor)
       └── Building (code per campus, optional)
            └── Venue (code per campus, optional floor/section, type, capacity)
```

A venue may be shared across departments, so venues are owned by the institution through its campus, never by a single department. All venue rows carry tenant-paired composite foreign keys (`id` + `institution_id`), so reads and writes cannot cross institutions even if an identifier alone were guessed. Not every room needs a floor value; `floor_label` and `section_label` are optional free text.

## Venue registration as implemented

Venue writes are reserved for institution administrators; all institution administrators can read the directory. A venue starts in `pending_review`. An administrator prepares the record (campus, optional building, code, name, type, capacity, notes), then takes a device to the venue, captures its GPS coordinate in the venue directory (browser Geolocation API with live map preview), inspects and adjusts it, chooses the boundary radius (5–2000 m) and submits. The API records the registering actor, timestamp, coordinate, radius and reported device accuracy in `venue_location_events` (`registered`, then `updated` on each change). A coordinate can only become an attendance boundary through this explicit registration plus a separate activation step.

Activation requires a registered coordinate and geofence: the service refuses `409` and a database check constraint (`venues_active_location_ck`) independently enforces the invariant. Deactivation (`inactive`) is always allowed and is the expected incident response when a boundary is questioned. An unreviewed coordinate never silently becomes an active boundary.

The map preview uses OpenStreetMap tiles via Leaflet, loaded as a lazy client chunk only on the venue page, and is clearly labelled as a review aid — every coordinate is entered or confirmed by the administrator, and the numeric fields (or the device GPS) stay authoritative.

## Proximity evaluation

`packages/verification` implements server-side Haversine distance on the WGS84 mean radius and a circular geofence decision with three outcomes:

- `within` — the distance to the venue centre is at or inside the configured radius.
- `outside` — the distance minus the reported horizontal accuracy still exceeds the radius: the reading is clearly inconsistent with the venue.
- `inconclusive` — the reading is stale (future or older than 120 s), the reported accuracy exceeds 100 m, or the uncertainty band crosses the boundary (`boundary_uncertain`); no reliable conclusion is possible.

A large uncertainty circle is never treated as a precise indoor location, and GPS is evaluated as a signal, not proof. A student with a weak or unavailable signal must get a retry or a documented human-reviewed alternative — never a hard failure. Since the venue-aware attendance rework, the check-in pipeline calls this evaluator: `within` records `within_boundary`, `outside` is rejected 422 without a write, and `inconclusive` is recorded as-is with the raw evidence in `attendance_check_in_evidence`.

## Privacy and optional evidence

Location is requested only for an attendance event or an explicitly approved checkpoint. No continuous tracking or background PWA location is planned. Raw coordinates, calculated distance, outcome and final attendance decision should be separate data with scoped access and approved retention.

A permanent venue marker and a dynamic session QR are different credentials. A static marker can be shared and is supplementary evidence only. Browser BLE APIs do not provide unrestricted or dependable background scanning across devices. A native client may later submit a signed beacon observation through a `VenueProximityProvider` interface. Any university Wi-Fi integration requires LASU IT approval; a PWA cannot inspect arbitrary access points.

## Dependencies

Physical surveys of real venues, building ownership, geofence radius policy per venue type, accessibility alternatives, approval workflow, data retention and the authorized roles for location review remain institutional decisions. The platform default — institution administrators register venues on site, department/faculty administrators read the directory — is implemented; whether LASU wants additional workflow (for example motion-based approval or a separate reviewer role) is still open. No real venue should be configured until those decisions and access are available.
