import {
  CreateBuildingRequestSchema,
  CreateVenueRequestSchema,
  RegisterVenueLocationRequestSchema,
  SetVenueStatusRequestSchema,
} from '@lasuatos/contracts';
import type { ApiProblem } from '@lasuatos/contracts';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import type { VenueService } from './service.js';

const COOKIE_NAME = 'lasuatos_session';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const venueParamsSchema = z.object({ venueId: z.uuid() }).strict();

function readSessionToken(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== COOKIE_NAME) continue;
    const token = item.slice(separator + 1).trim();
    return tokenPattern.test(token) ? token : undefined;
  }
  return undefined;
}

function unavailable(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problem: ApiProblem = {
    type: 'about:blank',
    title: 'Service unavailable',
    status: 503,
    detail: 'The request could not be processed.',
    instance: request.routeOptions.url ?? '/unknown',
    requestId: request.id,
  };
  return reply.header('cache-control', 'no-store')
    .code(503)
    .type('application/problem+json')
    .send(problem);
}

function unauthenticated(): Error {
  return Object.assign(new Error('Authentication is required.'), { statusCode: 401 });
}

function notAdministrator(): Error {
  return Object.assign(new Error('This account cannot perform the requested action.'), { statusCode: 403 });
}

function invalidRequest(): Error {
  return Object.assign(new Error('Invalid request.'), { statusCode: 400 });
}

function serializeVenue(venue: Awaited<ReturnType<VenueService['getVenue']>>) {
  return {
    id: venue.id,
    campusId: venue.campusId,
    campusName: venue.campusName,
    buildingId: venue.buildingId,
    buildingName: venue.buildingName,
    code: venue.code,
    name: venue.name,
    venueType: venue.venueType,
    floorLabel: venue.floorLabel,
    sectionLabel: venue.sectionLabel,
    capacity: venue.capacity,
    status: venue.status,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofenceKind: venue.geofenceKind,
    geofenceRadiusMeters: venue.geofenceRadiusMeters,
    locationRequired: venue.locationRequired,
    locationRegisteredAt: venue.locationRegisteredAt?.toISOString() ?? null,
    createdAt: venue.createdAt.toISOString(),
  };
}

export interface VenueRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly venue?: Pick<
    VenueService,
    | 'listCampuses'
    | 'listBuildings'
    | 'createBuilding'
    | 'listVenues'
    | 'getVenue'
    | 'createVenue'
    | 'registerVenueLocation'
    | 'setVenueStatus'
    | 'listActiveVenuesForLecturer'
  >;
}

export function registerVenueRoutes(server: FastifyInstance, options: VenueRouteOptions): void {
  async function requireAdministrator(request: FastifyRequest): Promise<AdministratorSessionAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw unauthenticated();
    if (account.accountType !== 'administrator') throw notAdministrator();
    return account;
  }

  server.get('/api/v1/lecturer/venues', async (request, reply) => {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw unauthenticated();
    if (account.accountType !== 'lecturer') throw notAdministrator();
    if (!options.venue) return unavailable(request, reply);
    const venues = await options.venue.listActiveVenuesForLecturer(account.id);
    return reply.header('cache-control', 'no-store').send({
      venues: venues.map((venue) => ({
        id: venue.id,
        code: venue.code,
        name: venue.name,
        campusName: venue.campusName,
        buildingName: venue.buildingName,
        venueType: venue.venueType,
        geofenceRadiusMeters: venue.geofenceRadiusMeters,
      })),
    });
  });

  server.get('/api/v1/admin/campuses', async (request, reply) => {
    if (!options.venue) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const campuses = await options.venue.listCampuses(account);
    return reply.header('cache-control', 'no-store').send({ campuses });
  });

  server.get('/api/v1/admin/buildings', async (request, reply) => {
    if (!options.venue) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const buildings = await options.venue.listBuildings(account);
    return reply.header('cache-control', 'no-store').send({ buildings });
  });

  server.post('/api/v1/admin/buildings', async (request, reply) => {
    const parsed = CreateBuildingRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.venue) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const building = await options.venue.createBuilding(account, parsed.data);
    return reply.header('cache-control', 'no-store').code(201).send({ status: 'created', building });
  });

  server.get('/api/v1/admin/venues', async (request, reply) => {
    if (!options.venue) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const venues = await options.venue.listVenues(account);
    return reply.header('cache-control', 'no-store').send({
      venues: venues.map(serializeVenue),
    });
  });

  server.get('/api/v1/admin/venues/:venueId', async (request, reply) => {
    const params = venueParamsSchema.safeParse(request.params);
    if (!params.success) throw invalidRequest();
    if (!options.venue) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const venue = await options.venue.getVenue(account, params.data.venueId);
    return reply.header('cache-control', 'no-store').send({ venue: serializeVenue(venue) });
  });

  server.post('/api/v1/admin/venues', async (request, reply) => {
    const parsed = CreateVenueRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.venue) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const venue = await options.venue.createVenue(account, {
      campusId: parsed.data.campusId,
      buildingId: parsed.data.buildingId ?? null,
      code: parsed.data.code,
      name: parsed.data.name,
      venueType: parsed.data.venueType,
      floorLabel: parsed.data.floorLabel ?? null,
      sectionLabel: parsed.data.sectionLabel ?? null,
      capacity: parsed.data.capacity ?? null,
      locationRequired: parsed.data.locationRequired,
      notes: parsed.data.notes ?? null,
    });
    return reply.header('cache-control', 'no-store').code(201).send({
      status: 'created',
      venue: serializeVenue(venue),
    });
  });

  server.post('/api/v1/admin/venues/:venueId/location', async (request, reply) => {
    const params = venueParamsSchema.safeParse(request.params);
    const parsed = RegisterVenueLocationRequestSchema.safeParse(request.body);
    if (!params.success || !parsed.success) throw invalidRequest();
    if (!options.venue) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const venue = await options.venue.registerVenueLocation(account, params.data.venueId, {
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      geofenceRadiusMeters: parsed.data.geofenceRadiusMeters,
      reportedAccuracyMeters: parsed.data.reportedAccuracyMeters ?? null,
    });
    return reply.header('cache-control', 'no-store').send({
      status: 'registered',
      venue: serializeVenue(venue),
    });
  });

  server.post('/api/v1/admin/venues/:venueId/status', async (request, reply) => {
    const params = venueParamsSchema.safeParse(request.params);
    const parsed = SetVenueStatusRequestSchema.safeParse(request.body);
    if (!params.success || !parsed.success) throw invalidRequest();
    if (!options.venue) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const venue = await options.venue.setVenueStatus(account, params.data.venueId, parsed.data.status);
    return reply.header('cache-control', 'no-store').send({
      status: venue.status,
      venue: serializeVenue(venue),
    });
  });
}
