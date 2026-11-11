import type { AdministratorSessionAccount } from '../auth/repository.js';
import type {
  AdminBuildingRecord,
  AdminCampusRecord,
  AdminVenueRecord,
  VenueRepository,
} from './repository.js';

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
  constructor() {
    super('The venue details are invalid.');
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
    });
    if (result.kind === 'campus_missing') throw new CampusUnavailableError();
    if (result.kind === 'duplicate') throw new VenueConflictError();
    return result.building;
  }

  async listVenues(account: AdministratorSessionAccount): Promise<AdminVenueRecord[]> {
    return this.#repository.listVenues(account.institutionId);
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
    });
    if (result.kind === 'campus_missing' || result.kind === 'building_missing') throw new CampusUnavailableError();
    if (result.kind === 'duplicate') throw new VenueConflictError();
    return result.venue;
  }

  async registerVenueLocation(account: AdministratorSessionAccount, venueId: string, input: {
    readonly latitude: number;
    readonly longitude: number;
    readonly geofenceRadiusMeters: number;
    readonly reportedAccuracyMeters?: number | null;
  }): Promise<AdminVenueRecord> {
    this.#requireInstitutionVenueManager(account);
    if (
      !Number.isFinite(input.latitude) || Math.abs(input.latitude) > 90 ||
      !Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180 ||
      !Number.isInteger(input.geofenceRadiusMeters) ||
      input.geofenceRadiusMeters < 5 || input.geofenceRadiusMeters > 2000 ||
      (input.reportedAccuracyMeters != null &&
        (!Number.isFinite(input.reportedAccuracyMeters) || input.reportedAccuracyMeters < 0))
    ) {
      throw new InvalidVenueInputError();
    }
    const result = await this.#repository.registerVenueLocation({
      institutionId: account.institutionId,
      venueId,
      latitude: input.latitude,
      longitude: input.longitude,
      geofenceRadiusMeters: input.geofenceRadiusMeters,
      reportedAccuracyMeters: input.reportedAccuracyMeters ?? null,
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
      now: this.#now(),
    });
    if (result.kind === 'missing') throw new VenueNotFoundError();
    if (result.kind === 'location_required') throw new VenueLocationRequiredError();
    return result.venue;
  }
}
