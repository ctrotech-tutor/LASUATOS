/**
 * Plain words for one audit record. Each trail stores its details its own way (key=value pairs,
 * free text, JSON diffs); this reads them into labelled facts, a note in the person's own words,
 * and links to the pages the record is about. Internal ids never reach the page: they become
 * names, or are left out.
 */
import { academicSetLabel, AUDIT_NOTABLE_ACTIONS, canonicalCourseCode, courseCodeKey, type AuditFact, type AuditLink } from '@lasuatos/contracts';
import { FACE_FAILURE_LABELS } from '../students/face-labels.js';
import type { AuditReferences, AuditRow } from './repository.js';

export interface Description {
  readonly subject: string | null;
  readonly subjectSearch: string | null;
  readonly facts: AuditFact[];
  readonly note: string | null;
  readonly links: AuditLink[];
  readonly notable: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTABLE = new Set<string>(AUDIT_NOTABLE_ACTIONS);
const lagosDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const lagosDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

const VENUE_OUTCOMES: Record<string, string> = {
  within: 'Inside the venue',
  outside: 'Outside the venue',
  inconclusive: 'Location unclear',
  unavailable: 'Location unavailable',
  none: 'Not checked',
};

const ROLES: Record<string, string> = {
  institution_administrator: 'Institution administrator',
  faculty_administrator: 'Faculty administrator',
  department_administrator: 'Department administrator',
  lecturer: 'Lecturer',
  course_coordinator: 'Course coordinator',
};

const CLASS_FIELDS: Record<string, string> = {
  surname: 'surname',
  first_name: 'first name',
  firstName: 'first name',
  middle_name: 'middle name',
  middleName: 'middle name',
  lasu_email: 'LASU email',
  lasuEmail: 'LASU email',
  matric_number: 'matric number',
  matricNumber: 'matric number',
  entry_year: 'set',
  entryYear: 'set',
  entry_level: 'entry level',
  entryLevel: 'entry level',
};

const STRUCTURE_FIELDS: Record<string, string> = {
  name: 'Name',
  code: 'Code',
  programmeYears: 'Programme length',
  isActive: 'Status',
  startsAt: 'Starts',
  endsAt: 'Ends',
  capacity: 'Capacity',
  venueType: 'Type',
  floorLabel: 'Floor',
  sectionLabel: 'Section',
  notes: 'Notes',
  status: 'Status',
  locationRequired: 'Location check',
  makeCurrent: 'Made current',
};

/** "key=value key=value with spaces" → { key: 'value', key: 'value with spaces' }; null for free text. */
export function keyValues(text: string): Record<string, string> | null {
  const trimmed = text.trim();
  if (!/^[a-z_]+=/.test(trimmed)) return null;
  const result: Record<string, string> = {};
  for (const part of trimmed.split(/\s+(?=[a-z_]+=)/)) {
    const index = part.indexOf('=');
    result[part.slice(0, index)] = part.slice(index + 1).trim();
  }
  return result;
}

function fact(label: string, value: string | number | null | undefined, previous: string | null = null): AuditFact | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  if (UUID.test(text)) return null;
  return { label: label.slice(0, 60), value: text.slice(0, 400), previous: previous === null ? null : previous.slice(0, 400) };
}

function percent(value: string | undefined): string | null {
  const number = Number(value);
  if (!value || !Number.isFinite(number)) return null;
  return `${Math.round(number * 100)}%`;
}

function count(value: string | undefined, one: string, many: string): string | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return `${value} ${value === '1' ? one : many}`;
}

function sentence(text: string): string {
  const value = text.trim().replace(/\s+/g, ' ');
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function humanise(value: string): string {
  return sentence(value.replace(/_/g, ' '));
}

function years(value: unknown): string {
  return typeof value === 'number' ? `${value} year${value === 1 ? '' : 's'}` : String(value ?? '');
}

function structureValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return key === 'notes' || key === 'floorLabel' || key === 'sectionLabel' ? 'None' : null;
  if (typeof value === 'string' && UUID.test(value)) return null;
  if (key === 'programmeYears') return years(value);
  if (key === 'isActive') return value === true ? 'Active' : 'Inactive';
  if (key === 'locationRequired' || key === 'makeCurrent') return value === true ? 'Yes' : 'No';
  if (key === 'status') return humanise(String(value));
  if (key === 'venueType') return humanise(String(value));
  if ((key === 'startsAt' || key === 'endsAt') && typeof value === 'string' && !Number.isNaN(Date.parse(value))) return lagosDate.format(new Date(value));
  if (Array.isArray(value)) return value.every((item) => typeof item === 'string') ? value.join(', ') : `${value.length}`;
  if (typeof value === 'object') return null;
  return String(value);
}

/** A structure or venue JSON record: created values, or [from, to] / { from, to } changes. */
function structureFacts(details: string): { facts: AuditFact[]; deactivated: boolean } {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(details) as Record<string, unknown>;
  } catch {
    return { facts: details.trim() ? [fact('Details', details.trim())].filter(Boolean) as AuditFact[] : [], deactivated: false };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { facts: [], deactivated: false };
  const facts: AuditFact[] = [];
  let deactivated = false;
  for (const [key, item] of Object.entries(value)) {
    if (/outline|polygon|secret|hash|token|previousCurrent|facultyId|buildingId|campusId/i.test(key)) continue;
    const label = STRUCTURE_FIELDS[key] ?? humanise(key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
    let change: [unknown, unknown] | null = null;
    if (Array.isArray(item) && item.length === 2 && key !== 'semesters') change = [item[0], item[1]];
    else if (item && typeof item === 'object' && !Array.isArray(item) && 'from' in item && 'to' in item) {
      const pair = item as { from: unknown; to: unknown };
      change = [pair.from, pair.to];
    }
    if (change) {
      if (key === 'isActive' && change[1] === false) deactivated = true;
      if (key === 'status' && change[1] === 'inactive') deactivated = true;
      const to = structureValue(key, change[1]);
      if (to === null) continue;
      facts.push({ label, value: to.slice(0, 400), previous: (structureValue(key, change[0]) ?? 'None').slice(0, 400) });
      continue;
    }
    if (key === 'semesters' && Array.isArray(item)) {
      const names = item.map((semester) => typeof semester === 'string' ? semester : semester && typeof semester === 'object' && 'added' in semester ? `${String((semester as { added: unknown }).added)} (added)` : null).filter(Boolean);
      const changed = item.filter((semester) => semester && typeof semester === 'object' && !('added' in semester)).length;
      const parts = [...names, ...(changed ? [changed === 1 ? '1 changed' : `${changed} changed`] : [])];
      const made = fact('Semesters', parts.join(', '));
      if (made) facts.push(made);
      continue;
    }
    const made = fact(label, structureValue(key, item));
    if (made) facts.push(made);
  }
  return { facts: facts.slice(0, 12), deactivated };
}

function registerLink(courseCode: string | null | undefined, matric: string | null): AuditLink | null {
  if (!courseCode) return null;
  const code = canonicalCourseCode(courseCode);
  return { label: `Open the ${code} register`, href: `/registers/${encodeURIComponent(courseCodeKey(code))}${matric ? `?q=${encodeURIComponent(matric)}` : ''}` };
}

function classListLink(departmentCode: string | null | undefined, set: number | null | undefined, matric: string | null, label = 'Open in the class list'): AuditLink | null {
  if (!departmentCode) return null;
  const search = new URLSearchParams({ department: departmentCode.toLowerCase() });
  if (set) search.set('set', String(set));
  if (matric) search.set('student', matric);
  return { label, href: `/class-list?${search.toString()}` };
}

function structureLink(row: AuditRow): AuditLink | null {
  const code = row.targetCode?.toLowerCase();
  if (!code) return null;
  switch (row.targetType) {
    case 'department': return { label: 'Open the department', href: `/admin/structure?department=${encodeURIComponent(code)}` };
    case 'faculty': return { label: 'Open the faculty', href: `/admin/structure?faculty=${encodeURIComponent(code)}` };
    case 'academic_session': return { label: 'Open the session', href: `/admin/structure?session=${encodeURIComponent(code.replace('/', '-'))}` };
    case 'venue': return { label: 'Open the venue', href: `/admin/venues?venue=${encodeURIComponent(code)}` };
    case 'building': return { label: 'Open venues', href: '/admin/venues' };
    default: return null;
  }
}

function lectureFact(refs: AuditReferences, sessionId: string | undefined, course: string | undefined): AuditFact | null {
  const session = sessionId ? refs.sessions.get(sessionId) : undefined;
  const code = session?.courseCode ?? course;
  if (!code) return null;
  return fact('Lecture', session ? `${canonicalCourseCode(code)} · ${lagosDay.format(session.startsAt).replace(',', '')}` : canonicalCourseCode(code));
}

/** "a; b; c. Reason: d" → { parts: [a, b, c], reason: d } */
function splitReason(text: string): { parts: string[]; reason: string | null } {
  const index = text.search(/\.?\s*Reason:\s*/);
  const head = index >= 0 ? text.slice(0, index) : text;
  const reason = index >= 0 ? text.slice(index).replace(/^\.?\s*Reason:\s*/, '').trim() : null;
  return { parts: head.split(';').map((part) => part.trim()).filter(Boolean), reason: reason || null };
}

function signedOut(parts: string[]): AuditFact | null {
  const part = parts.find((item) => /session\(s\) signed out/.test(item));
  const number = part ? /(\d+)/.exec(part)?.[1] : undefined;
  return number === undefined ? null : fact('Signed out', number === '0' ? 'No devices' : number === '1' ? '1 device' : `${number} devices`);
}

export function describe(row: AuditRow, refs: AuditReferences): Description {
  const facts: (AuditFact | null)[] = [];
  const links: (AuditLink | null)[] = [];
  let note: string | null = null;
  let notable = NOTABLE.has(row.action);
  const person = row.subjectName ?? null;
  let subject = [person, row.matricNumber, row.targetLabel].filter((part): part is string => Boolean(part)).join(' · ') || null;
  let subjectSearch: string | null = row.matricNumber ?? row.targetCode ?? row.staffEmail ?? row.subjectName ?? row.targetLabel ?? null;
  const pairs = keyValues(row.details) ?? {};
  const text = row.details.trim();
  const studentLink = () => classListLink(row.classDepartmentCode, row.classEntryYear, row.matricNumber);

  switch (row.action) {
    case 'class_list_imported': {
      const department = pairs.department ? refs.departments.get(pairs.department) : undefined;
      const set = Number(pairs.set) || null;
      subject = [department?.name, set ? academicSetLabel(set) : null].filter(Boolean).join(' · ') || null;
      subjectSearch = null;
      facts.push(
        fact('Department', department?.name),
        fact('Set', set ? academicSetLabel(set) : null),
        fact('Rows in the file', pairs.rows),
        fact('Added', pairs.added),
        fact('Updated', pairs.updated),
        fact('Unchanged', pairs.unchanged),
        fact('Linked to accounts', pairs.linked),
      );
      links.push(classListLink(department?.code, set, null, 'Open the class list'));
      break;
    }
    case 'class_list_entry_updated': {
      const changed = (pairs.changed ?? '').split(',').map((field) => CLASS_FIELDS[field.trim()] ?? humanise(field.trim()).toLowerCase()).filter(Boolean);
      facts.push(fact('Changed', changed.length ? sentence(changed.join(', ')) : null), fact('Matric number before', pairs.previous_matric));
      links.push(studentLink());
      break;
    }
    case 'class_list_entry_removed': {
      const department = pairs.department ? refs.departments.get(pairs.department) : undefined;
      const set = Number(pairs.set) || null;
      facts.push(fact('Department', department?.name), fact('Set', set ? academicSetLabel(set) : null));
      links.push(classListLink(department?.code, set, null, 'Open the class list'));
      break;
    }
    case 'account_opened':
      facts.push(fact('How', sentence(text.replace(/^opened /, ''))));
      links.push(studentLink());
      break;
    case 'account_taken_over': {
      const { parts } = splitReason(text);
      const how = parts.find((part) => part.startsWith('older account handed'))?.replace(/^older account handed to the listed student with /, '');
      const previous = parts.find((part) => part.startsWith('previous email'))?.replace(/^previous email /, '');
      facts.push(
        fact('How', how ? sentence(how) : null),
        fact('Old email', previous),
        signedOut(parts),
        fact('Old face', parts.some((part) => /face deleted/.test(part)) ? 'Deleted' : null),
        fact('Attendance', parts.some((part) => /attendance kept/.test(part)) ? 'Kept on the account' : null),
      );
      links.push(studentLink());
      break;
    }
    case 'account_released': {
      const { parts, reason } = splitReason(text);
      const from = parts.find((part) => part.startsWith('released from'))?.replace(/^released from /, '');
      const now = parts.find((part) => part.startsWith('class list email now'))?.replace(/^class list email now /, '');
      facts.push(
        fact('Email', now ?? null, from ?? null),
        signedOut(parts),
        fact('Registered face', parts.some((part) => /face deleted/.test(part)) ? 'Deleted' : null),
        fact('Attendance', parts.some((part) => /attendance kept/.test(part)) ? 'Kept on the account' : null),
      );
      note = reason;
      links.push(studentLink());
      break;
    }
    case 'setup_code_issued': {
      const minutes = /valid (\d+) minutes/.exec(text)?.[1];
      facts.push(fact('Works for', minutes ? `${minutes} minutes, once` : null), fact('Older account', /takes over/.test(text) ? 'Handed to this student when used' : null));
      links.push(studentLink());
      break;
    }
    case 'password_reset_with_code':
      facts.push(fact('How', 'A code sent to their LASU email'), signedOut(text.split(';').map((part) => part.trim())));
      break;
    case 'email_confirmed':
      facts.push(fact('What happened', sentence(text)));
      links.push(studentLink());
      break;
    case 'face_registered':
      facts.push(fact('Liveness', percent(pairs.live)), fact('Real face', percent(pairs.real)), fact('Model', pairs.model));
      links.push(studentLink());
      break;
    case 'face_replaced': {
      const head = keyValues(text.split(';')[0] ?? '') ?? {};
      facts.push(
        fact('Match with the old photos', percent(head.similarity)),
        fact('Liveness', percent(head.live)),
        fact('Real face', percent(head.real)),
        fact('Model', head.model ?? null, head.previous_model && head.previous_model !== head.model ? head.previous_model : null),
        fact('Old photos', /overwritten/.test(text) ? 'Replaced' : null),
      );
      links.push(studentLink());
      break;
    }
    case 'face_replace_confirmed':
      facts.push(fact('Confirmed with', 'Their password and a code to their LASU email'));
      break;
    case 'face_reset':
      facts.push(fact('Registered face', 'Deleted; they register again at their next check-in'));
      links.push(studentLink());
      break;
    case 'face_duplicate_refused':
    case 'face_replace_refused': {
      // "score=0.912 other_user=<id>", or for new photos "score=0.41" (no match with the old ones)
      // or "replacement score=0.91 other_user=<id>" (they matched someone else).
      const read = keyValues(text.replace(/^replacement\s+/, '')) ?? {};
      const other = read.other_user ? refs.users.get(read.other_user) : undefined;
      if (read.other_user) {
        facts.push(
          fact('Looked like', other ? [other.name, other.matricNumber].filter(Boolean).join(' · ') : 'Another student'),
          fact('Similarity', percent(read.score)),
        );
      } else {
        facts.push(fact('Match with the old photos', percent(read.score)));
      }
      links.push(studentLink());
      break;
    }
    case 'face_check_failed':
    case 'help_request_created': {
      facts.push(
        lectureFact(refs, pairs.session, pairs.course),
        fact('Why', pairs.reason ? FACE_FAILURE_LABELS[pairs.reason] ?? humanise(pairs.reason) : null),
        fact('Failed checks', pairs.failures),
        fact('Location', pairs.venue ? VENUE_OUTCOMES[pairs.venue] ?? humanise(pairs.venue) : null),
      );
      const session = pairs.session ? refs.sessions.get(pairs.session) : undefined;
      links.push(registerLink(session?.courseCode ?? pairs.course, row.matricNumber));
      break;
    }
    case 'help_request_added':
    case 'help_request_declined': {
      facts.push(lectureFact(refs, pairs.session, pairs.course));
      note = pairs.reason ? sentence(pairs.reason) : null;
      const session = pairs.session ? refs.sessions.get(pairs.session) : undefined;
      links.push(registerLink(session?.courseCode ?? pairs.course, row.matricNumber));
      break;
    }
    case 'face_review_approved':
    case 'face_review_rejected': {
      facts.push(lectureFact(refs, pairs.session, pairs.course), fact('Match score', percent(pairs.score)), fact('Note written', pairs.note_length ? 'Yes' : null));
      const session = pairs.session ? refs.sessions.get(pairs.session) : undefined;
      links.push(registerLink(session?.courseCode ?? pairs.course, row.matricNumber));
      break;
    }
    case 'attendee_added_by_hand':
    case 'attendee_removed': {
      facts.push(
        fact('Lecture', row.targetLabel),
        fact('Location at check-in', pairs.venue ? VENUE_OUTCOMES[pairs.venue] ?? humanise(pairs.venue) : null),
      );
      note = pairs.reason ? sentence(pairs.reason) : null;
      links.push(registerLink(row.targetCode, row.matricNumber), studentLink());
      break;
    }
    case 'retention_run': {
      if (row.subjectName || row.matricNumber) {
        const set = Number(pairs.set) || null;
        facts.push(fact('Set', set ? academicSetLabel(set) : null), fact('Deleted', 'Registered face and check-in photos'), fact('Grace period', count(pairs.grace_months, 'month', 'months')));
      } else {
        facts.push(
          fact('Faces deleted', pairs.faces),
          fact('Check-in photos deleted', pairs.check_photos),
          fact('Run', pairs.scheduled === 'true' ? 'Nightly, by itself' : pairs.scheduled === 'false' ? 'By hand' : null),
          fact('Grace period', count(pairs.grace_months, 'month', 'months')),
          fact('Kept if active within', count(pairs.active_days, 'day', 'days')),
          fact('Check-in photos kept', count(pairs.photo_days, 'day', 'days')),
        );
      }
      links.push({ label: 'Open data retention', href: '/admin/retention' });
      break;
    }
    case 'venue_location_registered':
    case 'venue_location_updated':
    case 'venue_location_cleared':
      facts.push(
        fact('GPS accuracy', pairs.accuracy_m ? `About ${pairs.accuracy_m} m` : null),
        fact('Boundary', pairs.radius_m ? `${pairs.radius_m} m around the point` : null),
        fact('GPS readings', pairs.samples),
      );
      links.push(structureLink(row));
      break;
    default: {
      if (row.source === 'staff') {
        const reasonText = pairs.reason ?? '';
        // A role change records before → after itself; today's role would only repeat the "after".
        const recorded = (label: string) => row.action === 'staff_role_changed' && new RegExp(`(^|; )${label}: [^;]*→`).test(reasonText);
        facts.push(
          fact('Email', row.staffEmail),
          recorded('Role') ? null : fact('Role', row.staffRole ? ROLES[row.staffRole] ?? humanise(row.staffRole) : null),
          recorded('Area') ? null : fact('Area', row.staffArea),
        );
        let reason = reasonText;
        if (row.action === 'staff_role_changed') {
          // "Role: A → B; Area: X → Y; Courses handed back: …; Why: …" (the why comes last, as typed).
          const at = reason.indexOf('; Why: ');
          const why = at >= 0 ? reason.slice(at + 7) : '';
          if (at >= 0) reason = reason.slice(0, at);
          for (const part of reason.split(';')) {
            const change = /^\s*([^:]+):\s*(.*?)\s*→\s*(.*)$/.exec(part);
            const plain = /^\s*([^:]+):\s*(.+)$/.exec(part);
            if (change) facts.push(fact(change[1]!.trim(), change[3]!.trim(), change[2]!.trim()));
            else if (plain) facts.push(fact(plain[1]!.trim(), plain[2]!.trim()));
          }
          note = why ? sentence(why) : null;
        } else if (row.action === 'staff_updated' && reason) {
          for (const part of reason.split(';')) {
            const match = /^\s*([^:]+):\s*(.*?)\s*→\s*(.*)$/.exec(part);
            if (match) facts.push(fact(match[1]!.trim(), match[3]!.trim() === 'none' ? 'None' : match[3]!.trim(), match[2]!.trim() === 'none' ? 'None' : match[2]!.trim()));
          }
          if (!facts.some((item) => item && item.previous !== null)) note = sentence(reason);
        } else {
          note = reason ? sentence(reason) : null;
        }
        links.push({ label: 'Open staff', href: row.action.startsWith('invitation_') && row.action !== 'invitation_accepted' ? '/admin/staff?show=invited' : '/admin/staff' });
        break;
      }
      if (row.source === 'structure') {
        const read = structureFacts(text);
        facts.push(...read.facts);
        if (read.deactivated && (row.targetType === 'department' || row.targetType === 'faculty')) notable = true;
        links.push(structureLink(row));
        break;
      }
      if (text) facts.push(fact('Details', sentence(text)));
    }
  }

  return {
    subject: subject ? subject.slice(0, 240) : null,
    subjectSearch: subjectSearch ? subjectSearch.slice(0, 120) : null,
    facts: facts.filter((item): item is AuditFact => item !== null).slice(0, 12),
    note: note ? note.slice(0, 1000) : null,
    links: links.filter((item, index, all): item is AuditLink => item !== null && all.findIndex((other) => other?.href === item.href) === index).slice(0, 4),
    notable,
  };
}

/** The ids inside a record's details that need names. */
export function referencesOf(row: AuditRow): { departments: string[]; sessions: string[]; users: string[] } {
  const pairs = keyValues((row.details.split(';')[0] ?? '').replace(/^replacement\s+/, '')) ?? {};
  const pick = (value: string | undefined) => (value && UUID.test(value) ? [value.toLowerCase()] : []);
  return { departments: pick(pairs.department), sessions: pick(pairs.session), users: pick(pairs.other_user) };
}
