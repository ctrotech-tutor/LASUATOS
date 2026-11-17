'use client';

import { CLASS_REP_ACTIVITY_DAYS, type ClassRep, type ClassRepList } from '@lasuatos/contracts';
import { ChevronRight, Plus, UserRoundPlus, UsersRound } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { shortDepartmentName } from '../../lib/department-options';
import { LectureRequestError, loadClassReps } from '../../lib/lecture-api';
import { primeResource, staleResources, useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, PageHeader, SegmentedControl, Stat, Stats } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { initials, shortDate } from '../staff/format';
import { useClock } from '../take-attendance/hooks';
import { Select } from '../ui/select';
import { SearchField } from '../ui/search-field';
import { AppointSheet, type AppointRequest } from './appoint-sheet';
import {
  activityLine,
  buildPosts,
  countPosts,
  filterPosts,
  groupPosts,
  isQuiet,
  listLine,
  PATH,
  postOf,
  postPlace,
  readView,
  REPS_KEY,
  ROLE_NAME,
  SEARCH_FROM,
  setsInUse,
  shortFacultyName,
  viewHref,
  type Post,
  type Show,
  type View,
} from './format';
import { assistantShort } from './assistant-model';
import { RepSheet } from './rep-sheet';
import './class-reps.css';

type Answer =
  | { readonly kind: 'reps'; readonly data: ClassRepList }
  | { readonly kind: 'denied' }
  | { readonly kind: 'signed-out' };

/** Refusals come back as answers, so the page can explain them. */
async function load(signal: AbortSignal): Promise<Answer> {
  try {
    return { kind: 'reps', data: await loadClassReps(signal) };
  } catch (caught) {
    if (caught instanceof LectureRequestError) {
      if (caught.status === 401) return { kind: 'signed-out' };
      if (caught.status === 403) return { kind: 'denied' };
    }
    throw caught;
  }
}

/**
 * Class reps: every HOC and GHOC post in the viewer's area, who holds it and how they use the
 * app, and the posts still without a rep. Administrators appoint GHOCs and HOCs; a GHOC appoints
 * the HOCs of their own set.
 */
export function ClassReps() {
  const resource = useResource(REPS_KEY, load, { maxAge: 20_000 });
  const answer = resource.data;
  useEffect(() => {
    if (answer?.kind === 'signed-out') window.location.replace(`/sign-in?next=${encodeURIComponent(PATH)}`);
  }, [answer]);

  if (answer?.kind === 'denied') {
    return (
      <div className="crp">
        <PageHeader title="Class reps" />
        <div className="ds-card">
          <EmptyState
            icon={<UsersRound size={26} strokeWidth={1.9} />}
            title="Administrators and GHOCs appoint class reps"
            message="A HOC takes attendance and keeps their class list. If a rep needs to change, ask your GHOC or department administrator."
            action={<Button href="/" variant="tinted">Go home</Button>}
          />
        </div>
      </div>
    );
  }
  if (!answer || answer.kind === 'signed-out') {
    return (
      <div className="crp">
        <Header title="Class reps" />
        {resource.error && !answer ? (
          <div className="ds-card">
            <EmptyState error title="Class reps did not load" message={resource.error} action={<Button variant="tinted" onClick={resource.reload}>Try again</Button>} />
          </div>
        ) : <ListSkeleton />}
      </div>
    );
  }
  return <Posts data={answer.data} reload={resource.reload} />;
}

function Header({ title, subtitle, onAppoint }: Readonly<{ title: string; subtitle?: string | undefined; onAppoint?: (() => void) | undefined }>) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      actions={(
        <div className="crp-head-actions">
          {onAppoint ? (
            <>
              <Button className="crp-add-wide" onClick={onAppoint} icon={<UserRoundPlus size={18} strokeWidth={2.2} aria-hidden="true" />}>Appoint</Button>
              <button className="ds-icon-btn is-filled crp-add-narrow" type="button" aria-label="Appoint" data-tip="Appoint" onClick={onAppoint}>
                <UserRoundPlus size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </>
          ) : null}
          <GuideButton page={PATH} label="Class reps" />
        </div>
      )}
    />
  );
}

function Posts({ data, reload }: Readonly<{ data: ClassRepList; reload: () => void }>) {
  const router = useRouter();
  const pathname = usePathname() ?? PATH;
  const params = useSearchParams();
  const now = useClock('fifteen');
  const view = readView(params);
  const [query, setQuery] = useState('');
  const [repId, setRepId] = useState<string | null>(null);
  const [appoint, setAppoint] = useState<AppointRequest | null>(null);

  const posts = useMemo(() => buildPosts(data), [data]);
  const sets = useMemo(() => setsInUse(posts), [posts]);
  const inSet = useMemo(() => (view.set === null ? posts : posts.filter((post) => post.entryYear === view.set)), [posts, view.set]);
  const counts = useMemo(() => countPosts(inSet, now), [inSet, now]);
  const shown = useMemo(() => filterPosts(posts, view, query, now), [posts, view, query, now]);
  const groups = useMemo(() => groupPosts(shown), [shown]);

  function go(next: Partial<View>) {
    router.replace(viewHref(pathname, { ...view, ...next }), { scroll: false });
  }

  // /class-reps?appoint=1 (from the overview's setup step) opens the appoint sheet once, unfocused.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || params?.get('appoint') !== '1') return undefined;
    opened.current = true;
    const timer = window.setTimeout(() => setAppoint({ post: null, replacing: null, focus: false }));
    return () => window.clearTimeout(timer);
  }, [params]);

  /** Shows a change at once, then asks the server for the full picture. */
  function patch(change: (current: ClassRepList) => ClassRepList) {
    primeResource(REPS_KEY, { kind: 'reps', data: change(data) } satisfies Answer);
    staleResources('class-list:');
    reload();
  }

  const ghocView = data.fixedEntryYear !== null;
  const faculties = [...new Set(data.departments.map((item) => item.facultyName))];
  const title = ghocView ? 'HOCs' : 'Class reps';
  const subtitle = ghocView
    ? [`${data.fixedEntryYear}/${(data.fixedEntryYear ?? 0) + 1} set`, faculties.length === 1 ? faculties[0]! : null].filter(Boolean).join(' · ')
    : data.departments.length === 1 ? shortDepartmentName(data.departments[0]!.name)
      : faculties.length === 1 ? faculties[0]! : undefined;
  const canAppoint = data.departments.length > 0 || data.faculties.length > 0;
  const startAppoint = (post: Post | null = null, replacing: ClassRep | null = null) => setAppoint({ post, replacing, focus: true });

  const rep = data.reps.find((item) => item.id === repId) ?? null;
  const repPost = rep ? posts.find((post) => post.holders.some((holder) => holder.id === rep.id) || post.assistants.some((item) => item.id === rep.id)) ?? postOf(rep, data) : null;
  const showSegments: Show[] = ['all', ...(counts.open > 0 || view.show === 'open' ? ['open' as const] : []), ...(counts.quiet > 0 || view.show === 'quiet' ? ['quiet' as const] : [])];
  const searchable = posts.length >= SEARCH_FROM;
  const multiFaculty = new Set(posts.map((post) => post.facultyId)).size > 1;

  return (
    <div className="crp">
      <Header title={title} subtitle={subtitle || undefined} onAppoint={canAppoint ? () => startAppoint() : undefined} />

      {posts.length === 0 ? (
        <div className="ds-card">
          <EmptyState
            icon={<UsersRound size={26} strokeWidth={1.9} />}
            title={data.departments.length === 0 ? 'No departments yet' : 'No class reps yet'}
            message={data.departments.length === 0
              ? 'Departments are added in Academic structure. Then you can appoint their class reps here.'
              : 'Appoint a GHOC or HOC for a set. They take attendance and keep the class list from their phones.'}
            action={data.departments.length === 0
              ? <Button href="/admin/structure" variant="tinted">Open Academic structure</Button>
              : canAppoint ? <Button onClick={() => startAppoint()}>Appoint the first rep</Button> : undefined}
          />
        </div>
      ) : (
        <>
          <Stats label="Class reps at a glance">
            <Stat label="Reps" value={counts.reps} hint={counts.ghocs ? `${counts.ghocs} GHOC${counts.ghocs === 1 ? '' : 's'}, ${counts.hocs} HOC${counts.hocs === 1 ? '' : 's'}` : `HOC${counts.hocs === 1 ? '' : 's'}`} />
            <Stat label="No rep yet" value={counts.open} hint={counts.open === 1 ? 'post to fill' : 'posts to fill'} tone={counts.open > 0 ? 'warning' : 'success'} />
            <Stat label="Taking attendance" value={counts.active} hint={`in the last ${CLASS_REP_ACTIVITY_DAYS} days`} tone={counts.active > 0 ? 'success' : undefined} />
            <Stat label="Quiet" value={counts.quiet} hint={`no sessions in ${CLASS_REP_ACTIVITY_DAYS} days`} />
          </Stats>

          <div className="crp-tools">
            {showSegments.length > 1 ? (
              <SegmentedControl
                label="Show"
                value={view.show}
                onChange={(show) => go({ show })}
                segments={showSegments.map((value) => ({
                  value,
                  label: value === 'all' ? 'All' : <>{value === 'open' ? 'No rep' : 'Quiet'} <span className="crp-count">{value === 'open' ? counts.open : counts.quiet}</span></>,
                }))}
              />
            ) : null}
            {searchable ? <SearchField className="crp-find" value={query} onValueChange={setQuery} placeholder="Name, matric, department or set" aria-label="Find a class rep or post" /> : null}
            {sets.length > 1 && !ghocView ? (
              <label className="crp-set">
                <span className="sr-only">Set</span>
                <Select
                  value={view.set === null ? 'all' : String(view.set)}
                  onValueChange={(value) => go({ set: value === 'all' ? null : Number(value) })}
                  options={[
                    { value: 'all', label: 'All sets', description: `${sets.length} sets` },
                    ...sets.map((year) => ({ value: String(year), label: `${year}/${year + 1} set` })),
                  ]}
                />
              </label>
            ) : null}
          </div>

          {groups.length === 0 ? (
            <p className="crp-quiet" role="status">
              {query.trim() ? `Nothing matches “${query.trim()}”.` : view.show === 'open' ? 'Every post has a rep.' : view.show === 'quiet' ? 'No rep is quiet.' : 'Nothing to show for this set.'}
            </p>
          ) : groups.map((group, index) => {
            const filled = group.posts.filter((post) => post.holders.length > 0).length;
            return (
              <section key={group.key} className="ds-section" aria-labelledby={`crp-${group.key}`}>
                <div className="ds-section-head">
                  <h2 className="ds-section-title" id={`crp-${group.key}`}>{group.title}</h2>
                  <span className="ds-section-aside">{filled} of {group.posts.length} filled</span>
                </div>
                {index === 0 ? (
                  <div className="crp-columns" aria-hidden="true">
                    <span>Rep</span><span>Post</span><span>Sessions</span><span>Appointed</span>
                  </div>
                ) : null}
                <ul className="ds-list crp-list">
                  {group.posts.flatMap((post) => (post.holders.length
                    ? post.holders.flatMap((holder) => [
                      <RepRow key={holder.id} rep={holder} post={post} now={now} onOpen={() => setRepId(holder.id)} />,
                      // Each holder's assistants follow them, set in a little.
                      ...post.assistants
                        .filter((item) => item.assistantOf?.id === holder.id)
                        .map((item) => <RepRow key={item.id} rep={item} post={post} now={now} onOpen={() => setRepId(item.id)} />),
                    ])
                    : [<OpenRow key={post.key} post={post} multiFaculty={multiFaculty} onOpen={() => startAppoint(post)} />]))}
                </ul>
              </section>
            );
          })}
        </>
      )}

      <RepSheet
        rep={rep}
        post={repPost}
        now={now}
        onClose={() => setRepId(null)}
        onReplace={(holder, post) => {
          setRepId(null);
          window.setTimeout(() => startAppoint(post, holder), 0);
        }}
        onRemoved={(id) => {
          setRepId(null);
          // A HOC's or GHOC's assistants go with them.
          patch((current) => ({ ...current, reps: current.reps.filter((item) => item.id !== id && item.assistantOf?.id !== id) }));
        }}
      />
      <AppointSheet
        request={appoint}
        data={data}
        posts={posts}
        defaultSet={view.set ?? (sets.length === 1 ? sets[0]! : null)}
        now={now}
        onClose={() => {
          setAppoint(null);
          if (params?.get('appoint')) go({});
        }}
        onAppointed={(appointed, removedIds) => patch((current) => ({
          ...current,
          // The new post replaces any they held; anyone removed from it goes too.
          reps: [appointed, ...current.reps.filter((item) => item.studentUserId !== appointed.studentUserId && !removedIds.includes(item.id))],
        }))}
      />
    </div>
  );
}

function Avatar({ rep, children }: Readonly<{ rep?: ClassRep; children?: ReactNode }>) {
  return <span className={`crp-avatar${rep ? '' : ' is-open'}`} aria-hidden="true">{rep ? initials(rep.studentName) : children}</span>;
}

function PostCell({ post, assistant = false }: Readonly<{ post: Post; assistant?: boolean }>) {
  return (
    <span className="crp-col crp-col-post">
      <span className={`crp-role is-${post.role}${assistant ? ' is-assistant' : ''}`}>{assistant ? assistantShort(post.role) : ROLE_NAME[post.role]}</span>
      <span className="crp-col-place">{post.role === 'ghoc' ? 'Whole faculty' : postPlace(post)}</span>
    </span>
  );
}

function RepRow({ rep, post, now, onOpen }: Readonly<{ rep: ClassRep; post: Post; now: number; onOpen: () => void }>) {
  const activity = activityLine(rep, now);
  const assistant = rep.assistantOf !== null;
  const roleName = assistant ? assistantShort(rep.role) : ROLE_NAME[rep.role];
  return (
    <li>
      <button className={`ds-row crp-row${assistant ? ' is-assistant' : ''}`} type="button" onClick={onOpen}>
        <Avatar rep={rep} />
        <span className="ds-row-body">
          <span className="ds-row-title crp-name">{rep.studentName}</span>
          <span className="ds-row-subtitle crp-wide-only crp-ellipsis"><span className="ds-mono">{rep.matricNumber}</span> · {rep.email}</span>
          <span className="ds-row-subtitle crp-narrow">
            <span className={`crp-role is-${rep.role}${assistant ? ' is-assistant' : ''}`}>{roleName}</span>
            <span className="crp-ellipsis">{assistant ? `Helps ${rep.assistantOf?.name ?? ''}` : post.role === 'ghoc' ? 'Whole faculty' : postPlace(post)}</span>
          </span>
          <span className={`ds-row-subtitle crp-narrow crp-activity is-${activity.tone}`}>{activity.text}</span>
        </span>
        <PostCell post={post} assistant={assistant} />
        <span className={`crp-col crp-col-sessions is-${activity.tone}`}>{activity.text}</span>
        <span className="crp-col crp-col-when"><span className="sr-only">Appointed </span>{shortDate(rep.appointedAt, now)}</span>
        <span className="crp-trail">{isQuiet(rep, now) ? <Badge tone="warning">Quiet</Badge> : null}</span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

function OpenRow({ post, multiFaculty, onOpen }: Readonly<{ post: Post; multiFaculty: boolean; onOpen: () => void }>) {
  const where = post.role === 'ghoc' ? (multiFaculty ? shortFacultyName(post.facultyName) : 'Whole faculty') : postPlace(post);
  const body = (
    <>
      <Avatar><Plus size={18} strokeWidth={2.2} /></Avatar>
      <span className="ds-row-body">
        <span className="ds-row-title crp-name crp-open-title">No {ROLE_NAME[post.role]} yet</span>
        <span className="ds-row-subtitle crp-wide-only">{post.canAppoint ? 'Appoint someone' : 'An administrator appoints this post'}</span>
        <span className="ds-row-subtitle crp-narrow crp-ellipsis">{where}</span>
        <span className="ds-row-subtitle crp-narrow crp-ellipsis">{listLine(post)}</span>
      </span>
      <PostCell post={post} />
      <span className="crp-col crp-col-list">{listLine(post)}</span>
      <span className="crp-trail" />
      {post.canAppoint ? <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" /> : <span className="crp-chevron-space" />}
    </>
  );
  return (
    <li>
      {post.canAppoint ? (
        <button className="ds-row crp-row is-open" type="button" onClick={onOpen}>{body}</button>
      ) : <div className="ds-row crp-row is-open">{body}</div>}
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="ds-section" role="status" aria-label="Loading class reps">
      <div className="ds-section-head"><span className="ds-skeleton" style={{ width: 140, height: 20 }} /></div>
      <ul className="ds-list" aria-hidden="true">
        {[56, 44, 62, 50].map((width) => (
          <li key={width}>
            <div className="ds-row crp-row">
              <span className="crp-avatar ds-skeleton" />
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
