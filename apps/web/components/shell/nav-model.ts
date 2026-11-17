/**
 * What the signed-in app frame shows for each kind of account: the pages, how they group in
 * the sidebar, which ones sit in the phone tab bar, and what the bars call the current page.
 * Plain data and functions, shared by the sidebar, the tab bar, "More" and the page search.
 */

import {
  BarChart3,
  BookMarked,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileClock,
  GraduationCap,
  HandHelping,
  Inbox,
  Landmark,
  LayoutDashboard,
  ListChecks,
  MapPinned,
  MessageSquareWarning,
  QrCode,
  Scale,
  ScanFace,
  ScanLine,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { canonicalCourseCode, isClassRepTaker, repRoleShort, type LectureCapabilities } from '@lasuatos/contracts';

export type NavItem = {
  readonly href: string;
  /** Sidebar, "More" and page search: "Attendance overview". */
  readonly label: string;
  /** Phone tab bar: "Reports". */
  readonly short: string;
  readonly icon: typeof ScanLine;
  /** Sidebar group; the first group of a menu may have none. */
  readonly group: string | null;
  /** Kept in the phone tab bar ahead of the others when they do not all fit. */
  readonly tab?: boolean;
  /** Shown only when the enrolled-course tools are in use. */
  readonly enrolledCourses?: boolean;
  /** Institution administrators only (messages to the LASUATOS team). */
  readonly institutionOnly?: boolean;
};

export type NavGroup = { readonly label: string | null; readonly items: readonly NavItem[] };

/** The phone tab bar holds five slots; with more pages the fifth becomes "More". */
export const PHONE_SLOTS = 5;

const ADMIN_NAV: readonly NavItem[] = [
  { href: '/admin', label: 'Overview', short: 'Overview', icon: LayoutDashboard, group: null, tab: true },
  { href: '/sessions', label: 'Take attendance', short: 'Attendance', icon: QrCode, group: 'Attendance', tab: true },
  { href: '/admin/attendance', label: 'Attendance overview', short: 'Reports', icon: BarChart3, group: 'Attendance', tab: true },
  { href: '/registers', label: 'Course registers', short: 'Registers', icon: ClipboardList, group: 'Attendance' },
  { href: '/face-checks', label: 'Face checks', short: 'Face checks', icon: ScanFace, group: 'Attendance' },
  { href: '/admin/appeals', label: 'Attendance appeals', short: 'Appeals', icon: Scale, group: 'Attendance' },
  { href: '/admin/staff', label: 'Staff', short: 'Staff', icon: UserPlus, group: 'People', tab: true },
  { href: '/class-list', label: 'Class lists', short: 'Class lists', icon: ListChecks, group: 'People' },
  { href: '/class-reps', label: 'Class reps', short: 'Class reps', icon: UsersRound, group: 'People' },
  { href: '/admin/venues', label: 'Venues', short: 'Venues', icon: MapPinned, group: 'Institution' },
  { href: '/admin/courses', label: 'Course list', short: 'Courses', icon: BookMarked, group: 'Institution' },
  { href: '/admin/structure', label: 'Academic structure', short: 'Structure', icon: Landmark, group: 'Institution' },
  { href: '/admin/messages', label: 'Messages', short: 'Messages', icon: Inbox, group: 'Records', institutionOnly: true },
  { href: '/admin/audit', label: 'Audit log', short: 'Audit log', icon: FileClock, group: 'Records' },
  { href: '/admin/retention', label: 'Data retention', short: 'Retention', icon: ShieldCheck, group: 'Records' },
];

const LECTURER_NAV: readonly NavItem[] = [
  { href: '/sessions', label: 'Take attendance', short: 'Attendance', icon: QrCode, group: 'Attendance', tab: true },
  { href: '/registers', label: 'Course registers', short: 'Registers', icon: ClipboardList, group: 'Attendance', tab: true },
  { href: '/face-checks', label: 'Face checks', short: 'Face checks', icon: ScanFace, group: 'Attendance', tab: true },
  { href: '/lecturer/courses', label: 'Course tools', short: 'Courses', icon: BookOpenCheck, group: 'Courses', tab: true },
  { href: '/lecturer/attendance', label: 'Course sessions', short: 'Sessions', icon: CalendarClock, group: 'Courses', enrolledCourses: true },
  { href: '/lecturer/reports', label: 'Attendance reports', short: 'Reports', icon: BarChart3, group: 'Courses', enrolledCourses: true },
  { href: '/lecturer/disputes', label: 'Attendance disputes', short: 'Disputes', icon: MessageSquareWarning, group: 'Courses', enrolledCourses: true },
];

export function isActive(href: string, pathname: string): boolean {
  // A course code's check-in is where a scan lands, so it stays under the Scan tab.
  if (href === '/a' && pathname.startsWith('/check-in')) return true;
  // The administration home is a prefix of its sub-pages; match it exactly.
  return href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export type ShellRole = 'administrator' | 'lecturer' | 'student';

/**
 * The menu for this account. The enrolled-course pages (reports, disputes and sessions for
 * course offerings) only matter once a lecturer has created an offering, so until then the
 * lecturer menu stays on QR attendance; disputes always show while any are open. Class reps
 * get their tools in a group of their own.
 */
export function navigationFor(input: {
  readonly role: ShellRole;
  readonly pathname: string;
  readonly capabilities: LectureCapabilities | null;
  readonly openDisputes: number;
  readonly institutionAdmin: boolean;
}): NavItem[] {
  const { role, pathname, capabilities } = input;
  if (role === 'administrator') {
    return ADMIN_NAV.filter((item) => !item.institutionOnly || input.institutionAdmin || isActive(item.href, pathname));
  }
  if (role === 'lecturer') {
    return LECTURER_NAV.filter((item) => !item.enrolledCourses
      || capabilities?.usesEnrolledCourses
      || (item.href === '/lecturer/disputes' && input.openDisputes > 0)
      || isActive(item.href, pathname));
  }
  const items: NavItem[] = [
    { href: '/a', label: 'Mark attendance', short: 'Scan', icon: ScanLine, group: null, tab: true },
    { href: '/attendance', label: 'My attendance', short: 'History', icon: ClipboardCheck, group: null, tab: true },
  ];
  // Joining a course with an enrollment code is only useful once lecturers use course offerings.
  if (capabilities?.usesEnrolledCourses || isActive('/courses', pathname)) {
    items.push({ href: '/courses', label: 'My courses', short: 'Courses', icon: GraduationCap, group: null, tab: true });
  }
  const takerRole = capabilities?.role;
  const rep = isClassRepTaker(takerRole) ? repRoleShort(takerRole) : 'Class rep';
  if (capabilities?.canTakeAttendance) {
    items.push({ href: '/sessions', label: 'Take attendance', short: 'Take', icon: QrCode, group: rep, tab: true });
    items.push({ href: '/registers', label: 'Course registers', short: 'Registers', icon: ClipboardList, group: rep });
  }
  // A HOC's or GHOC's assistant keeps the class list only when they were allowed to.
  if (isClassRepTaker(takerRole) && capabilities?.canKeepClassList) {
    items.push({ href: '/class-list', label: 'Class list', short: 'Class list', icon: ListChecks, group: rep });
  }
  if (capabilities?.canManageClassReps) items.push({ href: '/class-reps', label: 'HOCs', short: 'HOCs', icon: UsersRound, group: rep });
  // HOCs and GHOCs choose their assistants; an assistant sees their team and what they may do.
  if (capabilities?.canManageAssistants) {
    items.push({ href: '/assistants', label: 'Assistants', short: 'Assistants', icon: HandHelping, group: rep });
  } else if (capabilities?.assistantOf) {
    items.push({ href: '/assistants', label: 'My team', short: 'Team', icon: HandHelping, group: rep });
  }
  return items;
}

/** Consecutive items with the same group, in menu order. */
export function groupsOf(items: readonly NavItem[]): NavGroup[] {
  const groups: { label: string | null; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups;
}

/**
 * The phone tab bar and "More". When every page fits they all become tabs; otherwise the
 * pages marked `tab` (then the rest, in order) take four slots and "More" holds the others.
 */
export function splitForPhone(items: readonly NavItem[]): { tabs: NavItem[]; more: NavItem[] } {
  if (items.length <= PHONE_SLOTS) return { tabs: [...items], more: [] };
  const ordered = [...items.filter((item) => item.tab), ...items.filter((item) => !item.tab)];
  const tabs = ordered.slice(0, PHONE_SLOTS - 1);
  return { tabs, more: items.filter((item) => !tabs.includes(item)) };
}

/** Pages that are not in any menu. */
function extraLabel(pathname: string): string | null {
  if (pathname.startsWith('/sessions/')) return 'Session';
  if (pathname.startsWith('/lecturer/attendance/')) return 'Class';
  if (pathname.startsWith('/lecturer/reports/')) return 'Report';
  if (pathname.startsWith('/registers/')) return registerLabel(pathname.slice('/registers/'.length));
  if (pathname.startsWith('/account/security')) return 'Account';
  if (pathname.startsWith('/account/setup')) return 'Finish setting up';
  if (pathname.startsWith('/check-in')) return 'Check in';
  return null;
}

/** "ECE 305" for /registers/ECE305. */
function registerLabel(segment: string): string {
  try {
    const code = decodeURIComponent(segment.split('/')[0] ?? '').trim();
    return code ? canonicalCourseCode(code) : 'Register';
  } catch {
    return 'Register';
  }
}

export type Crumb = { readonly label: string; readonly href?: string };

/**
 * The desktop breadcrumb: "Attendance › Take attendance", or "Take attendance › Session" on a
 * session page (the first part links back).
 */
export function crumbsFor(pathname: string, items: readonly NavItem[]): Crumb[] {
  const extra = extraLabel(pathname);
  const exact = items.find((item) => item.href === pathname);
  if (exact) return exact.group ? [{ label: exact.group }, { label: exact.label }] : [{ label: exact.label }];
  const parent = items.find((item) => isActive(item.href, pathname));
  if (parent && extra) return [{ label: parent.label, href: parent.href }, { label: extra }];
  if (parent) return parent.group ? [{ label: parent.group }, { label: parent.label }] : [{ label: parent.label }];
  if (extra) return pathname.startsWith('/account') && extra !== 'Account' ? [{ label: 'Account' }, { label: extra }] : [{ label: extra }];
  // The Scan screen opened by staff (their menu has no Scan) or before the account is known.
  if (pathname === '/a' || pathname.startsWith('/a/')) return [{ label: 'Mark attendance' }];
  return [{ label: 'LASUATOS' }];
}

/** The small title in the phone navigation bar. */
export function titleFor(pathname: string, items: readonly NavItem[]): string {
  const crumbs = crumbsFor(pathname, items);
  return crumbs[crumbs.length - 1]?.label ?? 'LASUATOS';
}

/**
 * Where the phone bar's back button goes on a page below a menu page (an iOS push):
 * a session goes back to the session list, a register to the registers, account pages to the
 * person's home.
 */
export function backFor(pathname: string, items: readonly NavItem[]): { href: string; label: string } | null {
  if (pathname.startsWith('/sessions/')) {
    const list = items.find((item) => item.href === '/sessions');
    return { href: '/sessions', label: list?.short ?? 'Sessions' };
  }
  if (pathname.startsWith('/lecturer/attendance/')) {
    const list = items.find((item) => item.href === '/lecturer/attendance');
    return { href: '/lecturer/attendance', label: list?.short ?? 'Sessions' };
  }
  if (pathname.startsWith('/lecturer/reports/')) {
    const list = items.find((item) => item.href === '/lecturer/reports');
    return { href: '/lecturer/reports', label: list?.short ?? 'Reports' };
  }
  if (pathname.startsWith('/registers/')) {
    const list = items.find((item) => item.href === '/registers');
    return { href: '/registers', label: list?.short ?? 'Registers' };
  }
  if (pathname.startsWith('/account/')) {
    const home = items[0];
    return home ? { href: home.href, label: home.short } : null;
  }
  return null;
}
