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
  '/face-checks': 'Check-ins whose face matched, but not clearly. Compare the photos: same person, or remove them from that class.',
  '/admin/staff': 'Who runs attendance and administration, who uses the app lately, and who is still to join. Invite, correct or suspend.',
  '/class-list': 'Each set’s official list, and how far every student has got with their account. Students open accounts from it, so register names come from here.',
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
  '/face-checks': [
    {
      title: 'Why a check-in is here',
      body: [
        'Every check-in compares the student’s face with the face they registered. A clear match needs nothing from you. A close one passes too, so the student counts as present, but the photo is kept here for a person to look at.',
        'The scale shows where the score fell between passing and a clear match. Weak matches sat nearest the pass line: look at those most carefully.',
      ],
    },
    {
      title: 'Comparing the photos',
      body: [
        'Look at what does not change: the shape of the face, eyes, nose, ears and hairline. Light, glasses, a beard or a headscarf can lower the score without meaning anything.',
        'A photo of a photo or of a screen often shows edges, glare, or a face that is flat and evenly lit.',
      ],
    },
    {
      title: 'What each choice does',
      body: [
        'Same person: the check-in stands and the flag goes. Not the same: the student is taken off that class’s list with your reason. They see it was removed and can speak to you; the decision is in the Audit log.',
        'Decisions are final here. To undo a removal, open the session and put the student back on the list.',
      ],
    },
    {
      title: 'Faster with a keyboard',
      body: [
        'J or ↓ moves to the next check and K or ↑ to the one before. A means same person and X not the same; then 1 to 3 pick a reason, Enter removes and Escape goes back.',
        'After each decision the next check opens by itself, with its photos already loaded. On a phone, tap a check and the same happens in the sheet.',
      ],
    },
    {
      title: 'How long photos are kept',
      body: [
        'A check-in photo is kept only for close matches, and deleted automatically after the period set in Data retention. A check whose photo is gone can still be decided from the registered face and the session.',
      ],
    },
  ],
  '/admin/staff': [
    {
      title: 'Who you see and who you can invite',
      body: [
        'You see the staff you could have invited yourself, plus yourself. A department administrator invites lecturers and other department administrators for their department; a faculty administrator also invites faculty administrators; an institution administrator invites anyone.',
        'Lecturers take attendance for their own courses. Administrators also see their area’s reports, class lists and settings.',
      ],
    },
    {
      title: 'Inviting someone',
      body: [
        'Invite sends them an email with a link. It works once and lasts 7 days; opening it, they choose their own password, which also confirms their email.',
        'If the email didn’t arrive or the link expired, open them under Invited and send a new link: the old one stops working. Revoke if you invited the wrong address.',
      ],
    },
    {
      title: 'Last active and sessions',
      body: [
        'Last active is when they last used LASUATOS on any device. Sessions counts the attendance sessions they started in the last 30 days.',
        'A lecturer who joined more than a week ago and hasn’t started a session in 30 days is marked Quiet, so you can check whether they need help. Choose “No sessions in 30 days” to list just them.',
      ],
    },
    {
      title: 'Correcting details',
      body: [
        'Open someone and choose Edit details to fix a name or staff number. Their email, role and area stay as they were invited.',
      ],
    },
    {
      title: 'Suspending and reactivating',
      body: [
        'Suspend when someone leaves or their account may be misused. They are signed out on every device at once and can’t sign in until reactivated; their sessions and records stay.',
        'Each suspension and reactivation is kept in the Audit log with your name and the reason you chose. You can’t suspend yourself.',
      ],
    },
  ],
  '/class-list': [
    {
      title: 'Who keeps the lists',
      body: [
        'A HOC keeps their own set’s list. A GHOC sees every department’s list for their set in the faculty. Administrators see the lists in their department, faculty or the whole institution.',
        'Students can’t open an account unless their matric number is on a list, so the names on every register are the list’s names, not what students type.',
      ],
    },
    {
      title: 'Adding students',
      body: [
        'Choose Add students and upload the Excel or CSV list you already have, paste rows copied from a spreadsheet, or add one student. Matric number, surname and first name are needed; middle name and LASU email are optional.',
        'Every row is checked first and you see what will change. Nothing is saved while a row has a problem. Students already on the list are updated, never added twice.',
      ],
    },
    {
      title: 'The four stages',
      body: [
        'Not opened: the student hasn’t opened their account yet. Opened: they have, but haven’t confirmed their LASU email. Email confirmed: they still need to register their face. Ready: they can check in.',
        'Tap a stage on the progress card to see just those students. Remind the class writes a message for the group chat naming who still has a step to do.',
      ],
    },
    {
      title: 'Setup codes',
      body: [
        'When a student can’t get the emailed code, open them and choose Give setup code. It works once, for 30 minutes, and a new code replaces the old one.',
        'Give it to the student yourself, face to face or by direct message, never in a group chat. Once their LASU email is confirmed they reset their own password instead.',
      ],
    },
    {
      title: 'Corrections, faces and releasing an account',
      body: [
        'Correct a name or matric number from the student’s sheet; it changes everywhere at once. A confirmed LASU email can’t be changed, and only an administrator can change the matric number once the account is open.',
        'Administrators can reset a registered face that isn’t the student’s, or release an account someone else confirmed with the wrong email. Every change is kept under Recent changes and in the Audit log.',
      ],
    },
  ],
};
