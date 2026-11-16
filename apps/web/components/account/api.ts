'use client';

import {
  AccountSessionsSchema,
  PasswordChangedSchema,
  ProfileUpdatedSchema,
  SessionsRevokedSchema,
  type AccountSession,
  type ProfileUpdated,
} from '@lasuatos/contracts';
import type { z } from 'zod';
import { problemMessage, readJson } from '../account-forms';

const UNREACHABLE = 'LASUATOS did not respond. Check your connection and try again.';

/** A failed account request; `status` is 0 when the server was not reached. */
export class AccountRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The server's own words for 400/409 answers ("That matric number is already…"), else a plain fallback. */
function detailOf(body: unknown): string {
  return body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string' ? body.detail : '';
}

async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>, fallback: string, ownWords: readonly number[] = []): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;
    throw new AccountRequestError(UNREACHABLE, 0);
  }
  const body = await readJson(response);
  const parsed = schema.safeParse(body);
  if (response.ok && parsed.success) return parsed.data;
  const detail = detailOf(body);
  throw new AccountRequestError(ownWords.includes(response.status) && detail ? detail : problemMessage(response.status, body, fallback), response.status);
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function loadSessions(signal: AbortSignal): Promise<readonly AccountSession[]> {
  const result = await call('/api/v1/auth/sessions', { signal }, AccountSessionsSchema, 'Your sign-ins did not load.');
  return result.sessions;
}

/** Ends one other sign-in (`id`), or every other one. Resolves to how many ended. */
export async function signOutSessions(id: string | null): Promise<number> {
  const result = await call(
    id ? `/api/v1/auth/sessions/${encodeURIComponent(id)}` : '/api/v1/auth/sessions/revoke-others',
    { method: id ? 'DELETE' : 'POST' },
    SessionsRevokedSchema,
    'That device was not signed out. Try again.',
  );
  return result.revokedSessions;
}

export function updateProfile(changes: {
  readonly displayName?: string;
  readonly matricNumber?: string;
  readonly currentPassword?: string;
  readonly staffNumber?: string;
}): Promise<ProfileUpdated> {
  return call('/api/v1/auth/profile', json(changes), ProfileUpdatedSchema, 'Your details were not saved. Try again.', [400, 409]);
}

/** Resolves to how many other sign-ins the change ended. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<number> {
  const result = await call('/api/v1/auth/password', json({ currentPassword, newPassword }), PasswordChangedSchema, 'Your password was not changed. Try again.', [400]);
  return result.revokedSessions;
}
