export interface AdminCampusRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly address: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly isActive: boolean;
}

export interface AdminBuildingRecord {
  readonly id: string;
  readonly campusId: string;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface VenuePoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface AdminVenueRecord {
  readonly id: string;
  readonly campusId: string;
  readonly campusName: string;
  readonly buildingId: string | null;
  readonly buildingName: string | null;
  readonly code: string;
  readonly name: string;
  readonly venueType:
    | 'lecture_theatre'
    | 'classroom'
    | 'laboratory'
    | 'hall'
    | 'seminar_room'
    | 'workshop'
    | 'outdoor'
    | 'other';
  readonly floorLabel: string | null;
  readonly sectionLabel: string | null;
  readonly capacity: number | null;
  readonly status: 'pending_review' | 'active' | 'inactive';
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly geofenceKind: 'circle';
  readonly geofenceRadiusMeters: number | null;
  /** The building's footprint; null for circle venues. */
  readonly geofenceOutline: readonly VenuePoint[] | null;
  readonly geofenceAllowanceMeters: number;
  readonly locationAccuracyMeters: number | null;
  readonly locationSampleCount: number | null;
  readonly locationRequired: boolean;
  readonly locationRegisteredAt: Date | null;
  readonly locationRegisteredByName: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
}

/** How a venue was used since a date (see VenueUsageSchema). */
export interface VenueUsageRecord {
  readonly venueId: string;
  readonly sessions: number;
  readonly openSessions: number;
  readonly lastSessionAt: Date | null;
  readonly checkIns: number;
  readonly inside: number;
  readonly outside: number;
  readonly unclear: number;
  readonly noReading: number;
  readonly handAdded: number;
}

export interface VenueCheckInPointRecord {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number | null;
  readonly outcome: 'within' | 'outside' | 'inconclusive';
}

export interface VenueCourseUseRecord {
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessions: number;
  readonly lastAt: Date;
}

export interface VenueLocationChangeRecord {
  readonly kind: 'registered' | 'updated' | 'cleared';
  readonly at: Date;
  readonly actorName: string | null;
  readonly radiusMeters: number | null;
  readonly corners: number | null;
  readonly allowanceMeters: number | null;
  readonly accuracyMeters: number | null;
}

export interface CreateBuildingInput {
  readonly institutionId: string;
  readonly campusId: string;
  readonly code: string;
  readonly name: string;
  readonly actorUserId: string;
}

export interface CreateVenueInput {
  readonly institutionId: string;
  readonly campusId: string;
  readonly buildingId: string | null;
  readonly code: string;
  readonly name: string;
  readonly venueType: AdminVenueRecord['venueType'];
  readonly floorLabel: string | null;
  readonly sectionLabel: string | null;
  readonly capacity: number | null;
  readonly locationRequired: boolean;
  readonly notes: string | null;
  /** Audited as the one who added it. */
  readonly actorUserId: string;
}

export interface RegisterVenueLocationInput {
  readonly institutionId: string;
  readonly venueId: string;
  /** Circle centre, or the outline's centre of area. */
  readonly latitude: number;
  readonly longitude: number;
  /** Circle radius, or centre to furthest outline corner. */
  readonly geofenceRadiusMeters: number;
  readonly geofenceOutline: readonly VenuePoint[] | null;
  readonly geofenceAllowanceMeters: number;
  readonly reportedAccuracyMeters: number | null;
  readonly sampleCount: number | null;
  readonly actorUserId: string;
  readonly now: Date;
}

export type CreateBuildingResult =
  | { readonly kind: 'created'; readonly building: AdminBuildingRecord }
  | { readonly kind: 'campus_missing' }
  | { readonly kind: 'duplicate' };

export type CreateVenueResult =
  | { readonly kind: 'created'; readonly venue: AdminVenueRecord }
  | { readonly kind: 'campus_missing' }
  | { readonly kind: 'building_missing' }
  | { readonly kind: 'duplicate' };

export type RegisterVenueLocationResult =
  | { readonly kind: 'registered'; readonly venue: AdminVenueRecord }
  | { readonly kind: 'missing' };

export type SetVenueStatusResult =
  | { readonly kind: 'updated'; readonly venue: AdminVenueRecord }
  | { readonly kind: 'missing' }
  | { readonly kind: 'location_required' };

/** Corrections to a venue's details; undefined leaves a field as it is. */
export interface VenueDetailChanges {
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly venueType?: AdminVenueRecord['venueType'] | undefined;
  readonly buildingId?: string | null | undefined;
  readonly floorLabel?: string | null | undefined;
  readonly sectionLabel?: string | null | undefined;
  readonly capacity?: number | null | undefined;
  readonly notes?: string | null | undefined;
}

export type UpdateVenueResult =
  | { readonly kind: 'updated'; readonly venue: AdminVenueRecord }
  | { readonly kind: 'missing' }
  | { readonly kind: 'building_missing' }
  | { readonly kind: 'duplicate' };

export type UpdateBuildingResult =
  | { readonly kind: 'updated'; readonly building: AdminBuildingRecord }
  | { readonly kind: 'missing' }
  | { readonly kind: 'duplicate' };

/** Minimal active venue record for lecturer session setup. Coordinates excluded. */
export interface LecturerActiveVenueRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly campusName: string;
  readonly buildingName: string | null;
  readonly venueType: AdminVenueRecord['venueType'];
  readonly geofenceRadiusMeters: number | null;
}

export interface VenueRepository {
  listCampuses(institutionId: string): Promise<AdminCampusRecord[]>;
  /** Active venues in the lecturer's own institution, for session setup. */
  listActiveVenuesForLecturer(lecturerUserId: string): Promise<LecturerActiveVenueRecord[]>;
  listBuildings(institutionId: string): Promise<AdminBuildingRecord[]>;
  createBuilding(input: CreateBuildingInput): Promise<CreateBuildingResult>;
  /** Renames or recodes a building; audited. */
  updateBuilding(input: {
    readonly institutionId: string;
    readonly buildingId: string;
    readonly actorUserId: string;
    readonly code?: string | undefined;
    readonly name?: string | undefined;
    readonly now: Date;
  }): Promise<UpdateBuildingResult>;
  listVenues(institutionId: string): Promise<AdminVenueRecord[]>;
  /** Usage of every venue with sessions starting at or after `since`. */
  listVenueUsage(institutionId: string, since: Date, now: Date): Promise<VenueUsageRecord[]>;
  /** Accepted check-in positions at a venue since a date, newest first. */
  listVenueCheckInPoints(institutionId: string, venueId: string, since: Date, limit: number): Promise<VenueCheckInPointRecord[]>;
  /** Courses that held sessions at a venue since a date, busiest first. */
  listVenueCourses(institutionId: string, venueId: string, since: Date, limit: number): Promise<VenueCourseUseRecord[]>;
  /** The venue's location changes, newest first. */
  listVenueLocationChanges(institutionId: string, venueId: string, limit: number): Promise<VenueLocationChangeRecord[]>;
  getVenue(institutionId: string, venueId: string): Promise<AdminVenueRecord | null>;
  createVenue(input: CreateVenueInput): Promise<CreateVenueResult>;
  /** Corrects a venue's details (not its location or status); audited. */
  updateVenue(input: {
    readonly institutionId: string;
    readonly venueId: string;
    readonly actorUserId: string;
    readonly changes: VenueDetailChanges;
    readonly now: Date;
  }): Promise<UpdateVenueResult>;
  registerVenueLocation(input: RegisterVenueLocationInput): Promise<RegisterVenueLocationResult>;
  setVenueStatus(input: {
    readonly institutionId: string;
    readonly venueId: string;
    readonly status: 'active' | 'inactive';
    readonly actorUserId: string;
    readonly now: Date;
  }): Promise<SetVenueStatusResult>;
}
