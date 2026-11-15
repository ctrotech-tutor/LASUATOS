'use client';

import { AdministratorOverviewSchema, LectureSessionListSchema } from '@lasuatos/contracts';
import type { AdministratorOverview, AuthAdministrator } from '@lasuatos/contracts';
import { BookOpen, QrCode, RotateCw } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { loadAdministratorAttendanceOverview } from '../../lib/attendance-api';
import { loadContactNewCount } from '../../lib/contact-api';
import { forgetSession, lookupSession } from '../../lib/current-account';
import { apiRequest, loadFaceReviews, loadLectureSummary } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { Button, EmptyState, List, ListRow, PageHeader } from '../ds';
import { GuideSheet } from '../guide-sheet';
import { AttendanceCard } from './attendance-card';
import { Attention } from './attention';
import { lagosDay, longToday } from './format';
import { People } from './people';
import { LiveNow, RecentSessions } from './sessions';
import { SetupChecklist } from './setup';
import { attentionFor, setupStepsFor } from './model';
import './overview.css';

/* ---------- data: each part loads on its own and is cached for the tab ---------- */

const leaving = new Promise<never>(() => undefined);

/** The signed-in administrator; anyone else is sent where they belong. */
async function loadAdministrator(): Promise<AuthAdministrator> {
  const lookup = await lookupSession();
  if (lookup.kind === 'signed_out') {
    window.location.replace('/sign-in');
    return leaving;
  }
  if (lookup.kind === 'unavailable') throw new Error('We could not reach LASUATOS. Check your connection and try again.');
  if (lookup.account.accountType !== 'administrator') {
    window.location.replace(lookup.account.accountType === 'student' ? '/attendance' : '/sessions');
    return leaving;
  }
  return lookup.account;
}

const loadOverview = (signal: AbortSignal) => apiRequest('/api/v1/admin/overview', AdministratorOverviewSchema, { signal });
const loadMonth = (signal: AbortSignal) => loadLectureSummary(30, signal);
const loadRecent = (signal: AbortSignal) => apiRequest('/api/v1/lecture/sessions?limit=8', LectureSessionListSchema, { signal });
const loadPendingFaces = (signal: AbortSignal) => loadFaceReviews({ status: 'pending' }, signal).then((list) => list.pendingCount);
const loadDisputes = (signal: AbortSignal) => loadAdministratorAttendanceOverview(signal).then((overview) => overview.totals.openDisputes);

/* ---------- today, without putting a stale date in the server HTML ---------- */

function everyMinute(listener: () => void) {
  const timer = window.setInterval(listener, 60_000);
  return () => window.clearInterval(timer);
}
const todaySnapshot = () => lagosDay(new Date());
const longTodaySnapshot = () => longToday(new Date());
const serverBlank = () => '';

/* ---------- the setup checklist can be hidden, per account, on this device ---------- */

const SETUP_HIDDEN_EVENT = 'lasuatos:setup-hidden';
const setupKey = (accountId: string) => `lasuatos:setup-hidden:${accountId}`;
function onSetupHiddenChange(listener: () => void) {
  window.addEventListener(SETUP_HIDDEN_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(SETUP_HIDDEN_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
function readStorage(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function AdminOverview() {
  const account = useResource('admin:account', loadAdministrator);
  const admin = account.data;
  const institutionAdmin = admin?.role === 'institution_administrator';

  const overview = useResource(admin ? 'admin:overview' : null, loadOverview);
  const month = useResource(admin ? 'admin:summary-30' : null, loadMonth);
  const recent = useResource(admin ? 'admin:recent-sessions' : null, loadRecent, { poll: 45_000 });
  const faces = useResource(admin ? 'admin:face-reviews' : null, loadPendingFaces);
  const messages = useResource(institutionAdmin ? 'admin:messages-new' : null, loadContactNewCount);
  const metrics = overview.data?.metrics;
  const usesEnrolledCourses = Boolean(metrics && (metrics.courseOfferings > 0 || metrics.activeEnrollments > 0));
  const disputes = useResource(usesEnrolledCourses ? 'admin:disputes' : null, loadDisputes);

  const today = useSyncExternalStore(everyMinute, todaySnapshot, serverBlank);
  const longDate = useSyncExternalStore(everyMinute, longTodaySnapshot, serverBlank);

  const hiddenKey = admin ? setupKey(admin.id) : '';
  const setupHidden = useSyncExternalStore(
    onSetupHiddenChange,
    () => (hiddenKey ? readStorage(hiddenKey) : false),
    () => false,
  );
  const hideSetup = useCallback(() => {
    if (!hiddenKey) return;
    try {
      window.localStorage.setItem(hiddenKey, '1');
    } catch {
      /* Private mode: it stays visible next time. */
    }
    window.dispatchEvent(new Event(SETUP_HIDDEN_EVENT));
  }, [hiddenKey]);

  const [guideOpen, setGuideOpen] = useState(false);

  const header = (
    <PageHeader
      eyebrow={longDate || '\u00a0'}
      title="Overview"
      subtitle={admin ? <ScopeLine account={admin} overview={overview.data} /> : <span className="ds-skeleton ov-subtitle-bone" aria-hidden="true" />}
      actions={(
        <Button className="ov-header-action" href="/sessions" icon={<QrCode size={18} strokeWidth={2} aria-hidden="true" />}>
          Take attendance
        </Button>
      )}
    />
  );

  if (account.error && !admin) {
    return (
      <div className="ov">
        {header}
        <div className="ds-card">
          <EmptyState
            error
            icon={<RotateCw size={22} aria-hidden="true" />}
            title="The overview did not load"
            message={account.error}
            action={<Button variant="gray" onClick={() => { forgetSession(); account.reload(); }}>Try again</Button>}
          />
        </div>
      </div>
    );
  }

  const steps = overview.data ? setupStepsFor(overview.data, institutionAdmin) : [];
  const showSetup = !setupHidden && steps.some((step) => !step.done);
  const items = overview.data
    ? attentionFor({
      overview: overview.data,
      institutionAdmin,
      today,
      setupVisible: showSetup,
      faceReviews: faces.data ?? 0,
      newMessages: messages.data ?? 0,
      openDisputes: disputes.data ?? 0,
      sharedPhone: month.data?.totals.sharedDeviceEntries ?? 0,
    })
    : null;

  const setup = showSetup ? <SetupChecklist steps={steps} onHide={hideSetup} /> : null;
  // Before the first class, getting set up is the main job, so it takes the wide column.
  const setupInMain = month.data?.totals.sessions === 0;

  return (
    <div className="ov">
      {header}
      <div className="ov-grid">
        <div className="ov-main">
          <LiveNow sessions={recent.data?.sessions ?? []} openNow={month.data?.totals.openNow ?? 0} />
          <AttendanceCard resource={month} />
          {setupInMain ? setup : null}
          <RecentSessions resource={recent} today={today} />
        </div>
        <div className="ov-rail">
          {overview.error && !overview.data ? (
            <div className="ds-card ov-rail-error">
              <EmptyState
                error
                icon={<RotateCw size={22} aria-hidden="true" />}
                title="Some of the overview did not load"
                message={overview.error}
                action={<Button variant="gray" size="sm" onClick={overview.reload}>Try again</Button>}
              />
            </div>
          ) : (
            <>
              <Attention items={items} />
              {setupInMain ? null : setup}
              <People overview={overview.data} />
            </>
          )}
          <section className="ds-section ov-guide" aria-label="Guide">
            <List leading>
              <ListRow
                leading={<BookOpen size={18} strokeWidth={1.9} />}
                title="Guide"
                subtitle="What each page is for"
                onClick={() => setGuideOpen(true)}
                chevron
              />
            </List>
          </section>
        </div>
      </div>
      {admin ? (
        <GuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} role="administrator" institutionAdmin={institutionAdmin} />
      ) : null}
    </div>
  );
}

/** Where the administrator's access reaches, and the current academic session. */
function ScopeLine({ account, overview }: Readonly<{ account: AuthAdministrator; overview: AdministratorOverview | undefined }>) {
  const where = account.scope.type === 'department'
    ? account.scope.label
    : account.scope.type === 'faculty'
      ? account.scope.label
      : account.institutionName;
  const session = overview?.setup.academicSession?.code;
  return <>{where}{session ? <> · {session} session</> : null}</>;
}
