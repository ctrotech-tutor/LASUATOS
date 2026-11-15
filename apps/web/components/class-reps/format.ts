import { academicSetLabel, CLASS_REP_ACTIVITY_DAYS, type ClassRep, type ClassRepList, type ClassRepListSet, type ClassRepRole } from '@lasuatos/contracts';
import { shortDepartmentName } from '../../lib/department-options';
import { plural, shortDate } from '../staff/format';

export const PATH = '/class-reps';
export const REPS_KEY = 'class-reps';
/** A search field appears once there are this many posts. */
export const SEARCH_FROM = 8;
/** New reps get a week before an empty record counts as quiet. */
export const SETTLING_DAYS = 7;
const DAY = 86_400_000;

export const ROLE_NAME: Readonly<Record<ClassRepRole, string>> = { hoc: 'HOC', ghoc: 'GHOC' };

/**
 * One post: the GHOC of a faculty's set, or the HOC of a department's set. A post is open when
 * no one holds it. More than one person can hold a post (a big class may share it).
 */
export interface Post {
  readonly key: string;
  readonly role: ClassRepRole;
  readonly facultyId: string;
  readonly facultyName: string;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  /** "ECE"; empty for a GHOC post or when the department has no code. */
  readonly departmentCode: string;
  readonly entryYear: number;
  readonly holders: readonly ClassRep[];
  /** The department's class list for this set (HOC posts only). */
  readonly list: ClassRepListSet | null;
  /** Whether this viewer may appoint someone to it. */
  readonly canAppoint: boolean;
}

export interface PostGroup {
  readonly key: string;
  readonly title: string;
  readonly entryYear: number;
  readonly facultyId: string;
  readonly posts: readonly Post[];
}

export type Show = 'all' | 'open' | 'quiet';
export const SHOWS: readonly Show[] = ['all', 'open', 'quiet'];
export const SHOW_LABEL: Readonly<Record<Show, string>> = { all: 'All posts', open: 'No rep yet', quiet: 'Quiet reps' };

/** What the address asks for: `?set=2022&show=open`. */
export interface View {
  readonly set: number | null;
  readonly show: Show;
}

export function readView(params: { get: (name: string) => string | null } | null): View {
  const rawSet = params?.get('set') ?? '';
  const rawShow = params?.get('show') ?? '';
  return {
    set: /^\d{4}$/.test(rawSet) ? Number(rawSet) : null,
    show: SHOWS.includes(rawShow as Show) ? rawShow as Show : 'all',
  };
}

export function viewHref(pathname: string, view: View): string {
  const search = new URLSearchParams();
  if (view.set !== null) search.set('set', String(view.set));
  if (view.show !== 'all') search.set('show', view.show);
  const text = search.toString();
  return text ? `${pathname}?${text}` : pathname;
}

/** "Faculty of Engineering" → "Engineering". */
export function shortFacultyName(name: string): string {
  return name.replace(/^faculty\s+of\s+(the\s+)?/i, '').trim() || name;
}

export function postKey(role: ClassRepRole, placeId: string, entryYear: number): string {
  return `${role}:${placeId}:${entryYear}`;
}

/** The place a post covers, in a few words: "Electronic and Computer Engineering", or the faculty. */
export function postPlace(post: Pick<Post, 'role' | 'departmentName' | 'facultyName'>): string {
  return post.role === 'hoc' && post.departmentName ? shortDepartmentName(post.departmentName) : post.facultyName;
}

/** "HOC, Electronic and Computer Engineering". */
export function postTitle(post: Pick<Post, 'role' | 'departmentName' | 'facultyName'>): string {
  return `${ROLE_NAME[post.role]}, ${postPlace(post)}`;
}

/** Where a rep serves, as a post (for a rep's sheet and for "replace"). */
export function postOf(rep: ClassRep, data: ClassRepList): Post {
  const department = rep.departmentId ? data.departments.find((item) => item.id === rep.departmentId) : undefined;
  const placeId = rep.role === 'hoc' && rep.departmentId ? rep.departmentId : rep.facultyId;
  const key = postKey(rep.role, placeId, rep.entryYear);
  return {
    key,
    role: rep.role,
    facultyId: rep.facultyId,
    facultyName: rep.facultyName,
    departmentId: rep.departmentId,
    departmentName: rep.departmentName,
    departmentCode: department?.code ?? '',
    entryYear: rep.entryYear,
    holders: data.reps.filter((item) => postKey(item.role, item.role === 'hoc' && item.departmentId ? item.departmentId : item.facultyId, item.entryYear) === key),
    list: rep.departmentId ? data.lists.find((item) => item.departmentId === rep.departmentId && item.entryYear === rep.entryYear) ?? null : null,
    canAppoint: canAppointTo(data, rep.role, rep.role === 'hoc' ? rep.departmentId : rep.facultyId, rep.entryYear),
  };
}

/** Whether the viewer may appoint to a post (the server checks again). */
export function canAppointTo(data: Pick<ClassRepList, 'departments' | 'faculties' | 'fixedEntryYear'>, role: ClassRepRole, placeId: string | null, entryYear: number): boolean {
  if (!placeId) return false;
  if (data.fixedEntryYear !== null && entryYear !== data.fixedEntryYear) return false;
  return role === 'hoc' ? data.departments.some((item) => item.id === placeId) : data.faculties.some((item) => item.id === placeId);
}

/**
 * Every post the viewer should see. A set counts in a faculty once something happens in it there
 * (a class list or a rep); then each department of the faculty has a HOC post for it, and the
 * faculty a GHOC post (for those who may appoint GHOCs, or when one is held). A GHOC always
 * sees their own set, even before any list is uploaded.
 */
export function buildPosts(data: ClassRepList): Post[] {
  const departments = new Map(data.departments.map((item) => [item.id, item]));
  const facultyNames = new Map<string, string>();
  for (const item of data.departments) facultyNames.set(item.facultyId, item.facultyName);
  for (const item of data.faculties) facultyNames.set(item.id, item.name);
  for (const rep of data.reps) facultyNames.set(rep.facultyId, rep.facultyName);

  // Which sets are in use in which faculty.
  const sets = new Map<string, Set<number>>();
  const markSet = (facultyId: string, year: number) => {
    const years = sets.get(facultyId) ?? new Set<number>();
    years.add(year);
    sets.set(facultyId, years);
  };
  for (const list of data.lists) {
    const department = departments.get(list.departmentId);
    if (department) markSet(department.facultyId, list.entryYear);
  }
  for (const rep of data.reps) markSet(rep.facultyId, rep.entryYear);
  if (data.fixedEntryYear !== null) for (const item of data.departments) markSet(item.facultyId, data.fixedEntryYear);

  const holders = new Map<string, ClassRep[]>();
  for (const rep of data.reps) {
    const key = postKey(rep.role, rep.role === 'hoc' && rep.departmentId ? rep.departmentId : rep.facultyId, rep.entryYear);
    holders.set(key, [...(holders.get(key) ?? []), rep]);
  }
  const lists = new Map(data.lists.map((item) => [`${item.departmentId}:${item.entryYear}`, item]));
  const ghocFaculties = new Set(data.faculties.map((item) => item.id));

  const posts: Post[] = [];
  const seen = new Set<string>();
  for (const [facultyId, years] of sets) {
    const facultyName = facultyNames.get(facultyId) ?? 'Faculty';
    for (const entryYear of years) {
      const ghocKey = postKey('ghoc', facultyId, entryYear);
      if (ghocFaculties.has(facultyId) || holders.has(ghocKey)) {
        seen.add(ghocKey);
        posts.push({
          key: ghocKey, role: 'ghoc', facultyId, facultyName, departmentId: null, departmentName: null, departmentCode: '', entryYear,
          holders: holders.get(ghocKey) ?? [], list: null, canAppoint: canAppointTo(data, 'ghoc', facultyId, entryYear),
        });
      }
      for (const department of data.departments) {
        if (department.facultyId !== facultyId) continue;
        const key = postKey('hoc', department.id, entryYear);
        seen.add(key);
        posts.push({
          key, role: 'hoc', facultyId, facultyName, departmentId: department.id, departmentName: department.name, departmentCode: department.code, entryYear,
          holders: holders.get(key) ?? [], list: lists.get(`${department.id}:${entryYear}`) ?? null, canAppoint: canAppointTo(data, 'hoc', department.id, entryYear),
        });
      }
    }
  }
  // Reps whose department is outside the viewer's list of departments still show.
  for (const rep of data.reps) {
    const key = postKey(rep.role, rep.role === 'hoc' && rep.departmentId ? rep.departmentId : rep.facultyId, rep.entryYear);
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(postOf(rep, data));
  }
  return posts.sort(comparePosts);
}

function comparePosts(a: Post, b: Post): number {
  return b.entryYear - a.entryYear
    || a.facultyName.localeCompare(b.facultyName)
    || (a.role === b.role ? 0 : a.role === 'ghoc' ? -1 : 1)
    || postPlace(a).localeCompare(postPlace(b));
}

/** Posts in sections, one per set and faculty. The faculty is named only when there are several. */
export function groupPosts(posts: readonly Post[]): PostGroup[] {
  const faculties = new Set(posts.map((post) => post.facultyId));
  const groups: { key: string; title: string; entryYear: number; facultyId: string; posts: Post[] }[] = [];
  for (const post of posts) {
    const key = `${post.entryYear}:${post.facultyId}`;
    let group = groups.find((item) => item.key === key);
    if (!group) {
      const set = academicSetLabel(post.entryYear);
      group = { key, title: faculties.size > 1 ? `${set} · ${shortFacultyName(post.facultyName)}` : set, entryYear: post.entryYear, facultyId: post.facultyId, posts: [] };
      groups.push(group);
    }
    group.posts.push(post);
  }
  return groups;
}

/** No sessions in the activity window, after a settling-in week. */
export function isQuiet(rep: Pick<ClassRep, 'recentSessions' | 'appointedAt'>, now: number): boolean {
  return rep.recentSessions === 0 && now - Date.parse(rep.appointedAt) >= SETTLING_DAYS * DAY;
}

export type Tone = 'good' | 'warning' | 'none';

/** How a rep uses the app lately, in a few words. */
export function activityLine(rep: Pick<ClassRep, 'recentSessions' | 'lastSessionAt' | 'appointedAt'>, now: number): { readonly text: string; readonly tone: Tone } {
  if (rep.recentSessions > 0) return { text: `${plural(rep.recentSessions, 'session')} in ${CLASS_REP_ACTIVITY_DAYS} days`, tone: 'good' };
  const tone: Tone = isQuiet(rep, now) ? 'warning' : 'none';
  if (rep.lastSessionAt) return { text: `None since ${shortDate(rep.lastSessionAt, now)}`, tone };
  return { text: tone === 'warning' ? 'No sessions yet' : 'New, no sessions yet', tone };
}

/** What an open post's class list says: "48 on the list · 30 with accounts". */
export function listLine(post: Pick<Post, 'role' | 'list'>): string {
  if (post.role === 'ghoc') return 'Covers every department in the set';
  if (!post.list) return 'No class list yet';
  return `${post.list.students.toLocaleString('en-NG')} on the list · ${post.list.withAccounts.toLocaleString('en-NG')} with accounts`;
}

export interface RepCounts {
  readonly reps: number;
  readonly hocs: number;
  readonly ghocs: number;
  readonly open: number;
  readonly active: number;
  readonly quiet: number;
}

export function countPosts(posts: readonly Post[], now: number): RepCounts {
  const reps = posts.flatMap((post) => post.holders);
  return {
    reps: reps.length,
    hocs: reps.filter((rep) => rep.role === 'hoc').length,
    ghocs: reps.filter((rep) => rep.role === 'ghoc').length,
    open: posts.filter((post) => post.holders.length === 0 && post.canAppoint).length,
    active: reps.filter((rep) => rep.recentSessions > 0).length,
    quiet: reps.filter((rep) => isQuiet(rep, now)).length,
  };
}

/** Whether a post matches typed words: names, matric numbers, emails, places, codes and roles. */
export function postMatches(post: Post, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [
    ROLE_NAME[post.role],
    post.departmentName ?? '',
    post.departmentCode,
    post.facultyName,
    academicSetLabel(post.entryYear),
    String(post.entryYear),
    ...post.holders.flatMap((rep) => [rep.studentName, rep.matricNumber, rep.email]),
    post.holders.length ? '' : 'no rep open vacant',
  ].join(' ').toLowerCase();
  return words.every((word) => text.includes(word));
}

/** Posts for the chosen set and filter. An open post shows only to someone who could fill it. */
export function filterPosts(posts: readonly Post[], view: View, query: string, now: number): Post[] {
  return posts.filter((post) => {
    if (view.set !== null && post.entryYear !== view.set) return false;
    if (post.holders.length === 0 && !post.canAppoint && view.show !== 'all') return false;
    if (view.show === 'open' && (post.holders.length > 0 || !post.canAppoint)) return false;
    if (view.show === 'quiet' && !post.holders.some((rep) => isQuiet(rep, now))) return false;
    return postMatches(post, query);
  });
}

/** Sets in use, newest first. */
export function setsInUse(posts: readonly Post[]): number[] {
  return [...new Set(posts.map((post) => post.entryYear))].sort((a, b) => b - a);
}

/** Sets to appoint for: those in use and the last eight, newest first. */
export function setChoices(posts: readonly Post[], now: number): number[] {
  const year = new Date(now || Date.now()).getFullYear();
  const years = new Set(setsInUse(posts));
  for (let index = 0; index < 8; index += 1) years.add(year - index);
  return [...years].sort((a, b) => b - a);
}

/** Where an appointment is, for under the success screen's title: "Mechanical Engineering, 2022/2023 set." */
export function appointedLine(rep: Pick<ClassRep, 'role' | 'departmentName' | 'facultyName' | 'setLabel'>): string {
  return `${rep.role === 'hoc' && rep.departmentName ? shortDepartmentName(rep.departmentName) : rep.facultyName}, ${rep.setLabel}.`;
}

/** A class list link for a post: the department's set, or every list in the faculty's set. */
export function classListHref(post: Pick<Post, 'role' | 'departmentCode' | 'entryYear'>): string {
  const search = new URLSearchParams();
  if (post.role === 'hoc' && post.departmentCode) search.set('department', post.departmentCode.toLowerCase());
  search.set('set', String(post.entryYear));
  return `/class-list?${search.toString()}`;
}
