import { GitHub } from './github.ts';
import { AUTO_LABEL, componentLabel, isStatusIssue, publicText, STATUS_LABEL, toIncident, type Incident } from './incidents.ts';
import {
  autoBody, autoResolution, autoTitle, COMPONENT_IDS, deepDue, DEEP_STALE_MS, evaluate, planAutoIncident, step, watDay,
  type ComponentId, type ComponentState, type State,
} from './model.ts';
import type { Env } from './platform.ts';
import { probeApi, probeDeep, probeSite, type ProbeOptions } from './probe.ts';
import { Store, type AutoIncident, type CheckerState, type GitHubSync } from './store.ts';
import { buildSummary, dayList, DAYS_SHOWN, underMaintenance } from './summary.ts';

/**
 * One run of the checker (every minute, from the Cron Trigger):
 * 1. check the website and the API, and LASUATOS's own status when a deep check is due;
 * 2. move each part's state on and count the minute for today's bar;
 * 3. bring incidents in from GitHub and open, widen or close the automatic one;
 * 4. prepare the page summary, so a visit is one read.
 * Each step is guarded: a GitHub failure never stops the checks, and the other way round.
 */

export interface RunOptions extends ProbeOptions {
  /** The run's time (the cron's scheduled minute). */
  readonly at?: number;
  readonly github?: GitHub | null;
}

const ISSUE_COMMENT_FETCHES_PER_RUN = 8;

export function githubFor(env: Env): GitHub | null {
  if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return null;
  try {
    return new GitHub({ repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN });
  } catch {
    return null;
  }
}

export async function run(env: Env, options: RunOptions = {}): Promise<{ states: Record<ComponentId, ComponentState>; deep: boolean }> {
  const now = options.at ?? Date.now();
  const target = env.TARGET_URL.replace(/\/+$/, '');
  const store = new Store(env.DB);
  await store.ready();
  const previous = await store.state();
  const github = options.github === undefined ? githubFor(env) : options.github;

  // 1. Checks.
  // While anything is wrong, or the automatic incident is still open, every run checks deep so
  // recovery is confirmed (and the incident closed) within minutes, not at the next interval.
  const openAuto = await store.meta<AutoIncident>('auto');
  const troubled = openAuto !== null || COMPONENT_IDS.some((id) => previous.components[id].state !== 'operational' || previous.components[id].bad > 0);
  const everyDay = Number(env.DEEP_EVERY_DAY_MINUTES ?? 5) || 5;
  const everyNight = Number(env.DEEP_EVERY_NIGHT_MINUTES ?? 30) || 30;
  const doDeep = deepDue(now, previous.deepAt, troubled || previous.api?.ok === false, everyDay, everyNight);
  const [site, api, deep] = await Promise.all([
    probeSite(target, options),
    probeApi(target, options),
    doDeep ? probeDeep(target, previous.deep, options) : Promise.resolve(null),
  ]);
  // A deep check that failed only because the whole API is down tells nothing more; keep the last report.
  const deepReport = deep && (api.ok || deep.probe.ok) ? deep.report : null;
  const freshDeep = deepReport ?? (previous.deep && previous.deepAt !== null && now - previous.deepAt < DEEP_STALE_MS ? previous.deep : null);
  const measured = evaluate(site, api, deepReport);
  // Between deep checks the last report still says which parts are turned off.
  const hidden = deepReport ? measured.hidden : freshDeep ? evaluate(site, api, freshDeep).hidden : previous.hidden;

  // 2. States and minutes.
  const components = Object.fromEntries(COMPONENT_IDS.map((id) => [id, step(previous.components[id], measured.states[id], now)])) as Record<ComponentId, ComponentState>;
  const incidentsNow = await store.incidents(now - 2 * 86_400_000, 50);
  const maintenance = underMaintenance(incidentsNow, now);
  const minutes = Object.fromEntries(COMPONENT_IDS.map((id): [ComponentId, State | 'maint' | null] => [
    id,
    hidden.includes(id) ? null : maintenance.has(id) && components[id].state !== 'operational' ? 'maint' : components[id].state,
  ])) as Record<ComponentId, State | 'maint' | null>;

  const state: CheckerState = {
    components,
    hidden,
    deep: deepReport ?? previous.deep,
    deepAt: deepReport ? now : previous.deepAt,
    lastRun: now,
    site: { ok: site.ok, ms: site.ms },
    api: { ok: api.ok, ms: api.ms },
  };
  const today = watDay(now);
  await store.batch([
    ...store.countMinute(today, minutes),
    store.recordLatency(Math.floor(now / 300_000), site.ok ? site.ms : null, api.ok ? api.ms : null),
    store.setMeta('state', state),
  ]);

  // 3. Incidents.
  if (github) await syncGitHub(store, github, now).catch(async (error: unknown) => {
    const sync = (await store.meta<GitHubSync>('github')) ?? { etag: null, labelsReady: false, lastError: null };
    await store.batch([store.setMeta('github', { ...sync, lastError: `${new Date(now).toISOString()} ${error instanceof Error ? error.message : 'failed'}` })]);
  });
  await autoIncident(store, github, components, [...hidden, ...maintenance], now);

  // 4. Summary, and the daily clean-up once a day.
  await refreshSummary(store, now);
  if (new Date(now).getUTCHours() === 3 && new Date(now).getUTCMinutes() === 7) {
    await store.batch(store.prune(now, dayList(now, 400)[0]!));
  }
  return { states: components, deep: doDeep };
}

export async function refreshSummary(store: Store, now: number): Promise<void> {
  const state = await store.state();
  const [days, latency, incidents] = await Promise.all([
    store.days(dayList(now, DAYS_SHOWN)[0]!),
    store.latency(Math.floor((now - 24 * 3_600_000) / 300_000)),
    store.incidents(now - 15 * 86_400_000, 60),
  ]);
  const summary = buildSummary({ now, lastCheckAt: state.lastRun, states: state.components, hidden: state.hidden, days, latency, incidents });
  await store.batch([store.setMeta('summary', summary)]);
}

/** Brings status issues in from GitHub: only the ones changed since the last look. */
export async function syncGitHub(store: Store, github: GitHub, now: number): Promise<void> {
  const sync = (await store.meta<GitHubSync>('github')) ?? { etag: null, labelsReady: false, lastError: null };
  if (!sync.labelsReady) {
    await github.ensureLabels();
    await store.batch([store.setMeta('github', { ...sync, labelsReady: true })]);
  }
  const listed = await github.statusIssues(sync.etag);
  if (!listed) return;
  const known = await store.incidentUpdatedAt();
  const writes = [];
  let fetched = 0;
  let complete = true;
  const seen = new Set<string>();
  for (const issue of listed.issues) {
    if (!isStatusIssue(issue)) continue;
    const id = `gh-${issue.number}`;
    seen.add(id);
    if (known.get(id) === issue.updated_at) continue;
    if (fetched >= ISSUE_COMMENT_FETCHES_PER_RUN) {
      complete = false;
      continue;
    }
    fetched += 1;
    const comments = await github.comments(issue.number);
    writes.push(store.saveIncident(toIncident(issue, comments, now), issue.updated_at));
  }
  // Issues that lost the "status" label or were deleted no longer show, if they are still open here.
  const open = await store.incidents(now, 100);
  for (const incident of open) {
    if (incident.id.startsWith('gh-') && incident.resolvedAt === null && !seen.has(incident.id) && listed.issues.length < 30) writes.push(store.deleteIncident(incident.id));
  }
  // Keep the old ETag while some issues are still to fetch, so the next run lists them again.
  writes.push(store.setMeta('github', { ...sync, labelsReady: true, etag: complete ? listed.etag : null, lastError: null }));
  await store.batch(writes);
}

async function autoIncident(store: Store, github: GitHub | null, components: Record<ComponentId, ComponentState>, quiet: readonly ComponentId[], now: number): Promise<void> {
  const auto = await store.meta<AutoIncident>('auto');
  const plan = planAutoIncident(components, auto, quiet);
  if (plan.action === 'none') {
    // A maintainer closed our issue while things were still wrong: stop updating it.
    if (auto && auto.issue !== null && !auto.suppressed) {
      const stored = await store.incident(`gh-${auto.issue}`);
      if (stored && stored.resolvedAt !== null) await store.batch([store.setMeta('auto', { ...auto, suppressed: true })]);
    }
    return;
  }

  const labels = [STATUS_LABEL, AUTO_LABEL, plan.impact, ...plan.components.map(componentLabel)];
  if (plan.action === 'open') {
    const title = autoTitle(plan.components, components);
    const body = autoBody(plan.components, components, now);
    if (github) {
      try {
        const issue = await github.createIssue({ title, body, labels });
        await store.batch([
          store.saveIncident(toIncident(issue, [], now), issue.updated_at),
          store.setMeta('auto', { issue: issue.number, localId: null, components: plan.components, startedAt: now, suppressed: false } satisfies AutoIncident),
        ]);
        return;
      } catch {
        // Fall through: keep it on the page even when GitHub is unreachable.
      }
    }
    const localId = `auto-${now}`;
    await store.batch([
      store.saveIncident(localIncident(localId, title, body, plan.components, plan.impact, now), new Date(now).toISOString()),
      store.setMeta('auto', { issue: null, localId, components: plan.components, startedAt: now, suppressed: false } satisfies AutoIncident),
    ]);
    return;
  }

  if (!auto) return;
  if (plan.action === 'update') {
    const added = plan.components.filter((id) => !auto.components.includes(id));
    const next: AutoIncident = { ...auto, components: plan.components };
    if (auto.issue !== null && github && !auto.suppressed) {
      await github.updateIssue(auto.issue, { title: autoTitle(plan.components, components), labels }).catch(() => undefined);
      await github.comment(auto.issue, `Update: also affected now: ${added.map((id) => id.replace('_', '-')).join(', ')}.\n\n${autoBody(added, components, now).split('\n').filter((line) => line.startsWith('- ')).join('\n')}`).catch(() => undefined);
    } else if (auto.localId) {
      const stored = await store.incident(auto.localId);
      if (stored) await store.batch([store.saveIncident({ ...stored, title: autoTitle(plan.components, components), components: plan.components, impact: plan.impact, updates: [{ at: now, stage: 'update', body: autoBody(added, components, now) }, ...stored.updates] }, new Date(now).toISOString())]);
    }
    await store.batch([store.setMeta('auto', next)]);
    return;
  }

  // close
  if (auto.issue !== null && github && !auto.suppressed) {
    await github.comment(auto.issue, autoResolution(auto.startedAt, now)).catch(() => undefined);
    const closed = await github.updateIssue(auto.issue, { state: 'closed', state_reason: 'completed' }).catch(() => null);
    if (closed) {
      const comments = await github.comments(auto.issue).catch(() => []);
      await store.batch([store.saveIncident(toIncident(closed, comments, now), closed.updated_at)]);
    }
  } else if (auto.localId) {
    const stored = await store.incident(auto.localId);
    if (stored) await store.batch([store.saveIncident({ ...stored, resolvedAt: now, updates: [{ at: now, stage: 'resolved', body: autoResolution(auto.startedAt, now).replace(/^Resolved:\s*/, '') }, ...stored.updates] }, new Date(now).toISOString())]);
  }
  await store.batch([store.setMeta('auto', null)]);
}

function localIncident(id: string, title: string, body: string, components: ComponentId[], impact: 'minor' | 'major', now: number): Incident {
  return {
    id,
    number: null,
    kind: 'incident',
    impact,
    title,
    components,
    automatic: true,
    createdAt: now,
    resolvedAt: null,
    startsAt: null,
    endsAt: null,
    updates: [{ at: now, stage: 'investigating', body: publicText(body) }],
  };
}

