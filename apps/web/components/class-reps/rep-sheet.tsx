'use client';

import { CLASS_REP_ACTIVITY_DAYS, type ClassRep } from '@lasuatos/contracts';
import { AlertTriangle, Copy, Repeat2, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { failureText, revokeClassRep } from '../../lib/lecture-api';
import { Badge, Button, List, ListRow, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { initials, plural, shortDate, whenLabel } from '../staff/format';
import { classListHref, isQuiet, listLine, postPlace, ROLE_NAME, type Post } from './format';

/** One rep: their post, how they use the app, how to reach them, and replacing or removing them. */
export function RepSheet({ rep, post, now, onClose, onReplace, onRemoved }: Readonly<{
  rep: ClassRep | null;
  post: Post | null;
  now: number;
  onClose: () => void;
  onReplace: (rep: ClassRep, post: Post) => void;
  onRemoved: (id: string) => void;
}>) {
  // Keep the last rep while the sheet animates closed.
  const [last, setLast] = useState(rep && post ? { rep, post } : null);
  if (rep && post && (rep !== last?.rep || post !== last.post)) setLast({ rep, post });
  const shown = rep && post ? { rep, post } : last;
  return (
    <Sheet open={rep !== null} onClose={onClose} title={shown?.rep.studentName ?? ''}>
      {shown ? <Rep key={shown.rep.id} rep={shown.rep} post={shown.post} now={now} onReplace={onReplace} onRemoved={onRemoved} /> : null}
    </Sheet>
  );
}

function Rep({ rep, post, now, onReplace, onRemoved }: Readonly<{
  rep: ClassRep;
  post: Post;
  now: number;
  onReplace: (rep: ClassRep, post: Post) => void;
  onRemoved: (id: string) => void;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const role = ROLE_NAME[rep.role];
  const quiet = isQuiet(rep, now);
  const others = post.holders.filter((holder) => holder.id !== rep.id);
  const appointedDays = Math.floor((now - Date.parse(rep.appointedAt)) / 86_400_000);

  const copy = () => {
    void navigator.clipboard?.writeText(rep.email).then(
      () => feedback.toast('Email copied.'),
      () => feedback.toast('The email could not be copied.', 'error'),
    );
  };

  async function remove() {
    const sure = await feedback.confirm({
      title: `Remove ${rep.studentName} as ${role}?`,
      body: rep.role === 'ghoc'
        ? 'They can no longer take attendance or appoint HOCs. The HOCs they appointed stay, and their past sessions are kept.'
        : 'They can no longer take attendance or keep the class list. Their past sessions are kept.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy(true);
    try {
      await revokeClassRep(rep.id);
      feedback.toast(`${rep.studentName} is no longer ${role}.`);
      onRemoved(rep.id);
    } catch (caught) {
      feedback.toast(failureText(caught, 'They could not be removed. Try again.'), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="crp-person">
      <div className="crp-person-head">
        <span className="crp-avatar is-large" aria-hidden="true">{initials(rep.studentName)}</span>
        <div className="crp-person-who">
          <p className="crp-person-post">{role}, {rep.role === 'ghoc' ? 'whole faculty' : postPlace(post)}</p>
          <p className="crp-person-area">{rep.setLabel} · {rep.facultyName}</p>
          {quiet ? <p className="crp-person-badges"><Badge tone="warning">Quiet</Badge></p> : null}
        </div>
      </div>

      <dl className="crp-figures">
        <div className={quiet ? 'is-warning' : rep.recentSessions ? 'is-good' : ''}>
          <dt>Sessions</dt>
          <dd>{rep.recentSessions}<small className="crp-figure-note">in {CLASS_REP_ACTIVITY_DAYS} days</small></dd>
        </div>
        <div>
          <dt>Last session</dt>
          <dd>{rep.lastSessionAt ? whenLabel(rep.lastSessionAt, now) : 'None yet'}</dd>
        </div>
        <div>
          <dt>Appointed</dt>
          <dd>{shortDate(rep.appointedAt, now)}</dd>
        </div>
      </dl>

      {quiet ? (
        <p className="crp-note is-warning" role="note">
          <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
          {rep.lastSessionAt
            ? `No attendance taken since ${shortDate(rep.lastSessionAt, now)}. Lecturers may be taking it themselves; check the rep still has their phone and access.`
            : `Appointed ${plural(appointedDays, 'day')} ago and hasn’t taken attendance yet. Lecturers may be taking it themselves; check they can sign in.`}
        </p>
      ) : null}

      <List label="Details">
        <ListRow
          title="Email"
          subtitle={<a className="crp-link" href={`mailto:${rep.email}`}>{rep.email}</a>}
          trailing={(
            <button className="ds-icon-btn" type="button" onClick={copy} aria-label="Copy email" data-tip="Copy email">
              <Copy size={16} strokeWidth={2.1} aria-hidden="true" />
            </button>
          )}
        />
        <ListRow title="Matric number" detail={<span className="ds-mono">{rep.matricNumber || 'Not recorded'}</span>} />
        <ListRow title="Appointed by" detail={rep.appointedByName} />
        <ListRow title="Class list" subtitle={listLine(post)} href={classListHref(post)} />
      </List>

      {others.length ? (
        <p className="crp-note" role="note">
          Shares this post with {others.map((holder) => holder.studentName).join(' and ')}.
        </p>
      ) : null}

      {post.canAppoint ? (
        <div className="crp-actions">
          <Button variant="tinted" icon={<Repeat2 size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => onReplace(rep, post)}>Replace</Button>
          <Button variant="gray" className="crp-danger-text" busy={busy} icon={<UserRoundX size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => void remove()}>Remove</Button>
        </div>
      ) : null}
    </div>
  );
}
