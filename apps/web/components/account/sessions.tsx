'use client';

import type { AccountSession } from '@lasuatos/contracts';
import { Laptop, MonitorSmartphone, Smartphone, Tablet } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { primeResource, useResource } from '../../lib/resource';
import { Badge, Button, Section } from '../ds';
import { useFeedback } from '../feedback';
import { loadSessions, signOutSessions } from './api';
import { dateLabel, deviceFromAgent, orderSessions, sessionLine, signedOutText, type Device } from './model';

export const SESSIONS_KEY = 'account:sessions';

let cachedDevice: Device | null = null;
const subscribeNever = () => () => undefined;
function readDevice(): Device {
  if (!cachedDevice) {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    cachedDevice = deviceFromAgent(navigator.userAgent, { touch: navigator.maxTouchPoints > 1, installed: standalone });
  }
  return cachedDevice;
}
/** This browser in words. Null during the server render. */
function useThisDevice(): Device | null {
  return useSyncExternalStore(subscribeNever, readDevice, () => null);
}

function DeviceIcon({ kind }: Readonly<{ kind: Device['kind'] | 'unknown' }>) {
  const Icon = kind === 'phone' ? Smartphone : kind === 'tablet' ? Tablet : kind === 'computer' ? Laptop : MonitorSmartphone;
  return <Icon size={18} strokeWidth={2} />;
}

/**
 * Where this account is signed in: this device first, then the others with when each was last
 * used, each signed out on its own or all at once. LASUATOS does not store device names, so only
 * this one is named (from the browser, here and now).
 */
export function SignIns({ now }: Readonly<{ now: number }>) {
  const sessions = useResource(SESSIONS_KEY, loadSessions, { maxAge: 10_000 });
  const device = useThisDevice();
  const dialogs = useFeedback();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const list = sessions.data ? orderSessions(sessions.data) : null;
  const others = list ? list.filter((session) => !session.current) : [];

  async function signOut(id: string | null) {
    if (id === null) {
      const sure = await dialogs.confirm({
        title: `Sign out ${others.length} other sign-in${others.length === 1 ? '' : 's'}?`,
        body: 'Every phone and computer except this one will have to sign in again.',
        confirmLabel: 'Sign out',
        tone: 'danger',
      });
      if (!sure) return;
    }
    setPending(id ?? 'others');
    setError('');
    try {
      const count = await signOutSessions(id);
      if (sessions.data) primeResource(SESSIONS_KEY, sessions.data.filter((session) => session.current || (id !== null && session.id !== id)));
      dialogs.toast(id ? 'Signed out.' : signedOutText(count));
    } catch (caught) {
      // Already ended elsewhere: the list below refreshes either way.
      if (caught && typeof caught === 'object' && 'status' in caught && caught.status === 404) dialogs.toast('That sign-in had already ended.', 'info');
      else setError(caught instanceof Error ? caught.message : 'That did not work. Try again.');
    } finally {
      setPending(null);
      sessions.reload();
    }
  }

  return (
    <Section
      title="Where you’re signed in"
      id="acs-signins"
      aside={list ? `${list.length} sign-in${list.length === 1 ? '' : 's'}` : undefined}
      footer="A sign-in lasts 30 days. If you don’t recognise one, sign it out and change your password."
    >
      {list ? (
        <ul className="ds-list has-leading acs-signins">
          {list.map((session) => (
            <SignInRow
              key={session.id}
              session={session}
              device={session.current ? device : null}
              now={now}
              pending={pending}
              onSignOut={() => void signOut(session.id)}
            />
          ))}
        </ul>
      ) : sessions.error ? (
        <div className="ds-card acs-load-error" role="alert">
          <p>{sessions.error}</p>
          <Button variant="tinted" size="sm" onClick={sessions.reload}>Try again</Button>
        </div>
      ) : <SignInsSkeleton />}
      {error ? <p className="acs-error" role="alert">{error}</p> : null}
      {others.length > 1 ? (
        <Button variant="gray" block className="acs-signout-others" busy={pending === 'others'} disabled={pending !== null} onClick={() => void signOut(null)}>
          {pending === 'others' ? 'Signing out…' : 'Sign out everywhere else'}
        </Button>
      ) : null}
    </Section>
  );
}

function SignInRow({ session, device, now, pending, onSignOut }: Readonly<{
  session: AccountSession;
  device: Device | null;
  now: number;
  pending: string | null;
  onSignOut: () => void;
}>) {
  if (session.current) {
    const via = device?.browser ? `${device.browser} · ` : '';
    return (
      <li>
        <div className="ds-row acs-signin is-current">
          <span className="ds-row-leading" aria-hidden="true"><DeviceIcon kind={device?.kind ?? 'unknown'} /></span>
          <span className="ds-row-body">
            <span className="ds-row-title">{device ? `This ${device.name}` : 'This device'}</span>
            <span className="ds-row-subtitle">{via}signed in {dateLabel(session.createdAt, now)}</span>
          </span>
          <Badge tone="success" dot className="acs-now">Active now</Badge>
        </div>
      </li>
    );
  }
  const line = sessionLine(session, now);
  return (
    <li>
      <div className="ds-row acs-signin">
        <span className="ds-row-leading is-muted" aria-hidden="true"><DeviceIcon kind="unknown" /></span>
        <span className="ds-row-body">
          <span className="ds-row-title">Another sign-in</span>
          <span className="ds-row-subtitle">{line}</span>
        </span>
        <Button
          variant="plain"
          size="sm"
          className="acs-signout-one"
          busy={pending === session.id}
          disabled={pending !== null}
          onClick={onSignOut}
          aria-label={`Sign out the sign-in from ${dateLabel(session.createdAt, now)}`}
        >
          {pending === session.id ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </li>
  );
}

function SignInsSkeleton() {
  return (
    <ul className="ds-list has-leading" role="status" aria-label="Loading where you’re signed in">
      {[64, 48].map((width) => (
        <li key={width}>
          <div className="ds-row">
            <span className="ds-row-leading ds-skeleton" />
            <span className="ds-row-body">
              <span className="ds-skeleton" style={{ width: `${width}%`, height: 16 }} />
              <span className="ds-skeleton" style={{ width: '70%', height: 13, marginTop: 6 }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
