import { describe as group, expect, it } from 'vitest';
import { describe, keyValues, referencesOf } from './describe.js';
import type { AuditReferences, AuditRow } from './repository.js';

const DEPT = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const refs: AuditReferences = {
  departments: new Map([[DEPT, { code: 'ECE', name: 'Electronic and Computer Engineering' }]]),
  sessions: new Map([[SESSION, { courseCode: 'ECE 401', startsAt: new Date('2026-11-15T09:00:00Z') }]]),
  users: new Map([[OTHER, { name: 'Chioma Okafor', matricNumber: '250211184' }]]),
};

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: 'student:44444444-4444-4444-8444-444444444444',
  source: 'student',
  action: 'account_opened',
  actorId: null,
  actorName: null,
  subjectName: 'Ibrahim Musa',
  matricNumber: '250211190',
  targetLabel: null,
  targetType: null,
  targetCode: null,
  sessionId: null,
  classDepartmentCode: 'ECE',
  classEntryYear: 2025,
  staffEmail: null,
  staffRole: null,
  staffArea: null,
  details: '',
  createdAt: new Date('2026-11-15T10:00:00Z'),
  ...over,
});

const facts = (input: Partial<AuditRow>) => Object.fromEntries(describe(row(input), refs).facts.map((item) => [item.label, item.previous === null ? item.value : `${item.previous} > ${item.value}`]));

group('reading stored details', () => {
  it('splits key=value pairs whose values have spaces', () => {
    expect(keyValues(`session=${SESSION} course=ECE 401 reason=Known student; poor light`)).toEqual({ session: SESSION, course: 'ECE 401', reason: 'Known student; poor light' });
    expect(keyValues('registered face deleted; the student can register again')).toBeNull();
  });

  it('collects ids that need names, and only ids', () => {
    expect(referencesOf(row({ details: `session=${SESSION} course=ECE 401` }))).toEqual({ departments: [], sessions: [SESSION], users: [] });
    expect(referencesOf(row({ details: `replacement score=0.910 other_user=${OTHER}` }))).toEqual({ departments: [], sessions: [], users: [OTHER] });
    expect(referencesOf(row({ details: 'department=ECE set=2025' })).departments).toEqual([]);
  });
});

group('describing entries', () => {
  it('names the department and set of a class list upload, with a link', () => {
    const described = describe(row({ action: 'class_list_imported', subjectName: null, matricNumber: null, details: `department=${DEPT} set=2025 rows=62 added=58 updated=3 unchanged=1 linked=12` }), refs);
    expect(described.subject).toBe('Electronic and Computer Engineering · 2025/2026 set');
    expect(Object.fromEntries(described.facts.map((item) => [item.label, item.value]))).toMatchObject({ 'Rows in the file': '62', Added: '58', 'Linked to accounts': '12' });
    expect(described.links).toEqual([{ label: 'Open the class list', href: '/class-list?department=ece&set=2025' }]);
    expect(JSON.stringify(described)).not.toContain(DEPT);
  });

  it('turns a face check failure into the lecture, the reason and the location', () => {
    const described = describe(row({ action: 'face_check_failed', details: `session=${SESSION} course=ECE 401 failures=2 reason=mismatch venue=within` }), refs);
    expect(Object.fromEntries(described.facts.map((item) => [item.label, item.value]))).toEqual({
      Lecture: 'ECE 401 · Sun 15 Nov 2026',
      Why: 'Face did not match the registered face',
      'Failed checks': '2',
      Location: 'Inside the venue',
    });
    expect(described.links[0]).toEqual({ label: 'Open the ECE 401 register', href: '/registers/ECE401?q=250211190' });
  });

  it('shows who a refused face looked like, by name, never by id', () => {
    const described = describe(row({ action: 'face_duplicate_refused', details: `score=0.912 other_user=${OTHER}` }), refs);
    expect(described.notable).toBe(true);
    expect(Object.fromEntries(described.facts.map((item) => [item.label, item.value]))).toEqual({ 'Looked like': 'Chioma Okafor · 250211184', Similarity: '91%' });
    expect(facts({ action: 'face_replace_refused', details: 'score=0.412' })).toEqual({ 'Match with the old photos': '41%' });
  });

  it('reads an account release into the email change and keeps the reason as a note', () => {
    const described = describe(row({
      action: 'account_released',
      details: 'released from aisha.b@gmail.com; class list email now aisha.bello@student.lasu.edu.ng; 2 session(s) signed out; face deleted; attendance kept. Reason: Checked her ID card in person.',
    }), refs);
    expect(described.notable).toBe(true);
    expect(described.note).toBe('Checked her ID card in person.');
    expect(described.facts).toEqual(expect.arrayContaining([
      { label: 'Email', value: 'aisha.bello@student.lasu.edu.ng', previous: 'aisha.b@gmail.com' },
      { label: 'Signed out', value: '2 devices', previous: null },
      { label: 'Registered face', value: 'Deleted', previous: null },
    ]));
    expect(described.links[0]?.href).toBe('/class-list?department=ece&set=2025&student=250211190');
  });

  it('gives attendance changes their lecture, register and reason', () => {
    const described = describe(row({
      id: 'removal:55555555-5555-4555-8555-555555555555', action: 'attendee_removed', targetLabel: 'MEE 301 · 13 Nov 2026', targetType: 'lecture', targetCode: 'MEE 301',
      details: 'venue=outside reason=checked in from the hostel', classDepartmentCode: null,
    }), refs);
    expect(described).toMatchObject({ subject: 'Ibrahim Musa · 250211190 · MEE 301 · 13 Nov 2026', subjectSearch: '250211190' });
    expect(described.note).toBe('Checked in from the hostel');
    expect(Object.fromEntries(described.facts.map((item) => [item.label, item.value]))).toEqual({ Lecture: 'MEE 301 · 13 Nov 2026', 'Location at check-in': 'Outside the venue' });
    expect(described.links).toEqual([{ label: 'Open the MEE 301 register', href: '/registers/MEE301?q=250211190' }]);
  });

  it('reads structure and venue changes in either diff shape, and flags deactivations', () => {
    expect(facts({ source: 'structure', action: 'department_updated', targetType: 'department', targetCode: 'ECE', details: JSON.stringify({ programmeYears: [4, 5] }) }))
      .toEqual({ 'Programme length': '4 years > 5 years' });
    const off = describe(row({ source: 'structure', action: 'department_updated', targetType: 'department', targetCode: 'ECE', details: JSON.stringify({ isActive: [true, false] }) }), refs);
    expect(off.notable).toBe(true);
    expect(off.links).toEqual([{ label: 'Open the department', href: '/admin/structure?department=ece' }]);
    expect(facts({ source: 'structure', action: 'venue_deactivated', targetType: 'venue', targetCode: 'SCI-LH2', details: JSON.stringify({ status: { from: 'active', to: 'inactive' } }) }))
      .toEqual({ Status: 'Active > Inactive' });
    expect(facts({ source: 'structure', action: 'academic_session_created', targetType: 'academic_session', targetCode: '2026/2027', details: JSON.stringify({ code: '2026/2027', makeCurrent: true, semesters: ['First Semester', 'Second Semester'] }) }))
      .toEqual({ Code: '2026/2027', 'Made current': 'Yes', Semesters: 'First Semester, Second Semester' });
    expect(describe(row({ source: 'structure', action: 'academic_session_created', targetType: 'academic_session', targetCode: '2026/2027', details: '{}' }), refs).links[0]?.href).toBe('/admin/structure?session=2026-2027');
    expect(facts({ source: 'structure', action: 'department_created', targetType: 'department', details: JSON.stringify({ facultyId: DEPT, code: 'CSC', name: 'Computer Science', programmeYears: 4 }) }))
      .toEqual({ Code: 'CSC', Name: 'Computer Science', 'Programme length': '4 years' });
  });

  it('describes staff changes with email, role, area, and edits as changes', () => {
    expect(describe(row({ source: 'staff', action: 'staff_suspended', subjectName: 'Engr. Tunde Ade', matricNumber: null, staffEmail: 'tunde@lasu.edu.ng', staffRole: 'lecturer', staffArea: 'Mechanical Engineering', details: 'reason=On leave until January.' }), refs))
      .toMatchObject({ notable: true, note: 'On leave until January.', subjectSearch: 'tunde@lasu.edu.ng', links: [{ href: '/admin/staff' }] });
    expect(facts({ source: 'staff', action: 'staff_updated', matricNumber: null, details: 'reason=Staff number: none → LASU/CSC/482' })).toMatchObject({ 'Staff number': 'None > LASU/CSC/482' });
    expect(describe(row({ source: 'staff', action: 'invitation_revoked', matricNumber: null, details: 'reason=Wrong email' }), refs).links[0]?.href).toBe('/admin/staff?show=invited');
  });

  it('reads retention runs and venue locations', () => {
    expect(facts({ action: 'retention_run', subjectName: null, matricNumber: null, details: 'faces=3 check_photos=12 scheduled=true grace_months=12 active_days=180 photo_days=90' })).toEqual({
      'Faces deleted': '3', 'Check-in photos deleted': '12', Run: 'Nightly, by itself', 'Grace period': '12 months', 'Kept if active within': '180 days', 'Check-in photos kept': '90 days',
    });
    expect(facts({ source: 'venue', action: 'venue_location_updated', targetType: 'venue', targetCode: 'ENG-LT1', details: 'accuracy_m=4 radius_m=50 samples=20' }))
      .toEqual({ 'GPS accuracy': 'About 4 m', Boundary: '50 m around the point', 'GPS readings': '20' });
  });

  it('keeps unknown free text readable', () => {
    expect(facts({ action: 'something_new', details: 'did a thing' })).toEqual({ Details: 'Did a thing' });
  });
});
