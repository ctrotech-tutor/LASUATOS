'use client';

import type { StatusNotice } from '@lasuatos/contracts';
import { AlertTriangle, ArrowUpRight, CalendarClock, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { dismissedNotices, dismissNotice, loadStatusNotices, maintenanceWindow, pickNotice } from '../lib/status-notices';
import { useVisiblePolling } from '../lib/use-live';

/**
 * A pill with the status page's current incident or planned maintenance (ADR 034), so
 * students hear about a problem from LASUATOS before they assume it is their phone.
 * Checked every three minutes while the app is open; dismissible until the next update.
 */
export function StatusNoticeBanner() {
  const [state, setState] = useState<{ readonly notices: readonly StatusNotice[]; readonly at: number }>({ notices: [], at: 0 });
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  useVisiblePolling(async (signal) => {
    const { notices: next } = await loadStatusNotices(signal);
    if (!signal.aborted) {
      setState({ notices: next, at: Date.now() });
      setDismissed(dismissedNotices());
    }
    return 180_000;
  }, [], 300_000);

  // Times are judged as of the last check (every three minutes), which is close enough here.
  const notice = pickNotice(state.notices, dismissed, state.at);
  if (!notice) return null;

  const upcoming = notice.kind === 'maintenance' && notice.startsAt !== null && Date.parse(notice.startsAt) > state.at;
  const tone = notice.kind === 'maintenance' ? 'maintenance' : notice.impact;
  const Icon = upcoming ? CalendarClock : notice.kind === 'maintenance' ? Wrench : AlertTriangle;
  const when = notice.kind === 'maintenance' ? maintenanceWindow(notice) : null;
  const lead = upcoming ? 'Planned maintenance' : notice.kind === 'maintenance' ? 'Maintenance now' : null;

  return (
    <div className="ui-status-notice" data-tone={tone} role="status">
      <Icon size={17} aria-hidden="true" />
      <p>
        <strong>{lead ? `${lead}: ` : ''}{notice.title}</strong>
        {when ? <span> · {when} WAT</span> : null}
        {notice.message && !upcoming ? <span className="ui-status-notice-message">{notice.message}</span> : null}
      </p>
      <a href={notice.url} target="_blank" rel="noopener noreferrer">
        Details<ArrowUpRight size={14} aria-hidden="true" />
      </a>
      <button
        type="button"
        aria-label="Dismiss this notice"
        onClick={() => {
          dismissNotice(notice);
          setDismissed(dismissedNotices());
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
