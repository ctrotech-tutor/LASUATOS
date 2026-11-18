import { COMPONENT_IDS, WAT_OFFSET_MS, type ComponentId } from './model.ts';

/**
 * Incidents and maintenance (ADR 034). They are GitHub issues labelled "status" on the
 * LASUATOS repository: the checker opens one by itself when something breaks, and
 * maintainers post updates as comments from the GitHub app. This file turns issues and
 * comments into what the page shows. Only maintainers' words are shown (owner, members
 * and collaborators), so a stranger's comment can never appear on the status page if
 * the repository is public; text inside <!-- --> is private and never shown.
 */

export type Stage = 'investigating' | 'identified' | 'monitoring' | 'update' | 'resolved' | 'scheduled' | 'in_progress' | 'completed';

export interface IncidentUpdate {
  readonly at: number;
  readonly stage: Stage;
  readonly body: string;
}

export interface Incident {
  readonly id: string;
  readonly number: number | null;
  readonly kind: 'incident' | 'maintenance';
  readonly impact: 'minor' | 'major' | 'maintenance';
  readonly title: string;
  readonly components: ComponentId[];
  readonly automatic: boolean;
  readonly createdAt: number;
  readonly resolvedAt: number | null;
  readonly startsAt: number | null;
  readonly endsAt: number | null;
  /** Newest first. The last one is the opening message. */
  readonly updates: IncidentUpdate[];
}

export interface GitHubLabel { readonly name: string }
export interface GitHubUser { readonly login: string }
export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: 'open' | 'closed';
  readonly labels: ReadonlyArray<GitHubLabel | string>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
  readonly author_association: string;
  readonly user: GitHubUser | null;
  readonly pull_request?: unknown;
}
export interface GitHubComment {
  readonly id: number;
  readonly body: string | null;
  readonly created_at: string;
  readonly author_association: string;
  readonly user: GitHubUser | null;
}

export const STATUS_LABEL = 'status';
export const AUTO_LABEL = 'auto';
export const MAINTENANCE_LABEL = 'maintenance';
/** Labels the checker makes sure exist, with colours and descriptions shown in GitHub. */
export const LABELS: ReadonlyArray<{ readonly name: string; readonly color: string; readonly description: string }> = [
  { name: STATUS_LABEL, color: '153b5b', description: 'Shown on the LASUATOS status page' },
  { name: AUTO_LABEL, color: 'c5def5', description: 'Opened by the status checker' },
  { name: MAINTENANCE_LABEL, color: '0e8a96', description: 'Planned maintenance (add Starts: and Ends: lines)' },
  { name: 'major', color: 'b0281f', description: 'Status page: major outage' },
  { name: 'minor', color: 'd8b15c', description: 'Status page: partial outage or slowness' },
  ...COMPONENT_IDS.map((id) => ({ name: componentLabel(id), color: 'ededed', description: `Status page part: ${id.replace('_', '-')}` })),
];

export function componentLabel(id: ComponentId): string {
  return `component: ${id.replace('_', '-')}`;
}

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export function trusted(association: string): boolean {
  return TRUSTED.has(association);
}

function labelNames(issue: GitHubIssue): string[] {
  return issue.labels.map((label) => (typeof label === 'string' ? label : label.name).toLowerCase().trim());
}

export function isStatusIssue(issue: GitHubIssue): boolean {
  return !issue.pull_request && trusted(issue.author_association) && labelNames(issue).includes(STATUS_LABEL);
}

/** Removes private notes (<!-- -->) and surrounding blank space. */
export function publicText(text: string | null): string {
  return (text ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const STAGE_WORDS: Record<string, Stage> = {
  investigating: 'investigating',
  identified: 'identified',
  monitoring: 'monitoring',
  update: 'update',
  resolved: 'resolved',
  fixed: 'resolved',
};

/** "Identified: the database ran out of connections" → stage identified, rest as the body. */
export function readUpdate(text: string): { stage: Stage | null; body: string } {
  const match = /^\s*\**\s*(investigating|identified|monitoring|update|resolved|fixed)\s*\**\s*(?:[:\-–—.]\s*|\n+|$)/i.exec(text);
  if (!match) return { stage: null, body: text.trim() };
  return { stage: STAGE_WORDS[match[1]!.toLowerCase()]!, body: text.slice(match[0].length).trim() };
}

/**
 * "Starts: 2026-11-20 22:00" and "Ends: 2026-11-20 23:30" (West Africa Time), or ISO
 * times with an offset. Returns the times and the body without those lines.
 */
export function readWindow(text: string): { startsAt: number | null; endsAt: number | null; rest: string } {
  let startsAt: number | null = null;
  let endsAt: number | null = null;
  const rest = text.split('\n').filter((line) => {
    const match = /^\s*\**\s*(starts?|ends?|from|until|to)\s*\**\s*:\s*(.+?)\s*$/i.exec(line);
    if (!match) return true;
    const at = parseWatTime(match[2]!);
    if (at === null) return true;
    if (/^(starts?|from)$/i.test(match[1]!)) startsAt = at;
    else endsAt = at;
    return false;
  }).join('\n').trim();
  return { startsAt, endsAt, rest };
}

export function parseWatTime(value: string): number | null {
  const cleaned = value.replace(/\s*\(?\bWAT\b\)?\s*$/i, '').trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(cleaned);
  if (local) {
    const [, y, mo, d, h, mi] = local.map(Number) as [number, number, number, number, number, number];
    const at = Date.UTC(y, mo - 1, d, h, mi) - WAT_OFFSET_MS;
    return Number.isFinite(at) ? at : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(cleaned)) {
    const at = Date.parse(cleaned);
    return Number.isFinite(at) ? at : null;
  }
  return null;
}

/** One issue and its comments as the page shows it. */
export function toIncident(issue: GitHubIssue, comments: readonly GitHubComment[], now: number): Incident {
  const labels = labelNames(issue);
  const maintenance = labels.includes(MAINTENANCE_LABEL);
  const components = COMPONENT_IDS.filter((id) => labels.includes(componentLabel(id)));
  const createdAt = Date.parse(issue.created_at);
  const closedAt = issue.state === 'closed' && issue.closed_at ? Date.parse(issue.closed_at) : null;
  const opening = readWindow(publicText(issue.body));
  const updates: IncidentUpdate[] = [];
  updates.push({
    at: createdAt,
    stage: maintenance ? 'scheduled' : 'investigating',
    body: readUpdate(opening.rest).body || (maintenance ? 'Planned maintenance.' : 'We are looking into it.'),
  });
  for (const comment of comments) {
    if (!trusted(comment.author_association)) continue;
    const text = publicText(comment.body);
    if (!text) continue;
    const { stage, body } = readUpdate(text);
    if (!body && !stage) continue;
    updates.push({ at: Date.parse(comment.created_at), stage: stage ?? 'update', body: body || defaultBody(stage ?? 'update') });
  }
  // Newest first; on a tie the one written later (a comment after the opening) wins.
  const order = new Map(updates.map((update, index) => [update, index]));
  updates.sort((a, b) => b.at - a.at || order.get(b)! - order.get(a)!);

  let resolvedAt = closedAt;
  if (!maintenance && resolvedAt === null) {
    // "Resolved:" from a maintainer ends it on the page even before the issue is closed.
    const resolved = updates.find((update) => update.stage === 'resolved');
    if (resolved && updates[0] === resolved) resolvedAt = resolved.at;
  }
  if (maintenance && resolvedAt === null && opening.endsAt !== null && now > opening.endsAt) resolvedAt = opening.endsAt;
  if (resolvedAt !== null && !maintenance && updates[0]?.stage !== 'resolved') {
    updates.unshift({ at: resolvedAt, stage: 'resolved', body: 'This incident has been resolved.' });
  }
  if (maintenance && resolvedAt !== null && updates[0]?.stage !== 'completed') {
    updates.unshift({ at: resolvedAt, stage: 'completed', body: 'The maintenance is finished.' });
  }

  return {
    id: `gh-${issue.number}`,
    number: issue.number,
    kind: maintenance ? 'maintenance' : 'incident',
    impact: maintenance ? 'maintenance' : labels.includes('major') ? 'major' : 'minor',
    title: issue.title.trim().slice(0, 160) || 'Incident',
    components,
    automatic: labels.includes(AUTO_LABEL),
    createdAt,
    resolvedAt,
    startsAt: maintenance ? opening.startsAt : null,
    endsAt: maintenance ? opening.endsAt : null,
    updates: updates.slice(0, 50),
  };
}

function defaultBody(stage: Stage): string {
  switch (stage) {
    case 'identified': return 'The cause has been found and a fix is being worked on.';
    case 'monitoring': return 'A fix is in place and we are watching the results.';
    case 'resolved': return 'This incident has been resolved.';
    default: return 'We are still working on it.';
  }
}

/** Where an incident is now, for the badge on it. */
export function currentStage(incident: Incident, now: number): Stage {
  if (incident.kind === 'maintenance') {
    if (maintenanceOver(incident, now)) return 'completed';
    if (incident.startsAt !== null && now < incident.startsAt) return 'scheduled';
    return 'in_progress';
  }
  if (incident.resolvedAt !== null) return 'resolved';
  const latest = incident.updates.find((update) => update.stage !== 'update');
  return latest?.stage ?? 'investigating';
}

/** Closed, or past its end time even if nobody closed it. */
export function maintenanceOver(incident: Incident, now: number): boolean {
  return incident.resolvedAt !== null || (incident.endsAt !== null && now >= incident.endsAt);
}

export function isActive(incident: Incident, now: number): boolean {
  if (incident.kind === 'maintenance') return !maintenanceOver(incident, now) && (incident.startsAt === null || now >= incident.startsAt);
  return incident.resolvedAt === null;
}

/** When it ended, for the history (maintenance past its end counts as ended then). */
export function endedAt(incident: Incident, now: number): number | null {
  if (incident.resolvedAt !== null) return incident.resolvedAt;
  if (incident.kind === 'maintenance' && incident.endsAt !== null && now >= incident.endsAt) return incident.endsAt;
  return null;
}

/** Maintenance not started yet; shown ahead (and in the app banner from a day before). */
export function isUpcoming(incident: Incident, now: number): boolean {
  return incident.kind === 'maintenance' && !maintenanceOver(incident, now) && incident.startsAt !== null && now < incident.startsAt;
}

export const STAGE_LABEL: Record<Stage, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  update: 'Update',
  resolved: 'Resolved',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
};
