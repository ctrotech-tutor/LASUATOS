import { VENUE_USAGE_DAYS } from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import {
  MAX_ALLOWANCE_METERS,
  MAX_VENUE_RADIUS_METERS,
  MIN_CIRCLE_RADIUS_METERS,
  OUTLINE_PROBLEM_TEXT,
  isValidCoordinate,
  outlineCentroid,
  outlineProblem,
  outlineReachMeters,
} from '@lasuatos/verification/venue-area';
import type {
  AdminBuildingRecord,
  AdminCampusRecord,
  AdminVenueRecord,
  LecturerActiveVenueRecord,
  VenueCheckInPointRecord,
  VenueCourseUseRecord,
  VenueLocationChangeRecord,
  VenuePoint,
  VenueRepository,
  VenueUsageRecord,
} from './repository.js';

const DAY_MILLISECONDS = 86_400_000;
/** Enough positions to see where phones land, few enough to draw quickly on a phone. */
export const VENUE_EVIDENCE_POINTS = 600;

export interface VenueEvidenceRecord {
  readonly days: number;
  readonly points: readonly VenueCheckInPointRecord[];
  readonly pointsShown: boolean;
  readonly courses: readonly VenueCourseUseRecord[];
  readonly history: readonly VenueLocationChangeRecord[];
}

export class VenuePermissionError extends Error {
  readonly statusCode = 403;
  constructor() {
    super('This account cannot manage institution venues.');
    this.name = 'VenuePermissionError';
  }
}

export class VenueNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('This venue is not available to this account.');
    this.name = 'VenueNotFoundError';
  }
}

export class CampusUnavailableError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('This campus is not available to this account.');
    this.name = 'CampusUnavailableError';
  }
}

export class BuildingNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('This building is not available to this account.');
    this.name = 'BuildingNotFoundError';
  }
}

export class VenueConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('A record with this code already exists for the selected campus.');
    this.name = 'VenueConflictError';
  }
}

export class VenueLocationRequiredError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Register and confirm a venue location and geofence before activating it.');
    this.name = 'VenueLocationRequiredError';
  }
}

export class InvalidVenueInputError extends Error {
  readonly statusCode = 400;
  constructor(message = 'The venue details are invalid.') {
    super(message);
    this.name = 'InvalidVenueInputError';
  }
}

function emptyToNull(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export class VenueService {
  readonly #repository: VenueRepository;
  readonly #now: () => Date;

  constructor(options: { readonly repository: VenueRepository; readonly now?: () => Date }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Venue directory reads are institution-wide for any administrator in that
   * institution; writes are reserved for institution administrators because a
   * venue boundary affects every department that shares it.
   */
  #requireInstitutionVenueManager(account: AdministratorSessionAccount): void {
    if (account.role !== 'institution_administrator') throw new VenuePermissionError();
  }

  async listCampuses(account: AdministratorSessionAccount): Promise<AdminCampusRecord[]> {
    return this.#repository.listCampuses(account.institutionId);
  }

  /** Active venues in the lecturer's own institution; coordinates excluded. */
  async listActiveVenuesForLecturer(lecturerUserId: string): Promise<LecturerActiveVenueRecord[]> {
    return this.#repository.listActiveVenuesForLecturer(lecturerUserId);
  }

  async listBuildings(account: AdministratorSessionAccount): Promise<AdminBuildingRecord[]> {
    return this.#repository.listBuildings(account.institutionId);
  }

  async createBuilding(account: AdministratorSessionAccount, input: {
    readonly campusId: string;
    readonly code: string;
    readonly name: string;
  }): Promise<AdminBuildingRecord> {
    this.#requireInstitutionVenueManager(account);
    const result = await this.#repository.createBuilding({
      institutionId: account.institutionId,
      campusId: input.campusId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      actorUserId: account.id,
    });
    if (result.kind === 'campus_missing') throw new CampusUnavailableError();
    if (result.kind === 'duplicate') throw new VenueConflictError();
    return result.building;
  }

  async updateBuilding(account: AdministratorSessionAccount, buildingId: string, input: {
    readonly code?: string | undefined;
    readonly name?: string | undefined;
  }): Promise<AdminBuildingRecord> {
    this.#requireInstitutionVenueManager(account);
    const result = await this.#repository.updateBuilding({
      institutionId: account.institutionId,
      buildingId,
      actorUserId: account.id,
      code: input.code?.trim().toUpperCase(),
      name: input.name?.trim(),
      now: this.#now(),
    });
    if (result.kind === 'missing') throw new BuildingNotFoundError();
    if (result.kind === 'duplicate') throw new VenueConflictError();
    return result.building;
  }

  async updateVenue(account: AdministratorSessionAccount, venueId: string, input: {
    readonly code?: string | undefined;
    readonly name?: string | undefined;
    readonly venueType?: AdminVenueRecord['venueType'] | undefined;
    readonly buildingId?: string | null | undefined;
    readonly floorLabel?: string | null | undefined;
    readonly sectionLabel?: string | null | undefined;
    readonly capacity?: number | null | undefined;
    readonly notes?: string | null | undefined;
  }): Promise<AdminVenueRecord> {
    this.#requireInstitutionVenueManager(account);
    const result = await this.#repository.updateVenue({
      institutionId: account.institutionId,
      venueId,
      actorUserId: account.id,
      changes: {
        code: input.code?.trim().toUpperCase(),
        name: input.name?.trim(),
        venueType: input.venueType,
        buildingId: input.buildingId,
        floorLabel: input.floorLabel === undefined ? undefined : emptyToNull(input.floorLabel, 40),
        sectionLabel: input.sectionLabel === undefined ? undefined : emptyToNull(input.sectionLabel, 80),
        capacity: input.capacity,
        notes: input.notes === undefined ? undefined : emptyToNull(input.notes, 500),
      },
      now: this.#now(),
    });
    if (result.kind === 'missing') throw new VenueNotFoundError();
    if (result.kind === 'building_missing') throw new CampusUnavailableError();
    if (result.kind === 'duplicate') throw new VenueConflictError();
    return result.venue;
  }

  async listVenues(account: AdministratorSessionAccount): Promise<AdminVenueRecord[]> {
    return this.#repository.listVenues(account.institutionId);
  }

  /** Sessions and check-ins at each venue in the last VENUE_USAGE_DAYS. */
  async listVenueUsage(account: AdministratorSessionAccount): Promise<VenueUsageRecord[]> {
    const now = this.#now();
    return this.#repository.listVenueUsage(account.institutionId, new Date(now.getTime() - VENUE_USAGE_DAYS * DAY_MILLISECONDS), now);
  }

  /**
   * What happened at one venue lately: the courses held there, its location changes and, for
   * institution administrators (who change boundaries), where accepted check-ins landed. The
   * positions carry no names; they show whether the boundary sits where the phones are.
   */
  async venueEvidence(account: AdministratorSessionAccount, venueId: string): Promise<VenueEvidenceRecord> {
    const venue = await this.#repository.getVenue(account.institutionId, venueId);
    if (!venue) throw new VenueNotFoundError();
    const since = new Date(this.#now().getTime() - VENUE_USAGE_DAYS * DAY_MILLISECONDS);
    const pointsShown = account.role === 'institution_administrator';
    const [points, courses, history] = await Promise.all([
      pointsShown ? this.#repository.listVenueCheckInPoints(account.institutionId, venueId, since, VENUE_EVIDENCE_POINTS) : Promise.resolve([]),
      this.#repository.listVenueCourses(account.institutionId, venueId, since, 12),
      this.#repository.listVenueLocationChanges(account.institutionId, venueId, 20),
    ]);
    return { days: VENUE_USAGE_DAYS, points, pointsShown, courses, history };
  }

  async getVenue(account: AdministratorSessionAccount, venueId: string): Promise<AdminVenueRecord> {
    const venue = await this.#repository.getVenue(account.institutionId, venueId);
    if (!venue) throw new VenueNotFoundError();
    return venue;
  }

  async createVenue(account: AdministratorSessionAccount, input: {
    readonly campusId: string;
    readonly buildingId?: string | null;
    readonly code: string;
    readonly name: string;
    readonly venueType: AdminVenueRecord['venueType'];
    readonly floorLabel?: string | null;
    readonly sectionLabel?: string | null;
    readonly capacity?: number | null;
    readonly locationRequired: boolean;
    readonly notes?: string | null;
  }): Promise<AdminVenueRecord> {
    this.#requireInstitutionVenueManager(account);
    const result = await this.#repository.createVenue({
      institutionId: account.institutionId,
      campusId: input.campusId,
      buildingId: input.buildingId ?? null,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      venueType: input.venueType,
      floorLabel: emptyToNull(input.floorLabel, 40),
      sectionLabel: emptyToNull(input.sectionLabel, 80),
      capacity: input.capacity ?? null,
      locationRequired: input.locationRequired,
      notes: emptyToNull(input.notes, 500),
      actorUserId: account.id,
    });
    if (result.kind === 'campus_missing' || result.kind === 'building_missing') throw new CampusUnavailableError();
    if (result.kind === 'duplicate') throw new VenueConflictError();
    return result.venue;
  }

  /**
   * Registers or updates a venue's location: either an outline (the
   * building's corners, from which the centre and reach are computed here)
   * or a circle, plus the allowance beyond the shape. Every change is kept in
   * venue_location_events.
   */
  async registerVenueLocation(account: AdministratorSessionAccount, venueId: string, input: {
    readonly latitude?: number | undefined;
    readonly longitude?: number | undefined;
    readonly geofenceRadiusMeters?: number | undefined;
    readonly outline?: readonly VenuePoint[] | undefined;
    readonly allowanceMeters?: number | undefined;
    readonly reportedAccuracyMeters?: number | null | undefined;
    readonly sampleCount?: number | null | undefined;
  }): Promise<AdminVenueRecord> {
    this.#requireInstitutionVenueManager(account);
    const allowance = input.allowanceMeters ?? 0;
    if (!Number.isInteger(allowance) || allowance < 0 || allowance > MAX_ALLOWANCE_METERS) throw new InvalidVenueInputError();
    if (
      input.reportedAccuracyMeters != null &&
      (!Number.isFinite(input.reportedAccuracyMeters) || input.reportedAccuracyMeters < 0 || input.reportedAccuracyMeters > 10_000)
    ) {
      throw new InvalidVenueInputError();
    }
    if (input.sampleCount != null && (!Number.isInteger(input.sampleCount) || input.sampleCount < 1 || input.sampleCount > 10_000)) {
      throw new InvalidVenueInputError();
    }

    let shape: { latitude: number; longitude: number; radius: number; outline: VenuePoint[] | null };
    if (input.outline) {
      const outline = input.outline.map((point) => ({
        latitude: Math.round(point.latitude * 1e7) / 1e7,
        longitude: Math.round(point.longitude * 1e7) / 1e7,
      }));
      const problem = outlineProblem(outline);
      if (problem) throw new InvalidVenueInputError(OUTLINE_PROBLEM_TEXT[problem]);
      const center = outlineCentroid(outline);
      const reach = Math.ceil(outlineReachMeters(outline, center));
      shape = {
        latitude: Math.round(center.latitude * 1e7) / 1e7,
        longitude: Math.round(center.longitude * 1e7) / 1e7,
        radius: Math.min(MAX_VENUE_RADIUS_METERS, Math.max(MIN_CIRCLE_RADIUS_METERS, reach)),
        outline,
      };
    } else {
      const { latitude, longitude, geofenceRadiusMeters: radius } = input;
      if (
        latitude === undefined || longitude === undefined || radius === undefined ||
        !isValidCoordinate({ latitude, longitude }) ||
        !Number.isInteger(radius) || radius < MIN_CIRCLE_RADIUS_METERS || radius > MAX_VENUE_RADIUS_METERS
      ) {
        throw new InvalidVenueInputError();
      }
      shape = { latitude, longitude, radius, outline: null };
    }

    const result = await this.#repository.registerVenueLocation({
      institutionId: account.institutionId,
      venueId,
      latitude: shape.latitude,
      longitude: shape.longitude,
      geofenceRadiusMeters: shape.radius,
      geofenceOutline: shape.outline,
      geofenceAllowanceMeters: allowance,
      reportedAccuracyMeters: input.reportedAccuracyMeters ?? null,
      sampleCount: input.sampleCount ?? null,
      actorUserId: account.id,
      now: this.#now(),
    });
    if (result.kind === 'missing') throw new VenueNotFoundError();
    return result.venue;
  }

  async setVenueStatus(
    account: AdministratorSessionAccount,
    venueId: string,
    status: 'active' | 'inactive',
  ): Promise<AdminVenueRecord> {
    this.#requireInstitutionVenueManager(account);
    const result = await this.#repository.setVenueStatus({
      institutionId: account.institutionId,
      venueId,
      status,
      actorUserId: account.id,
      now: this.#now(),
    });
    if (result.kind === 'missing') throw new VenueNotFoundError();
    if (result.kind === 'location_required') throw new VenueLocationRequiredError();
    return result.venue;
  }
}
