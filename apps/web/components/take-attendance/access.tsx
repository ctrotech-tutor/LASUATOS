'use client';

import type { LectureCapabilities } from '@lasuatos/contracts';
import { QrCode, RotateCw } from 'lucide-react';
import { useCallback } from 'react';
import { forgetSession, lookupSession } from '../../lib/current-account';
import { loadLectureCapabilities } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { WorkspaceSkeleton } from '../account-gate';
import { Button, EmptyState } from '../ds';

export type Access =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly capabilities: LectureCapabilities }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' };

class Unavailable extends Error {}

async function loadAccess(): Promise<LectureCapabilities> {
  const session = await lookupSession();
  if (session.kind === 'signed_out') {
    window.location.replace(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
    // Never settles: the page is leaving.
    return new Promise<LectureCapabilities>(() => undefined);
  }
  if (session.kind === 'unavailable') throw new Unavailable('unavailable');
  return loadLectureCapabilities();
}

/**
 * Who may take attendance, cached for the tab: going back and forth between the list and a
 * session opens at once.
 */
export function useTakerAccess(): { access: Access; retry: () => void } {
  const resource = useResource('take:capabilities', loadAccess, { maxAge: 5 * 60_000 });
  const { reload } = resource;
  const retry = useCallback(() => {
    forgetSession();
    reload();
  }, [reload]);
  const access: Access = resource.data
    ? resource.data.canTakeAttendance ? { kind: 'ready', capabilities: resource.data } : { kind: 'denied' }
    : resource.error ? { kind: 'unavailable' } : { kind: 'loading' };
  return { access, retry };
}

/** Loading, denied or offline. Pages with their own skeleton draw loading themselves. */
export function AccessMessage({ access, retry }: Readonly<{ access: Access; retry: () => void }>) {
  if (access.kind === 'loading') return <WorkspaceSkeleton label="Opening attendance…" />;
  if (access.kind === 'denied') {
    return (
      <div className="ds-card tk-access">
        <EmptyState
          icon={<QrCode size={24} aria-hidden="true" />}
          title="Only lecturers and class reps take attendance"
          message="To mark your own attendance, scan the QR code in class."
          action={<Button href="/a">Mark my attendance</Button>}
        />
      </div>
    );
  }
  if (access.kind === 'unavailable') {
    return (
      <div className="ds-card tk-access">
        <EmptyState
          error
          icon={<RotateCw size={22} aria-hidden="true" />}
          title="We couldn’t reach LASUATOS"
          message="You are still signed in. Check your connection and try again."
          action={<Button variant="gray" onClick={retry}>Try again</Button>}
        />
      </div>
    );
  }
  return null;
}
