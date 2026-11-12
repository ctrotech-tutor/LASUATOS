'use client';

import {
  STAFF_ROLE_LABELS,
  type StaffDirectory,
  type StaffInvitation,
  type StaffMember,
  type StaffRole,
  type StaffScopeOptions,
} from '@lasuatos/contracts';
import { ArrowLeft, MailPlus, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { ApiFailure } from '../lib/course-api';
import { lookupAdministrator } from '../lib/current-account';
import {
  changeStaffStatus,
  inviteStaff,
  loadStaffDirectory,
  loadStaffOptions,
  resendStaffInvitation,
  revokeStaffInvitation,
} from '../lib/staff-api';
import { useFeedback } from './feedback';
import { Select } from './ui/select';

const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
const formatDate = (value: string) => dateTime.format(new Date(value));

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly adminName: string;
      readonly scopeLabel: string;
      readonly institutionName: string;
      readonly directory: StaffDirectory;
      readonly options: StaffScopeOptions;
    };

interface Feedback { readonly kind: 'success' | 'error'; readonly text: string }

function failureMessage(caught: unknown, fallback: string): string {
  if (caught && typeof caught === 'object' && 'message' in caught && typeof (caught as ApiFailure).message === 'string') {
    return (caught as ApiFailure).message;
  }
  return fallback;
}

const emptyForm = { email: '', displayName: '', role: '' as StaffRole | '', facultyId: '', departmentId: '', staffNumber: '' };

export function StaffWorkspace() {
  const dialogs = useFeedback();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState('');
  const [statusTarget, setStatusTarget] = useState<{ member: StaffMember; reason: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void lookupAdministrator('manage staff')
      .then(async (session) => {
        if (session.kind === 'error') {
          if (!signal.aborted) setState({ kind: 'error', message: session.message });
          return;
        }
        const account = session.account;
        const [directory, options] = await Promise.all([loadStaffDirectory(signal), loadStaffOptions(signal)]);
        if (signal.aborted) return;
        setState({
          kind: 'ready',
          adminName: account.displayName,
          scopeLabel: account.scope.label,
          institutionName: account.institutionName,
          directory,
          options,
        });
      })
      .catch((caught: unknown) => {
        if (signal.aborted) return;
        setState({ kind: 'error', message: failureMessage(caught, 'Staff management is temporarily unavailable.') });
      });
    return () => controller.abort();
  }, [reloadKey]);

  const refresh = () => setReloadKey((key) => key + 1);

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.role) return;
    setBusy('invite');
    setFeedback(null);
    try {
      const { invitation, emailSent } = await inviteStaff({
        email: form.email,
        displayName: form.displayName,
        role: form.role,
        facultyId: form.role === 'faculty_administrator' ? form.facultyId || null : null,
        departmentId: form.role === 'lecturer' || form.role === 'department_administrator' ? form.departmentId || null : null,
        staffNumber: form.role === 'lecturer' ? form.staffNumber || null : null,
      });
      setFeedback({
        kind: emailSent ? 'success' : 'error',
        text: emailSent
          ? `Invitation sent to ${invitation.email}. The link works once and expires ${formatDate(invitation.expiresAt)}.`
          : `The invitation for ${invitation.email} was saved, but the email could not be sent. Check the email settings, then use Resend.`,
      });
      setForm(emptyForm);
      refresh();
    } catch (caught) {
      setFeedback({ kind: 'error', text: failureMessage(caught, 'The invitation could not be created.') });
    } finally {
      setBusy('');
    }
  }

  async function act(key: string, run: () => Promise<string>) {
    setBusy(key);
    setFeedback(null);
    try {
      setFeedback({ kind: 'success', text: await run() });
      refresh();
    } catch (caught) {
      setFeedback({ kind: 'error', text: failureMessage(caught, 'That change could not be made. Refresh and try again.') });
    } finally {
      setBusy('');
    }
  }

  const resend = (invitation: StaffInvitation) => act(`resend:${invitation.id}`, async () => {
    const { emailSent } = await resendStaffInvitation(invitation.id);
    return emailSent
      ? `A new link was sent to ${invitation.email}. The previous link no longer works.`
      : `A new link was created for ${invitation.email}, but the email could not be sent.`;
  });

  const revoke = async (invitation: StaffInvitation) => {
    const sure = await dialogs.confirm({
      title: 'Revoke this invitation?',
      body: `The link sent to ${invitation.email} will stop working. You can invite them again later.`,
      confirmLabel: 'Revoke invitation',
      tone: 'danger',
    });
    if (!sure) return;
    void act(`revoke:${invitation.id}`, async () => {
      await revokeStaffInvitation(invitation.id);
      return `The invitation for ${invitation.email} was revoked.`;
    });
  };

  async function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusTarget) return;
    const { member, reason } = statusTarget;
    const suspend = member.status === 'active';
    await act(`status:${member.userId}`, async () => {
      await changeStaffStatus(member.userId, suspend ? 'suspend' : 'reactivate', reason);
      setStatusTarget(null);
      return suspend
        ? `${member.displayName} was suspended and signed out on every device.`
        : `${member.displayName} was reactivated and can sign in again.`;
    });
  }

  if (state.kind === 'loading') {
    return <section className="workspace-message" aria-live="polite"><div><h2>Loading staff</h2><p>Checking your administrator access.</p></div></section>;
  }

  if (state.kind === 'error') {
    return (
      <section className="workspace-message" role="alert">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>Staff management is unavailable</h2>
          <p>{state.message}</p>
          <div className="workspace-message-actions">
            <button className="button button-primary" type="button" onClick={() => { setState({ kind: 'loading' }); refresh(); }}>Try again</button>
            <Link className="button button-secondary" href="/admin">Back to administration overview</Link>
          </div>
        </div>
      </section>
    );
  }

  const { directory, options } = state;
  const needsDepartment = form.role === 'lecturer' || form.role === 'department_administrator';
  const pending = directory.invitations;

  return (
    <div className="venue-workspace staff-workspace">
      <div className="venue-workspace-heading">
        <Link className="text-link" href="/admin"><ArrowLeft size={14} aria-hidden="true" /> Administration overview</Link>
        <div className="admin-overview-heading venue-heading-row">
          <div>
            <p className="section-kicker">STAFF · ACCESS</p>
            <h1>Staff</h1>
            <p>
              Invite lecturers and administrators by email. Each person sets their own password from the link,
              which also confirms their email address. You can invite and manage people at or below your own
              level, inside your own area.
            </p>
          </div>
          <span className="admin-live-indicator"><i aria-hidden="true" />Access verified</span>
        </div>
        <div className="admin-scope-card venue-scope-card" aria-label="Staff management scope">
          <div className="admin-scope-symbol"><ShieldCheck size={23} strokeWidth={1.7} aria-hidden="true" /></div>
          <div className="admin-scope-copy">
            <p className="section-kicker">YOUR AREA</p>
            <h2>{state.scopeLabel}</h2>
            <p>{state.institutionName} · You can invite: {options.allowedRoles.map((role) => STAFF_ROLE_LABELS[role]).join(', ')}</p>
          </div>
          <span className="admin-role-tag">{state.adminName}</span>
        </div>
      </div>

      {feedback ? <p className={`venue-feedback venue-feedback-${feedback.kind}`} role="status">{feedback.text}</p> : null}

      <section className="venue-panel" aria-labelledby="staff-invite-heading">
        <div className="venue-panel-heading">
          <MailPlus size={16} aria-hidden="true" />
          <div>
            <h3 id="staff-invite-heading">Invite a staff member</h3>
            <p>The invitation link is emailed to them, works once and expires after 7 days.</p>
          </div>
        </div>
        <form className="venue-form" onSubmit={submitInvite}>
          <div className="venue-form-grid">
            <label>
              Full name
              <input value={form.displayName} maxLength={160} required autoComplete="off"
                onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} />
            </label>
            <label>
              Email address
              <input type="email" value={form.email} maxLength={320} required autoComplete="off"
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label>
              Role
              <Select
                value={form.role}
                required
                placeholder="Choose a role"
                onValueChange={(next) => setForm((current) => ({ ...current, role: next as StaffRole }))}
                options={options.allowedRoles.map((role) => ({ value: role, label: STAFF_ROLE_LABELS[role] }))}
              />
            </label>
            {form.role === 'faculty_administrator' ? (
              <label>
                Faculty
                <Select
                  value={form.facultyId}
                  required
                  placeholder="Choose a faculty"
                  onValueChange={(next) => setForm((current) => ({ ...current, facultyId: next }))}
                  options={options.faculties.map((faculty) => ({ value: faculty.id, label: faculty.name }))}
                />
              </label>
            ) : null}
            {needsDepartment ? (
              <label>
                Department
                <Select
                  value={form.departmentId}
                  required
                  placeholder="Choose a department"
                  onValueChange={(next) => setForm((current) => ({ ...current, departmentId: next }))}
                  options={options.departments.map((department) => ({ value: department.id, label: department.name, description: department.facultyName }))}
                />
              </label>
            ) : null}
            {form.role === 'lecturer' ? (
              <label>
                Staff number
                <input value={form.staffNumber} maxLength={64} required autoComplete="off"
                  onChange={(event) => setForm((current) => ({ ...current, staffNumber: event.target.value }))} />
              </label>
            ) : null}
          </div>
          <div className="venue-form-actions">
            <button className="button button-primary" type="submit" disabled={busy === 'invite'}>
              {busy === 'invite' ? 'Sending invitation' : 'Send invitation'}
            </button>
            <span className="venue-field-hint">Lecturers are still assigned to courses from the course tools after they join.</span>
          </div>
        </form>
      </section>

      <section className="venue-panel" aria-labelledby="staff-pending-heading">
        <div className="venue-panel-heading">
          <MailPlus size={16} aria-hidden="true" />
          <div>
            <h3 id="staff-pending-heading">Pending invitations ({pending.length})</h3>
            <p>Resending creates a new link and the old one stops working. Expired invitations can be resent.</p>
          </div>
        </div>
        {pending.length ? (
          <ul className="staff-list">
            {pending.map((invitation) => (
              <li key={invitation.id} className="staff-row">
                <div className="staff-row-main">
                  <strong>{invitation.displayName}</strong>
                  <span className={`venue-status ${invitation.expired ? 'venue-status-inactive' : 'venue-status-active'}`}>
                    {invitation.expired ? 'Expired' : 'Pending'}
                  </span>
                  <span className="venue-list-subtitle">{invitation.email} · {STAFF_ROLE_LABELS[invitation.role]} · {invitation.scopeLabel}</span>
                  <span className="venue-list-meta">
                    Sent {formatDate(invitation.sentAt)}{invitation.invitedByName ? ` by ${invitation.invitedByName}` : ' by the server bootstrap command'}
                    {' · '}{invitation.expired ? 'expired' : 'expires'} {formatDate(invitation.expiresAt)}
                  </span>
                </div>
                <div className="staff-row-actions">
                  <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void resend(invitation)}>Resend</button>
                  <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => revoke(invitation)}>Revoke</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="venue-empty">No pending invitations.</p>}
      </section>

      <section className="venue-panel" aria-labelledby="staff-members-heading">
        <div className="venue-panel-heading">
          <Users size={16} aria-hidden="true" />
          <div>
            <h3 id="staff-members-heading">Staff in your area ({directory.members.length})</h3>
            <p>Suspending someone signs them out on every device and blocks sign-in until they are reactivated. Every change is recorded with your name and reason.</p>
          </div>
        </div>
        {directory.members.length ? (
          <ul className="staff-list">
            {directory.members.map((member) => (
              <li key={member.userId} className="staff-row">
                <div className="staff-row-main">
                  <strong>{member.displayName}{member.isSelf ? ' (you)' : ''}</strong>
                  <span className={`venue-status ${member.status === 'active' ? 'venue-status-active' : 'venue-status-inactive'}`}>
                    {member.status === 'active' ? 'Active' : 'Suspended'}
                  </span>
                  <span className="venue-list-subtitle">
                    {member.email} · {STAFF_ROLE_LABELS[member.role]} · {member.scopeLabel}{member.staffNumber ? ` · ${member.staffNumber}` : ''}
                  </span>
                  <span className="venue-list-meta">Joined {formatDate(member.joinedAt)}</span>
                </div>
                {member.manageable ? (
                  <div className="staff-row-actions">
                    <button className="button button-secondary" type="button" disabled={Boolean(busy)}
                      onClick={() => setStatusTarget({ member, reason: '' })}>
                      {member.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </div>
                ) : null}
                {statusTarget?.member.userId === member.userId ? (
                  <form className="staff-status-form" onSubmit={(event) => void submitStatus(event)}>
                    <label>
                      Reason ({member.status === 'active' ? 'suspension' : 'reactivation'}, 10–500 characters, recorded in the audit log)
                      <textarea value={statusTarget.reason} minLength={10} maxLength={500} required rows={2}
                        onChange={(event) => setStatusTarget({ member, reason: event.target.value })} />
                    </label>
                    <div className="venue-form-actions">
                      <button className="button button-primary" type="submit" disabled={busy === `status:${member.userId}` || statusTarget.reason.trim().length < 10}>
                        {member.status === 'active' ? 'Suspend and sign out everywhere' : 'Reactivate account'}
                      </button>
                      <button className="button button-secondary" type="button" onClick={() => setStatusTarget(null)}>Cancel</button>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="venue-empty">No staff yet. Invitations appear here once accepted.</p>}
      </section>
    </div>
  );
}
