/**
 * What the status page shows and how it decides (ADR 034). Pure functions only:
 * the Worker feeds in check results and stored state, and writes back what these
 * return, so every rule here is unit-tested.
 */

export type State = 'operational' | 'degraded' | 'down';
/** What LASUATOS reports for a part: `off` when it is turned off there (the row is hidden). */
export type ReportedState = State | 'off';

export const COMPONENTS = [
  { id: 'website', name: 'Website', hint: 'Pages load on phones and computers.' },
  { id: 'sign_in', name: 'Sign-in and accounts', hint: 'Signing in with your matric number or email, and opening an account.' },
  { id: 'google', name: 'Google sign-in', hint: 'Sign in with Google and Continue with Google.' },
  { id: 'attendance', name: 'Attendance check-in', hint: 'Scanning the QR code or typing the code, and the lecturer’s list.' },
  { id: 'face', name: 'Face check', hint: 'Confirming it’s you when you mark attendance.' },
  { id: 'email', name: 'Emails', hint: 'Sign-in codes, password codes and notices.' },
] as const;

export type ComponentId = (typeof COMPONENTS)[number]['id'];
export const COMPONENT_IDS: readonly ComponentId[] = COMPONENTS.map((component) => component.id);

const RANK: Record<State, number> = { operational: 0, degraded: 1, down: 2 };
export function worst(...states: readonly State[]): State {
  return states.reduce<State>((a, b) => (RANK[b] > RANK[a] ? b : a), 'operational');
}

/** One fetch of a page or endpoint, after its retry. */
export interface Probe {
  readonly ok: boolean;
  readonly ms: number | null;
  /** HTTP status, or 0 when nothing came back (timeout, DNS, TLS). */
  readonly status: number;
}

/** LASUATOS's own /api/v1/status answer (PublicStatusSchema in the contracts). */
export interface DeepReport {
  readonly core: ReportedState;
  readonly errors: ReportedState;
  readonly email: ReportedState;
  readonly google: ReportedState;
  readonly face: ReportedState;
}

/** Slower than this is shown as degraded: students notice a page that takes this long. */
export const SLOW_PAGE_MS = 6_000;
export const SLOW_API_MS = 4_000;
/** A deep report older than this is not used (the checker missed runs). */
export const DEEP_STALE_MS = 45 * 60_000;

const asState = (value: ReportedState): State => (value === 'off' ? 'operational' : value);

/**
 * Each part's state from one run. `null` means "not measured this run": keep what was shown.
 * The website is the page itself; everything else is served by the API, so the API being
 * unreachable takes it all down whatever the last deep report said.
 */
export function evaluate(site: Probe, api: Probe, deep: DeepReport | null): { states: Partial<Record<ComponentId, State>>; hidden: ComponentId[] } {
  const states: Partial<Record<ComponentId, State>> = {};
  const hidden: ComponentId[] = [];
  states.website = !site.ok ? 'down' : (site.ms ?? 0) > SLOW_PAGE_MS ? 'degraded' : 'operational';

  const apiState: State = !api.ok ? 'down' : (api.ms ?? 0) > SLOW_API_MS ? 'degraded' : 'operational';
  if (deep?.google === 'off') hidden.push('google');
  if (deep?.face === 'off') hidden.push('face');

  if (apiState === 'down') {
    for (const id of ['sign_in', 'google', 'attendance', 'face', 'email'] as const) states[id] = 'down';
    return { states, hidden };
  }
  if (!deep) {
    // Only the light check ran: it can make things worse, not say they are fine.
    if (apiState === 'degraded') for (const id of ['sign_in', 'attendance'] as const) states[id] = 'degraded';
    return { states, hidden };
  }
  const core = worst(apiState, asState(deep.core), asState(deep.errors));
  states.sign_in = core;
  states.attendance = core;
  states.google = worst(apiState, asState(deep.google));
  states.face = worst(apiState, asState(deep.face));
  states.email = worst(apiState, asState(deep.email));
  return { states, hidden };
}

/** Shown state plus the streaks that decide when it changes and when incidents open and close. */
export interface ComponentState {
  readonly state: State;
  /** When the shown state last changed (ms). */
  readonly since: number;
  /** Consecutive runs measured not operational. */
  readonly bad: number;
  /** Consecutive runs measured better than shown (operational, or degraded while down). */
  readonly good: number;
}

export const INITIAL: ComponentState = { state: 'operational', since: 0, bad: 0, good: 0 };
/** Runs measured fine in a row before a part is shown as fine again (each failure is already retried once). */
export const RECOVER_AFTER = 2;

/**
 * Moves one part on by one run. A worse state shows at once (every failure was retried
 * within the run first); getting better needs RECOVER_AFTER fine runs in a row, so a
 * flapping part does not flicker green.
 */
export function step(previous: ComponentState, measured: State | undefined, now: number): ComponentState {
  if (measured === undefined) return previous;
  if (measured === 'operational') {
    const good = previous.good + 1;
    if (previous.state !== 'operational' && good < RECOVER_AFTER) return { ...previous, bad: 0, good };
    return { state: 'operational', since: previous.state === 'operational' ? previous.since : now, bad: 0, good };
  }
  const bad = previous.bad + 1;
  if (RANK[measured] > RANK[previous.state]) return { state: measured, since: now, bad, good: 0 };
  if (RANK[measured] < RANK[previous.state]) {
    // down → degraded: a partial recovery, also shown after RECOVER_AFTER better runs in a row.
    const better = previous.good + 1;
    return better >= RECOVER_AFTER ? { state: measured, since: now, bad, good: 0 } : { ...previous, bad, good: better };
  }
  return { ...previous, bad, good: 0 };
}

/** Runs a part must stay wrong before an incident is opened (about two minutes). */
export const OPEN_AFTER = 2;
/** Runs everything must be fine before the automatic incident is closed. */
export const CLOSE_AFTER = 3;

export type Impact = 'minor' | 'major';

export interface AutoIncidentPlan {
  readonly action: 'open' | 'update' | 'close' | 'none';
  readonly components: ComponentId[];
  readonly impact: Impact;
}

/** Whether to open, widen or close the one automatic incident. */
export function planAutoIncident(states: Readonly<Record<ComponentId, ComponentState>>, open: { readonly components: readonly ComponentId[] } | null, hidden: readonly ComponentId[]): AutoIncidentPlan {
  const visible = COMPONENT_IDS.filter((id) => !hidden.includes(id));
  const affected = visible.filter((id) => states[id].state !== 'operational' && states[id].bad >= OPEN_AFTER);
  const impact = impactOf(affected, states);
  if (!open) return affected.length ? { action: 'open', components: affected, impact } : { action: 'none', components: [], impact };
  const allFine = visible.every((id) => states[id].state === 'operational' && states[id].good >= CLOSE_AFTER);
  if (allFine) return { action: 'close', components: [...open.components], impact };
  const widened = affected.filter((id) => !open.components.includes(id));
  return widened.length ? { action: 'update', components: [...open.components, ...widened], impact } : { action: 'none', components: [...open.components], impact };
}

export function impactOf(affected: readonly ComponentId[], states: Readonly<Record<ComponentId, ComponentState>>): Impact {
  const down = affected.filter((id) => states[id].state === 'down');
  if (down.some((id) => id === 'website' || id === 'sign_in' || id === 'attendance') || down.length >= 2) return 'major';
  return 'minor';
}

const NAMES: Record<ComponentId, string> = {
  website: 'The website',
  sign_in: 'Sign-in',
  google: 'Google sign-in',
  attendance: 'Attendance check-in',
  face: 'Face check',
  email: 'Emails',
};

/** A plain-words title for the automatic incident; nothing internal. */
export function autoTitle(components: readonly ComponentId[], states: Readonly<Record<ComponentId, ComponentState>>): string {
  if (components.includes('website') && states.website.state === 'down') return 'LASUATOS is not loading';
  if (components.includes('sign_in') && components.includes('attendance') && states.sign_in.state === 'down') return 'LASUATOS is not working right now';
  if (components.length === 1 && components[0] === 'email') return states.email.state === 'down' ? 'Emails are not being sent' : 'Emails are delayed';
  const names = components.map((id) => NAMES[id]);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!.toLowerCase()}`;
  const bad = components.some((id) => states[id].state === 'down');
  return `${list} ${bad ? (components.length === 1 ? 'is not working' : 'are not working') : (components.length === 1 ? 'is slow' : 'are slow')}`;
}

/** What students and lecturers can do meanwhile, per part. */
export const WORKAROUND: Record<ComponentId, string> = {
  website: 'Try again in a few minutes. If you are in class, tell your lecturer: they can mark you present afterwards.',
  sign_in: 'If you are in class, tell your lecturer: they can mark you present by hand once it is back.',
  google: 'Sign in with your matric number and password, or ask for an emailed code.',
  attendance: 'Lecturers: keep the class open a little longer, or mark students present by hand under Absent.',
  face: 'Students cannot confirm their face, so they cannot mark themselves present. Lecturers can mark students present by hand under Absent.',
  email: 'Codes may be slow or not arrive. If you can, use Continue with Google instead of an emailed code.',
};

export function autoBody(components: readonly ComponentId[], states: Readonly<Record<ComponentId, ComponentState>>, at: number): string {
  const lines = [
    `The status checker found a problem at ${clock(at)} WAT and is looking into it.`,
    '',
    ...components.map((id) => `- **${COMPONENTS.find((component) => component.id === id)!.name}** (${states[id].state === 'down' ? 'not working' : 'slow or failing at times'}): ${WORKAROUND[id]}`),
    '',
    // Instructions for maintainers, hidden from the status page (it drops <!-- --> text).
    '<!-- Opened automatically by the status checker; it closes by itself when everything is back to normal. Your comments appear on the status page as updates: start one with Investigating, Identified, Monitoring or Resolved to set the stage. Text inside these comment marks stays private. -->',
  ];
  return lines.join('\n');
}

export function autoResolution(started: number, at: number): string {
  const minutes = Math.max(1, Math.round((at - started) / 60_000));
  return `Resolved: everything has been working normally again since ${clock(at)} WAT (about ${duration(minutes)} after the problem was found).`;
}

/** West Africa Time is UTC+1 all year (no daylight saving). */
export const WAT_OFFSET_MS = 60 * 60_000;

export function watDay(at: number): string {
  return new Date(at + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

export function clock(at: number): string {
  return new Date(at + WAT_OFFSET_MS).toISOString().slice(11, 16);
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * Whether this run does the deep check (LASUATOS's /api/v1/status, which wakes the
 * database). Every DEEP_EVERY_DAY minutes from 06:00 to 21:59 WAT, every
 * DEEP_EVERY_NIGHT at night so the free database can sleep, and every run while
 * anything is wrong so recovery is seen at once.
 */
export function deepDue(at: number, lastDeep: number | null, troubled: boolean, everyDay: number, everyNight: number): boolean {
  if (troubled || lastDeep === null) return true;
  const hour = new Date(at + WAT_OFFSET_MS).getUTCHours();
  const every = hour >= 6 && hour < 22 ? everyDay : everyNight;
  // A little slack so a run that fires a few seconds early still counts.
  return at - lastDeep >= every * 60_000 - 20_000;
}
