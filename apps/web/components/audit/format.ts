import { AUDIT_ENTRY_ID_PATTERN, AuditCategorySchema, type AuditCategory, type AuditLogEntry, type AuditLogQuery } from '@lasuatos/contracts';

export const PATH = '/admin/audit';
export const LIST_PREFIX = 'admin:audit:list:';
export const ENTRY_PREFIX = 'admin:audit:entry:';
export const SUMMARY_KEY = 'admin:audit:summary';

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type Show = 'all' | 'notable';
/** Presets stay relative: a saved "last 7 days" link means the last 7 days when it is opened. */
export type Period = 'all' | 'today' | '7d' | '30d' | 'custom';
export const PERIODS: readonly Period[] = ['all', 'today', '7d', '30d', 'custom'];

/** Everything the address bar holds: `?show=notable&category=faces&period=7d&q=2502&actor=<id>&entry=student:<id>`. */
export type View = {
  readonly show: Show;
  readonly category: AuditCategory | null;
  readonly period: Period;
  /** Custom dates (ISO days, Lagos); only with period 'custom'. */
  readonly from: string;
  readonly to: string;
  readonly q: string;
  readonly actor: string | null;
  readonly entry: string | null;
};

export const EMPTY_VIEW: View = { show: 'all', category: null, period: 'all', from: '', to: '', q: '', actor: null, entry: null };

export function readView(params: { get(name: string): string | null } | null): View {
  const category = AuditCategorySchema.safeParse(params?.get('category'));
  const from = params?.get('from') ?? '';
  const to = params?.get('to') ?? '';
  const period = params?.get('period');
  const custom = ISO_DAY.test(from) || ISO_DAY.test(to) || period === 'custom';
  const actor = params?.get('actor') ?? '';
  const entry = params?.get('entry') ?? '';
  return {
    show: params?.get('show') === 'notable' ? 'notable' : 'all',
    category: category.success ? category.data : null,
    period: custom ? 'custom' : period === 'today' || period === '7d' || period === '30d' ? period : 'all',
    from: ISO_DAY.test(from) ? from : '',
    to: ISO_DAY.test(to) ? to : '',
    q: (params?.get('q') ?? '').slice(0, 120),
    actor: UUID.test(actor) ? actor.toLowerCase() : null,
    entry: AUDIT_ENTRY_ID_PATTERN.test(entry) ? entry.toLowerCase() : null,
  };
}

/** Defaults stay out of the address, so `/admin/audit` is everything, newest first. */
export function viewHref(path: string, view: View): string {
  const params = new URLSearchParams();
  if (view.show !== 'all') params.set('show', view.show);
  if (view.category) params.set('category', view.category);
  if (view.period === 'custom') {
    if (view.from) params.set('from', view.from);
    if (view.to) params.set('to', view.to);
    if (!view.from && !view.to) params.set('period', 'custom');
  } else if (view.period !== 'all') params.set('period', view.period);
  if (view.q.trim()) params.set('q', view.q.trim());
  if (view.actor) params.set('actor', view.actor);
  if (view.entry) params.set('entry', view.entry);
  // Entry ids read better with their colon ("student:…"), which a query string may hold as is.
  const search = params.toString().replace(/%3A/gi, ':');
  return search ? `${path}?${search}` : path;
}

/* ---------- Days in Lagos ---------- */

const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });

/** Today in Lagos as an ISO day. */
export const lagosToday = (now: number) => lagosDay.format(now);

export function addDays(iso: string, days: number): string {
  const time = Date.parse(`${iso}T00:00:00Z`) + days * DAY;
  return new Date(time).toISOString().slice(0, 10);
}

/** The dates a period covers, as the API wants them; empty for all time. */
export function periodRange(view: Pick<View, 'period' | 'from' | 'to'>, now: number): { from?: string; to?: string } {
  const today = lagosToday(now);
  switch (view.period) {
    case 'today': return { from: today, to: today };
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'custom': return { ...(view.from ? { from: view.from } : {}), ...(view.to ? { to: view.to } : {}) };
    default: return {};
  }
}

/** The API query for a view (without a cursor). */
export function queryOf(view: View, now: number): Omit<AuditLogQuery, 'cursor'> {
  return {
    ...(view.category ? { category: view.category } : {}),
    ...(view.q.trim() ? { q: view.q.trim() } : {}),
    ...periodRange(view, now),
    ...(view.actor ? { actor: view.actor } : {}),
    ...(view.show === 'notable' ? { notable: 'true' as const } : {}),
  };
}

export const listKey = (view: View, now: number) => {
  const query = queryOf(view, now);
  return `${LIST_PREFIX}${[query.category, query.q?.toLowerCase(), query.from, query.to, query.actor, query.notable].map((part) => part ?? '').join(':')}`;
};
export const entryKey = (id: string) => `${ENTRY_PREFIX}${id}`;

/** Filters besides the default list (anything that narrows it). */
export const isFiltered = (view: View) => Boolean(view.show !== 'all' || view.category || view.period !== 'all' || view.q.trim() || view.actor);

/* ---------- Words ---------- */

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? word : many}`;
}

export const CATEGORY_LABEL: Readonly<Record<AuditCategory, string>> = {
  students: 'Students and class lists',
  faces: 'Faces',
  attendance: 'Attendance changes',
  staff: 'Staff',
  structure: 'Academic structure',
  venues: 'Venues',
  retention: 'Data retention',
};

export const CATEGORY_SHORT: Readonly<Record<AuditCategory, string>> = {
  students: 'Students',
  faces: 'Faces',
  attendance: 'Attendance',
  staff: 'Staff',
  structure: 'Structure',
  venues: 'Venues',
  retention: 'Retention',
};

export const CATEGORY_HINT: Readonly<Record<AuditCategory, string>> = {
  students: 'Class lists, accounts, emails',
  faces: 'Registered, checks, reviews',
  attendance: 'Added by hand, removed, help',
  staff: 'Invitations, suspensions, edits',
  structure: 'Faculties, departments, sessions',
  venues: 'Buildings, venues, locations',
  retention: 'Face data deleted after graduation',
};

export const CATEGORIES = AuditCategorySchema.options;

export const PERIOD_LABEL: Readonly<Record<Period, string>> = {
  all: 'Any time',
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Pick dates',
};

/** "Ada Bello-Ojo" → "AB"; "Dr. Ada Bello-Ojo" → "AB". */
export function initials(name: string): string {
  const words = name.replace(/\b(dr|prof|mr|mrs|ms|engr|arc)\.?\s+/gi, '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words.at(-1)![0] : '')).toUpperCase() || '?';
}

/** The first name, or a title and surname: "Dr Bello-Ojo", "Kunle". */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? name;
  if (/^(dr|prof|professor|mr|mrs|ms|engr|arc)\.?$/i.test(first) && words.length > 1) return `${first.replace(/\.$/, '')} ${words.at(-1)}`;
  return first;
}

/* ---------- Times ---------- */

const timeOfDay = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const weekdayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Africa/Lagos' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const fullWhenFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

const dayNumber = (time: number) => Math.floor(Date.parse(`${lagosDay.format(time)}T00:00:00Z`) / DAY);
/** Whole calendar days (in Lagos) from `from` to `to`. */
export const calendarDays = (from: string | number, to: number) => dayNumber(to) - dayNumber(typeof from === 'number' ? from : Date.parse(from));

export const clock = (iso: string) => timeOfDay.format(Date.parse(iso));

/** A day heading: Today, Yesterday, Thursday (this week), Thu 5 Nov, then Thu 5 Nov 2025. */
export function dayLabel(iso: string, now: number): string {
  const days = calendarDays(iso, now);
  const at = Date.parse(iso);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekdayLong.format(at);
  return (days < 300 ? dayMonth : dayMonthYear).format(at).replace(',', '');
}

/** For a row: 14:05 today, Yesterday 14:05, Thu 14:05, then 5 Nov. */
export function rowTime(iso: string, now: number): string {
  const days = calendarDays(iso, now);
  if (days <= 0) return clock(iso);
  if (days === 1) return `Yesterday ${clock(iso)}`;
  if (days < 7) return `${weekdayLong.format(Date.parse(iso)).slice(0, 3)} ${clock(iso)}`;
  return shortDay.format(Date.parse(iso));
}

export const fullWhen = (iso: string) => fullWhenFormat.format(Date.parse(iso)).replace(/,(?=[^,]*$)/, ' at').replace(',', '');

export function agoLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = calendarDays(iso, now);
  if (days < 45) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30.4);
  return months < 12 ? `${months} months ago` : `${Math.round(days / 365)} year${Math.round(days / 365) === 1 ? '' : 's'} ago`;
}

export type DayGroup = { readonly key: string; readonly label: string; readonly entries: readonly AuditLogEntry[] };

/** Entries (newest first) in Lagos days. */
export function groupByDay(entries: readonly AuditLogEntry[], now: number): DayGroup[] {
  const groups: { key: string; label: string; entries: AuditLogEntry[] }[] = [];
  for (const entry of entries) {
    const key = lagosDay.format(Date.parse(entry.at));
    const last = groups.at(-1);
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, label: dayLabel(entry.at, now), entries: [entry] });
  }
  return groups;
}

/** Against the same number of days before: "12 more than the week before". */
export function trendLabel(total: number, previous: number): string {
  if (previous === 0) return total === 0 ? 'none the week before either' : 'none the week before';
  const difference = total - previous;
  if (difference === 0) return 'same as the week before';
  return `${Math.abs(difference).toLocaleString('en-NG')} ${difference > 0 ? 'more' : 'fewer'} than the week before`;
}

/** "between 2 Nov and 9 Nov", "since 2 Nov", "today". */
export function periodWords(view: Pick<View, 'period' | 'from' | 'to'>): string | null {
  const day = (iso: string) => shortDay.format(Date.parse(`${iso}T12:00:00Z`));
  switch (view.period) {
    case 'today': return 'today';
    case '7d': return 'in the last 7 days';
    case '30d': return 'in the last 30 days';
    case 'custom':
      if (view.from && view.to) return view.from === view.to ? `on ${day(view.from)}` : `between ${day(view.from)} and ${day(view.to)}`;
      if (view.from) return `since ${day(view.from)}`;
      if (view.to) return `up to ${day(view.to)}`;
      return null;
    default: return null;
  }
}

/** What the list shows, in words: "12 entries about faces by Kunle Bakare in the last 7 days". */
export function resultLine(view: View, count: number, more: boolean, actorName: string | null): string {
  const parts = [`${plural(count, view.show === 'notable' ? 'entry worth a look' : 'entry', view.show === 'notable' ? 'entries worth a look' : 'entries')}${more ? '+' : ''}`];
  if (view.category) parts.push(`in ${CATEGORY_LABEL[view.category].toLowerCase()}`);
  if (view.actor) parts.push(`by ${actorName ?? 'this person'}`);
  if (view.q.trim()) parts.push(`matching “${view.q.trim()}”`);
  const period = periodWords(view);
  if (period) parts.push(period);
  return parts.join(' ');
}

/** Copy text, falling back to a hidden text area where the Clipboard API is missing or refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused: try the old way.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  (document.querySelector('dialog[open]') ?? document.body).append(area);
  area.select();
  let done = false;
  try {
    done = document.execCommand('copy');
  } catch {
    done = false;
  }
  area.remove();
  active?.focus({ preventScroll: true });
  return done;
}

/* ---------- One entry ---------- */

/** Who acted, in words: a name, or the nightly job for retention runs. */
export const actorLabel = (entry: Pick<AuditLogEntry, 'actorName' | 'category'>) =>
  entry.actorName ?? (entry.category === 'retention' ? 'Scheduled clean-up' : 'LASUATOS');

/** "4 years → 5 years" in plain text (for copying and the CSV). */
export const factText = (fact: AuditLogEntry['facts'][number]) =>
  fact.previous !== null ? `${fact.label}: ${fact.previous} to ${fact.value}` : `${fact.label}: ${fact.value}`;

/** The stored record laid out to read: indented JSON when it is JSON, else as stored. */
export function prettyRecord(details: string): string {
  const text = details.trim();
  if (!text) return '';
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

/** An entry as plain text, to paste into an email or a report. */
export function entryText(entry: AuditLogEntry, origin: string): string {
  return [
    entry.summary,
    `When: ${fullWhen(entry.at)}`,
    `By: ${actorLabel(entry)}`,
    entry.subject ? `About: ${entry.subject}` : null,
    ...entry.facts.map(factText),
    entry.note ? `Note: ${entry.note}` : null,
    `Entry: ${origin}${PATH}?entry=${entry.id}`,
  ].filter(Boolean).join('\n');
}

/** The first change worth showing in the list ("Programme length 4 years → 5 years"). */
export const firstChange = (entry: AuditLogEntry) => entry.facts.find((fact) => fact.previous !== null) ?? null;
