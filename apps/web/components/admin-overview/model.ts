import type { AdministratorOverview } from '@lasuatos/contracts';
import { CalendarClock, Inbox, MapPinned, MessageSquareWarning, Scale, ScanFace, Smartphone, UserRoundSearch, type LucideIcon } from 'lucide-react';
import { daysBetween, lagosDay, plural } from './format';

export type AttentionItem = {
  readonly key: string;
  readonly icon: LucideIcon;
  readonly tone: 'danger' | 'warning' | 'tint';
  readonly title: string;
  readonly subtitle: string;
  readonly count?: number;
  readonly href: string;
};

/** The overview with the sheet of student accounts on no class list open (also linked from the audit log). */
export const UNLISTED_HREF = '/admin?unlisted=1';

/** A session ending within this many days is mentioned. */
const SESSION_ENDING_SOON = 21;

/**
 * What needs the administrator, most urgent first. Only real, actionable items: when there are
 * none the list says so in one line. Sources that failed to load simply contribute nothing.
 */
export function attentionFor(input: {
  readonly overview: AdministratorOverview;
  readonly institutionAdmin: boolean;
  /** YYYY-MM-DD in Lagos; empty before the page has hydrated. */
  readonly today: string;
  /** The setup checklist already asks for a current session. */
  readonly setupVisible: boolean;
  readonly faceReviews: number;
  readonly newMessages: number;
  readonly openDisputes: number;
  /** Attendance appeals waiting for the department (this administrator decides them). */
  readonly openAppeals: number;
  readonly sharedPhone: number;
}): AttentionItem[] {
  const { overview, institutionAdmin, today } = input;
  const items: AttentionItem[] = [];

  const session = overview.setup.academicSession;
  if (institutionAdmin && !session && !input.setupVisible) {
    items.push({ key: 'session', icon: CalendarClock, tone: 'danger', title: 'No current academic session', subtitle: 'Student levels are worked out from it', href: '/admin/structure' });
  }
  if (institutionAdmin && session && today) {
    const left = daysBetween(today, lagosDay(new Date(session.endsAt)));
    if (left < 0) {
      items.push({ key: 'session', icon: CalendarClock, tone: 'danger', title: `${session.code} session has ended`, subtitle: 'Start the next one so levels stay right', href: '/admin/structure' });
    } else if (left <= SESSION_ENDING_SOON) {
      items.push({ key: 'session', icon: CalendarClock, tone: 'tint', title: `${session.code} ends ${left === 0 ? 'today' : `in ${plural(left, 'day')}`}`, subtitle: 'Get the next session ready', href: '/admin/structure' });
    }
  }
  if (input.faceReviews > 0) {
    items.push({ key: 'faces', icon: ScanFace, tone: 'warning', title: input.faceReviews === 1 ? 'Face check to review' : 'Face checks to review', subtitle: 'Counted as present until you decide', count: input.faceReviews, href: '/face-checks' });
  }
  const appeals = input.openAppeals;
  if (appeals > 0) {
    items.push({ key: 'appeals', icon: Scale, tone: 'warning', title: appeals === 1 ? 'Attendance appeal to decide' : 'Attendance appeals to decide', subtitle: 'Disputes a lecturer turned down', count: appeals, href: '/admin/appeals' });
  }
  if (input.openDisputes > 0) {
    items.push({ key: 'disputes', icon: MessageSquareWarning, tone: 'warning', title: input.openDisputes === 1 ? 'Open attendance dispute' : 'Open attendance disputes', subtitle: 'Students asking for a correction', count: input.openDisputes, href: '/admin/attendance' });
  }
  if (input.newMessages > 0) {
    items.push({ key: 'messages', icon: Inbox, tone: 'tint', title: input.newMessages === 1 ? 'New message' : 'New messages', subtitle: 'From the contact page', count: input.newMessages, href: '/admin/messages' });
  }
  if (institutionAdmin && overview.setup.venuesWithoutLocation > 0) {
    const count = overview.setup.venuesWithoutLocation;
    items.push({ key: 'venues', icon: MapPinned, tone: 'warning', title: count === 1 ? 'Venue without a location' : 'Venues without a location', subtitle: 'Check-ins there can’t be verified', count, href: '/admin/venues' });
  }
  const unlisted = overview.metrics.unlistedStudents;
  if (unlisted > 0) {
    items.push({
      key: 'unlisted',
      icon: UserRoundSearch,
      tone: 'warning',
      title: unlisted === 1 ? 'Unlisted student account' : 'Unlisted student accounts',
      subtitle: 'On no class list · see who',
      count: unlisted,
      href: UNLISTED_HREF,
    });
  }
  if (input.sharedPhone > 0) {
    items.push({ key: 'shared', icon: Smartphone, tone: 'warning', title: 'Shared-phone check-ins', subtitle: 'One phone, several students · 30 days', count: input.sharedPhone, href: '/admin/attendance' });
  }
  return items;
}

export type SetupStep = { readonly key: string; readonly title: string; readonly done: boolean; readonly href: string };

/**
 * First-run checklist. Institution administrators set up the structure and venues; everyone
 * brings in lecturers and class reps and takes attendance once. It disappears when all are done.
 */
export function setupStepsFor(overview: AdministratorOverview, institutionAdmin: boolean): SetupStep[] {
  const { metrics, setup } = overview;
  const steps: SetupStep[] = [];
  if (institutionAdmin) {
    steps.push({ key: 'structure', title: 'Add faculties and departments', done: metrics.departments > 0, href: '/admin/structure' });
    steps.push({ key: 'session', title: 'Set the current academic session', done: setup.academicSession !== null, href: '/admin/structure' });
  }
  steps.push({ key: 'staff', title: 'Invite lecturers', done: metrics.activeLecturers > 0, href: '/admin/staff?invite=1' });
  steps.push({ key: 'reps', title: 'Appoint class reps', done: setup.classReps > 0, href: '/class-reps?appoint=1' });
  if (institutionAdmin) steps.push({ key: 'venues', title: 'Add lecture venues', done: setup.venues > 0, href: '/admin/venues' });
  steps.push({ key: 'first', title: 'Take attendance once', done: setup.hasTakenAttendance, href: '/sessions?new=1' });
  return steps;
}
