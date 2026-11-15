'use client';

import { STAFF_ROLE_LABELS, type StaffDirectory, type StaffInvitation } from '@lasuatos/contracts';
import { AlertTriangle, Mail, Send, X } from 'lucide-react';
import { useState } from 'react';
import { resendStaffInvitation, revokeStaffInvitation } from '../../lib/staff-api';
import { Badge, Button, List, ListRow, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { expiryLine, problem, whenLabel } from './format';

/** One invitation: where it went, when it runs out, and a new link or an end to it. */
export function InvitationSheet({ invitation, now, onClose, onChanged }: Readonly<{
  invitation: StaffInvitation | null;
  now: number;
  onClose: () => void;
  onChanged: (change: (current: StaffDirectory) => StaffDirectory) => void;
}>) {
  return (
    <Sheet open={invitation !== null} onClose={onClose} title={invitation?.displayName ?? ''}>
      {invitation ? <Invitation key={invitation.id} invitation={invitation} now={now} onClose={onClose} onChanged={onChanged} /> : null}
    </Sheet>
  );
}

function Invitation({ invitation, now, onClose, onChanged }: Readonly<{
  invitation: StaffInvitation;
  now: number;
  onClose: () => void;
  onChanged: (change: (current: StaffDirectory) => StaffDirectory) => void;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState<'' | 'resend' | 'revoke'>('');
  const [error, setError] = useState('');
  const [unsent, setUnsent] = useState(false);

  async function resend() {
    setBusy('resend');
    setError('');
    try {
      const { invitation: renewed, emailSent } = await resendStaffInvitation(invitation.id);
      onChanged((current) => ({ ...current, invitations: current.invitations.map((item) => (item.id === renewed.id ? renewed : item)) }));
      if (emailSent) feedback.toast(`A new link was sent to ${invitation.email}.`);
      else setUnsent(true);
    } catch (caught) {
      setError(problem(caught, 'A new link could not be sent. Try again.'));
    } finally {
      setBusy('');
    }
  }

  async function revoke() {
    const sure = await feedback.confirm({
      title: `Revoke ${invitation.displayName}’s invitation?`,
      body: `The link sent to ${invitation.email} stops working. You can invite them again later.`,
      confirmLabel: 'Revoke invitation',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy('revoke');
    setError('');
    try {
      await revokeStaffInvitation(invitation.id);
      onChanged((current) => ({ ...current, invitations: current.invitations.filter((item) => item.id !== invitation.id) }));
      feedback.toast(`${invitation.displayName}’s invitation was revoked.`);
      onClose();
    } catch (caught) {
      setError(problem(caught, 'The invitation could not be revoked. Try again.'));
      setBusy('');
    }
  }

  return (
    <div className="sf-person">
      <div className="sf-person-head">
        <span className="sf-avatar is-large is-icon" aria-hidden="true"><Mail size={24} strokeWidth={1.9} /></span>
        <div className="sf-person-who">
          <p className="sf-person-role">{STAFF_ROLE_LABELS[invitation.role]}</p>
          <p className="sf-person-area">{invitation.scopeLabel}</p>
          <p className="sf-person-badges">
            {invitation.expired ? <Badge tone="warning">Expired</Badge> : <Badge tone="neutral">Waiting to join</Badge>}
          </p>
        </div>
      </div>

      <List label="Invitation">
        <ListRow title="Email" subtitle={<a className="sf-link" href={`mailto:${invitation.email}`}>{invitation.email}</a>} />
        <ListRow title="Sent" detail={`${whenLabel(invitation.sentAt, now)}${invitation.invitedByName ? ` by ${invitation.invitedByName}` : ''}`} />
        <ListRow title={invitation.expired ? 'Link' : 'Link works'} detail={<span className={invitation.expired ? 'sf-warning-text' : undefined}>{expiryLine(invitation, now)}</span>} />
        {invitation.role === 'lecturer' ? <ListRow title="Staff number" detail={invitation.staffNumber ? <span className="ds-mono">{invitation.staffNumber}</span> : 'They can add it'} /> : null}
      </List>

      {unsent ? (
        <p className="sf-note is-warning" role="alert">
          <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
          A new link was made, but the email didn’t send. Check the email settings, then try again.
        </p>
      ) : null}
      {error ? <p className="sf-error" role="alert">{error}</p> : null}

      <div className="sf-actions">
        <Button variant={invitation.expired ? 'filled' : 'tinted'} busy={busy === 'resend'} disabled={Boolean(busy)} onClick={() => void resend()} icon={<Send size={18} strokeWidth={2.1} aria-hidden="true" />}>
          {invitation.expired ? 'Send a new link' : 'Resend'}
        </Button>
        <Button variant="gray" className="sf-danger-text" busy={busy === 'revoke'} disabled={Boolean(busy)} onClick={() => void revoke()} icon={<X size={18} strokeWidth={2.2} aria-hidden="true" />}>
          Revoke
        </Button>
      </div>
    </div>
  );
}
