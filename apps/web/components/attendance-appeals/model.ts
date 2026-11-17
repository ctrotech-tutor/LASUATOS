import type { AdministratorAttendanceAppeal, AdministratorAttendanceAppeals } from '@lasuatos/contracts';
import { canUphold, standingOf, type Decision, type Figure } from '../course-disputes/model';

export type Appeal = AdministratorAttendanceAppeal;
export type AppealList = AdministratorAttendanceAppeals;
export type AppealTab = 'open' | 'decided';

export { NOTE_MAX, NOTE_MIN, noteProblem, numberFormat, plural, problemText, when, waitedLabel, daysSince, currentMark, canUphold, KIND_LABEL } from '../course-disputes/model';
export type { Decision, Figure };

/** How a decided appeal is labelled in the list and the sheet. */
export const APPEAL_OUTCOME: Readonly<Record<Exclude<Appeal['status'], 'open'>, { readonly label: string; readonly tone: 'success' | 'danger' | 'neutral' }>> = {
  upheld: { label: 'Marked present', tone: 'success' },
  rejected: { label: 'Decision kept', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

/** Who decides, in a sentence for the decided sheet. */
export function decidedLine(appeal: Pick<Appeal, 'status' | 'decidedByName' | 'departmentName'>): string {
  const by = appeal.decidedByName ?? `An administrator of ${appeal.departmentName}`;
  switch (appeal.status) {
    case 'open': return '';
    case 'upheld': return `${by} accepted the appeal. The student is marked present for this class.`;
    case 'rejected': return `${by} kept the lecturer’s decision. The mark stays as it is.`;
    case 'withdrawn': return 'The student withdrew the appeal. The lecturer’s decision stands.';
  }
}

/**
 * Whether this administrator can decide it, and if not, why: an appeal is decided once, by
 * someone other than the lecturer who turned the dispute down.
 */
export function blocker(appeal: Pick<Appeal, 'status' | 'conflict'>): 'decided' | 'conflict' | null {
  if (appeal.status !== 'open') return 'decided';
  return appeal.conflict ? 'conflict' : null;
}

/** Where the student stands in the course, and where marking them present would put them. */
export function appealStanding(appeal: Appeal): { readonly now: Figure; readonly ifUpheld: Figure | null } | null {
  const { dispute } = appeal;
  if (dispute.student.enrollmentStatus === 'withdrawn') return null;
  // The dispute stays "rejected" while the appeal is open; for the figures it is still undecided.
  return standingOf({ ...dispute, status: appeal.status === 'open' ? 'open' : dispute.status });
}

/** Ready-made notes, each at least NOTE_MIN characters, written to be read by the student and the lecturer. */
export function appealNoteSuggestions(decision: Decision): readonly string[] {
  return decision === 'uphold'
    ? ['The class rep confirms you were in class.', 'The record supports your account.']
    : ['Nothing new shows you were in class.', 'The lecturer’s reasons are sound.'];
}

/** The text for the decide buttons' footnote. */
export function decideHint(appeal: Appeal): string {
  const first = firstName(appeal.dispute.student.displayName);
  if (!canUphold(appeal.dispute)) return `${first} has left this course, so they cannot be marked present. You can keep the lecturer’s decision with a note.`;
  const already = appeal.dispute.record?.status === 'present';
  return `${already ? 'They are already marked present, so the register will not change. ' : 'Marking them present changes the register. '}${first} and the lecturer read your note, and your decision is final.`;
}

export const firstName = (name: string) => name.split(/\s+/)[0] || name;

/** After a decision, the next waiting appeal below it, else the one above, else none. */
export function nextOpenAppeal(appeals: readonly Appeal[], decidedId: string): Appeal | null {
  const open = appeals.filter((appeal) => appeal.status === 'open');
  const index = open.findIndex((appeal) => appeal.id === decidedId);
  const rest = open.filter((appeal) => appeal.id !== decidedId && appeal.conflict === false);
  if (rest.length === 0) return null;
  if (index < 0) return rest[0]!;
  return open.slice(index + 1).find((appeal) => !appeal.conflict) ?? rest[rest.length - 1]!;
}

/** The page subtitle: what is waiting and, when some are not theirs to decide, how many. */
export function waitingLine(list: AppealList | undefined): string {
  if (!list) return '\u00a0';
  if (list.openCount === 0) return 'Nothing waiting';
  const mine = list.appeals.filter((appeal) => appeal.status === 'open' && appeal.conflict).length;
  const count = new Intl.NumberFormat('en-NG').format(list.openCount);
  return mine ? `${count} waiting · ${mine} for another administrator` : `${count} waiting for a decision`;
}
