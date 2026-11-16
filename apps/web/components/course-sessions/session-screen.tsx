'use client';

import { ATTENDANCE_SESSION_MAX_MINUTES } from '@lasuatos/contracts';
import { BarChart3, KeyRound, LockKeyhole, Plus, QrCode, ScanLine } from 'lucide-react';
import { useMemo, useState } from 'react';
import { closeAttendanceSession, rotateAttendanceCode, updateAttendanceSessionSettings } from '../../lib/attendance-api';
import { formatClock } from '../../lib/lecture-api';
import { peekResource, primeResource, useResource } from '../../lib/resource';
import { haptic } from '../../lib/use-live';
import { Badge, Button, EmptyState, Menu, PageHeader, SegmentedControl } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { remainingLabel, whenLine } from '../take-attendance/format';
import { useClock, useToday } from '../take-attendance/hooks';
import { detailKey, loadDetail, primeSession, recalledCode, rememberCode, SESSIONS_KEY, type TypedCode } from './data';
import { canExtend, EXTEND_MINUTES, presentRate, problemText, roster, withSession, type CourseSession, type SessionDetail } from './model';
import { Roster } from './roster';
import { Stage } from './stage';
import '../take-attendance/take.css';
import './course-sessions.css';

const LIST = '/lecturer/attendance';
const BACK = { href: LIST, label: 'Sessions' };
type Tab = 'qr' | 'students' | 'absent';

const whileOpen = (detail: SessionDetail) => detail.session.status === 'open';

/**
 * One class of an enrolled course: the QR code students scan while it is open, who has checked
 * in and who has not (live, every 4 seconds), and the corrections a lecturer makes with a reason.
 */
export function CourseSessionScreen({ sessionId }: Readonly<{ sessionId: string }>) {
  const loader = useMemo(() => loadDetail(sessionId), [sessionId]);
  const resource = useResource<SessionDetail>(detailKey(sessionId), loader, { maxAge: 0, poll: 4_000, pollWhile: whileOpen });
  // Drawn from the list at once while the names load.
  const [summary] = useState(() => peekResource<readonly CourseSession[]>(SESSIONS_KEY)?.find((item) => item.id === sessionId) ?? null);
  const detail: SessionDetail | null = resource.data ?? (summary ? { session: summary, attendees: [], notCheckedIn: [] } : null);

  if (!detail) {
    return resource.error ? (
      <div className="tk-page cs-page">
        <PageHeader back={BACK} title="Class" />
        <div className="ds-card">
          <EmptyState error title="This class isn’t available" message={resource.error} action={<Button href={LIST} variant="gray">All sessions</Button>} />
        </div>
      </div>
    ) : <SessionBones />;
  }
  return <SessionReady detail={detail} loading={!resource.data} error={resource.error} reload={resource.reload} />;
}

function SessionBones() {
  return (
    <div className="tk-page cs-page" role="status" aria-label="Opening the class">
      <PageHeader back={BACK} title={<span className="ds-skeleton tk-bone-title" />} />
      <div className="tk-session-grid">
        <div className="tk-stage is-bone"><span className="ds-skeleton tk-qr-bone" /></div>
      </div>
    </div>
  );
}

function SessionReady({ detail, loading, error, reload }: Readonly<{
  detail: SessionDetail;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
}>) {
  const { session } = detail;
  const open = session.status === 'open';
  const feedback = useFeedback();
  const today = useToday();
  const now = useClock('fifteen');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(open ? 'qr' : 'students');
  const [typed, setTyped] = useState<TypedCode | null>(() => recalledCode(session.id));
  const counts = roster(detail);
  const classSize = loading ? null : counts.classSize;
  const left = open && now ? remainingLabel(session.endsAt, new Date(now)) : null;
  const extendable = canExtend(session, ATTENDANCE_SESSION_MAX_MINUTES);
  // Phones show one panel at a time; the QR code only while attendance is open.
  const activeTab: Tab = !open && tab === 'qr' ? 'students' : tab;

  function changed(updated: CourseSession) {
    const next = { ...detail, session: { ...detail.session, ...updated, sharedDeviceCount: detail.session.sharedDeviceCount } };
    primeSession(next);
    const list = peekResource<readonly CourseSession[]>(SESSIONS_KEY);
    if (list) primeResource(SESSIONS_KEY, withSession(list, next.session));
    reload();
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (caught) {
      feedback.toast(problemText(caught, 'That did not work. Check your connection and try again.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function newCode() {
    if (typed) {
      const sure = await feedback.confirm({
        title: 'Show a new code to type?',
        body: `${typed.code.slice(0, 4)}… stops working at once. Students who already checked in stay on the list.`,
        confirmLabel: 'New code',
      });
      if (!sure) return;
    }
    await run(async () => {
      const result = await rotateAttendanceCode(session.id);
      const code = { code: result.code, expiresAt: result.expiresAt };
      rememberCode(session.id, code);
      setTyped(code);
      haptic(12);
    });
  }

  function toggleQrOnly() {
    void run(async () => {
      const result = await updateAttendanceSessionSettings(session.id, { qrOnly: !session.qrOnly });
      changed(result.session);
      feedback.toast(result.session.qrOnly ? 'QR code only: typed codes are refused now.' : 'Students can type the code again.');
    });
  }

  function extend() {
    void run(async () => {
      const result = await updateAttendanceSessionSettings(session.id, { extendMinutes: EXTEND_MINUTES });
      changed(result.session);
      feedback.toast(`Open until ${formatClock(result.session.endsAt)}.`);
    });
  }

  async function closeNow() {
    const sure = await feedback.confirm({
      title: 'Close attendance now?',
      body: 'Students can no longer check in, and it cannot be reopened. You can still mark someone present afterwards, with a reason.',
      confirmLabel: 'Close attendance',
      tone: 'danger',
    });
    if (!sure) return;
    await run(async () => {
      await closeAttendanceSession(session.id);
      changed({ ...session, status: 'closed', closedAt: new Date().toISOString() });
      setTab('students');
      feedback.toast('Attendance closed.');
    });
  }

  const meta = [whenLine(session.startsAt, session.endsAt, today), session.venueName].filter(Boolean).join(' · ');
  const ended = session.closedAt ? `Closed at ${formatClock(session.closedAt)}` : `Ended at ${formatClock(session.endsAt)}`;

  return (
    <div className="tk-page tk-session cs-page" data-tab={activeTab}>
      <PageHeader
        back={BACK}
        eyebrow={`${session.courseCode} · ${session.title}`}
        title={session.courseTitle}
        subtitle={meta}
        actions={(
          <div className="tk-head-actions">
            <GuideButton page={LIST} label="Course sessions" />
            {open ? (
              <Menu
                label="Class actions"
                title={`${session.courseCode} · ${session.title}`}
                items={[
                  {
                    label: session.qrOnly ? 'Let students type the code' : 'QR code only',
                    icon: session.qrOnly ? <KeyRound size={17} aria-hidden="true" /> : <ScanLine size={17} aria-hidden="true" />,
                    disabled: busy,
                    onSelect: toggleQrOnly,
                  },
                  !session.qrOnly && {
                    label: typed ? 'New code to type' : 'Show a code to type',
                    icon: <KeyRound size={17} aria-hidden="true" />,
                    disabled: busy,
                    onSelect: () => void newCode(),
                  },
                  extendable && { label: `${EXTEND_MINUTES} more minutes`, icon: <Plus size={17} aria-hidden="true" />, disabled: busy, onSelect: extend },
                  { label: 'Close attendance', icon: <LockKeyhole size={17} aria-hidden="true" />, destructive: true, disabled: busy, onSelect: () => void closeNow() },
                ]}
              />
            ) : null}
          </div>
        )}
      />

      <div className="tk-status">
        {open ? <Badge tone="success" dot>{left ? `Live · ${left}` : 'Live'}</Badge> : <Badge tone="neutral">{ended}</Badge>}
        {open && session.qrOnly ? <Badge tone="tint">QR code only</Badge> : null}
        {session.locationRequired ? <Badge tone="tint">Room checked</Badge> : null}
      </div>

      {error && !loading ? <p className="tk-error" role="alert">{error}</p> : null}

      <div className="tk-tabs">
        <SegmentedControl
          block
          label="Show"
          value={activeTab}
          onChange={setTab}
          segments={[
            ...(open ? [{ value: 'qr' as const, label: 'QR code' }] : []),
            { value: 'students' as const, label: `Present ${counts.present.length.toLocaleString('en-NG')}` },
            { value: 'absent' as const, label: `${open ? 'Not yet' : 'Absent'}${loading ? '' : ` ${counts.absent.length.toLocaleString('en-NG')}`}` },
          ]}
        />
      </div>

      <div className="tk-session-grid">
        <div className="tk-lead">
          {open ? (
            <div className="tk-panel" data-panel="qr">
              <Stage
                session={session}
                present={counts.present.length}
                classSize={classSize}
                typed={typed}
                busy={busy}
                canExtend={extendable}
                onNewCode={() => void newCode()}
                onExtend={extend}
                onClose={() => void closeNow()}
              />
            </div>
          ) : (
            <Summary detail={detail} loading={loading} />
          )}
        </div>
        <div className="tk-side">
          <Roster session={session} attendees={detail.attendees} absent={detail.notCheckedIn} loading={loading} onChanged={reload} />
        </div>
      </div>
    </div>
  );
}

/** After class: the numbers that matter, and where to go next. */
function Summary({ detail, loading }: Readonly<{ detail: SessionDetail; loading: boolean }>) {
  const { session } = detail;
  const counts = roster(detail);
  const rate = loading ? null : presentRate(counts.present.length, counts.classSize);
  const value = (count: number) => (loading ? '–' : count.toLocaleString('en-NG'));
  return (
    <section className="tk-stage-section" aria-labelledby="cs-summary-title">
      <div className="tk-section-head">
        <h2 className="tk-section-title" id="cs-summary-title">Summary</h2>
        {rate !== null ? <span className="tk-stage-timer">{rate}% present</span> : null}
      </div>
      <div className="tk-closed">
        <dl className="tk-closed-stats">
          <div><dt>Present</dt><dd>{loading ? value(session.attendanceCount) : value(counts.present.length)}</dd></div>
          <div><dt>Absent</dt><dd>{value(counts.absent.length)}</dd></div>
          <div className={counts.flagged ? 'is-warning' : undefined}><dt>Flagged</dt><dd>{value(counts.flagged)}</dd></div>
        </dl>
        {rate !== null ? (
          <div className="cs-meter" role="img" aria-label={`${rate}% of the class checked in`}>
            <span style={{ width: `${rate}%` }} />
          </div>
        ) : null}
        <p className="tk-quiet">Missed someone? Open their name under Absent to mark them present.</p>
        <div className="tk-sheet-actions is-row">
          <Button variant="gray" block href={`/lecturer/reports?courseOfferingId=${session.courseOfferingId}`} icon={<BarChart3 size={18} strokeWidth={2.1} aria-hidden="true" />}>Report</Button>
          <Button variant="tinted" block href={`${LIST}?new=1&courseOfferingId=${session.courseOfferingId}`} icon={<QrCode size={18} strokeWidth={2.1} aria-hidden="true" />}>New class</Button>
        </div>
      </div>
    </section>
  );
}
