import { describe, expect, it } from 'vitest';
import type { StaffInvitation, StaffMember, StaffPositionChangeResult } from '@lasuatos/contracts';
import { applyFilter, countStaff, expiryLine, groupMembers, initials, isQuiet, matches, POSITION_REASONS, positionConsequences, REASON_MIN, roleLine, sessionsLine, sortInvitations, whenLabel } from './format';

const NOW = Date.parse('2026-11-10T10:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const member = (overrides: Partial<StaffMember>): StaffMember => ({
  userId: crypto.randomUUID(),
  email: 'someone@lasu.edu.ng',
  displayName: 'Someone',
  role: 'lecturer',
  scopeLabel: 'Electronic and Computer Engineering, Faculty of Engineering',
  staffNumber: null,
  status: 'active',
  joinedAt: ago(60),
  manageable: true,
  isSelf: false,
  lastActiveAt: null,
  recentSessions: 0,
  lastSessionAt: null,
  ...overrides,
});

const invitation = (overrides: Partial<StaffInvitation>): StaffInvitation => ({
  id: crypto.randomUUID(),
  email: 'new@lasu.edu.ng',
  displayName: 'New Person',
  role: 'lecturer',
  scopeLabel: 'Mechanical Engineering, Faculty of Engineering',
  staffNumber: null,
  invitedByName: 'Funmi Adebayo',
  sentAt: ago(2),
  expiresAt: new Date(NOW + 5 * DAY).toISOString(),
  expired: false,
  ...overrides,
});

describe('staff wording', () => {
  it('makes initials without titles', () => {
    expect(initials('Dr. Tunde Adeyemi')).toBe('TA');
    expect(initials('Engr. Chidi Okonkwo')).toBe('CO');
    expect(initials('Prof Ngozi')).toBe('N');
    expect(initials('funmi adebayo')).toBe('FA');
  });

  it('marks lecturers quiet only after a week without sessions', () => {
    expect(isQuiet(member({}), NOW)).toBe(true);
    expect(isQuiet(member({ joinedAt: ago(3) }), NOW)).toBe(false);
    expect(isQuiet(member({ recentSessions: 2 }), NOW)).toBe(false);
    expect(isQuiet(member({ status: 'suspended' }), NOW)).toBe(false);
    expect(isQuiet(member({ role: 'department_administrator' }), NOW)).toBe(false);
  });

  it('describes recent sessions', () => {
    expect(sessionsLine(member({ recentSessions: 1 }), NOW)).toEqual({ text: '1 session in 30 days', tone: 'good' });
    expect(sessionsLine(member({ recentSessions: 12 }), NOW).text).toBe('12 sessions in 30 days');
    expect(sessionsLine(member({ lastSessionAt: '2026-09-14T08:00:00Z' }), NOW)).toEqual({ text: 'None since 14 Sept', tone: 'warning' });
    expect(sessionsLine(member({ joinedAt: ago(2) }), NOW)).toEqual({ text: 'No sessions yet', tone: 'none' });
  });

  it('says when, in Lagos time', () => {
    expect(whenLabel(null, NOW)).toBe('Never');
    expect(whenLabel(new Date(NOW - 30_000).toISOString(), NOW)).toBe('Just now');
    expect(whenLabel('2026-11-10T07:12:00Z', NOW)).toBe('Today, 08:12');
    // 23:30 UTC on the 9th is already the 10th in Lagos.
    expect(whenLabel('2026-11-09T23:30:00Z', NOW)).toBe('Today, 00:30');
    expect(whenLabel('2026-11-09T17:20:00Z', NOW)).toBe('Yesterday, 18:20');
    expect(whenLabel('2026-11-06T09:00:00Z', NOW)).toBe('Friday');
    expect(whenLabel('2026-10-12T09:00:00Z', NOW)).toBe('12 Oct');
    expect(whenLabel('2025-10-12T09:00:00Z', NOW)).toBe('12 Oct 2025');
  });

  it('counts down an invitation and puts expired ones first', () => {
    expect(expiryLine(invitation({}), NOW)).toBe('Expires in 5 days');
    expect(expiryLine(invitation({ expiresAt: new Date(NOW + DAY).toISOString() }), NOW)).toBe('Expires tomorrow');
    expect(expiryLine(invitation({ expired: true, expiresAt: ago(2) }), NOW)).toBe('Expired 2 days ago');
    const fresh = invitation({ sentAt: ago(1) });
    const old = invitation({ sentAt: ago(9), expired: true, expiresAt: ago(2) });
    const older = invitation({ sentAt: ago(4) });
    expect(sortInvitations([older, fresh, old]).map((item) => item.id)).toEqual([old.id, fresh.id, older.id]);
  });

  it('names the role and, below the university, the area', () => {
    expect(roleLine({ role: 'institution_administrator', scopeLabel: 'Lagos State University' })).toBe('Institution admin');
    expect(roleLine({ role: 'faculty_administrator', scopeLabel: 'Faculty of Engineering' })).toBe('Faculty admin · Faculty of Engineering');
  });
});

describe('staff directory', () => {
  const ece = 'Electronic and Computer Engineering, Faculty of Engineering';
  const mce = 'Mechanical Engineering, Faculty of Engineering';
  const people = [
    member({ displayName: 'Zainab Bello', scopeLabel: mce, recentSessions: 3 }),
    member({ displayName: 'Ade Okafor', scopeLabel: ece }),
    member({ displayName: 'Kunle Ajayi', role: 'department_administrator', scopeLabel: ece }),
    member({ displayName: 'Bisi Eze', scopeLabel: ece, status: 'suspended' }),
    member({ displayName: 'Funmi Adebayo', role: 'institution_administrator', scopeLabel: 'Lagos State University', email: 'admin@lasu.edu.ng', staffNumber: null }),
  ];

  it('puts administrators first, then lecturers by department', () => {
    const groups = groupMembers(people);
    expect(groups.map((group) => [group.title, group.members.map((item) => item.displayName)])).toEqual([
      ['Administrators', ['Funmi Adebayo', 'Kunle Ajayi']],
      [expect.stringContaining('Electronic'), ['Ade Okafor', 'Bisi Eze']],
      [expect.stringContaining('Mechanical'), ['Zainab Bello']],
    ]);
    expect(groups[1]?.aside).toBe('Faculty of Engineering');
  });

  it('calls a single department’s lecturers just Lecturers', () => {
    expect(groupMembers(people.filter((item) => item.scopeLabel === ece && item.role === 'lecturer'))[0]?.title).toBe('Lecturers');
  });

  it('filters and counts', () => {
    expect(applyFilter(people, 'quiet', NOW).map((item) => item.displayName)).toEqual(['Ade Okafor']);
    expect(applyFilter(people, 'suspended', NOW).map((item) => item.displayName)).toEqual(['Bisi Eze']);
    expect(applyFilter(people, 'admins', NOW)).toHaveLength(2);
    expect(countStaff(people, NOW)).toEqual({ lecturers: 3, active: 1, quiet: 1, suspended: 1, admins: 2 });
  });

  it('finds by name, email or staff number, ignoring case, spaces and accents', () => {
    const found = member({ displayName: 'Adébáyọ̀ Olúwaṣeun', email: 'seun@lasu.edu.ng', staffNumber: 'LASU/ENG 204' });
    expect(matches(found, 'adebayo')).toBe(true);
    expect(matches(found, 'SEUN@')).toBe(true);
    expect(matches(found, 'eng204')).toBe(true);
    expect(matches(found, 'chidi')).toBe(false);
  });
});

describe('role change review', () => {
  const result = (overrides: Partial<StaffPositionChangeResult>): StaffPositionChangeResult => ({
    applied: false,
    from: { role: 'lecturer', scopeLabel: 'Computer Science, Faculty of Science' },
    to: { role: 'department_administrator', scopeLabel: 'Computer Science, Faculty of Science' },
    workspaceChanges: true,
    coursesLeaving: [],
    openDisputes: 0,
    teachingNow: false,
    emailSent: false,
    ...overrides,
  });
  const course = (courseCode: string, otherLecturers: number) => ({ courseCode, courseTitle: 'Title', departmentName: 'Computer Science', semesterName: 'First Semester', otherLecturers });

  it('puts courses nobody else teaches first, then disputes, then the workspace', () => {
    const notes = positionConsequences(result({ coursesLeaving: [course('CSC 301', 0), course('CSC 305', 2)], openDisputes: 3 }), 'Folasade');
    expect(notes.map((note) => note.tone)).toEqual(['warning', 'warning', 'neutral']);
    expect(notes[0]!.text).toBe('Nobody else teaches CSC 301. Add a lecturer from Courses so attendance can carry on.');
    expect(notes[1]!.text).toBe('3 attendance disputes are waiting on those courses. They wait for the next lecturer.');
    expect(notes[2]!.text).toMatch(/^Folasade gets the administrator workspace for Computer Science/);
  });

  it('keeps it to one line when nothing else is affected', () => {
    expect(positionConsequences(result({ workspaceChanges: false, to: { role: 'lecturer', scopeLabel: 'Physics' } }), 'Tunde'))
      .toEqual([{ tone: 'neutral', text: 'It applies on Tunde’s next tap. Same account and password; no new invitation.' }]);
    expect(positionConsequences(result({ coursesLeaving: [course('A', 1)], openDisputes: 1 }), 'T')[0]!.text).toBe('1 attendance dispute is waiting on that course. The other lecturers can decide it.');
  });

  it('offers reasons the API accepts', () => {
    for (const reason of POSITION_REASONS) expect(reason.length).toBeGreaterThanOrEqual(REASON_MIN);
  });
});
