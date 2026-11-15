'use client';

import { STAFF_ACTIVITY_DAYS, type StaffDirectory, type StaffInvitation, type StaffMember } from '@lasuatos/contracts';
import { ChevronRight, Mail, UserPlus, Users } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAccount } from '../../lib/current-account';
import { primeResource, staleResources, useResource } from '../../lib/resource';
import { loadStaffDirectory, loadStaffOptions } from '../../lib/staff-api';
import { Badge, Button, EmptyState, PageHeader, SegmentedControl, Stat, Stats } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { Select } from '../ui/select';
import { SearchField } from '../ui/search-field';
import {
  applyFilter,
  countStaff,
  DIRECTORY_KEY,
  expiryLine,
  FILTER_LABEL,
  FILTERS,
  groupMembers,
  initials,
  isQuiet,
  matches,
  ROLE_SHORT,
  roleLine,
  sessionsLine,
  sortInvitations,
  splitArea,
  whenLabel,
  type Filter,
} from './format';
import { InvitationSheet } from './invitation-sheet';
import { InviteSheet } from './invite-sheet';
import { PersonSheet } from './person-sheet';
import './staff.css';

const OPTIONS_KEY = 'admin:staff-options';
const SEARCH_FROM = 8;

type Show = 'staff' | 'invited';

/** Staff: everyone who can sign in to run attendance or administer, and who is still to join. */
export function Staff() {
  const account = useCurrentAccount();
  if (account === undefined) return <div className="sf"><Header /><ListSkeleton /></div>;
  if (account === null || account.accountType !== 'administrator') {
    return (
      <div className="sf">
        <PageHeader title="Staff" />
        <div className="ds-card">
          <EmptyState
            icon={<Users size={26} strokeWidth={1.9} />}
            title="Administrators manage staff"
            message="Ask an administrator in your department or faculty to invite someone or change their access."
            action={<Button href="/" variant="tinted">Go home</Button>}
          />
        </div>
      </div>
    );
  }
  return <Directory />;
}

function Header({ onInvite }: Readonly<{ onInvite?: () => void }>) {
  return (
    <PageHeader
      title="Staff"
      actions={(
        <div className="sf-head-actions">
          {onInvite ? <Button onClick={onInvite} icon={<UserPlus size={18} strokeWidth={2.2} aria-hidden="true" />}>Invite</Button> : null}
          <GuideButton page="/admin/staff" label="Staff" />
        </div>
      )}
    />
  );
}

function Directory() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useClock('fifteen');
  const directory = useResource(DIRECTORY_KEY, loadStaffDirectory, { maxAge: 30_000 });
  const options = useResource(OPTIONS_KEY, loadStaffOptions, { maxAge: 300_000 });

  const show: Show = params?.get('show') === 'invited' ? 'invited' : 'staff';
  const rawFilter = params?.get('filter');
  const filter: Filter = FILTERS.includes(rawFilter as Filter) ? rawFilter as Filter : 'all';
  const [query, setQuery] = useState('');
  const [personId, setPersonId] = useState<string | null>(null);
  const [invitationId, setInvitationId] = useState<string | null>(null);
  const [inviting, setInviting] = useState<false | 'tap' | 'link'>(false);

  function setParams(next: { show?: Show; filter?: Filter }) {
    const search = new URLSearchParams(params?.toString() ?? '');
    const nextShow = next.show ?? show;
    const nextFilter = next.filter ?? filter;
    search.delete('invite');
    if (nextShow === 'invited') search.set('show', 'invited'); else search.delete('show');
    if (nextFilter !== 'all') search.set('filter', nextFilter); else search.delete('filter');
    const text = search.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  // /admin/staff?invite=1 (from the overview's setup step) opens the invite sheet once.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || params?.get('invite') !== '1') return undefined;
    opened.current = true;
    const timer = window.setTimeout(() => setInviting('link'));
    return () => window.clearTimeout(timer);
  }, [params]);

  const data = directory.data;
  const members = useMemo(() => data?.members ?? [], [data]);
  const invitations = useMemo(() => sortInvitations(data?.invitations ?? []), [data]);
  const counts = useMemo(() => countStaff(members, now), [members, now]);
  const shownMembers = useMemo(() => applyFilter(members, filter, now).filter((member) => matches(member, query)), [members, filter, now, query]);
  const groups = useMemo(() => groupMembers(shownMembers), [shownMembers]);
  const shownInvitations = useMemo(() => invitations.filter((invitation) => matches(invitation, query)), [invitations, query]);

  /** Shows a change at once, then asks the server for the full picture. */
  function patch(change: (current: StaffDirectory) => StaffDirectory) {
    if (data) primeResource(DIRECTORY_KEY, change(data));
    staleResources('admin:');
    directory.reload();
  }

  const person = members.find((member) => member.userId === personId) ?? null;
  const invitation = invitations.find((item) => item.id === invitationId) ?? null;
  const header = <Header onInvite={() => setInviting('tap')} />;

  if (!data) {
    return (
      <div className="sf">
        {header}
        {directory.error ? (
          <div className="ds-card">
            <EmptyState error title="Staff did not load" message={directory.error} action={<Button variant="tinted" onClick={directory.reload}>Try again</Button>} />
          </div>
        ) : <ListSkeleton />}
      </div>
    );
  }

  const expired = invitations.filter((item) => item.expired).length;
  const filterOptions = FILTERS.filter((value) => {
    if (value === 'all' || value === filter) return true;
    if (value === 'lecturers') return counts.lecturers > 0 && counts.admins > 0;
    if (value === 'admins') return counts.admins > 0 && counts.lecturers > 0;
    if (value === 'quiet') return counts.quiet > 0;
    return counts.suspended > 0;
  });
  const filterCount = (value: Filter) => (value === 'all' ? members.length : applyFilter(members, value, now).length);
  const searchable = members.length + invitations.length >= SEARCH_FROM;

  return (
    <div className="sf">
      {header}

      <div className="sf-tabs">
        <SegmentedControl
          label="Show"
          value={show}
          onChange={(value) => setParams({ show: value })}
          segments={[
            { value: 'staff', label: <>Staff <span className="sf-count">{members.length}</span></> },
            { value: 'invited', label: <>Invited <span className="sf-count">{invitations.length}</span></> },
          ]}
        />
      </div>

      {show === 'staff' ? (
        <>
          {counts.lecturers > 0 ? (
            <Stats label="Lecturers at a glance">
              <Stat label="Lecturers" value={counts.lecturers} hint={counts.admins ? `and ${counts.admins} admin${counts.admins === 1 ? '' : 's'}` : undefined} />
              <Stat label="Taking attendance" value={counts.active} hint={`in the last ${STAFF_ACTIVITY_DAYS} days`} tone={counts.active > 0 ? 'success' : undefined} />
              <Stat label="No sessions" value={counts.quiet} hint={`in ${STAFF_ACTIVITY_DAYS} days, joined over a week ago`} tone={counts.quiet > 0 ? 'warning' : undefined} />
              <Stat label="Invited" value={invitations.length} hint={expired ? `${expired} expired` : 'waiting to join'} tone={expired ? 'warning' : undefined} />
            </Stats>
          ) : null}

          {searchable || filterOptions.length > 1 ? (
            <div className="sf-tools">
              {searchable ? <SearchField className="sf-find" value={query} onValueChange={setQuery} placeholder="Name, email or staff number" aria-label="Find staff" /> : null}
              {filterOptions.length > 1 ? (
                <label className="sf-filter">
                  <span className="sr-only">Show</span>
                  <Select
                    value={filter}
                    onValueChange={(value) => setParams({ filter: value as Filter })}
                    options={filterOptions.map((value) => { const n = filterCount(value); return { value, label: FILTER_LABEL[value], description: `${n} ${n === 1 ? 'person' : 'people'}` }; })}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {members.length === 0 ? (
            <div className="ds-card">
              <EmptyState
                icon={<Users size={26} strokeWidth={1.9} />}
                title="No staff yet"
                message="People appear here once they accept their invitation."
                action={<Button onClick={() => setInviting('tap')}>Invite someone</Button>}
              />
            </div>
          ) : groups.length === 0 ? (
            <p className="sf-quiet" role="status">{query.trim() ? `No one matches “${query.trim()}”.` : `No one is ${filter === 'suspended' ? 'suspended' : 'in this list'}.`}</p>
          ) : (
            <>
              {groups.map((group, index) => (
                <section key={group.key} className="ds-section" aria-labelledby={`sf-${group.key}`}>
                  <div className="ds-section-head">
                    <h2 className="ds-section-title" id={`sf-${group.key}`}>{group.title}</h2>
                    <span className="ds-section-aside">{group.aside ? <span className="sf-aside-area">{group.aside} · </span> : null}{group.members.length}</span>
                  </div>
                  {index === 0 ? (
                    <div className="sf-columns" aria-hidden="true">
                      <span>Name</span><span>Staff no. or role</span><span>Sessions</span><span>Last active</span>
                    </div>
                  ) : null}
                  <ul className="ds-list sf-list">
                    {group.members.map((member) => <MemberRow key={member.userId} member={member} now={now} onOpen={() => setPersonId(member.userId)} />)}
                  </ul>
                </section>
              ))}
            </>
          )}
        </>
      ) : invitations.length === 0 ? (
        <div className="ds-card">
          <EmptyState
            icon={<Mail size={26} strokeWidth={1.9} />}
            title="No one is waiting to join"
            message="When you invite someone, they show here until they set their password."
            action={<Button onClick={() => setInviting('tap')}>Invite someone</Button>}
          />
        </div>
      ) : (
        <>
          {searchable ? <div className="sf-tools"><SearchField className="sf-find" value={query} onValueChange={setQuery} placeholder="Name or email" aria-label="Find an invitation" /></div> : null}
          {shownInvitations.length ? (
            <section className="ds-section" aria-labelledby="sf-invited">
              <div className="ds-section-head">
                <h2 className="ds-section-title" id="sf-invited">Waiting to join</h2>
                <span className="ds-section-aside">{expired ? `${expired} expired` : 'Links last 7 days'}</span>
              </div>
              <ul className="ds-list sf-list">
                {shownInvitations.map((item) => <InvitationRow key={item.id} invitation={item} now={now} onOpen={() => setInvitationId(item.id)} />)}
              </ul>
            </section>
          ) : <p className="sf-quiet" role="status">No invitation matches “{query.trim()}”.</p>}
        </>
      )}

      <PersonSheet member={person} now={now} onClose={() => setPersonId(null)} onChanged={patch} />
      <InvitationSheet invitation={invitation} now={now} onClose={() => setInvitationId(null)} onChanged={patch} />
      <InviteSheet
        open={inviting !== false}
        focusOnOpen={inviting === 'tap'}
        onClose={() => {
          setInviting(false);
          if (params?.get('invite')) setParams({});
        }}
        options={options.data}
        optionsError={options.error}
        onRetryOptions={options.reload}
        directory={data}
        onInvited={(issued) => patch((current) => ({ ...current, invitations: [issued, ...current.invitations.filter((item) => item.id !== issued.id)] }))}
        onOpenInvitation={(id) => {
          setInviting(false);
          setParams({ show: 'invited' });
          window.setTimeout(() => setInvitationId(id), 0);
        }}
        onOpenPerson={(id) => {
          setInviting(false);
          setParams({ show: 'staff', filter: 'all' });
          window.setTimeout(() => setPersonId(id), 0);
        }}
      />
    </div>
  );
}

function Avatar({ name, off = false, icon }: Readonly<{ name: string; off?: boolean; icon?: React.ReactNode }>) {
  return <span className={`sf-avatar${off ? ' is-off' : ''}${icon ? ' is-icon' : ''}`} aria-hidden="true">{icon ?? initials(name)}</span>;
}

function lowerFirst(text: string): string {
  return /^(Today|Yesterday|Just now)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function RoleArea({ person }: Readonly<{ person: Pick<StaffMember, 'role' | 'scopeLabel'> }>) {
  const area = person.role === 'institution_administrator' ? null : splitArea(person.scopeLabel).name;
  return (
    <span className="sf-col-stack" title={area ? `${ROLE_SHORT[person.role]}, ${area}` : undefined}>
      <span>{ROLE_SHORT[person.role]}</span>
      {area ? <span className="sf-col-sub">{area}</span> : null}
    </span>
  );
}

function MemberRow({ member, now, onOpen }: Readonly<{ member: StaffMember; now: number; onOpen: () => void }>) {
  const lecturer = member.role === 'lecturer';
  const sessions = sessionsLine(member, now);
  const suspended = member.status === 'suspended';
  const narrow = suspended ? (member.lastActiveAt ? `Last active ${lowerFirst(whenLabel(member.lastActiveAt, now))}` : 'Never signed in') : lecturer ? sessions.text : roleLine(member);
  return (
    <li>
      <button className="ds-row sf-row" type="button" onClick={onOpen}>
        <Avatar name={member.displayName} off={suspended} />
        <span className="ds-row-body">
          <span className="ds-row-title sf-name">
            <span className="sf-name-text">{member.displayName}</span>
            {member.isSelf ? <span className="sf-you">You</span> : null}
          </span>
          <span className="ds-row-subtitle sf-email">{member.email}</span>
          <span className={`ds-row-subtitle sf-narrow${lecturer && !suspended ? ` is-${sessions.tone}` : ''}`}>{narrow}</span>
        </span>
        <span className="sf-col sf-col-role">
          {lecturer
            ? member.staffNumber ? <span className="ds-mono">{member.staffNumber}</span> : <span className="sf-muted">No staff number</span>
            : <RoleArea person={member} />}
        </span>
        <span className={`sf-col sf-col-sessions is-${lecturer || member.recentSessions ? sessions.tone : 'none'}`}>
          {lecturer || member.recentSessions ? sessions.text : <span className="sf-muted">—</span>}
        </span>
        <span className="sf-col sf-col-seen"><span className="sr-only">Last active </span>{whenLabel(member.lastActiveAt, now)}</span>
        <span className="sf-trail">
          {suspended ? <Badge tone="danger">Suspended</Badge> : isQuiet(member, now) ? <Badge tone="warning" className="sf-narrow-badge">Quiet</Badge> : null}
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

function InvitationRow({ invitation, now, onOpen }: Readonly<{ invitation: StaffInvitation; now: number; onOpen: () => void }>) {
  return (
    <li>
      <button className="ds-row sf-row" type="button" onClick={onOpen}>
        <Avatar name={invitation.displayName} icon={<Mail size={18} strokeWidth={2} />} />
        <span className="ds-row-body">
          <span className="ds-row-title sf-name"><span className="sf-name-text">{invitation.displayName}</span></span>
          <span className="ds-row-subtitle sf-email">{invitation.email}</span>
          <span className="ds-row-subtitle sf-narrow">{ROLE_SHORT[invitation.role]} · <span className={invitation.expired ? 'sf-expired' : undefined}>{expiryLine(invitation, now)}</span></span>
        </span>
        <span className="sf-col sf-col-role"><RoleArea person={invitation} /></span>
        <span className="sf-col sf-col-sessions">Sent {lowerFirst(whenLabel(invitation.sentAt, now))}</span>
        <span className={`sf-col sf-col-seen${invitation.expired ? ' is-warning' : ''}`}>{expiryLine(invitation, now)}</span>
        <span className="sf-trail" />
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="ds-section" role="status" aria-label="Loading staff">
      <div className="ds-section-head"><span className="ds-skeleton" style={{ width: 140, height: 20 }} /></div>
      <ul className="ds-list" aria-hidden="true">
        {[58, 44, 64, 50, 40].map((width) => (
          <li key={width}>
            <div className="ds-row sf-row">
              <span className="sf-avatar ds-skeleton" />
              <span className="ds-row-body">
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 16 }} />
                <span className="ds-skeleton" style={{ width: `${width - 14}%`, height: 13, marginTop: 6 }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

