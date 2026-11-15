/** Wording, grouping and filters for Staff. Pure, so it can be tested. */

import { STAFF_ACTIVITY_DAYS, type StaffInvitation, type StaffMember } from '@lasuatos/contracts';
import { shortDepartmentName } from '../../lib/department-options';

const DAY = 86_400_000;
/** Someone who joined this recently is not "quiet" yet: they may not have had a class. */
export const SETTLING_DAYS = 7;

export type Filter = 'all' | 'lecturers' | 'admins' | 'quiet' | 'suspended';
export const FILTERS: readonly Filter[] = ['all', 'lecturers', 'admins', 'quiet', 'suspended'];
export const FILTER_LABEL: Readonly<Record<Filter, string>> = {
  all: 'Everyone',
  lecturers: 'Lecturers',
  admins: 'Administrators',
  quiet: `No sessions in ${STAFF_ACTIVITY_DAYS} days`,
  suspended: 'Suspended',
};

export const SUSPEND_REASONS = ['Left the university', 'On extended leave', 'Account may be misused'] as const;
export const REACTIVATE_REASONS = ['Back from leave', 'Suspended by mistake', 'Returned to the university'] as const;
/** The API keeps a reason of 10 to 500 characters in the audit log. */
export const REASON_MIN = 10;

/** Error messages from staff-api, which throws plain `{ message }` objects. */
export function problem(caught: unknown, fallback: string): string {
  if (caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string' && caught.message) return caught.message;
  return fallback;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

const TITLES = /^(dr|prof|engr|mr|mrs|ms|miss|arc|pharm|barr|rev|alhaji|alhaja|chief)\.?$/i;
/** Two letters for an avatar, skipping titles: "Dr. Tunde Adeyemi" is TA. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => !TITLES.test(word));
  const letters = (words.length ? words : [name]).slice(0, 2).map((word) => [...word][0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

const isAdmin = (member: StaffMember) => member.role !== 'lecturer';

/** A lecturer who could be taking attendance but has not in the last 30 days. */
export function isQuiet(member: StaffMember, now: number): boolean {
  return member.role === 'lecturer'
    && member.status === 'active'
    && member.recentSessions === 0
    && now - Date.parse(member.joinedAt) > SETTLING_DAYS * DAY;
}

function normalise(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s.]+/g, '');
}

export function matches(member: StaffMember | StaffInvitation, query: string): boolean {
  const needle = normalise(query);
  if (!needle) return true;
  return [member.displayName, member.email, member.staffNumber ?? '', member.scopeLabel].some((value) => normalise(value).includes(needle));
}

export function applyFilter(members: readonly StaffMember[], filter: Filter, now: number): StaffMember[] {
  switch (filter) {
    case 'lecturers': return members.filter((member) => member.role === 'lecturer');
    case 'admins': return members.filter(isAdmin);
    case 'quiet': return members.filter((member) => isQuiet(member, now));
    case 'suspended': return members.filter((member) => member.status === 'suspended');
    default: return [...members];
  }
}

export type StaffGroup = { readonly key: string; readonly title: string; readonly aside: string | null; readonly members: StaffMember[] };

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byName = (a: { displayName: string }, b: { displayName: string }) => collator.compare(a.displayName, b.displayName);

/** "Electronic and Computer Engineering, Faculty of Engineering" → its two parts. */
export function splitArea(scopeLabel: string): { readonly name: string; readonly within: string | null } {
  const at = scopeLabel.indexOf(', ');
  if (at < 0) return { name: scopeLabel, within: null };
  return { name: scopeLabel.slice(0, at), within: scopeLabel.slice(at + 2) };
}

/**
 * Administrators first, then lecturers by department, each by name. With one department the
 * lecturers are simply "Lecturers".
 */
export function groupMembers(members: readonly StaffMember[]): StaffGroup[] {
  const admins = members.filter(isAdmin).sort(byName);
  const byArea = new Map<string, StaffMember[]>();
  for (const member of members) {
    if (isAdmin(member)) continue;
    const list = byArea.get(member.scopeLabel);
    if (list) list.push(member);
    else byArea.set(member.scopeLabel, [member]);
  }
  const groups: StaffGroup[] = [];
  if (admins.length) groups.push({ key: 'admins', title: 'Administrators', aside: null, members: admins });
  const areas = [...byArea.entries()].sort(([a], [b]) => collator.compare(shortDepartmentName(splitArea(a).name), shortDepartmentName(splitArea(b).name)));
  for (const [area, list] of areas) {
    const { name, within } = splitArea(area);
    groups.push({
      key: `area:${area}`,
      title: areas.length === 1 ? 'Lecturers' : shortDepartmentName(name),
      aside: areas.length === 1 ? null : within,
      members: list.sort(byName),
    });
  }
  return groups;
}

/** Invitations needing a new link first, then the newest. */
export function sortInvitations(invitations: readonly StaffInvitation[]): StaffInvitation[] {
  return [...invitations].sort((a, b) => Number(b.expired) - Number(a.expired) || b.sentAt.localeCompare(a.sentAt));
}

const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Africa/Lagos' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

/** Whole Lagos calendar days from `iso` to `now` (0 is today). */
function daysAgo(iso: string, now: number): number {
  return Math.round((Date.parse(lagosDay.format(new Date(now))) - Date.parse(lagosDay.format(new Date(iso)))) / DAY);
}

/** "12 Oct", or "12 Oct 2025" from another year. */
export function shortDate(iso: string, now: number): string {
  const sameYear = lagosDay.format(new Date(iso)).slice(0, 4) === lagosDay.format(new Date(now)).slice(0, 4);
  return (sameYear ? dayMonth : dayMonthYear).format(new Date(iso));
}

/** "Just now", "Today, 09:12", "Yesterday, 18:20", "Monday", "12 Oct"; "Never" when null. */
export function whenLabel(iso: string | null, now: number): string {
  if (!iso) return 'Never';
  if (now - Date.parse(iso) < 120_000) return 'Just now';
  const days = daysAgo(iso, now);
  if (days <= 0) return `Today, ${clock.format(new Date(iso))}`;
  if (days === 1) return `Yesterday, ${clock.format(new Date(iso))}`;
  if (days < 7) return weekday.format(new Date(iso));
  return shortDate(iso, now);
}

export type Tone = 'good' | 'warning' | 'none';

/** What their attendance-taking looks like lately, for a lecturer row and sheet. */
export function sessionsLine(member: StaffMember, now: number): { readonly text: string; readonly tone: Tone } {
  if (member.recentSessions > 0) return { text: `${plural(member.recentSessions, 'session')} in ${STAFF_ACTIVITY_DAYS} days`, tone: 'good' };
  const tone: Tone = isQuiet(member, now) ? 'warning' : 'none';
  if (member.lastSessionAt) return { text: `None since ${shortDate(member.lastSessionAt, now)}`, tone };
  return { text: 'No sessions yet', tone };
}

/** "Expires in 5 days", "Expires today", "Expired 2 days ago". */
export function expiryLine(invitation: StaffInvitation, now: number): string {
  const days = Math.round((Date.parse(invitation.expiresAt) - now) / DAY);
  if (invitation.expired) {
    const ago = Math.max(0, -days);
    return ago === 0 ? 'Expired today' : `Expired ${plural(ago, 'day')} ago`;
  }
  if (days <= 0) return 'Expires today';
  return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
}

export type StaffCounts = { readonly lecturers: number; readonly active: number; readonly quiet: number; readonly suspended: number; readonly admins: number };

export function countStaff(members: readonly StaffMember[], now: number): StaffCounts {
  let lecturers = 0, active = 0, quiet = 0, suspended = 0, admins = 0;
  for (const member of members) {
    if (member.status === 'suspended') suspended += 1;
    if (member.role !== 'lecturer') { admins += 1; continue; }
    lecturers += 1;
    if (member.status === 'active' && member.recentSessions > 0) active += 1;
    if (isQuiet(member, now)) quiet += 1;
  }
  return { lecturers, active, quiet, suspended, admins };
}

/** The directory's cache key; the overview's keys share the `admin:` prefix. */
export const DIRECTORY_KEY = 'admin:staff';

export const ROLE_SHORT: Readonly<Record<StaffMember['role'], string>> = {
  lecturer: 'Lecturer',
  department_administrator: 'Department admin',
  faculty_administrator: 'Faculty admin',
  institution_administrator: 'Institution admin',
};

/** "Department admin · Electronic & Computer Eng.": the role and, below the university, its area. */
export function roleLine(person: Pick<StaffMember, 'role' | 'scopeLabel'>): string {
  if (person.role === 'institution_administrator') return ROLE_SHORT[person.role];
  return `${ROLE_SHORT[person.role]} · ${shortDepartmentName(splitArea(person.scopeLabel).name)}`;
}
