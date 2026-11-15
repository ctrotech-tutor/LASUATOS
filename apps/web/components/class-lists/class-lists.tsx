'use client';

import type { ClassList } from '@lasuatos/contracts';
import { ListChecks, UserPlus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LectureRequestError } from '../../lib/lecture-api';
import { primeResource, staleResources, useResource } from '../../lib/resource';
import { loadClassList } from '../../lib/student-api';
import { Button, EmptyState, PageHeader, SkeletonLines } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { AddSheet } from './add-sheet';
import { placeHref, placeKey, readPlace, type Place } from './format';
import { Overview } from './overview';
import { Roster } from './roster';
import './class-lists.css';

export const PATH = '/class-list';

type Answer =
  | { readonly kind: 'list'; readonly list: ClassList }
  | { readonly kind: 'denied'; readonly message: string }
  | { readonly kind: 'missing'; readonly message: string }
  | { readonly kind: 'signed-out' };

/** Asks for one place. Refusals come back as answers, so the page can explain them. */
async function load(place: Place, signal: AbortSignal): Promise<Answer> {
  try {
    const list = await loadClassList({
      department: place.department,
      entryYear: typeof place.set === 'number' ? place.set : null,
      // Everything for "all sets"; otherwise the server sends one list whole once the
      // department and set are settled, and just the summaries for an overview.
      ...(place.set === 'all' ? {} : { only: 'lists' as const }),
    }, signal);
    return { kind: 'list', list };
  } catch (caught) {
    if (caught instanceof LectureRequestError) {
      if (caught.status === 401) return { kind: 'signed-out' };
      if (caught.status === 403) return { kind: 'denied', message: caught.message };
      if (caught.status === 404) return { kind: 'missing', message: caught.message };
    }
    throw caught;
  }
}

/** One stable loader per place, as useResource needs. */
const loaders = new Map<string, (signal: AbortSignal) => Promise<Answer>>();
function loaderFor(place: Place) {
  const key = placeKey(place);
  let loader = loaders.get(key);
  if (!loader) {
    loader = (signal: AbortSignal) => load(place, signal);
    loaders.set(key, loader);
  }
  return loader;
}

/** Whether the answer is one list (a HOC's, or a department's set) rather than an overview. */
function isRoster(list: ClassList, place: Place): boolean {
  return list.departmentId !== null && (list.entryYear !== null || place.set === 'all');
}

/**
 * Class lists: who is in each department's set, and how far each student has got with their
 * account. HOCs see their own list; GHOCs and administrators start from every list in their
 * area. Students open their accounts from these lists, so names on registers come from here.
 */
export function ClassLists() {
  const router = useRouter();
  const feedback = useFeedback();
  const pathname = usePathname() ?? PATH;
  const params = useSearchParams();
  const place = readPlace(params);
  const key = placeKey(place);
  const resource = useResource(key, loaderFor(place), { maxAge: 20_000 });
  const [adding, setAdding] = useState(false);
  const [addPreset, setAddPreset] = useState<string | null>(null);

  const answer = resource.data;
  useEffect(() => {
    if (answer?.kind === 'signed-out') window.location.replace(`/sign-in?next=${encodeURIComponent(PATH)}`);
  }, [answer]);

  // ?add=1 opens the add sheet once, without focusing anything (they came from a link).
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || params?.get('add') !== '1') return undefined;
    opened.current = true;
    const timer = window.setTimeout(() => setAdding(true));
    return () => window.clearTimeout(timer);
  }, [params]);

  /** Changes a search parameter on this page, keeping the place. */
  function setParam(name: string, value: string | null) {
    const search = new URLSearchParams(params?.toString() ?? '');
    if (value) search.set(name, value); else search.delete(name);
    const text = search.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  /** After a change: show it at once where possible, then refetch every cached place. */
  function changed(update?: (list: ClassList) => ClassList) {
    if (update && answer?.kind === 'list') primeResource(key, { kind: 'list', list: update(answer.list) } satisfies Answer);
    staleResources('class-list:');
    resource.reload();
  }

  function startAdding(departmentId: string | null = null) {
    setAddPreset(departmentId);
    setAdding(true);
  }

  const list = answer?.kind === 'list' ? answer.list : undefined;
  const header = (title: string, extra: { subtitle?: string; back?: { href: string; label: string } } = {}) => (
    <PageHeader
      title={title}
      subtitle={extra.subtitle}
      back={extra.back}
      actions={(
        <div className="cls-head-actions">
          {list ? (
            <>
              <Button className="cls-add-wide" onClick={() => startAdding()} icon={<UserPlus size={18} strokeWidth={2.2} aria-hidden="true" />}>Add students</Button>
              <button className="ds-icon-btn is-filled cls-add-narrow" type="button" aria-label="Add students" data-tip="Add students" onClick={() => startAdding()}>
                <UserPlus size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </>
          ) : null}
          <GuideButton page={PATH} label="Class lists" />
        </div>
      )}
    />
  );

  if (!answer || answer.kind === 'signed-out') {
    if (resource.error && !answer) {
      return (
        <div className="cls">
          {header('Class lists')}
          <div className="ds-card"><EmptyState error title="The class list did not load" message={resource.error} action={<Button variant="tinted" onClick={resource.reload}>Try again</Button>} /></div>
        </div>
      );
    }
    return <div className="cls">{header('Class lists')}<div className="ds-card cls-loading"><SkeletonLines lines={6} label="Loading class lists" /></div></div>;
  }

  if (answer.kind === 'denied') {
    return (
      <div className="cls">
        <PageHeader title="Class lists" />
        <div className="ds-card">
          <EmptyState
            icon={<ListChecks size={26} strokeWidth={1.9} />}
            title="Class lists are kept by HOCs and administrators"
            message="If you are your class’s HOC, ask your department administrator to appoint you in Class reps."
            action={<Button href="/" variant="tinted">Go home</Button>}
          />
        </div>
      </div>
    );
  }

  if (answer.kind === 'missing') {
    return (
      <div className="cls">
        {header('Class lists')}
        <div className="ds-card">
          <EmptyState title="That list isn’t here" message={answer.message} action={<Button href={PATH} variant="tinted">See every list</Button>} />
        </div>
      </div>
    );
  }

  const data = answer.list;
  function closeAdding() {
    setAdding(false);
    setAddPreset(null);
    if (params?.get('add')) setParam('add', null);
  }

  const addSheet = (
    <AddSheet
      open={adding}
      list={data}
      presetDepartmentId={addPreset}
      onClose={closeAdding}
      onDone={(departmentId, entryYear) => {
        closeAdding();
        feedback.toast('The class list was saved. Students can open their accounts now.');
        const code = data.departments.find((item) => item.id === departmentId)?.code;
        if (data.departmentId === departmentId && data.entryYear === entryYear) changed();
        else if (code) {
          staleResources('class-list:');
          router.replace(placeHref(pathname, { department: code.toLowerCase(), set: entryYear }), { scroll: false });
        } else changed();
      }}
    />
  );

  if (isRoster(data, place)) {
    return (
      <>
        <Roster
          list={data}
          place={place}
          pathname={pathname}
          params={params}
          header={header}
          setParam={setParam}
          onChanged={changed}
          onAdd={() => startAdding()}
        />
        {addSheet}
      </>
    );
  }

  return (
    <>
      <Overview list={data} place={place} pathname={pathname} header={header} onAdd={startAdding} />
      {addSheet}
    </>
  );
}
