import {
  academicSetLabel,
  CLASS_REP_ACTIVITY_DAYS,
  type AssistantPermission,
  type ClassRep,
  type ClassRepRole,
} from '@lasuatos/contracts';
import { shortDepartmentName } from '../../lib/department-options';

export const ASSISTANTS_PATH = '/assistants';

/** "AHOC" for a HOC's assistant, "AGHOC" for a GHOC's. */
export function assistantShort(role: ClassRepRole): 'AHOC' | 'AGHOC' {
  return role === 'ghoc' ? 'AGHOC' : 'AHOC';
}

/** "Assistant HOC", "Assistant GHOC". */
export function assistantName(role: ClassRepRole): string {
  return role === 'ghoc' ? 'Assistant GHOC' : 'Assistant HOC';
}

/** The class a post covers: "Computer Engineering, 2022/2023 set" or "Faculty of Engineering, 2022/2023 set". */
export function teamPlace(rep: Pick<ClassRep, 'role' | 'departmentName' | 'facultyName' | 'entryYear'>): string {
  const place = rep.role === 'hoc' && rep.departmentName ? shortDepartmentName(rep.departmentName) : rep.facultyName;
  return `${place}, ${academicSetLabel(rep.entryYear)}`;
}

export interface PermissionCopy {
  readonly label: string;
  readonly hint: string;
}

/** What each permission lets an assistant do, in the words a HOC uses. */
export function permissionCopy(permission: AssistantPermission, role: ClassRepRole): PermissionCopy {
  switch (permission) {
    case 'registers':
      return {
        label: 'See the class’s registers',
        hint: role === 'ghoc'
          ? 'Every session in the faculty’s set, not only the ones they took.'
          : 'Every session for the set, not only the ones they took.',
      };
    case 'class_list':
      return { label: 'Keep the class list', hint: 'Add and correct students, and move them to the right list.' };
    case 'setup_codes':
      return { label: 'Give setup codes', hint: 'Lets a classmate open their account without the LASU email code. Comes with the class list.' };
    case 'hocs':
      return { label: 'Appoint and remove HOCs', hint: 'For the faculty’s set, as you can. They can’t choose assistants.' };
  }
}

/** Every assistant takes attendance; this is the line shown above the switches. */
export const ATTENDANCE_COPY: PermissionCopy = {
  label: 'Take attendance',
  hint: 'Start sessions, show the QR code and add classmates. Every assistant can.',
};

/** The permissions in the order they are shown. */
export function orderedPermissions(available: readonly AssistantPermission[]): AssistantPermission[] {
  const order: AssistantPermission[] = ['registers', 'class_list', 'setup_codes', 'hocs'];
  return order.filter((item) => available.includes(item));
}

/**
 * The permissions after one switch changes: setup codes are given from the class list, so
 * turning the list off turns them off, and turning them on turns the list on.
 */
export function togglePermission(current: readonly AssistantPermission[], permission: AssistantPermission, on: boolean): AssistantPermission[] {
  const next = new Set(current);
  if (on) next.add(permission);
  else next.delete(permission);
  if (permission === 'class_list' && !on) next.delete('setup_codes');
  if (permission === 'setup_codes' && on) next.add('class_list');
  return orderedPermissions([...next]);
}

/** "Takes attendance, sees the registers and keeps the class list." */
export function powersLine(permissions: readonly AssistantPermission[]): string {
  const parts = ['takes attendance'];
  if (permissions.includes('registers')) parts.push('sees the registers');
  if (permissions.includes('class_list')) parts.push(permissions.includes('setup_codes') ? 'keeps the class list with setup codes' : 'keeps the class list');
  if (permissions.includes('hocs')) parts.push('appoints HOCs');
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** "3 sessions in 30 days" or "No sessions yet". */
export function sessionsLine(rep: Pick<ClassRep, 'recentSessions' | 'lastSessionAt'>): string {
  if (rep.recentSessions > 0) return `${rep.recentSessions} session${rep.recentSessions === 1 ? '' : 's'} in ${CLASS_REP_ACTIVITY_DAYS} days`;
  return rep.lastSessionAt ? `No sessions in ${CLASS_REP_ACTIVITY_DAYS} days` : 'No sessions yet';
}

/** A UUID from the address (`?for=`), or null. */
export function principalFrom(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
