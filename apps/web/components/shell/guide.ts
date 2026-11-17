import { ATTENDANCE_APPEAL_WINDOW_DAYS, ATTENDANCE_DISPUTE_WINDOW_DAYS } from '@lasuatos/contracts';

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
  '/admin/appeals': 'Disputes a lecturer turned down that the student took to the department: the class, both sides and the record. Mark them present or keep the lecturer’s decision; yours is final.',
  '/face-checks': 'Check-ins whose face matched, but not clearly. Compare the photos: same person, or remove them from that class.',
  '/admin/staff': 'Who runs attendance and administration, who uses the app lately, and who is still to join. Invite, correct, move to another role or suspend.',
  '/class-list': 'Each set’s official list, and how far every student has got with their account. Students open accounts from it, so register names come from here.',
  '/class-reps': 'Who represents each set: a GHOC for the faculty and a HOC for each department, and their assistants. See who takes attendance, fill open posts, replace or remove a rep.',
  '/assistants': 'Up to two classmates who help a HOC or GHOC: they take attendance, and do what else their HOC or GHOC allows.',
  '/admin/venues': 'Each lecture room on the map, the boundary a check-in must land in, and how check-ins there have gone. Add rooms, draw boundaries, test a spot on site.',
  '/admin/courses': 'The codes and titles lecturers choose from. Hide old courses or rename a code prefix in one step.',
  '/admin/structure': 'Where today falls in the session, the faculties and departments people belong to, how long each programme runs, and the sessions and semesters.',
  '/admin/messages': 'What people sent the LASUATOS team from the contact page: what is overdue, privacy requests and their deadline. Reply by email, then mark each one handled with a note.',
  '/admin/audit': 'Every change made in LASUATOS, who made it and when: what changed, the reason given, and the changes worth a second look. Filter, search, download as CSV.',
  '/lecturer/attendance': 'Open a class for a course students joined, show its QR code, and see who checked in and who has not.',
  '/lecturer/reports': 'Each course’s students against its classes: who is below the required attendance, what every mark means, and the changes made. Correct a mark, download or print.',
  '/lecturer/disputes': 'Students who say a mark in one of your courses is wrong: the class, what they say, and where they stand. Uphold to mark them present, or reject, with a note they read.',
  '/lecturer/courses': 'The courses you teach and who has joined each. Add a course, give its students a join code, and go to its sessions, report and disputes.',
  '/courses': 'Join a course with the code from its lecturer, see your attendance in each course so far, and the level worked out from your matric number.',
  '/attendance': 'Where you stand for exams: each course against the 75% line, what it takes to stay above it, and every lecture you attended, missed or had removed. Dispute a mark you think is wrong.',
  '/admin/health': 'Whether students can sign in, get their codes and check in right now: the database, each email provider and today’s allowance, the trends that raise alerts, recent alerts and the nightly clean-up.',
  '/admin/retention': 'What face data is due for deletion and when the nightly clean-up takes it, what is stored, and each set’s students: whose face goes next and who keeps it for now.',
  '/account/security': 'Your details, your registered face, your password, and every phone or computer signed in to your account.',
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
        'Missed: a lecture of your course was held and you have no check-in for it. Removed: you checked in, but it was taken off the list, with the reason shown. Both count as not attended.',
        'For a course you joined with a code, tap Dispute under the class (see Disputing a mark). For a lecture taken from a class list, ask the lecturer or class rep who took attendance that day to add you; they can do it from their list.',
      ],
    },
    {
      title: 'Disputing a mark',
      body: [
        'Were you in class but have no check-in, or was your check-in removed? Tap Dispute under the class, or open it from Disputes, and say what happened: where you sat and why the check-in failed. At least 20 characters; your lecturer reads every word.',
        'You can dispute a class for 14 days after it ends; a removed check-in straight away, a missing one once the class has closed. Up to 10 can wait for a decision at once.',
        'Your lecturer accepts it (you are marked present) or does not (your mark stays), with a note you can read here, and you get an email. While it waits you can withdraw it, and send it again within the 14 days.',
      ],
    },
    {
      title: 'Taking a dispute to your department',
      body: [
        `If your lecturer does not accept a dispute and you think they got it wrong, open it and tap Take it to your department, within ${ATTENDANCE_APPEAL_WINDOW_DAYS} days of their decision. Say what they may have missed: a classmate who saw you, or what their note gets wrong.`,
        'Your department’s administrators (the HOD’s office) read everything you and your lecturer wrote, and either mark you present or keep the lecturer’s decision. You get an email, and their decision is final.',
        'You can appeal a dispute once. While it waits you can withdraw it, but then you cannot send another for that class.',
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
  '/account/security': [
    {
      title: 'Where you’re signed in',
      body: [
        'Each time you sign in on a phone or computer, it stays signed in for 30 days. The list shows this device first, then the others with when each was last used.',
        'LASUATOS doesn’t record device names, so other sign-ins show only their dates. If one isn’t yours, sign it out, then change your password.',
        '“Sign out everywhere else” ends every sign-in except this one. Changing your password does the same.',
      ],
    },
    {
      title: 'Your password',
      body: [
        'A new account starts with LASU + your matric number + your SURNAME, like the LASU portal (Direct Entry students who opened theirs with a JAMB number: LASU + JAMB number + SURNAME). Anyone who knows your number can guess it, so change it to a phrase only you know.',
        'Forgot it? Sign out, then choose “Forgot password” on the sign-in page. Students can also get a 6-digit code to their LASU email.',
      ],
    },
    {
      title: 'Direct Entry: adding your matric number',
      body: [
        'Opened your account with your JAMB number? When your matric number and LASU email arrive, choose Add my matric number here. A code goes to your LASU email; once you enter it, your attendance, courses, face and password move to the matric number.',
        'Sign in with either number afterwards. Your personal email gets a note that it changed.',
      ],
    },
    {
      title: 'New face photos',
      body: [
        'If check-ins keep failing (new glasses, a new hairstyle, a dark first photo), take new photos in good light. You confirm with your password and a code sent to your LASU email, so no one holding your unlocked phone can change your face.',
        'The new photos must look like the ones you registered. If the registered photos are of someone else, ask your HOC to reset them.',
      ],
    },
    {
      title: 'Your name and matric number',
      body: [
        'Once your class list confirms you, your name and matric number come from it, and only your HOC can correct them. Until then you can correct them here; changing the matric number asks for your password.',
        'Lecturers add their LASU staff number once. After that only an administrator can change it.',
      ],
    },
  ],
  '/courses': [
    {
      title: 'Joining a course',
      body: [
        'Your lecturer gives out a 12-character code for each course, like 7K9M-PQ2R-4XBD. Type it with or without the dashes; capitals don’t matter. Codes never use 0, O, 1 or I, so no character can be mistaken for another.',
        'A code stops working when the lecturer replaces it and at the end of the semester. If yours doesn’t work, ask for the current one.',
        'Joining puts the course on your list. It doesn’t mark you present: in class you still scan the QR code or type the class code.',
      ],
    },
    {
      title: 'The attendance beside each course',
      body: [
        'The figure is the classes of that course you attended, out of those held so far. The tick on the bar marks the 75% you need for the exam. Tap a course to see every class in My attendance.',
        'A course with no classes yet says so. It fills in after the first class.',
      ],
    },
    {
      title: 'Your level',
      body: [
        'Your level is worked out from the first two digits of your matric number (your entry year), how you entered LASU (UTME at 100 Level, or Direct Entry at 200 or 300 Level), and how long your programme runs.',
        'Your department and how you entered come from your class list, so your HOC keeps them right. If either is wrong, ask your HOC (or an assistant HOC) to correct it; your attendance moves with you. Your level is for your information only: attendance is recorded the same either way.',
      ],
    },
  ],
  '/lecturer/attendance': [
    {
      title: 'Course sessions or Take attendance?',
      body: [
        'Course sessions are for courses students joined with your join code. Only those students can check in, and you see who has not checked in yet.',
        'Take attendance works for any class, with anyone who scans. Use it when a course has no join code yet.',
      ],
    },
    {
      title: 'The QR code and the typed code',
      body: [
        'The QR code changes every 20 seconds, so a photo sent to a group chat soon stops working. Show it full screen on a projector, or walk your phone round the room.',
        'Students who cannot scan type the 12-character code in My attendance. LASUATOS shows it once; if you lose it, show a new one and the old one stops working. Turn on QR code only to refuse typed codes altogether.',
      ],
    },
    {
      title: 'Marking someone present, or removing a check-in',
      body: [
        'Open a name under Not checked in (Absent, once the class is closed) to mark the student present, or under Present to remove a check-in. Each needs a reason of at least 10 characters, kept with the record for good.',
        'This works during class and after it. The student sees the change in My attendance, and can dispute it.',
      ],
    },
    {
      title: 'What the flags mean',
      body: [
        'Same phone: another student checked in on the same phone. It can be a friend lending a phone, or one person marking for others.',
        'Location unconfirmed: the class has a venue, but the phone’s location was too rough to tell. It still counts. Clearly outside readings are refused.',
      ],
    },
    {
      title: 'Time and closing',
      body: [
        'Attendance closes by itself at the end time. Add 15 minutes while it is open, up to four hours in all, or close it early once everyone is in. A closed class cannot be reopened.',
      ],
    },
  ],
  '/lecturer/disputes': [
    {
      title: 'What a dispute is',
      body: [
        `A student’s own account that a mark is wrong: they have no check-in for a class, or their check-in was removed. They can raise one for up to ${ATTENDANCE_DISPUTE_WINDOW_DAYS} days after the class, with a statement of at least 20 characters, and you get an email.`,
        'It is not evidence by itself. Decide from what you know: whether you saw them, the class, the reason a check-in was removed. Any lecturer of the course can decide it.',
      ],
    },
    {
      title: 'Upholding and rejecting',
      body: [
        'Upholding marks the student present for that class. Your note is kept with their record as the reason, like any correction, and the class’s changes list it. If they were already marked present, nothing in the register changes.',
        'Rejecting keeps the mark as it is. Either way the student reads your note in My attendance, and your decision cannot be changed or deleted.',
        `After a rejection the student can ask their department to look again, once, within ${ATTENDANCE_APPEAL_WINDOW_DAYS} days. The department’s administrators see the dispute, your note and the student’s appeal, and decide; you get an email either way, and the dispute shows Appealed, Upheld on appeal or Appeal rejected.`,
        'A student who has left the course cannot be marked present, so their dispute can only be rejected.',
      ],
    },
    {
      title: 'The figures in a dispute',
      body: [
        'Where the student stands in the course now, counted as the report counts it, and where upholding would put them, against the required attendance you chose for reports on this device.',
      ],
    },
    {
      title: 'Order, courses and the menu badge',
      body: [
        'Waiting disputes are oldest first, so no one waits longest; after a decision the next one opens. The waiting time turns amber after five days.',
        'Choose a course from the filter button to see only its disputes. The number by Disputes in the menu is how many are waiting across your courses.',
      ],
    },
  ],
  '/lecturer/reports': [
    {
      title: 'How a percentage is worked out',
      body: [
        'The classes a student attended, out of the classes held since they joined the course. Classes before they joined show a dash and do not count. A class still taking attendance counts once they check in; until it ends, not having checked in yet is not a miss.',
        'Students who left the course keep their marks but are not in the course figures or the below list.',
      ],
    },
    {
      title: 'What the marks mean',
      body: [
        'A dot is present: blue when the phone was in the room or the class had no room boundary, amber when the location was too rough to be sure (it still counts). A square is a student a lecturer marked present.',
        'A red cross is a check-in that was removed; it counts as missed. A ring is absent.',
      ],
    },
    {
      title: 'Correcting a mark',
      body: [
        'Tap a mark in the grid, or a student and then a class. Remove a check-in, or mark a student present, with a reason of at least 10 characters. The reason is kept with the record for good, and the student sees the change in My attendance and can dispute it.',
        'Every change to a class is listed in it, with who made it, when and why. Tap a class’s date to see them.',
      ],
    },
    {
      title: 'Required attendance, download and print',
      body: [
        '75% unless you choose another (50% to 80%) from the options button. The choice is kept on this device and used for the list, the download and the printout.',
        'Download for Excel gives P or A for every class with a note where it matters, the totals and who is below. Print gives the grid on paper, with P, A, P* (marked by a lecturer), A* (removed) and P? (location unsure).',
      ],
    },
  ],
  '/lecturer/courses': [
    {
      title: 'Adding a course',
      body: [
        'Pick the course from the course list, the same one you use to open sessions, so registers and reports agree on its code and title. If it is not there, add it to the list from the picker first.',
        'Choose the level you teach it at; it is filled in from the code where it can be (ECE 305 is 300 level). The course is offered by your department, for the semester you choose.',
      ],
    },
    {
      title: 'Join codes',
      body: [
        'Students join a course with its 12-character code, like 7K9M-PQ2R-4XBD, in My courses. Copy it, share it to the class group (the link fills the code in for them), or show it full screen with a QR code in class.',
        'A code shows only once: LASUATOS keeps a fingerprint of it, not the code itself. If you lose it, get a new one. The old code stops working, and nobody who joined leaves the course.',
        'Turn the code off when everyone has joined, so nobody else can. Every code stops working when the semester ends.',
      ],
    },
    {
      title: 'Changing a course',
      body: [
        'The level is yours to change. The title and units belong to the course on the course list, so they are the same on every session and register.',
        'If you added the course to the list, you can correct its title and units here, and the change shows everywhere it is used. Otherwise an administrator corrects them in Course list.',
      ],
    },
    {
      title: 'The numbers on each course',
      body: [
        'Students are those who joined with a code. Classes held counts the sessions you opened for the course. Disputes open are students saying their attendance was recorded wrongly; answer them in Disputes.',
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
  '/admin/health': [
    {
      title: 'What the colours mean',
      body: [
        'Green: everything works. Amber: something is degraded but students still get through, for example Brevo has used today’s emails and Gmail is sending instead, or the nightly clean-up is late.',
        'Red: students are affected now. The database cannot be reached or is behind the release, no email provider is set up, or emails failed on every provider in the last half hour.',
      ],
    },
    {
      title: 'Email providers and the daily allowance',
      body: [
        'Emails go through the first provider in the list that is ready. Brevo’s free plan allows 300 emails a day, Resend 100 and a Gmail account about 500. When a provider’s allowance is used up, or it refuses an email, LASUATOS moves on to the next one at once and the email still arrives.',
        'A provider that ran out is skipped until its allowance resets: 1:00 am Lagos time (midnight UTC), and a few hours later for Gmail, which counts the last 24 hours. A setup problem, such as a wrong key, skips it for 30 minutes. A skipped provider is still tried last if every other one fails.',
        'The counts are shared by every instance of LASUATOS, so one instance learning that Brevo is out saves the others from trying. To check every provider by hand, run pnpm prod:email:test --to your address. It sends one email through each.',
      ],
    },
    {
      title: 'Alerts',
      body: [
        'Alerts go to every address in ALERT_EMAIL in Vercel. You get one when email switches to a backup provider, when every provider fails, when a provider nears or reaches its allowance, and when a trend crosses its line.',
        'Repeats are held back: the same alert is emailed at most once an hour (every 6 hours for a provider switch), and the list here marks those as not emailed. The list keeps 30 days.',
      ],
    },
    {
      title: 'Trends',
      body: [
        'Each bar counts something across every instance over a short window, and an alert goes out when it fills: 80 wrong passwords or codes in 15 minutes, 60 requests refused as too fast in 10 minutes, 15 server errors in 10 minutes, or Google sign-ins failing.',
        'A full bar at the start of a big lecture is not always a problem. Many students checking in at once can trip the speed limits; if it keeps happening, tell the LASUATOS team.',
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
        'Every change people make: class lists uploaded or corrected, accounts opened, released or taken over, faces registered, reset or refused, students added to or removed from a lecture by hand, staff invited, edited, moved to another role or suspended, faculties, departments, sessions and venues changed, and the nightly clean-up of face data.',
        'Entries cannot be edited or deleted, not even by an institution administrator. Times are Lagos time.',
      ],
    },
    {
      title: 'Worth a look',
      body: [
        'Some changes take something away from a person or hand an account to someone else: an account released or taken over, a face reset or refused, a student removed from a lecture or a class list, a staff member suspended or given another role, a faculty or department switched off. These are marked Worth a look.',
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
    {
      title: 'Enrolled courses',
      body: [
        'Shown only where courses have class lists. Expected is every class that has ended, for each student who was on the list when it began, including students who have since completed the course. Students who withdrew are left out, and a class still taking attendance is not a miss yet.',
        'Present includes check-ins added by hand and those whose location was unclear; removed check-ins never count. A course’s rate is the same as in its lecturer’s course report.',
        'Disputes are decided by the course’s lecturers (or, on appeal, by the department in Appeals), and the figures change only when one is upheld. The colours mark 75%, a guide rather than university policy. See all searches every course and sorts by lowest rate, open disputes, most recent class or code.',
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
  '/admin/appeals': [
    {
      title: 'What an appeal is',
      body: [
        `A student disputed a mark, the course lecturer did not accept it, and the student asked the department to look again. They can do this once per dispute, within ${ATTENDANCE_APPEAL_WINDOW_DAYS} days of the lecturer’s decision, with a statement of at least 20 characters.`,
        'Appeals go to the administrators of the department that runs the course: the HOD’s office. Faculty administrators see their faculty’s appeals, and institution administrators see all of them. The first appeal waiting in a department sends its administrators an email.',
      ],
    },
    {
      title: 'Deciding',
      body: [
        'Read both sides: what the student said first, the lecturer’s note, and what the student says now. The record shows whether they checked in, and any change to it with its reason.',
        'Mark them present to accept the appeal: the register changes, and your note is kept with the record as the reason. Keep the lecturer’s decision to leave the mark as it is. Either way write a note of at least 10 characters; the student and the lecturer both read it and get an email.',
        'Your decision is final. It cannot be changed or deleted, and the audit log lists it.',
      ],
    },
    {
      title: 'When you cannot decide',
      body: [
        'If you turned the dispute down yourself as the course’s lecturer, another administrator has to decide the appeal, so nobody reviews their own decision.',
        'A student who has left the course cannot be marked present, so their appeal can only be kept as it is.',
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
      title: 'Changing someone’s role or area',
      body: [
        'Choose Change role or area to move someone, for example a lecturer appointed HOD or an administrator moving department. They keep their account and password; no new invitation is needed.',
        'Review change shows what will happen first: the courses they stop teaching this semester, with how many other lecturers each has, disputes waiting on them, and whether their menu changes. Past semesters keep their name.',
        'You can only move people within the area you manage, never yourself, and not while they are taking attendance. They get an email, and the change is in the Audit log.',
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
        'A HOC keeps their own set’s list. A GHOC sees every department’s list for their set in the faculty. Their assistants keep it too when allowed. Administrators see the lists in their department, faculty or the whole institution.',
        'Students can’t open an account unless their matric number is on a list, so the names on every register are the list’s names, not what students type.',
      ],
    },
    {
      title: 'Adding students',
      body: [
        'Choose Add students and upload the list file you already have (Excel, Word, PDF or CSV, old .xls and .doc too; not scans or photos), paste the list (from a spreadsheet, a Word or PDF list, or a WhatsApp message with one student per line), or add one student. Matric number, surname and first name are needed; middle name and email are optional.',
        'Every row is checked first and you see what will change. Nothing is saved while a row has a problem. Students already on the list are updated, never added twice.',
      ],
    },
    {
      title: 'Direct Entry students without a matric number',
      body: [
        'List them by their JAMB registration number (12 digits and 2 letters, like 202530074987JA): in the matric column, or in a JAMB column with the matric cell empty. They are saved as Direct Entry and may give a personal email until they have a LASU one.',
        'When the matric number arrives, the student adds it in Account, you type it over the JAMB number on their sheet, or you upload a list with both numbers. Their account and attendance move to the matric number.',
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
        'Correct a name, matric number or entry route (UTME or Direct Entry) from the student’s sheet; it changes everywhere at once. Students can’t change these themselves, so they come to you. A confirmed LASU email can’t be changed, and only an administrator can change the matric number once the account is open (except replacing a JAMB number with the matric number, which you can do).',
        'A student on the wrong department’s list? Open them and choose Wrong department, then where they belong. Their account and attendance go with them. A HOC or GHOC must be removed from their post first, and moving to another faculty takes an institution administrator.',
        'Administrators can reset a registered face that isn’t the student’s, or release an account someone else confirmed with the wrong email. Every change is kept under Recent changes and in the Audit log.',
      ],
    },
  ],
  '/assistants': [
    {
      title: 'Assistant HOCs and GHOCs',
      body: [
        'A HOC can choose up to two assistant HOCs (AHOCs) from their class, and a GHOC up to two assistant GHOCs (AGHOCs) from their faculty’s set. They share the work: every assistant can take attendance for the class, with the same rules as their HOC.',
        'Choose them by name from your class list, or type their matric number or email. They must be on the class list, have opened their account, and not hold a post already.',
      ],
    },
    {
      title: 'What they can do',
      body: [
        'Besides taking attendance, switch on only what you need: seeing every session in the class’s registers, keeping the class list (adding, correcting and moving students), giving setup codes, and for a GHOC’s assistant, appointing and removing HOCs. Changes apply the next time they open the app.',
        'Assistants never choose other assistants. A GHOC can manage the assistants of the HOCs in their set, and administrators can manage any in their area.',
      ],
    },
    {
      title: 'Removing or stepping down',
      body: [
        'Remove an assistant at any time. An assistant can step down from My team. When a HOC or GHOC is replaced or removed, their assistants stop too, so the new rep chooses their own.',
        'Sessions an assistant took are kept, and show who took them.',
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
