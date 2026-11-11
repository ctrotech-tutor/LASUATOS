import {
  AdminBuildingSchema,
  AdminBuildingsSchema,
  AdminCampusesSchema,
  AdminVenueSchema,
  AdminVenuesSchema,
  CreateBuildingRequestSchema,
  CreateVenueRequestSchema,
  CreateVenueResponseSchema,
  LecturerActiveVenuesSchema,
  RegisterVenueLocationRequestSchema,
  SetVenueStatusRequestSchema,
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
