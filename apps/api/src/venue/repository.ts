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
  readonly locationRequired: boolean;
  readonly locationRegisteredAt: Date | null;
  readonly createdAt: Date;
}

export interface CreateBuildingInput {
  readonly institutionId: string;
  readonly campusId: string;
  readonly code: string;
  readonly name: string;
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
}

export interface RegisterVenueLocationInput {
  readonly institutionId: string;
  readonly venueId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly geofenceRadiusMeters: number;
  readonly reportedAccuracyMeters: number | null;
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

export interface VenueRepository {
  listCampuses(institutionId: string): Promise<AdminCampusRecord[]>;
  listBuildings(institutionId: string): Promise<AdminBuildingRecord[]>;
  createBuilding(input: CreateBuildingInput): Promise<CreateBuildingResult>;
  listVenues(institutionId: string): Promise<AdminVenueRecord[]>;
  getVenue(institutionId: string, venueId: string): Promise<AdminVenueRecord | null>;
  createVenue(input: CreateVenueInput): Promise<CreateVenueResult>;
  registerVenueLocation(input: RegisterVenueLocationInput): Promise<RegisterVenueLocationResult>;
  setVenueStatus(input: {
    readonly institutionId: string;
    readonly venueId: string;
    readonly status: 'active' | 'inactive';
    readonly now: Date;
  }): Promise<SetVenueStatusResult>;
}
