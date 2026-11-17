'use client';

import { LECTURE_REOPEN_WINDOW_HOURS, type LectureCapabilities, type LectureSessionDetail, type LectureSessionList, type LectureSessionSummary, isClassRepTaker, repRoleShort } from '@lasuatos/contracts';
import { MonitorPlay, Pencil, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { deleteLectureSession, failureText, formatClock, loadLectureSession, updateLectureSession } from '../../lib/lecture-api';
import { peekResource, primeResource, staleResources, useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, Menu, PageHeader, SegmentedControl } from '../ds';
import { useFeedback } from '../feedback';
import { AccessMessage, useTakerAccess } from './access';
import { Attendees, isFlagged } from './attendees';
import { EditSessionDialog } from './edit-session';
import { numberFormat, remainingLabel, whenLine } from './format';
import { GuideButton } from '../shell/guide-button';
import { HelpRequests } from './help';
import { useClock, useToday } from './hooks';
import { sessionsKey } from './home';
import { sessionKey } from './new-session';
import { QrStage } from './qr';
import './take.css';

const BACK = { href: '/sessions', label: 'Sessions' };
type Tab = 'qr' | 'students' | 'help';

/** /sessions/[id]: the code students scan, who has marked attendance, and the session's controls. */
export function TakeAttendanceSession({ sessionId }: Readonly<{ sessionId: string }>) {
  const { access, retry } = useTakerAccess();
  if (access.kind === 'ready') return <SessionScreen sessionId={sessionId} takerRole={access.capabilities.role} />;
  if (access.kind === 'loading') return <SessionSkeleton />;
  return <div className="tk-page"><AccessMessage access={access} retry={retry} /></div>;
}

function SessionSkeleton() {
  return (
    <div className="tk-page" role="status" aria-label="Opening the session">
      <PageHeader back={BACK} title={<span className="ds-skeleton tk-bone-title" />} />
      <div className="tk-session-grid">
        <div className="tk-stage is-bone"><span className="ds-skeleton tk-qr-bone" /></div>
      </div>
    </div>
  );
}

const isOpen = (detail: LectureSessionDetail) => detail.session.status === 'open';

/** The session as the list last saw it, so the page draws at once while the names load. */
function fromList(sessionId: string): LectureSessionSummary | null {
  return peekResource<LectureSessionList>(sessionsKey(''))?.sessions.find((item) => item.id === sessionId) ?? null;
}

function SessionScreen({ sessionId, takerRole }: Readonly<{ sessionId: string; takerRole: LectureCapabilities['role'] }>) {
  const key = sessionKey(sessionId);
  const loader = useMemo(() => (signal: AbortSignal) => loadLectureSession(sessionId, signal), [sessionId]);
  // Live while students are arriving (every 4 s while the tab is visible); still once closed.
  const resource = useResource<LectureSessionDetail>(key, loader, { maxAge: 0, poll: 4_000, pollWhile: isOpen });
  const [summary] = useState(() => fromList(sessionId));
  const detail: LectureSessionDetail | null = resource.data
    ?? (summary ? { session: summary, attendees: [], canManage: summary.canManage, helpRequests: [] } : null);

  if (!detail) {
    return resource.error ? (
      <div className="tk-page">
        <PageHeader back={BACK} title="Session" />
        <div className="ds-card">
          <EmptyState error title="This session isn’t available" message={resource.error} action={<Button href="/sessions" variant="gray">All sessions</Button>} />
        </div>
      </div>
    ) : <SessionSkeleton />;
  }
  return <SessionReady detail={detail} loading={!resource.data} error={resource.error} takerRole={takerRole} reload={resource.reload} />;
}

function SessionReady({ detail, loading, error, takerRole, reload }: Readonly<{
  detail: LectureSessionDetail;
  loading: boolean;
  error: string | undefined;
  takerRole: LectureCapabilities['role'];
  reload: () => void;
}>) {
  const { session, canManage, helpRequests } = detail;
  const open = session.status === 'open';
  const isRep = isClassRepTaker(takerRole);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>('qr');
  const dialogs = useFeedback();
  const router = useRouter();
  const today = useToday();
  const now = useClock('fifteen');
  const left = open && now ? remainingLabel(session.endsAt, new Date(now)) : null;
  const pendingHelp = helpRequests.filter((request) => request.status === 'pending').length;
  const showStage = canManage && open;
  const showHelp = canManage && helpRequests.length > 0;
  // Phones show one panel at a time; the QR code only while attendance is open.
  const activeTab: Tab = !showStage && tab === 'qr' ? 'students' : !showHelp && tab === 'help' ? 'students' : tab;

  function afterChange(updated?: LectureSessionSummary) {
    if (updated) primeResource(sessionKey(session.id), { ...detail, session: { ...session, ...updated } });
    staleResources('take:sessions:');
    staleResources('admin:');
    reload();
  }

  async function change(input: Parameters<typeof updateLectureSession>[1], done: string) {
    setBusy(true);
    try {
      afterChange(await updateLectureSession(session.id, input));
      dialogs.toast(done);
    } catch (caught) {
      dialogs.toast(failureText(caught), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function closeNow() {
    const sure = await dialogs.confirm({
      title: 'Close attendance now?',
      body: 'Students can no longer mark attendance. You can reopen it for 15 minutes.',
      confirmLabel: 'Close attendance',
      tone: 'danger',
    });
    if (sure) await change({ close: true }, 'Attendance closed.');
  }

  async function deleteNow() {
    const count = session.presentCount;
    let confirmCourseCode: string | undefined;
    if (count > 0) {
      const typed = await dialogs.prompt({
        title: `Delete ${session.courseCode} and its attendance?`,
        body: `${count} student${count === 1 ? ' is' : 's are'} on this list. Deleting takes ${count === 1 ? 'them' : 'all of them'} off the register and cannot be undone. Type ${session.courseCode} to confirm.`,
        label: 'Course code',
        placeholder: session.courseCode,
        maxLength: 40,
        confirmLabel: 'Delete session',
        tone: 'danger',
      });
      if (typed === null) return;
      if (typed.replace(/\s+/g, '').toUpperCase() !== session.courseCode.replace(/\s+/g, '').toUpperCase()) {
        dialogs.toast(`That does not match ${session.courseCode}. Nothing was deleted.`, 'error');
        return;
      }
      confirmCourseCode = typed;
    } else {
      const sure = await dialogs.confirm({
        title: `Delete ${session.courseCode}?`,
        body: 'No one has marked attendance yet. The QR code stops working.',
        confirmLabel: 'Delete session',
        tone: 'danger',
      });
      if (!sure) return;
    }
    setBusy(true);
    try {
      await deleteLectureSession(session.id, confirmCourseCode);
      staleResources('take:sessions:');
      staleResources('admin:');
      dialogs.toast(`${session.courseCode} was deleted.`);
      router.replace('/sessions');
    } catch (caught) {
      dialogs.toast(failureText(caught), 'error');
      setBusy(false);
    }
  }

  const meta = [whenLine(session.startsAt, session.endsAt, today), session.venueName, session.lecturerName].filter(Boolean).join(' · ');
  const takerLabel = isClassRepTaker(session.creatorRole) ? repRoleShort(session.creatorRole) : session.creatorRole;

  return (
    <div className="tk-page tk-session" data-tab={activeTab}>
      <PageHeader
        back={BACK}
        eyebrow={session.courseCode}
        title={session.courseTitle}
        subtitle={meta}
        actions={(
          <div className="tk-head-actions">
            <GuideButton page="/sessions" label="Taking attendance" />
            {canManage ? (
              <Menu
                label="Session actions"
                title={`${session.courseCode} · ${formatClock(session.startsAt)}`}
                items={[
                  open && {
                    label: session.qrMode === 'dynamic' ? 'Use a poster instead' : 'Use a screen code instead',
                    icon: session.qrMode === 'dynamic' ? <Printer size={17} aria-hidden="true" /> : <MonitorPlay size={17} aria-hidden="true" />,
                    disabled: busy,
                    onSelect: () => void change(
                      { qrMode: session.qrMode === 'dynamic' ? 'static' : 'dynamic' },
                      session.qrMode === 'dynamic' ? 'Switched to a poster.' : 'Switched to a screen code.',
                    ),
                  },
                  { label: 'Edit details', icon: <Pencil size={17} aria-hidden="true" />, disabled: busy, onSelect: () => setEditing(true) },
                  { label: 'Delete session', icon: <Trash2 size={17} aria-hidden="true" />, destructive: true, disabled: busy, onSelect: () => void deleteNow() },
                ]}
              />
            ) : null}
          </div>
        )}
      />

      <div className="tk-status">
        {open ? (
          <Badge tone="success" dot>{left ? `Live · ${left}` : 'Live'}</Badge>
        ) : (
          <Badge tone="neutral">Closed at {formatClock(session.endsAt)}</Badge>
        )}
        {!canManage ? (
          <Badge tone="neutral">
            {session.creatorName === session.lecturerName ? 'View only' : `View only · taken by ${session.creatorName} (${takerLabel})`}
          </Badge>
        ) : null}
        {session.requireVenue ? <Badge tone="tint">Room checked</Badge> : null}
      </div>

      {error && !loading ? <p className="tk-error" role="alert">{error}</p> : null}

      {showStage || showHelp ? (
        <div className="tk-tabs">
          <SegmentedControl
            block
            label="Show"
            value={activeTab}
            onChange={setTab}
            segments={[
              ...(showStage ? [{ value: 'qr' as const, label: 'QR code' }] : []),
              { value: 'students' as const, label: `Students ${numberFormat.format(session.presentCount)}` },
              ...(showHelp ? [{ value: 'help' as const, label: pendingHelp ? `Help ${pendingHelp}` : 'Help' }] : []),
            ]}
          />
        </div>
      ) : null}

      <div className={`tk-session-grid${canManage ? '' : ' is-single'}`}>
        {canManage ? (
          <div className="tk-lead">
            {open ? (
              <div className="tk-panel" data-panel="qr">
                <QrStage session={session} busy={busy} onExtend={() => void change({ extendMinutes: 15 }, 'Added 15 minutes.')} onClose={() => void closeNow()} />
              </div>
            ) : (
              <ClosedCard
                detail={detail}
                busy={busy}
                // Unknown until the clock ticks on the client: offer it, the server has the last word.
                canReopen={!now || now - Date.parse(session.endsAt) <= LECTURE_REOPEN_WINDOW_HOURS * 3_600_000}
                onReopen={() => void change({ extendMinutes: 15 }, 'Attendance reopened for 15 minutes.')}
              />
            )}
          </div>
        ) : null}
        <div className="tk-side">
          {showHelp ? (
            <div className="tk-panel" data-panel="help">
              <HelpRequests session={session} requests={helpRequests} isRep={isRep} onChanged={reload} />
            </div>
          ) : null}
          <div className="tk-panel" data-panel="students">
            <Attendees detail={detail} takerRole={takerRole} loading={loading} onChanged={reload} />
          </div>
        </div>
      </div>

      {editing && canManage ? (
        <EditSessionDialog
          session={session}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            afterChange(updated);
            setEditing(false);
            dialogs.toast('Details saved.');
          }}
        />
      ) : null}
    </div>
  );
}

/** After class: the numbers that matter, and reopening for latecomers. */
function ClosedCard({ detail, busy, canReopen, onReopen }: Readonly<{
  detail: LectureSessionDetail;
  busy: boolean;
  canReopen: boolean;
  onReopen: () => void;
}>) {
  const { session, attendees } = detail;
  const present = attendees.filter((item) => !item.removed);
  const byHand = present.filter((item) => item.method === 'manual').length;
  const flagged = present.filter(isFlagged).length;
  return (
    <section className="tk-stage-section" aria-labelledby="tk-summary-title">
      <div className="tk-section-head">
        <h2 className="tk-section-title" id="tk-summary-title">Summary</h2>
      </div>
      <div className="tk-closed">
        <dl className="tk-closed-stats">
          <div><dt>Present</dt><dd>{numberFormat.format(session.presentCount)}</dd></div>
          <div className={flagged ? 'is-warning' : undefined}><dt>Flagged</dt><dd>{numberFormat.format(flagged)}</dd></div>
          <div><dt>By hand</dt><dd>{numberFormat.format(byHand)}</dd></div>
        </dl>
        {canReopen ? (
          <Button variant="tinted" block disabled={busy} icon={<RefreshCw size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={onReopen}>
            Reopen for 15 minutes
          </Button>
        ) : (
          <p className="tk-quiet">Too late to reopen. Add latecomers by hand.</p>
        )}
      </div>
    </section>
  );
}
