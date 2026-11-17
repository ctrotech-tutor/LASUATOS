'use client';

import {
  MAX_ASSISTANTS,
  repRoleShort,
  type AssistantPermission,
  type Assistants as AssistantsData,
  type ClassRep,
} from '@lasuatos/contracts';
import { Check, HandHelping, Plus, UserRoundX } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCurrentAccount } from '../../lib/current-account';
import { capabilitiesChanged, failureText, LectureRequestError, loadAssistants, removeAssistant, updateAssistant } from '../../lib/lecture-api';
import { primeResource, staleResources, useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, PageHeader } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { initials } from '../staff/format';
import { SwitchField } from '../ui/switch';
import { AddAssistantSheet } from './add-assistant-sheet';
import {
  ASSISTANTS_PATH,
  assistantName,
  assistantShort,
  ATTENDANCE_COPY,
  orderedPermissions,
  permissionCopy,
  powersLine,
  principalFrom,
  sessionsLine,
  teamPlace,
  togglePermission,
} from './assistant-model';
import './class-reps.css';
import './assistants.css';

type Answer =
  | { readonly kind: 'team'; readonly data: AssistantsData }
  | { readonly kind: 'refused'; readonly status: number; readonly message: string }
  | { readonly kind: 'signed-out' };

/** One stable loader per team, as useResource needs. */
const loaders = new Map<string, (signal: AbortSignal) => Promise<Answer>>();
function loaderFor(principalId: string | null) {
  const key = principalId ?? 'own';
  let loader = loaders.get(key);
  if (!loader) {
    loader = async (signal: AbortSignal): Promise<Answer> => {
      try {
        return { kind: 'team', data: await loadAssistants(principalId, signal) };
      } catch (caught) {
        if (caught instanceof LectureRequestError) {
          if (caught.status === 401) return { kind: 'signed-out' };
          if (caught.status === 403 || caught.status === 404) return { kind: 'refused', status: caught.status, message: caught.message };
        }
        throw caught;
      }
    };
    loaders.set(key, loader);
  }
  return loader;
}

export const teamKey = (principalId: string | null) => `assistants:${principalId ?? 'own'}`;

/**
 * Assistants: a HOC or GHOC chooses up to two classmates (AHOC, AGHOC) to share the work, and
 * what each may do besides taking attendance. Their GHOC and administrators open the same page
 * for them (`?for=`); an assistant sees their team, what they may do, and can step down.
 */
export function Assistants() {
  const params = useSearchParams();
  const principalId = principalFrom(params?.get('for'));
  const resource = useResource(teamKey(principalId), loaderFor(principalId), { maxAge: 20_000 });
  const answer = resource.data;
  useEffect(() => {
    if (answer?.kind === 'signed-out') {
      window.location.replace(`/sign-in?next=${encodeURIComponent(`${ASSISTANTS_PATH}${principalId ? `?for=${principalId}` : ''}`)}`);
    }
  }, [answer, principalId]);

  if (answer?.kind === 'refused') {
    return (
      <div className="crp ast">
        <PageHeader title="Assistants" back={principalId ? { href: '/class-reps', label: 'Class reps' } : undefined} />
        <div className="ds-card">
          <EmptyState
            icon={<HandHelping size={26} strokeWidth={1.9} />}
            title={answer.status === 404 ? 'That HOC or GHOC was not found' : 'HOCs and GHOCs choose assistants'}
            message={answer.status === 404
              ? 'They may have been replaced. Open Class reps to see who holds the post now.'
              : 'Each HOC and GHOC can choose up to two classmates to help take attendance. If you’re helping yours, ask them to add you.'}
            action={<Button href={principalId ? '/class-reps' : '/'} variant="tinted">{principalId ? 'Open Class reps' : 'Go home'}</Button>}
          />
        </div>
      </div>
    );
  }
  if (!answer || answer.kind === 'signed-out') {
    return (
      <div className="crp ast">
        <PageHeader title="Assistants" />
        {resource.error && !answer ? (
          <div className="ds-card">
            <EmptyState error title="Assistants did not load" message={resource.error} action={<Button variant="tinted" onClick={resource.reload}>Try again</Button>} />
          </div>
        ) : <TeamSkeleton />}
      </div>
    );
  }
  return <Team data={answer.data} principalId={principalId} reload={resource.reload} />;
}

function Team({ data, principalId, reload }: Readonly<{ data: AssistantsData; principalId: string | null; reload: () => void }>) {
  const account = useCurrentAccount();
  const router = useRouter();
  const feedback = useFeedback();
  const [adding, setAdding] = useState(false);
  const { principal, assistants, canManage } = data;
  const short = assistantShort(principal.role);
  const me = assistants.find((item) => item.studentUserId === account?.id) ?? null;
  const ownTeam = principalId === null;
  const isPrincipal = ownTeam && canManage;
  const free = MAX_ASSISTANTS - assistants.length;

  const title = isPrincipal ? 'Assistants' : me ? 'My team' : `${firstName(principal.studentName)}’s assistants`;
  const subtitle = `${repRoleShort(principal.role)} · ${teamPlace(principal)}`;

  /** Shows a change at once, then asks the server for the full picture. */
  function patch(change: (current: AssistantsData) => AssistantsData) {
    primeResource(teamKey(principalId), { kind: 'team', data: change(data) } satisfies Answer);
    staleResources('class-reps');
    reload();
  }

  async function stepDown(self: ClassRep) {
    const sure = await feedback.confirm({
      title: `Stop being ${short}?`,
      body: `You’ll stop taking attendance for ${teamPlace(principal)}. The sessions you took are kept. ${firstName(principal.studentName)} can add you again later.`,
      confirmLabel: 'Step down',
      tone: 'danger',
    });
    if (!sure) return;
    try {
      await removeAssistant(self.id);
      feedback.toast(`You’re no longer ${short}.`);
      staleResources('assistants:');
      capabilitiesChanged();
      router.replace('/');
    } catch (caught) {
      feedback.toast(failureText(caught, 'That didn’t work. Try again.'), 'error');
    }
  }

  return (
    <div className="crp ast">
      <PageHeader
        title={title}
        subtitle={subtitle}
        back={ownTeam ? undefined : { href: '/class-reps', label: 'Class reps' }}
        actions={(
          <div className="crp-head-actions">
            {canManage && free > 0 && assistants.length > 0 ? (
              <>
                <Button className="crp-add-wide" onClick={() => setAdding(true)} icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>Add {short}</Button>
                <button className="ds-icon-btn is-filled crp-add-narrow" type="button" aria-label={`Add ${short}`} data-tip={`Add ${short}`} onClick={() => setAdding(true)}>
                  <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </>
            ) : null}
            <GuideButton page={ASSISTANTS_PATH} label="Assistants" />
          </div>
        )}
      />

      {me ? (
        <section className="ds-section" aria-labelledby="ast-you">
          <div className="ds-section-head"><h2 className="ds-section-title" id="ast-you">You</h2></div>
          <div className="ds-card ast-card">
            <p className="ast-you-line">You’re {assistantName(principal.role)} to <strong>{principal.studentName}</strong>.</p>
            <ul className="ast-can" aria-label="What you can do">
              <li><Check size={16} strokeWidth={2.4} aria-hidden="true" />{ATTENDANCE_COPY.label}</li>
              {orderedPermissions(data.available).map((permission) => {
                const allowed = me.permissions.includes(permission);
                return (
                  <li key={permission} className={allowed ? '' : 'is-off'}>
                    {allowed ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : <span className="ast-dash" aria-hidden="true" />}
                    {permissionCopy(permission, principal.role).label}
                    {allowed ? null : <span className="sr-only"> (not allowed)</span>}
                  </li>
                );
              })}
            </ul>
            <p className="ast-note">Need more? Ask {firstName(principal.studentName)}. Only they, your GHOC or an administrator can change it.</p>
            <div className="crp-actions">
              <Button variant="gray" className="crp-danger-text" icon={<UserRoundX size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={() => void stepDown(me)}>Step down</Button>
            </div>
          </div>
        </section>
      ) : null}

      {!isPrincipal ? (
        <section className="ds-section" aria-labelledby="ast-principal">
          <div className="ds-section-head"><h2 className="ds-section-title" id="ast-principal">{repRoleShort(principal.role)}</h2></div>
          <ul className="ds-list">
            <li><PersonRow rep={principal} badge={repRoleShort(principal.role)} /></li>
          </ul>
        </section>
      ) : null}

      <section className="ds-section" aria-labelledby="ast-list">
        <div className="ds-section-head">
          <h2 className="ds-section-title" id="ast-list">{me ? 'Assistants' : `${short}s`}</h2>
          <span className="ds-section-aside">{assistants.length} of {MAX_ASSISTANTS}</span>
        </div>

        {assistants.length === 0 ? (
          <div className="ds-card">
            <EmptyState
              icon={<HandHelping size={26} strokeWidth={1.9} />}
              title={canManage ? `Share the work with up to ${MAX_ASSISTANTS} classmates` : 'No assistants yet'}
              message={canManage
                ? `An ${short} takes attendance when ${isPrincipal ? 'you can’t' : `${firstName(principal.studentName)} can’t`}. You choose what else they can do, and change it any time.`
                : `${firstName(principal.studentName)} hasn’t chosen any.`}
              action={canManage ? <Button onClick={() => setAdding(true)} icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>Add {short}</Button> : undefined}
            />
          </div>
        ) : (
          <div className="ast-cards">
            {assistants.map((assistant) => (
              <AssistantCard
                key={assistant.id}
                assistant={assistant}
                data={data}
                isYou={assistant.id === me?.id}
                onChanged={(updated) => patch((current) => ({ ...current, assistants: current.assistants.map((item) => (item.id === updated.id ? updated : item)) }))}
                onRemoved={(id) => patch((current) => ({ ...current, assistants: current.assistants.filter((item) => item.id !== id) }))}
              />
            ))}
            {canManage && free > 0 ? (
              <button className="ast-slot" type="button" onClick={() => setAdding(true)}>
                <span className="crp-avatar is-open" aria-hidden="true"><Plus size={18} strokeWidth={2.2} /></span>
                <span className="ast-slot-text">
                  <span className="ast-slot-title">Add {short}</span>
                  <span className="ast-slot-sub">{free} place{free === 1 ? '' : 's'} left</span>
                </span>
              </button>
            ) : null}
          </div>
        )}
      </section>

      {canManage ? (
        <AddAssistantSheet
          open={adding}
          data={data}
          principalId={principalId}
          onClose={() => setAdding(false)}
          onAdded={(added) => patch((current) => ({ ...current, assistants: [...current.assistants, added] }))}
        />
      ) : null}
    </div>
  );
}

function firstName(fullName: string): string {
  // Class-list names read "SURNAME First Middle": the first name is the second word when the first is all capitals.
  const words = fullName.trim().split(/\s+/);
  if (words.length > 1 && words[0] === words[0]!.toUpperCase()) return words[1]!;
  return words[0] ?? fullName;
}

function PersonRow({ rep, badge }: Readonly<{ rep: ClassRep; badge: string }>) {
  return (
    <div className="ds-row ast-person">
      <span className="crp-avatar" aria-hidden="true">{initials(rep.studentName)}</span>
      <span className="ds-row-body">
        <span className="ds-row-title crp-name">{rep.studentName}</span>
        <span className="ds-row-subtitle crp-ellipsis"><span className="ds-mono">{rep.matricNumber}</span> · {rep.email}</span>
        <span className="ds-row-subtitle">{sessionsLine(rep)}</span>
      </span>
      <span className={`crp-role is-${rep.role}`}>{badge}</span>
    </div>
  );
}

function AssistantCard({ assistant, data, isYou, onChanged, onRemoved }: Readonly<{
  assistant: ClassRep;
  data: AssistantsData;
  isYou: boolean;
  onChanged: (rep: ClassRep) => void;
  onRemoved: (id: string) => void;
}>) {
  const feedback = useFeedback();
  const role = data.principal.role;
  const short = assistantShort(role);
  const [permissions, setPermissions] = useState<readonly AssistantPermission[]>(assistant.permissions);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // A fresh answer from the server wins over what was shown.
  const [seen, setSeen] = useState(assistant.permissions);
  if (assistant.permissions !== seen) {
    setSeen(assistant.permissions);
    setPermissions(assistant.permissions);
  }

  async function toggle(permission: AssistantPermission, on: boolean) {
    const before = permissions;
    const next = togglePermission(before, permission, on);
    setPermissions(next);
    setSaving(true);
    try {
      const saved = await updateAssistant(assistant.id, next);
      onChanged(saved);
    } catch (caught) {
      setPermissions(before);
      feedback.toast(failureText(caught, 'That change wasn’t saved. Try again.'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const sure = await feedback.confirm({
      title: `Remove ${assistant.studentName} as ${short}?`,
      body: 'They stop taking attendance straight away. The sessions they took are kept.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!sure) return;
    setRemoving(true);
    try {
      await removeAssistant(assistant.id);
      feedback.toast(`${assistant.studentName} is no longer ${short}.`);
      onRemoved(assistant.id);
    } catch (caught) {
      feedback.toast(failureText(caught, 'They could not be removed. Try again.'), 'error');
      setRemoving(false);
    }
  }

  return (
    <article className="ds-card ast-card" aria-labelledby={`ast-${assistant.id}`} aria-busy={saving || undefined}>
      <div className="ast-card-head">
        <span className="crp-avatar" aria-hidden="true">{initials(assistant.studentName)}</span>
        <div className="ast-card-who">
          <h3 className="ast-card-name" id={`ast-${assistant.id}`}>{assistant.studentName}{isYou ? <span className="ast-you"> (you)</span> : null}</h3>
          <p className="ast-card-line crp-ellipsis"><span className="ds-mono">{assistant.matricNumber}</span> · {assistant.email}</p>
          <p className="ast-card-line">{sessionsLine(assistant)}</p>
        </div>
        <Badge tone={role === 'ghoc' ? 'accent' : 'tint'}>{short}</Badge>
      </div>

      {data.canManage ? (
        <div className="ast-switches" role="group" aria-label={`What ${assistant.studentName} can do`}>
          <div className="ast-always">
            <span className="ast-always-text">
              <span>{ATTENDANCE_COPY.label}</span>
              <small>{ATTENDANCE_COPY.hint}</small>
            </span>
            <span className="ast-always-tag">Always</span>
          </div>
          {orderedPermissions(data.available).map((permission) => {
            const copy = permissionCopy(permission, role);
            return (
              <SwitchField
                key={permission}
                checked={permissions.includes(permission)}
                onCheckedChange={(on) => void toggle(permission, on)}
                label={copy.label}
                hint={copy.hint}
              />
            );
          })}
        </div>
      ) : (
        <p className="ast-powers">{powersLine(permissions)}</p>
      )}

      {data.canManage ? (
        <div className="ast-card-foot">
          <Button variant="gray" size="sm" className="crp-danger-text" busy={removing} icon={<UserRoundX size={16} strokeWidth={2.1} aria-hidden="true" />} onClick={() => void remove()}>Remove</Button>
        </div>
      ) : null}
    </article>
  );
}

function TeamSkeleton() {
  return (
    <div className="ds-section" role="status" aria-label="Loading assistants">
      <div className="ds-section-head"><span className="ds-skeleton" style={{ width: 120, height: 20 }} /></div>
      <div className="ast-cards" aria-hidden="true">
        {[60, 48].map((width) => (
          <div key={width} className="ds-card ast-card">
            <div className="ast-card-head">
              <span className="crp-avatar ds-skeleton" />
              <div className="ast-card-who">
                <span className="ds-skeleton" style={{ display: 'block', width: `${width}%`, height: 16 }} />
                <span className="ds-skeleton" style={{ display: 'block', width: `${width - 16}%`, height: 13, marginTop: 6 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
