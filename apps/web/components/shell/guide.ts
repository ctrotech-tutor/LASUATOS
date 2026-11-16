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
  '/class-reps': 'Who represents each set: a GHOC for the faculty and a HOC for each department. See who takes attendance, fill open posts, replace or remove a rep.',
  '/admin/venues': 'Each lecture room on the map, the boundary a check-in must land in, and how check-ins there have gone. Add rooms, draw boundaries, test a spot on site.',
  '/admin/courses': 'The codes and titles lecturers choose from. Hide old courses or rename a code prefix in one step.',
  '/admin/structure': 'Where today falls in the session, the faculties and departments people belong to, how long each programme runs, and the sessions and semesters.',
  '/admin/messages': 'What people sent the LASUATOS team from the contact page: what is overdue, privacy requests and their deadline. Reply by email, then mark each one handled with a note.',
  '/admin/audit': 'Every change made in LASUATOS, who made it and when: what changed, the reason given, and the changes worth a second look. Filter, search, download as CSV.',
  '/attendance': 'Where you stand for exams: each course against the 75% line, what it takes to stay above it, and every lecture you attended, missed or had removed.',
  '/admin/retention': 'What face data is due for deletion and when the nightly clean-up takes it, what is stored, and each set’s students: whose face goes next and who keeps it for now.',
};

export type GuideTopic = { readonly title: string; readonly body: readonly string[] };

/**
 * Longer answers for a page, opened from its Guide button. Pages carry no paragraphs of their
 * own; what a person may need to know once lives here.
 */
export const GUIDE_TOPICS: Readonly<Record<string, readonly GuideTopic[]>> = {
  '/attendance': [
    {
      title: 'How your percentage is worked out',
      body: [
        'For each course: the lectures you attended, out of every lecture of that course held this semester by the lecturers and class reps whose lectures you attended. It is the same number your course register shows.',
        'A lecture counts once it is over. While one is still taking attendance it is not missed yet, but if you have checked in it counts straight away.',
        'You need 75% in a course to be eligible for its exam. The gold tick on each ring marks that line.',
      ],
    },
    {
      title: '“Can miss” and “attend the next”',
      body: [
        '“Can miss 2 more” is how many lectures in a row you could miss from today and still be at 75% or above. “On the line” means missing the next one takes you under.',
        '“Attend the next 4 in a row” is how many lectures you need without a miss to get back to 75%. Both change after every lecture.',
      ],
    },
    {
      title: 'Missed and removed lectures',
      body: [
        'Missed: a lecture of your course was held and you have no check-in for it. If you were there, ask the lecturer or class rep to add you; they can do it from their list.',
        'Removed: you checked in, but the lecturer, a class rep or a face check took it off the list, with the reason shown. It counts as not attended. Speak to them if it is wrong.',
      ],
    },
    {
      title: 'What a check-in proves',
      body: [
        'A QR scan or typed code records when you used it. For lectures linked to a venue, your phone also shares its location at that moment, and when face checks are on, a quick look at the camera confirms it is you. An imprecise location still counts as present.',
        'Your lecturer or class rep can see the list and remove entries that are wrong, and you see that here. The privacy notice says what is stored and who can see it.',
      ],
    },
  ],
  '/admin/courses': [
    {
      title: 'What the course list is for',
      body: [
        'Lecturers and class reps pick a course from this list when they open a session, so every register uses the same code and title. A course nobody can find is usually typed by hand and ends up on a register of its own.',
        'The list starts with the built-in courses from the NUC CCMAS (2022) for engineering and technology. Courses added here sit alongside them.',
      ],
    },
    {
      title: 'Built-in, changed and added',
      body: [
        'Built-in courses come with LASUATOS. Faculty and institution administrators can correct one for everyone here: change its code, title or units. It then shows as Changed, with its built-in code if that changed.',
        'Added courses were added here, by any administrator, or by a lecturer opening a session for a course that was missing. Whoever added a course can correct it.',
      ],
    },
    {
      title: 'Hiding or removing a course',
      body: [
        'Hide a course nobody should pick any more. Sessions already taken keep it, its register stays, and you can show it again any time.',
        'An added course that was never taught can be removed instead. A changed built-in course can have its changes undone, which brings the built-in version back.',
      ],
    },
    {
      title: 'Needs a look',
      body: [
        'Units not set: sources disagree on that course’s units, so they were left blank. Set them from the department’s course list.',
        'Same title: two codes with one title are often one course added twice. Sessions then split between two registers. Keep one, and hide the other or change its code to match.',
      ],
    },
    {
      title: 'Changing a code, or a whole prefix',
      body: [
        'When a department renames a course (GET 201 taught as MEE 201), open it and choose Edit. Sessions already taken can move to the new code so the register continues.',
        'When every course with one prefix changes, use Rename a code prefix in the menu beside Add course. You see each change, and anything that would be skipped, before anything is saved; it all happens together or not at all.',
      ],
    },
  ],
  '/admin/retention': [
    {
      title: 'Why face data is deleted',
      body: [
        'A registered face is personal data, and LASUATOS keeps it only while attendance needs it. Once a set has finished its programme and the grace period has passed, the registered faces of its students are deleted for good.',
        'Accounts, class lists and attendance records are kept. A student who comes back, for an extra year or a carry-over course, can register their face again.',
      ],
    },
    {
      title: 'When a set is due',
      body: [
        'A set finishes on 1 September after its last year: the entry year (from the class list) plus the department’s programme length, which is set in Academic structure. Its faces are due the grace period after that, 12 months by default (the page lists the periods in use under The rules).',
        'A set shows on this page from two years before its faces are due, so you can see what is coming, until every face in it has gone.',
      ],
    },
    {
      title: 'Kept while still checking in',
      body: [
        'A student whose set is due but who checked in to a lecture recently keeps their face: 180 days by default. Their face goes at the first clean-up after that many days without a check-in, and the set shows the date for each one.',
        'Open a set to see every student on its class list: whose face goes at the next run, who keeps it for now, who is still within the grace period, and who never registered one.',
      ],
    },
    {
      title: 'Check-in photos',
      body: [
        'When a face matches, but not clearly, the photo taken at check-in is kept so someone can compare it in Face checks. These photos are deleted after 90 days by default, whatever the set.',
      ],
    },
    {
      title: 'The nightly clean-up',
      body: [
        'Every night at 3:30 am (Lagos time) LASUATOS deletes whatever is due, across the whole institution. Each run is listed under Recent clean-ups, and each deleted face is written to the audit log.',
        'An institution administrator can also delete what is due straight away with Delete now, for example before handing over records. Faculty and department administrators see their own area and cannot delete by hand.',
        'Faces of students on no class list are counted under Faces stored but are never reached by the clean-up, because they belong to no set. Add those students to a class list, or reset their face from Class lists.',
      ],
    },
  ],
  '/admin/audit': [
    {
      title: 'What the audit log records',
      body: [
        'Every change people make: class lists uploaded or corrected, accounts opened, released or taken over, faces registered, reset or refused, students added to or removed from a lecture by hand, staff invited, edited or suspended, faculties, departments, sessions and venues changed, and the nightly clean-up of face data.',
        'Entries cannot be edited or deleted, not even by an institution administrator. Times are Lagos time.',
      ],
    },
    {
      title: 'Worth a look',
      body: [
        'Some changes take something away from a person or hand an account to someone else: an account released or taken over, a face reset or refused, a student removed from a lecture or a class list, a staff member suspended, a faculty or department switched off. These are marked Worth a look.',
        'Nothing is wrong with them, and nothing is blocked. They are simply the ones to read when you check what happened this week.',
      ],
    },
    {
      title: 'Finding something',
      body: [
        'Search finds a matric number, a name or email address, a course code, a venue or a department. Combine it with a kind of change, a period and Worth a look.',
        'Open an entry and choose Everything by them to see what one person did, or Everything about it to see the whole history of a student, course or room. The address bar keeps every filter, so a copied link opens the same view.',
        'On a computer, J and K move down and up the list, and Escape closes the entry.',
      ],
    },
    {
      title: 'What an entry shows',
      body: [
        'What happened and to whom, who did it and when, what changed (the old value struck through, then the new one), the reason they gave, and buttons to the register, class list or settings page it touched.',
        'Stored record shows the entry exactly as it is kept, with internal ids, for anyone who needs to trace it in the database.',
      ],
    },
    {
      title: 'Downloading',
      body: [
        'Download CSV saves the entries under the current filters, up to 5,000 rows, as a spreadsheet that opens in Excel or Google Sheets. Narrow the period if you need more.',
        'The file holds names, matric numbers and email addresses. Keep it somewhere only the people who need it can open, and delete it when you are done.',
      ],
    },
    {
      title: 'Who sees what',
      body: [
        'Institution administrators see everything. Faculty and department administrators see student, face and attendance changes in their own faculty or department, changes to that faculty or department itself, and the staff, structure and venue changes they made themselves. The line under the page title says which area you see. Lecturers and class reps do not have an audit log.',
      ],
    },
  ],
  '/admin/messages': [
    {
      title: 'Where messages come from',
      body: [
        'Anyone can write to the LASUATOS team from the contact page, signed in or not. Each message gets a reference such as LA-7K3P9Q, which the sender sees and which goes in the subject of every reply.',
        'Every institution administrator is emailed about each new message, with a button that opens it here. The contact page sends attendance entries to lecturers and class reps, and names and matric numbers to HOCs, so what lands here is what only the team can deal with.',
      ],
    },
    {
      title: 'Reply dates',
      body: [
        'The contact page promises a reply within two working days (Monday to Friday), so a message sent on Friday afternoon is due on Tuesday afternoon. After that it shows as Overdue.',
        'Privacy requests (a copy of someone’s data, a correction, deleting face data, an objection) must be answered within 30 days under the Nigeria Data Protection Act. They are listed first under Needs a look, with the days left.',
      ],
    },
    {
      title: 'Replying',
      body: [
        'Reply by email opens your email app addressed to the sender, with the reference in the subject and their message quoted. Some messages also offer a draft, such as asking for more detail about a problem. Read the draft and change it before you send it.',
        'Signed in means the sender was signed in to the LASUATOS account that uses that email address. When they were not, the address is not confirmed: before you change an account or send anyone’s data, ask them to write from their account’s email or confirm who they are with their HOC.',
      ],
    },
    {
      title: 'Handled, and the note',
      body: [
        'Once you have replied, mark the message handled so other administrators know it is done. Handling a new message moves on to the next one.',
        'Add a note of what you did. For privacy requests it is the record of how the request was answered. Only institution administrators see notes. You can edit a note later; who handled the message, and when, stay the same.',
        'Move back to new if something still needs doing. Handled messages are deleted a year after they were handled, and any message after two years.',
      ],
    },
    {
      title: 'Finding a message',
      body: [
        'Search finds a reference exactly, or words in a name, email address or message, within New, Handled or All. Choose a topic to see only that kind of message.',
        'Each message has its own link (Copy link in its menu), and Also from this sender lists the sender’s other messages. On a computer, press J and K to move down and up the list, and Escape to close the message.',
      ],
    },
  ],
  '/admin/structure': [
    {
      title: 'What this page is for',
      body: [
        'Faculties and departments decide where lecturers and students belong: who sees which class lists, which administrator looks after whom, and how attendance is grouped. Sessions and semesters date everything, so registers and the overview know which semester a class falls in.',
        'The card at the top shows where today falls in the current session: the semester, the week, and how long is left. Tap it to see the whole session.',
      ],
    },
    {
      title: 'Programme length and levels',
      body: [
        'A student’s level is worked out from their entry year, the current session and their department’s programme length. Engineering and law usually run 5 years, medicine 6, most others 4.',
        'Students who have gone past the last year show as that level, extra year. Each set’s registered faces and check-in photos are deleted a set time after its programme ends (see Data retention), so a shorter programme means sooner deletion.',
      ],
    },
    {
      title: 'The current session',
      body: [
        'Only one session is current. Making another current moves every student’s level at once, so switch when the new session actually begins.',
        'A session’s semesters can be renamed, moved, or one added (up to three), but not removed, because classes and course offerings point at them. When none is current, levels use the session that includes today, or failing that the calendar, with the year starting in September.',
        'New session fills in one year on from the latest session. Check its dates against the approved calendar before adding it.',
      ],
    },
    {
      title: 'Adding and deactivating',
      body: [
        'A faculty’s or department’s code is permanent and unique in the institution, so choose it carefully. Its name and programme length can be changed later.',
        'Deactivate a department that has closed or merged. It leaves sign-up, staff invitations and new course offerings; its people, class lists and records are kept, and it can be reactivated. A faculty can be deactivated once all its departments are, and a department can only come back while its faculty is active.',
      ],
    },
    {
      title: 'Needs a look',
      body: [
        'No current session, or the current one has ended: levels may be wrong until the right session is current.',
        'The session ends within 90 days and nothing follows it: set up the next one so it is ready to switch to.',
        'A department with no lecturers or no class list can’t take attendance yet. A department with lecturers but no classes in 30 days, past the second week of a semester, may have stopped using LASUATOS.',
      ],
    },
    {
      title: 'Who can change what',
      body: [
        'Institution administrators manage everything here, including faculties and sessions. Faculty administrators add, edit and deactivate their faculty’s departments. Department administrators can correct their department’s name and programme length.',
        'Every change is listed under Changes, with who made it. The audit log keeps them all.',
      ],
    },
  ],
  '/admin/venues': [
    {
      title: 'Setting a venue up',
      body: [
        'Add the venue, then Set location. The quickest way is Tap the building: tap inside it on the map and its outline comes from OpenStreetMap. Or tap the room’s corners in order, or stand in each corner with a phone and use Start GPS.',
        'A new venue starts “Not active yet”. Once the boundary looks right, Activate it; only then can lecturers pick it when they open attendance.',
      ],
    },
    {
      title: 'Outline or circle?',
      body: [
        'An outline follows the walls, so a long hall or an L-shaped building is covered exactly. Use it for rooms and buildings.',
        'A circle is a centre and how far the furthest seat is. Use it for open spaces, such as a sports field, or when the walls can’t be traced.',
      ],
    },
    {
      title: 'The allowance',
      body: [
        'Phones indoors are often 10 to 30 metres off. The allowance is how far beyond the walls (or circle) a reading may land and still count. 15 to 25 metres suits most halls.',
        'With no allowance, students sitting inside can be turned away. Too large, and someone in the next building could check in.',
      ],
    },
    {
      title: 'Testing a spot',
      body: [
        'Stand where a student would sit and press Test this spot. Your phone’s position is checked with the same rules as a real check-in, and you see whether it would count, how far off you are, and how accurate the reading was.',
        'Try the back row and a corner. If a seat inside is turned away, widen the allowance or redraw the outline.',
      ],
    },
    {
      title: 'What the warnings mean',
      body: [
        'Landed outside or unclear: a fifth or more of recent check-ins with a location were outside the boundary or too rough to tell. If students really were inside, the boundary is too tight.',
        'Added by hand: a quarter or more of the people marked present were added by the person taking attendance. Checking in may be failing at this venue.',
        'Warnings need at least 20 check-ins in the last 30 days, so one odd class doesn’t raise one.',
      ],
    },
    {
      title: 'Check-ins on the map',
      body: [
        'The dots are where phones were when students checked in over the last 30 days: green inside, red outside, amber unclear. Only institution administrators see them, rounded to about a metre.',
        'Where the room had to be checked, a check-in from outside is turned away and not stored, so it does not appear here.',
      ],
    },
    {
      title: 'A bigger map',
      body: [
        'Every map has a full-screen button in its top corner. Press Done or Escape to come back. While setting a boundary you can keep tapping corners in full screen.',
      ],
    },
  ],
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
  '/class-reps': [
    {
      title: 'HOCs and GHOCs',
      body: [
        'A HOC represents one department’s set (for example the 2022/2023 set of Electronic and Computer Engineering). They take attendance from their phone, keep their class list and give classmates setup codes.',
        'A GHOC represents the same set across the whole faculty. They take attendance, see every department’s list for their set, and appoint the HOCs of their set. Administrators appoint GHOCs and HOCs; a department administrator appoints HOCs only.',
      ],
    },
    {
      title: 'Posts and open posts',
      body: [
        'Once a set has a class list or a rep in a faculty, every department of that faculty gets a HOC post for it, and the faculty a GHOC post. A post with no one in it shows as No HOC yet or No GHOC yet; tap it to appoint someone.',
        'Choose No rep to list only the open posts. Two people can share a post, for example in a very large class: untick Remove when you appoint the second.',
      ],
    },
    {
      title: 'Appointing someone',
      body: [
        'The student needs a LASUATOS account first. Pick them by name from the class list, or type their matric number or email. Their record is checked against the post: a different department or set is pointed out, but you decide.',
        'A student holds one post at a time, so appointing someone who is already a rep moves them. Appointing to a post that is held removes the current rep unless you untick it. They get the new access the next time they open the app.',
      ],
    },
    {
      title: 'Sessions and Quiet',
      body: [
        'Sessions counts the attendance sessions a rep started in the last 30 days, counted from their appointment. Many lecturers take attendance themselves, so few sessions is not a fault.',
        'A rep appointed over a week ago with no session in 30 days is marked Quiet, so you can check they still have access and know how. Choose Quiet to list just them.',
      ],
    },
    {
      title: 'Replacing and removing',
      body: [
        'Open a rep and choose Replace to appoint someone else to the same post; the current rep is removed once the new one is saved. Remove ends their access straight away.',
        'Their past sessions, registers and class list changes are kept either way, and the HOCs a GHOC appointed stay in their posts.',
      ],
    },
  ],
};
