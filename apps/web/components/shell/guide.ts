/**
 * One line on what each workspace page is for. Screens stay free of explanations; the guide
 * sheet (components/guide-sheet.tsx) is the one place to read them, grouped like the sidebar.
 * Keep each line short, concrete and in plain words.
 */
export const PAGE_GUIDE: Readonly<Record<string, string>> = {
  '/admin': 'Attendance this week, what needs you, and how far setup has come.',
  '/sessions': 'Open attendance for any class, show the QR code, and watch check-ins arrive.',
  '/admin/attendance': 'How well students attend, who is below 75%, and how each course and department is doing.',
  '/registers': 'Every course’s students against its classes, with percentages for exam eligibility. Download or print.',
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
        'A closed session can be reopened for 15 minutes, up to 12 hours after it ended; after that, add latecomers by hand. Delete only a session opened by mistake: it takes everyone off the register.',
      ],
    },
  ],
  '/admin/attendance': [
    {
      title: 'How the rate is worked out',
      body: [
        'Each course has a list of everyone who has attended at least one of its classes. A class’s rate is the share of that list who were present, the same as in Course registers.',
        'The big number puts every class in the period together. Bars on the chart are days (weeks for a semester); the line marks 75%.',
      ],
    },
    {
      title: 'Below 75%',
      body: [
        'Students who have attended fewer than three in four of a course’s classes this semester, worst first. A course counts once it has met 3 times, so one missed class does not put anyone here.',
        'Tap a student to open that course’s register. The semester comes from Academic structure; without one, the last 90 days are used.',
      ],
    },
    {
      title: '7 days, 30 days or semester',
      body: [
        '7 and 30 days end today and compare with the same span just before. Semester runs from the first day of the current semester.',
        'Tap a department to see only its classes, and the cross on its name to see everything again. A session counts under the department it was opened for.',
      ],
    },
    {
      title: 'What the checks mean',
      body: [
        'Added by hand: the person taking attendance added the student. Outside the venue: the phone was outside the room’s area when the student checked in.',
        'Same phone: one phone checked in more than one student in a class. Removed: taken off a list after checking in, not counted as present.',
      ],
    },
  ],
  '/registers': [
    {
      title: 'Who is on a register',
      body: [
        'Everyone who has checked in to at least one of the course’s sessions, or was added by hand. A student’s percentage is the sessions they attended out of all the sessions held in that semester.',
        'Courses are listed by code. This semester’s show the average and how many are below the required attendance; tap one to open its register.',
      ],
    },
    {
      title: 'Required attendance',
      body: [
        '75% unless you choose another from the options button on a register (50% to 80%). The choice is kept on this device and used for the list, the download and the printout.',
        'Tap a student to see each session they attended or missed, and how many in a row would bring them back to the required attendance.',
      ],
    },
    {
      title: 'Semesters',
      body: [
        'A register shows the latest semester with sessions. Pick another from the menu under the title. Sessions outside every semester in Academic structure are grouped together, and Every session shows them all.',
      ],
    },
    {
      title: 'Download and print',
      body: [
        'Download for Excel gives P or A for every session, the totals and who is eligible. Print gives the same grid on paper, ready to sign, without the app around it.',
        'On a computer the latest sessions are shown first; scroll left for earlier ones. Tap a date to open that session.',
      ],
    },
  ],
};
