/**
 * Plain words for a structure audit row, shown in the page's history: "Renamed from Electrical
 * Engineering", "Programme length 4 → 5 years", "Deactivated". The page names the faculty,
 * department or session itself, so a summary never repeats it.
 */

type Details = Record<string, unknown>;

const lagosDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

function pair(value: unknown): [unknown, unknown] | null {
  return Array.isArray(value) && value.length === 2 ? [value[0], value[1]] : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function day(value: unknown): string {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? '' : lagosDate.format(new Date(time));
}

function years(value: unknown): string {
  return typeof value === 'number' ? `${value} year${value === 1 ? '' : 's'}` : '';
}

/** "Renamed from …", programme length and active/inactive changes, joined with "; ". */
function updated(details: Details): string {
  const parts: string[] = [];
  const name = pair(details.name);
  if (name) parts.push(`Renamed from ${text(name[0])}`);
  const programme = pair(details.programmeYears);
  if (programme) parts.push(`Programme length ${text(programme[0])} → ${years(programme[1])}`);
  const active = pair(details.isActive);
  if (active) parts.push(active[1] === true ? 'Reactivated' : 'Deactivated');
  return parts.join('; ') || 'Details changed';
}

function sessionUpdated(details: Details): string {
  const parts: string[] = [];
  const code = pair(details.code);
  if (code) parts.push(`Renamed from ${text(code[0])}`);
  const starts = pair(details.startsAt);
  const ends = pair(details.endsAt);
  if (starts && ends) parts.push(`Dates moved to ${day(starts[1])} – ${day(ends[1])}`);
  else if (starts) parts.push(`Now starts ${day(starts[1])}`);
  else if (ends) parts.push(`Now ends ${day(ends[1])}`);
  const semesters = Array.isArray(details.semesters) ? details.semesters as Details[] : [];
  const added = semesters.map((semester) => text(semester.added)).filter(Boolean);
  if (added.length) parts.push(`Added ${added.join(' and ')}`);
  const changed = semesters.filter((semester) => !semester.added).length;
  if (changed) parts.push(changed === 1 ? 'A semester’s dates or name changed' : `${changed} semesters changed`);
  return parts.join('; ') || 'Details changed';
}

export function describeStructureChange(action: string, details: Details): string {
  switch (action) {
    case 'faculty_created':
      return `Added with the code ${text(details.code)}`.trim();
    case 'department_created': {
      const length = years(details.programmeYears);
      return `Added with the code ${text(details.code)}${length ? `, ${length}` : ''}`;
    }
    case 'faculty_updated':
    case 'department_updated':
      return updated(details);
    case 'academic_session_created': {
      const semesters = Array.isArray(details.semesters) ? details.semesters.length : typeof details.semesters === 'number' ? details.semesters : 0;
      const parts = [semesters ? `Created with ${semesters} semester${semesters === 1 ? '' : 's'}` : 'Created'];
      if (details.makeCurrent === true) parts.push('made current');
      return parts.join(', ');
    }
    case 'academic_session_made_current':
      return 'Made the current session';
    case 'academic_session_updated':
      return sessionUpdated(details);
    default:
      return 'Changed';
  }
}
