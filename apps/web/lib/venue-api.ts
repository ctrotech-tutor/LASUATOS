import {
  AdminBuildingSchema,
  AdminBuildingsSchema,
  AdminCampusesSchema,
  AdminVenueSchema,
  AdminVenuesSchema,
  BuildingOutlinesResponseSchema,
  CreateBuildingRequestSchema,
  CreateVenueRequestSchema,
  CreateVenueResponseSchema,
  LecturerActiveVenuesSchema,
  RegisterVenueLocationRequestSchema,
  SetVenueStatusRequestSchema,
  UpdateBuildingRequestSchema,
  UpdateVenueRequestSchema,
} from '@lasuatos/contracts';
import { z } from 'zod';
import { requestJson } from './course-api';

const BuildingCreatedSchema = z.object({
  status: z.literal('created'),
  building: AdminBuildingSchema,
});

const VenueRegisteredSchema = z.object({
  status: z.literal('registered'),
  venue: AdminVenueSchema,
});

const VenueStatusUpdatedSchema = z.object({
  status: z.enum(['active', 'inactive']),
  venue: AdminVenueSchema,
});

export async function loadAdminCampuses(signal?: AbortSignal) {
  return requestJson('/api/v1/admin/campuses', AdminCampusesSchema, signal ? { signal } : undefined);
}

export async function loadAdminBuildings(signal?: AbortSignal) {
  return requestJson('/api/v1/admin/buildings', AdminBuildingsSchema, signal ? { signal } : undefined);
}

export async function createBuilding(input: unknown) {
  const payload = CreateBuildingRequestSchema.parse(input);
  return requestJson('/api/v1/admin/buildings', BuildingCreatedSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function loadAdminVenues(signal?: AbortSignal) {
  return requestJson('/api/v1/admin/venues', AdminVenuesSchema, signal ? { signal } : undefined);
}

/** OpenStreetMap building footprints around a map point, best match first. */
export async function loadBuildingOutlines(latitude: number, longitude: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ latitude: latitude.toFixed(7), longitude: longitude.toFixed(7) });
  return requestJson(`/api/v1/admin/venues/building-outlines?${query.toString()}`, BuildingOutlinesResponseSchema, signal ? { signal } : undefined);
}

export async function createVenue(input: unknown) {
  const payload = CreateVenueRequestSchema.parse(input);
  return requestJson('/api/v1/admin/venues', CreateVenueResponseSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function registerVenueLocation(venueId: string, input: unknown) {
  const payload = RegisterVenueLocationRequestSchema.parse(input);
  return requestJson(
    `/api/v1/admin/venues/${encodeURIComponent(venueId)}/location`,
    VenueRegisteredSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function setVenueStatus(venueId: string, status: 'active' | 'inactive') {
  const payload = SetVenueStatusRequestSchema.parse({ status });
  return requestJson(
    `/api/v1/admin/venues/${encodeURIComponent(venueId)}/status`,
    VenueStatusUpdatedSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

/** Active venues a lecturer may attach to an attendance session. Coordinates never leave the API. */
export async function loadLecturerActiveVenues(signal?: AbortSignal) {
  return requestJson('/api/v1/lecturer/venues', LecturerActiveVenuesSchema, signal ? { signal } : undefined);
}

const VenueUpdatedSchema = z.object({ status: z.literal('updated'), venue: AdminVenueSchema });
const BuildingUpdatedSchema = z.object({ status: z.literal('updated'), building: AdminBuildingSchema });

/** Corrects a venue's code, name, type, building, floor, section or capacity. */
export async function updateVenue(venueId: string, input: unknown) {
  const payload = UpdateVenueRequestSchema.parse(input);
  return requestJson(`/api/v1/admin/venues/${encodeURIComponent(venueId)}`, VenueUpdatedSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Corrects a building's code or name. */
export async function updateBuilding(buildingId: string, input: unknown) {
  const payload = UpdateBuildingRequestSchema.parse(input);
  return requestJson(`/api/v1/admin/buildings/${encodeURIComponent(buildingId)}`, BuildingUpdatedSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
