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

export type GuideTopic = { readonly title: string; readonly body: readonly string[] };

/**
 * Longer answers for a page, opened from its Guide button. Pages carry no paragraphs of their
 * own; what a person may need to know once lives here.
 */
export const GUIDE_TOPICS: Readonly<Record<string, readonly GuideTopic[]>> = {
  '/sessions': [
    {
      title: 'Screen code or poster?',
      body: [
        'A screen code changes every 30 seconds, so a photo sent to a group chat soon stops working. Show it on a projector or TV, or walk your phone round the room.',
        'A poster is one fixed code to download or print. It works until attendance closes, so pair it with the room check: then a photo of it is no use from outside.',
      ],
    },
    {
      title: 'Checking students are in the room',
      body: [
        'Pick a venue whose location is registered and keep “Check they are in the room” on. Each phone’s location is checked when the student marks attendance.',
        'Students who were outside, or whose location could not be confirmed, are flagged on the list. Tap a name to see the distance and how accurate the phone was.',
      ],
    },
    {
      title: 'Adding a student by hand',
      body: [
        'For a student who is in class but cannot scan: a dead phone, or no smartphone. They are marked “Added by you” on the list and in every export.',
        'Class reps can add up to 10 while attendance is open, from inside the venue. After it closes, only the lecturer can add, and those entries are marked “Added after class”.',
      ],
    },
    {
      title: 'What the flags mean',
      body: [
        'Same phone: several students checked in on one phone. It can be a friend helping, or one person marking for others.',
        'Face to review: the face matched, but not clearly. It counts as present until you approve or reject it on Face checks.',
        'Typed details: the student has no account yet. Tap the name to correct a typo; if the matric number belongs to an account, the entry moves to it.',
      ],
    },
    {
      title: 'Closing, reopening and deleting',
      body: [
        'Attendance closes by itself at the end time. Close it early when the class is in, or add 15 minutes while it is open.',
        'A closed session can be reopened for 15 minutes. Delete only a session opened by mistake: it takes everyone off the register.',
      ],
    },
  ],
};
