# Venue system

## Status

The venue model, administration API and administrator interface are implemented, and venue boundaries gate lecture check-ins. The schema contains campuses (with optional map anchors), buildings, venues and a venue location audit trail. The administrator workspace at `/admin/venues` lists venues, creates and edits buildings and venues, registers each venue's boundary (an outline of the hall or a circle) on a map, shows where recent check-ins landed, and activates or deactivates venues. A lecture session linked to a mapped venue checks students' positions against it, on by default (ADR 033); how that works for students is in `docs/LECTURE_ATTENDANCE.md`.

Venue beacons or markers, BLE and university Wi-Fi evidence are not implemented. No coordinates in this repository represent a real LASU classroom: the demo seed's campus anchor comes from a public map reference for the LASU Epe Campus area (approximately `6.594255, 3.995948`), is labelled synthetic, and the seeded demo venue stays `pending_review` with no boundary until an administrator registers one. Real venues in production are registered by LASUATOS administrators, not by this repository.

## Implemented hierarchy

```text
Institution
  └── Campus (code/name, optional address and map anchor)
       └── Building (code per campus, optional)
            └── Venue (code per campus, optional floor/section, type, capacity)
```

A venue may be shared across departments, so venues are owned by the institution through its campus, never by a single department. All venue rows carry tenant-paired composite foreign keys (`id` + `institution_id`), so reads and writes cannot cross institutions even if an identifier alone were guessed. Not every room needs a floor value; `floor_label` and `section_label` are optional free text.

## Venue registration as implemented

Venue writes are reserved for institution administrators; any administrator in the institution can read the directory. A venue starts in `pending_review`. An administrator prepares the record (campus, optional building, code, name, type, capacity, notes), then registers its boundary in one of two shapes (migration 0018 added outlines):

- **Outline** (recommended): the hall's corners, 3 to 24, in order. The quickest way is the building's OpenStreetMap footprint, looked up server-side (`GET /api/v1/admin/venues/building-outlines`); corners can also be tapped on the map or captured with GPS standing in each corner. Outlines that cross themselves, repeat a corner or are smaller than about 4 m² are refused.
- **Circle**: a centre and a radius of 5 to 2,000 m.

Both have an **allowance**, 0 to 100 m (15 by default): how far outside the shape a phone reading may land and still count, because phone GPS indoors is usually 10 to 30 m off. The form suggests one from the accuracy measured at the venue (about one accuracy radius, between 10 and 40 m). GPS capture averages several readings taken while the phone is held still. The API records the registering actor, time, shape, allowance and reported device accuracy in `venue_location_events` (`registered`, then `updated` on each change). A coordinate can only become an attendance boundary through this explicit registration plus a separate activation step.

Activation requires a registered coordinate and geofence: the service refuses `409` and a database check constraint (`venues_active_location_ck`) independently enforces the invariant. Deactivation (`inactive`) is always allowed and is the expected incident response when a boundary is questioned. An unreviewed coordinate never silently becomes an active boundary.

The map uses OpenStreetMap tiles via Leaflet, loaded as a lazy client chunk only where a map is shown. It is a review aid: every shape is drawn or confirmed by the administrator, and a footprint from OpenStreetMap is only a starting point. The venue's evidence view (`GET /api/v1/admin/venues/{venueId}/evidence`) shows where phones were at check-in over the last 30 days, so an outline that is too tight shows up as readings just outside it.

## Proximity evaluation

`packages/verification/src/venue-area.ts` decides lecture check-ins with `evaluatePresence`, in this order:

1. A reading older than two minutes (or from the future) is `inconclusive` (`stale`).
2. Further outside the shape than the allowance plus the reading's whole accuracy radius is `outside`: even the most generous reading of the error cannot put the phone at the venue.
3. Accuracy of 1 km or worse is `inconclusive` (`approximate`): the phone is sharing an approximate location, usually because Precise Location is off.
4. Accuracy worse than 100 m, or none given, is `inconclusive` (`coarse`).
5. Inside the shape is `within` (`inside`).
6. Outside the shape by no more than the allowance is `within` (`within_allowance`).
7. Anything else is `outside` (`outside_uncertain`): a better reading may land inside.

The allowance is the one visible tolerance; the accuracy radius is never added on top of it. Distances are Haversine on the WGS84 mean radius.

When the session requires the venue, only `within` is accepted. Every other outcome is refused with `422` and a message that says what to do (take a fresh reading, turn on Precise Location, move near a window, go into the venue), and the person taking attendance can add the student by hand. When the venue is mapped but not required, the outcome is recorded with the check-in and nothing is refused. The outcome, distance and accuracy are stored with the attendance record and shown to the session taker.

The older enrolled-course check-in (`POST /api/v1/student/attendance/check-in`) uses the earlier circular evaluator, `evaluateCircularGeofence` in `geofence.ts`: `within` is recorded, clearly `outside` is refused, and `inconclusive` is recorded as is.

A large uncertainty circle is never treated as a precise indoor location, and GPS is evaluated as a signal, not proof.

## Privacy and optional evidence

Location is requested only for an attendance event or an explicitly approved checkpoint. No continuous tracking or background PWA location is planned. Raw coordinates, calculated distance, outcome and final attendance decision should be separate data with scoped access and approved retention.

A permanent venue marker and a dynamic session QR are different credentials. A static marker can be shared and is supplementary evidence only. Browser BLE APIs do not provide unrestricted or dependable background scanning across devices. A native client may later submit a signed beacon observation through a `VenueProximityProvider` interface. Any university Wi-Fi integration requires LASU IT approval; a PWA cannot inspect arbitrary access points.

## Dependencies

Physical surveys of real venues, building ownership, geofence radius policy per venue type, accessibility alternatives, approval workflow, data retention and the authorized roles for location review remain institutional decisions. The platform default (institution administrators register venues, department and faculty administrators read the directory) is implemented; whether LASU wants additional workflow (for example motion-based approval or a separate reviewer role) is still open. No real venue should be configured until those decisions and access are available.
