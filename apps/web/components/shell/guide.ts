/**
 * One line on what each workspace page is for. Screens stay free of explanations; the guide
 * sheet (components/guide-sheet.tsx) is the one place to read them, grouped like the sidebar.
 * Keep each line short, concrete and in plain words.
 */
export const PAGE_GUIDE: Readonly<Record<string, string>> = {
  '/admin': 'Attendance this week, what needs you, and how far setup has come.',
  '/sessions': 'Open attendance for any class, show the QR code, and watch check-ins arrive.',
  '/admin/attendance': 'Every session in your area by department and course, with checks on how attendance was taken.',
  '/registers': 'Each course’s students against its sessions, with percentages for exam eligibility. Export or print.',
  '/face-checks': 'Check-ins whose face matched, but not clearly. They count until you approve or reject them.',
  '/admin/staff': 'Invite lecturers and administrators, and suspend or restore their access.',
  '/class-list': 'Official class lists. Students open their accounts from them, so names on registers come from here.',
  '/class-reps': 'HOCs take attendance for their department’s set; GHOCs cover the faculty set.',
  '/admin/venues': 'Lecture venues and their locations, used to confirm students are in the room.',
  '/admin/courses': 'The codes and titles lecturers choose from. Hide old courses or rename a code prefix in one step.',
  '/admin/structure': 'Faculties, departments, programme lengths, and the current academic session.',
  '/admin/messages': 'Requests and problem reports from the contact page. Reply by email, then mark them handled.',
  '/admin/audit': 'Every change, who made it and when. Search by matric number or name.',
  '/admin/retention': 'When registered faces and check-in photos are deleted, and the nightly clean-up.',
};
