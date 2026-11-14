'use client';

import type { RetentionPreview, RetentionSet } from '@lasuatos/contracts';
import { CalendarClock, CheckCircle2, Clock3, GraduationCap, ImageOff, ScanFace, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { lookupAdministrator } from '../lib/current-account';
import { failureText } from '../lib/lecture-api';
import { loadRetention, runRetention } from '../lib/student-api';
import { useFeedback } from './feedback';
import { CardGridSkeleton, ListSkeleton } from './ui/skeleton';

const dayFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const stampFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly preview: RetentionPreview };

function plural(count: number, word: string): string {
  return `${count.toLocaleString('en-NG')} ${word}${count === 1 ? '' : 's'}`;
}

function setState(set: RetentionSet, today: string): { label: string; tone: 'due' | 'waiting' | 'done' } {
  if (set.faces === 0) return { label: 'Cleared', tone: 'done' };
  if (set.dueOn <= today && set.dueFaces > 0) return { label: 'Due now', tone: 'due' };
  if (set.dueOn <= today) return { label: 'Kept: still active', tone: 'waiting' };
  return { label: `Due ${dayFormat.format(new Date(`${set.dueOn}T00:00:00Z`))}`, tone: 'waiting' };
}

/**
 * Face data is kept only while it is needed. A set's registered faces are
 * deleted a grace period after its final session (worked out from the entry
 * year in the matric number and the programme length), unless the student
 * still checks in to lectures; check-in photos kept for review go sooner.
 * Accounts and attendance records stay.
 */
export function RetentionWorkspace() {
  const dialogs = useFeedback();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void lookupAdministrator('manage data retention').then(async (session) => {
      if (session.kind === 'error') {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: session.message });
        return;
      }
      try {
        const preview = await loadRetention(controller.signal);
        if (!controller.signal.aborted) setLoad({ kind: 'ready', preview });
      } catch (caught) {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: failureText(caught, 'Data retention could not be loaded.') });
      }
    });
    return () => controller.abort();
  }, [attempt]);

  async function run(preview: RetentionPreview) {
    const { faces, checkPhotos } = preview.due;
    const confirmed = await dialogs.confirm({
      title: 'Delete the data that is due now?',
      body: `${plural(faces, 'registered face')} and ${plural(checkPhotos, 'check-in photo')} will be deleted for good. Accounts, class lists and attendance records stay. Students who come back can register their face again.`,
      confirmLabel: 'Delete now',
      tone: 'danger',
    });
    if (!confirmed) return;
    setRunning(true);
    try {
      const result = await runRetention();
      dialogs.toast(`Deleted ${plural(result.facesDeleted, 'face')} and ${plural(result.checkPhotosDeleted, 'check-in photo')}.`);
      setAttempt((value) => value + 1);
    } catch (caught) {
      dialogs.toast(failureText(caught, 'The clean-up did not run. Try again.'), 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page-stack rt-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">ADMINISTRATION</p>
          <h1>Data retention</h1>
          <p className="page-lede">Face data is deleted once a set has graduated, so LASUATOS keeps it only as long as attendance needs it. Accounts and attendance records are kept.</p>
        </div>
      </section>

      {load.kind === 'loading' ? (
        <>
          <CardGridSkeleton label="Loading data retention…" count={3} />
          <ListSkeleton label="Loading sets…" rows={4} />
        </>
      ) : null}

      {load.kind === 'error' ? (
        <section className="workspace-message" role="alert">
          <span className="workspace-message-icon" aria-hidden="true">!</span>
          <div>
            <h2>Data retention is unavailable</h2>
            <p>{load.message}</p>
            <div className="workspace-message-actions">
              <button className="button button-primary" type="button" onClick={() => { setLoad({ kind: 'loading' }); setAttempt((value) => value + 1); }}>Try again</button>
              <Link className="button button-secondary" href="/admin">Back to administration</Link>
            </div>
          </div>
        </section>
      ) : null}

      {load.kind === 'ready' ? <RetentionReady preview={load.preview} running={running} onRun={() => void run(load.preview)} /> : null}
    </div>
  );
}

function RetentionReady({ preview, running, onRun }: Readonly<{ preview: RetentionPreview; running: boolean; onRun: () => void }>) {
  const { policy, due, lastRun } = preview;
  const today = preview.generatedAt.slice(0, 10);
  const nothingDue = due.faces === 0 && due.checkPhotos === 0;

  return (
    <>
      <section className="rt-rules" aria-label="The rules">
        <article className="cl-card rt-rule">
          <GraduationCap size={20} aria-hidden="true" />
          <strong>{policy.graceMonths} months after graduating</strong>
          <span>A set’s registered faces are deleted this long after its final session ends (from the entry year in the matric number and the programme length).</span>
        </article>
        <article className="cl-card rt-rule">
          <ScanFace size={20} aria-hidden="true" />
          <strong>Unless still checking in</strong>
          <span>A student who checked in during the last {policy.activeWithinDays} days keeps their face (extra year, carry-over courses).</span>
        </article>
        <article className="cl-card rt-rule">
          <ImageOff size={20} aria-hidden="true" />
          <strong>Check-in photos: {policy.checkPhotoDays} days</strong>
          <span>The photo taken at a close face match is kept for review, then deleted.</span>
        </article>
      </section>

      <section className={`cl-card rt-due${nothingDue ? ' is-clear' : ''}`} aria-labelledby="rt-due-heading">
        <div className="rt-due-head">
          {nothingDue ? <CheckCircle2 size={22} aria-hidden="true" /> : <Trash2 size={22} aria-hidden="true" />}
          <div>
            <h2 id="rt-due-heading">{nothingDue ? 'Nothing is due' : 'Due for deletion now'}</h2>
            <p>{nothingDue ? 'All face data kept is still within the rules.' : `${plural(due.faces, 'registered face')} and ${plural(due.checkPhotos, 'check-in photo')}.`}</p>
          </div>
        </div>
        <ul className="rt-facts">
          <li>
            {preview.scheduled ? <CalendarClock size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}
            {preview.scheduled ? 'Runs by itself every night at 3:30 am.' : 'The nightly run is not set up yet (CRON_SECRET), so run it here.'}
          </li>
          <li>
            <ShieldCheck size={15} aria-hidden="true" />
            {lastRun
              ? `Last run ${stampFormat.format(new Date(lastRun.at))}${lastRun.scheduled ? ' (nightly)' : lastRun.actorName ? ` by ${lastRun.actorName}` : ''}: ${plural(lastRun.facesDeleted, 'face')}, ${plural(lastRun.checkPhotosDeleted, 'photo')} deleted.`
              : 'Has not run yet.'}
          </li>
        </ul>
        {preview.canRun ? (
          <button className="button report-danger-button rt-run" type="button" disabled={nothingDue || running} onClick={onRun}>
            <Trash2 size={16} aria-hidden="true" /> {running ? 'Deleting…' : 'Delete what is due now'}
          </button>
        ) : (
          <p className="rt-note">Only institution administrators can run the clean-up.</p>
        )}
      </section>

      <section className="rt-sets" aria-labelledby="rt-sets-heading">
        <h2 id="rt-sets-heading">Sets that have finished</h2>
        {preview.sets.length === 0 ? (
          <div className="fr-empty">
            <GraduationCap size={28} aria-hidden="true" />
            <strong>No set has finished its programme yet</strong>
            <span>Sets appear here once their final session ends.</span>
          </div>
        ) : (
          <ul className="rt-set-list">
            {preview.sets.map((set) => {
              const state = setState(set, today);
              return (
                <li key={`${set.departmentName}-${set.entryYear}`} className={`rt-set is-${state.tone}`}>
                  <div className="rt-set-main">
                    <strong>{set.departmentName}</strong>
                    <span>{set.setLabel} set · {set.programmeYears}-year programme · finished {dayFormat.format(new Date(`${set.finishedOn}T00:00:00Z`))}</span>
                  </div>
                  <span className={`rt-set-state is-${state.tone}`}>{state.label}</span>
                  <dl className="rt-set-counts">
                    <div><dt>Students</dt><dd>{set.students.toLocaleString('en-NG')}</dd></div>
                    <div><dt>Faces kept</dt><dd>{set.faces.toLocaleString('en-NG')}</dd></div>
                    <div><dt>Due</dt><dd>{set.dueFaces.toLocaleString('en-NG')}</dd></div>
                    <div><dt>Still active</dt><dd>{set.keptActive.toLocaleString('en-NG')}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
