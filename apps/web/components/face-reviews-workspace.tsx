'use client';

import type { FaceReviewItem, FaceReviewList } from '@lasuatos/contracts';
import { Check, ScanFace, ShieldAlert, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { decideFaceReview, failureText, faceReviewPhotoUrl, formatClock, formatShortDay, loadFaceReviews } from '../lib/lecture-api';
import { useFeedback } from './feedback';
import { AccessMessage, useTakerAccess } from './lecture-sessions';
import { SessionsTabs } from './sessions-tabs';
import { Bone, SkeletonRegion } from './ui/skeleton';

type Tab = 'pending' | 'reviewed';

/** The score of a clear match (kept in step with the API's FACE_LIMITS.clearMatch). */
const FACE_MATCH_CLEAR = 0.6;

const STATUS_LABEL: Record<FaceReviewItem['status'], string> = {
  pending: 'To review',
  approved: 'Approved',
  rejected: 'Rejected · removed',
  removed: 'Removed from the list',
};

/** Check-ins whose face matched, but not clearly: compare and approve or reject. */
export function FaceReviewsWorkspace() {
  const { access, retry } = useTakerAccess();
  if (access.kind !== 'ready') return <AccessMessage access={access} retry={retry} />;
  const role = access.capabilities.role;
  if (role !== 'lecturer' && role !== 'administrator') {
    return (
      <section className="workspace-message" role="status">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>Face checks are reviewed by lecturers</h2>
          <p>When a classmate’s face matched only loosely, the lecturer or an administrator compares the photos. Class reps see the flag on the session list.</p>
          <div className="workspace-message-actions">
            <Link className="button button-primary" href="/sessions">Back to sessions</Link>
          </div>
        </div>
      </section>
    );
  }
  return <FaceReviewsReady />;
}

function ReviewSkeleton() {
  return (
    <SkeletonRegion label="Loading face checks…" className="fr-list">
      {[0, 1, 2].map((index) => (
        <div className="fr-card" key={index}>
          <div className="fr-photos">
            <Bone className="fr-photo-bone" />
            <Bone className="fr-photo-bone" />
          </div>
          <div className="fr-body">
            <Bone width="52%" height={18} />
            <Bone width="34%" height={12} />
            <Bone width="70%" height={12} />
            <Bone width={180} height={40} style={{ marginTop: 8, borderRadius: 10 }} />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

function FaceReviewsReady() {
  const [tab, setTab] = useState<Tab>('pending');
  const [list, setList] = useState<FaceReviewList | null>(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);
  const dialogs = useFeedback();

  useEffect(() => {
    const controller = new AbortController();
    loadFaceReviews({ status: tab }, controller.signal)
      .then((result) => {
        setList(result);
        setError('');
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(failureText(caught, 'The face checks could not be loaded. Try again.'));
      });
    return () => controller.abort();
  }, [tab, reload]);

  function switchTab(next: Tab) {
    if (next === tab) return;
    setList(null);
    setError('');
    setTab(next);
  }

  async function loadMore() {
    if (!list?.nextCursor) return;
    setLoadingMore(true);
    try {
      const more = await loadFaceReviews({ status: tab, cursor: list.nextCursor });
      setList((current) => (current ? { ...more, items: [...current.items, ...more.items] } : more));
    } catch (caught) {
      dialogs.toast(failureText(caught), 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  async function decide(item: FaceReviewItem, decision: 'approve' | 'reject') {
    let note: string | undefined;
    if (decision === 'reject') {
      const answer = await dialogs.prompt({
        title: `Reject ${item.studentName}’s check-in?`,
        body: `${item.matricNumber} is removed from ${item.courseCode} on ${formatShortDay(item.sessionStartsAt)}. They can see it was removed and speak to you.`,
        label: 'Reason',
        defaultValue: 'Not the same person',
        suggestions: ['Not the same person', 'Photo of a photo or a screen', 'Face hidden or unclear'],
        maxLength: 300,
        confirmLabel: 'Reject and remove',
        tone: 'danger',
      });
      if (answer === null) return;
      if (answer.trim().length < 3) {
        dialogs.toast('Say why the check-in is rejected (at least 3 letters).', 'error');
        return;
      }
      note = answer.trim();
    }
    setBusy(item.id);
    try {
      const updated = await decideFaceReview(item.id, { decision, ...(note ? { note } : {}) });
      dialogs.toast(decision === 'approve' ? `${item.studentName}’s check-in was approved.` : `${item.studentName} was removed from ${item.courseCode}.`);
      setList((current) => current && {
        ...current,
        pendingCount: Math.max(0, current.pendingCount - 1),
        items: tab === 'pending' ? current.items.filter((entry) => entry.id !== item.id) : current.items.map((entry) => (entry.id === item.id ? updated : entry)),
      });
    } catch (caught) {
      dialogs.toast(failureText(caught), 'error');
      setReload((value) => value + 1);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="page-stack lx-page fr-page">
      <section className="page-heading lx-heading">
        <div>
          <p className="page-eyebrow">ATTENDANCE</p>
          <h1>Face checks</h1>
          <p className="page-lede">
            Check-ins where the face matched, but not clearly. They count as present until you decide. Compare the photo taken at check-in
            with the registered photo: approve it, or reject it to remove the student from that class.
          </p>
        </div>
      </section>
      <SessionsTabs active="face-checks" faceChecks />

      <div className="cl-tabs" role="tablist" aria-label="Which face checks">
        <button type="button" role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'is-active' : undefined} onClick={() => switchTab('pending')}>
          <ShieldAlert size={15} aria-hidden="true" /> To review{list && tab === 'pending' ? ` (${list.pendingCount})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'reviewed'} className={tab === 'reviewed' ? 'is-active' : undefined} onClick={() => switchTab('reviewed')}>
          <Check size={15} aria-hidden="true" /> Reviewed
        </button>
      </div>

      {error ? (
        <div className="fr-error" role="alert">
          <p className="lx-error">{error}</p>
          <button className="button button-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button>
        </div>
      ) : null}

      {!list && !error ? <ReviewSkeleton /> : null}

      {list && list.items.length === 0 ? (
        <div className="fr-empty">
          <ScanFace size={30} aria-hidden="true" />
          <strong>{tab === 'pending' ? 'Nothing to review' : 'No reviewed face checks yet'}</strong>
          <span>{tab === 'pending' ? 'Close face matches from your sessions appear here. Clear matches need no review.' : 'Face checks you approve or reject are kept here.'}</span>
        </div>
      ) : null}

      {list && list.items.length > 0 ? (
        <ul className="fr-list">
          {list.items.map((item) => (
            <li className="fr-card" key={item.id}>
              <div className="fr-photos">
                <figure>
                  {item.hasCheckPhoto ? (
                    <img src={faceReviewPhotoUrl(item.id, 'check')} alt={`Photo taken at check-in by ${item.studentName}`} width={150} height={150} loading="lazy" />
                  ) : (
                    <span className="fr-no-photo"><UserRound size={30} aria-hidden="true" /><small>No longer kept</small></span>
                  )}
                  <figcaption>At check-in</figcaption>
                </figure>
                <figure>
                  {item.hasRegisteredPhoto ? (
                    <img src={faceReviewPhotoUrl(item.id, 'registered')} alt={`Registered photo of ${item.studentName}`} width={150} height={150} loading="lazy" />
                  ) : (
                    <span className="fr-no-photo"><UserRound size={30} aria-hidden="true" /><small>Not registered</small></span>
                  )}
                  <figcaption>Registered</figcaption>
                </figure>
              </div>
              <div className="fr-body">
                <div className="fr-title">
                  <strong>{item.studentName}</strong>
                  <span className={`lx-flag fr-status is-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                </div>
                <span className="fr-matric">{item.matricNumber}</span>
                <span className="fr-meta">
                  <Link href={`/sessions/${item.sessionId}`}>{item.courseCode}</Link> · {formatShortDay(item.sessionStartsAt)} · checked in {formatClock(item.checkedInAt)}
                  {item.takenBy ? ` · taken by ${item.takenBy}` : ''}
                </span>
                <span className="fr-score">
                  Match score {item.score.toFixed(2)} <small>(a clear match is {FACE_MATCH_CLEAR.toFixed(2)} or more)</small>
                </span>
                {item.status !== 'pending' && item.reviewedByName ? (
                  <span className="fr-meta">
                    {item.status === 'approved' ? 'Approved' : 'Rejected'} by {item.reviewedByName}{item.reviewedAt ? ` · ${formatShortDay(item.reviewedAt)} ${formatClock(item.reviewedAt)}` : ''}
                    {item.reviewNote ? ` · “${item.reviewNote}”` : ''}
                  </span>
                ) : null}
                {item.status === 'pending' ? (
                  <div className="fr-actions">
                    <button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void decide(item, 'approve')}>
                      <Check size={16} aria-hidden="true" /> {busy === item.id ? 'Saving…' : 'Same person'}
                    </button>
                    <button className="button button-secondary fr-reject" type="button" disabled={Boolean(busy)} onClick={() => void decide(item, 'reject')}>
                      <X size={16} aria-hidden="true" /> Not the same
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {list?.nextCursor ? (
        <button className="button button-secondary lx-load-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
      <p className="lx-fine">Check-in photos are kept only for close matches, and deleted automatically after a set time.</p>
    </div>
  );
}
