import { currentStage, endedAt, isActive, isUpcoming, type Incident } from './incidents.ts';
import { COMPONENTS, impactOf, watDay, type ComponentId, type ComponentState, type State } from './model.ts';

/**
 * Everything one page view needs, prepared by the checker after each run and stored
 * as one row, so a visit costs one read however many people look during an outage.
 */

export const DAYS_SHOWN = 90;
export type Shown = State | 'maintenance';

export interface DayBar {
  readonly day: string;
  /** Minutes measured in each state; all zero means no data that day. */
  readonly up: number;
  readonly degraded: number;
  readonly down: number;
  readonly maint: number;
}

export interface ComponentSummary {
  readonly id: ComponentId;
  readonly name: string;
  readonly hint: string;
  readonly state: Shown;
  readonly since: number;
  /** Over the days shown, maintenance excluded; null with no data. */
  readonly uptime: number | null;
  /** The same over the last 30 days (what phones show). */
  readonly uptime30: number | null;
  readonly days: DayBar[];
}

export interface Summary {
  readonly generatedAt: number;
  readonly lastCheckAt: number | null;
  readonly overall: 'operational' | 'degraded' | 'down' | 'maintenance';
  readonly components: ComponentSummary[];
  /** Five-minute averages over the last 24 hours (ms; null when not measured). */
  readonly latency: { readonly site: Array<number | null>; readonly api: Array<number | null>; readonly from: number };
  readonly active: Incident[];
  readonly upcoming: Incident[];
  /** Ended in the last 14 days, newest first. */
  readonly recent: Incident[];
}

export function dayList(now: number, count: number): string[] {
  const days: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) days.push(watDay(now - index * 86_400_000));
  return days;
}

export function uptime(bars: readonly DayBar[]): number | null {
  let counted = 0;
  let down = 0;
  for (const bar of bars) {
    counted += bar.up + bar.degraded + bar.down;
    down += bar.down;
  }
  return counted === 0 ? null : (counted - down) / counted;
}

/** What a day's bar shows: the worst of it, ignoring a stray minute. */
export function barState(bar: DayBar): Shown | 'none' {
  const total = bar.up + bar.degraded + bar.down + bar.maint;
  if (total === 0) return 'none';
  if (bar.down >= 2 || (bar.down > 0 && bar.down / total > 0.01)) return 'down';
  if (bar.degraded >= 5 || bar.down > 0) return 'degraded';
  if (bar.maint > 0 && bar.maint >= total / 2) return 'maintenance';
  return 'operational';
}

/** Parts under maintenance now: those it names, or every part when it names none. */
export function underMaintenance(incidents: readonly Incident[], now: number): Set<ComponentId> {
  const parts = new Set<ComponentId>();
  for (const incident of incidents) {
    if (incident.kind !== 'maintenance' || !isActive(incident, now)) continue;
    for (const id of incident.components.length ? incident.components : COMPONENTS.map((component) => component.id)) parts.add(id);
  }
  return parts;
}

export function buildSummary(input: {
  readonly now: number;
  readonly lastCheckAt: number | null;
  readonly states: Readonly<Record<ComponentId, ComponentState>>;
  readonly hidden: readonly ComponentId[];
  readonly days: ReadonlyArray<{ component: string; day: string; up: number; degraded: number; down: number; maint: number }>;
  readonly latency: ReadonlyArray<{ bucket: number; site_sum: number; site_n: number; api_sum: number; api_n: number }>;
  readonly incidents: readonly Incident[];
}): Summary {
  const { now } = input;
  const days = dayList(now, DAYS_SHOWN);
  const maintenance = underMaintenance(input.incidents, now);
  const components = COMPONENTS.filter((component) => !input.hidden.includes(component.id)).map((component): ComponentSummary => {
    const rows = new Map(input.days.filter((row) => row.component === component.id).map((row) => [row.day, row]));
    const bars = days.map((day) => {
      const row = rows.get(day);
      return { day, up: row?.up ?? 0, degraded: row?.degraded ?? 0, down: row?.down ?? 0, maint: row?.maint ?? 0 };
    });
    const state = input.states[component.id];
    return {
      id: component.id,
      name: component.name,
      hint: component.hint,
      state: maintenance.has(component.id) ? 'maintenance' : state.state,
      since: state.since,
      uptime: uptime(bars),
      uptime30: uptime(bars.slice(-30)),
      days: bars,
    };
  });

  const active = input.incidents.filter((incident) => isActive(incident, now)).sort((a, b) => b.createdAt - a.createdAt);
  const upcoming = input.incidents.filter((incident) => isUpcoming(incident, now)).sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0));
  const recent = input.incidents
    .filter((incident) => {
      const ended = endedAt(incident, now);
      return ended !== null && now - ended < 14 * 86_400_000;
    })
    .sort((a, b) => (endedAt(b, now) ?? 0) - (endedAt(a, now) ?? 0));

  const shown = components.map((component) => component.state);
  const majorIncident = active.some((incident) => incident.kind === 'incident' && incident.impact === 'major');
  // The headline says major only when students cannot use LASUATOS (same rule as incidents).
  const downIds = components.filter((component) => component.state === 'down').map((component) => component.id);
  const majorOutage = downIds.length > 0 && impactOf(downIds, input.states) === 'major';
  const overall: Summary['overall'] = majorOutage || majorIncident
    ? 'down'
    : shown.includes('down') || shown.includes('degraded') || active.some((incident) => incident.kind === 'incident')
      ? 'degraded'
      : shown.includes('maintenance') ? 'maintenance' : 'operational';

  const from = Math.floor((now - 24 * 3_600_000) / 300_000) + 1;
  const site: Array<number | null> = [];
  const api: Array<number | null> = [];
  const buckets = new Map(input.latency.map((row) => [row.bucket, row]));
  for (let bucket = from; bucket < from + 288; bucket += 1) {
    const row = buckets.get(bucket);
    site.push(row && row.site_n ? Math.round(row.site_sum / row.site_n) : null);
    api.push(row && row.api_n ? Math.round(row.api_sum / row.api_n) : null);
  }

  return { generatedAt: now, lastCheckAt: input.lastCheckAt, overall, components, latency: { site, api, from: from * 300_000 }, active, upcoming, recent };
}

/** For the app banner (GET /api/notices.json; StatusNoticeSchema in the contracts). */
export function notices(summary: Summary, origin: string, now: number) {
  const soon = summary.upcoming.filter((incident) => incident.startsAt !== null && incident.startsAt - now < 24 * 3_600_000);
  return [...summary.active, ...soon].slice(0, 5).map((incident) => ({
    id: incident.id,
    kind: incident.kind,
    impact: incident.impact,
    title: incident.title,
    message: plain(incident.updates[0]?.body ?? '').slice(0, 400),
    startsAt: incident.startsAt === null ? null : new Date(incident.startsAt).toISOString(),
    endsAt: incident.endsAt === null ? null : new Date(incident.endsAt).toISOString(),
    updatedAt: new Date(incident.updates[0]?.at ?? incident.createdAt).toISOString(),
    url: `${origin}/incidents/${incident.id}`,
    stage: currentStage(incident, now),
  }));
}

/** Markdown to one plain line, for the banner. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*-\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
