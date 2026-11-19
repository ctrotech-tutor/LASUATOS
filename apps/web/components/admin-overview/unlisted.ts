import { academicSetLabel, type UnlistedStudent } from '@lasuatos/contracts';

/**
 * Why a student account is on no class list, worked out from what the server found:
 * - `second`: the same number's list name already has its own account, so this is a second one
 *   (a double sign-up, or someone typed another student's number);
 * - `unlinked`: the number is on a list, but that name has no account yet;
 * - `missing`: the number is on no list in this area.
 */
export type UnlistedKind = 'second' | 'unlinked' | 'missing';

export function unlistedKind(account: UnlistedStudent): UnlistedKind {
  if (!account.listed) return 'missing';
  return account.listed.linkedToAnother ? 'second' : 'unlinked';
}

export const UNLISTED_LABEL: Record<UnlistedKind, string> = {
  second: 'Second account',
  unlinked: 'On a list, not linked',
  missing: 'Not on any list',
};

export interface UnlistedAdvice {
  readonly title: string;
  readonly text: string;
  /** Opens the class list at the name with this number, when there is one. */
  readonly link: { readonly label: string; readonly href: string } | null;
  /** Suspending is the usual fix (a second or test account) rather than linking. */
  readonly suggestSuspend: boolean;
}

function classListHref(listed: NonNullable<UnlistedStudent['listed']>, number: string): string {
  const search = new URLSearchParams({ department: listed.departmentCode.toLowerCase(), set: String(listed.entryYear), student: number });
  return `/class-list?${search.toString()}`;
}

/** What to do about one account, in plain words. Pure so it can be tested. */
export function unlistedAdvice(account: UnlistedStudent): UnlistedAdvice {
  const listed = account.listed;
  const suspended = account.status === 'suspended';
  const where = listed ? `${listed.departmentName}, ${academicSetLabel(listed.entryYear)}` : '';
  switch (unlistedKind(account)) {
    case 'second':
      return {
        title: 'A second account for this number',
        text: `${account.studentNumber} on the ${where} list already has its own account. This one is a double sign-up, or someone used another student’s number.${suspended ? ' It is suspended.' : ' If no one needs it, suspend it.'}${account.attendanceRecords > 0 ? ' Its attendance stays on record.' : ''}`,
        link: listed ? { label: 'Open the account on the list', href: classListHref(listed, account.studentNumber) } : null,
        suggestSuspend: true,
      };
    case 'unlinked':
      return {
        title: 'On a list, but not linked',
        text: `${account.studentNumber} is on the ${where} list, but that name has no account yet. Ask the student to open their account from the list, or give them a setup code there. This account and its attendance then move to the name on the list.`,
        link: listed ? { label: 'Open the name on the list', href: classListHref(listed, account.studentNumber) } : null,
        suggestSuspend: false,
      };
    default:
      return {
        title: 'Not on any class list',
        text: suspended
          ? `It is suspended. If it belongs to a real student, add ${account.studentNumber} to their class list, then reactivate it.`
          : account.attendanceRecords > 0 || account.faceRegistered
          ? `If this is a real student, add ${account.studentNumber} to their class list. The account links to the list by itself, with its attendance. If it isn’t, suspend it.`
          : `If this is a real student, add ${account.studentNumber} to their class list and the account links to it by itself. A test or mistyped account can be suspended.`,
        link: null,
        suggestSuspend: account.attendanceRecords === 0 && !account.faceRegistered,
      };
  }
}

/** Ready-made reasons, as on the Staff page; "Something else" takes free text. */
export const UNLISTED_SUSPEND_REASONS = ['Second account for the same student', 'Test or practice account', 'Not a student in this area'] as const;
export const UNLISTED_REACTIVATE_REASONS = ['Suspended by mistake', 'Student confirmed it is theirs', 'Being added to a class list'] as const;
/** The API keeps a reason of 5 to 300 characters. */
export const UNLISTED_REASON_MIN = 5;

/** Active first (they still need a decision), newest first within each. */
export function sortUnlisted(accounts: readonly UnlistedStudent[]): UnlistedStudent[] {
  return [...accounts].sort((a, b) => (a.status === b.status ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : a.status === 'active' ? -1 : 1));
}
